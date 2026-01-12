/**
 * WASM compilation phase for ONNX Runtime
 *
 * Builds ONNX Runtime with Emscripten using official build script.
 */

import { existsSync, promises as fs } from 'node:fs'
import { cpus } from 'node:os'
import path from 'node:path'

import { formatDuration, getFileSize } from 'build-infra/lib/build-helpers'
import { printError } from 'build-infra/lib/build-output'
import { createCheckpoint, shouldRun } from 'build-infra/lib/checkpoint-manager'
import { ensureEmscripten } from 'build-infra/lib/emscripten-installer'

import { whichSync } from '@socketsecurity/lib/bin'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { safeDelete } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'
import { getDefaultSpinner } from '@socketsecurity/lib/spinner'

const logger = getDefaultLogger()
const spinner = getDefaultSpinner()

/**
 * Build ONNX Runtime with Emscripten.
 *
 * @param {object} options - Build options
 * @param {string} options.buildDir - Build directory
 * @param {string} options.modeSourceDir - Mode-specific source directory
 * @param {string} options.buildScriptFile - Build script file path
 * @param {string} options.buildMode - Build mode ('prod' or 'dev')
 * @param {boolean} options.isCI - Is running in CI environment
 * @param {object} options.buildOutputPaths - Build output paths (buildWasmFile, buildCmakeCacheFile, buildPostBuildScriptFile)
 * @param {boolean} options.forceRebuild - Force rebuild (ignore checkpoints)
 * @param {string} options.emscriptenVersion - Emscripten version to use (from build-infra package.json)
 */
export async function compileWasm(options) {
  const {
    buildDir,
    buildMode,
    buildOutputPaths,
    buildScriptFile,
    emscriptenVersion = 'latest',
    forceRebuild,
    isCI,
    modeSourceDir,
  } = options

  if (!(await shouldRun(buildDir, '', 'wasm-compiled', forceRebuild))) {
    return
  }

  logger.step('Building ONNX Runtime with Emscripten')

  // Auto-detect and activate Emscripten SDK.
  logger.substep(`Using Emscripten version ${emscriptenVersion}`)
  const emscriptenResult = await ensureEmscripten({
    version: emscriptenVersion,
    autoInstall: false,
    quiet: true,
  })

  if (!emscriptenResult.available) {
    printError('Emscripten SDK required')
    throw new Error('Emscripten SDK required')
  }

  const startTime = Date.now()

  // Clean stale cached files before build.
  // GitHub Actions may have restored old unpatched files from cache after clone step.
  // Delete them now to force CMake to recopy patched versions from source.
  logger.substep('Checking for stale cached build files...')
  const { buildCmakeCacheFile, buildPostBuildScriptFile, buildWasmFile } =
    buildOutputPaths

  // Delete cached wasm_post_build.js (CMake will recopy from patched source).
  if (existsSync(buildPostBuildScriptFile)) {
    await safeDelete(buildPostBuildScriptFile)
    logger.success('Removed stale wasm_post_build.js from cache')
  }

  // Clear CMake cache to force full reconfiguration.
  if (existsSync(buildCmakeCacheFile)) {
    await safeDelete(buildCmakeCacheFile)
    logger.success('Cleared CMake cache')
  }

  // ONNX Runtime has its own build script: ./build.sh --config Release --build_wasm
  // We need to pass WASM_ASYNC_COMPILATION=0 via EMCC_CFLAGS environment variable.

  const buildScript = buildScriptFile

  // Note: WASM_ASYNC_COMPILATION=0 is required for bundling but causes compilation
  // errors when passed via EMCC_CFLAGS (it's a linker flag, not compiler flag).
  // ONNX Runtime's build system handles Emscripten settings through CMake.
  // We pass it through --emscripten_settings which goes to EMSCRIPTEN_SETTINGS.

  // Enable WASM threading to avoid MLFloat16 build errors.
  // Issue: https://github.com/microsoft/onnxruntime/issues/23769
  // When threading is disabled, BUILD_MLAS_NO_ONNXRUNTIME is defined, which causes
  // MLFloat16 to be missing Negate(), IsNegative(), and FromBits() methods.
  // Workaround (if threading can't be used): Comment out BUILD_MLAS_NO_ONNXRUNTIME
  // in cmake/onnxruntime_webassembly.cmake after cloning.

  // Check if Ninja is available for faster builds
  const ninjaAvailable = whichSync('ninja', { nothrow: true })

  // Check if ccache is available for faster C++ compilation
  const ccacheAvailable = whichSync('ccache', { nothrow: true })

  // Get CPU count for optimal parallelization
  const cpuCount = cpus().length
  // Use 100% of cores in CI, 75% locally to avoid overwhelming the system
  const parallelJobs = isCI
    ? cpuCount
    : Math.max(1, Math.floor(cpuCount * 0.75))

  logger.substep(`Build mode: ${buildMode}`)
  logger.substep(
    `Parallelization: ${parallelJobs} jobs (${cpuCount} CPU cores available)`,
  )

  const buildArgs = [
    '--config',
    'Release',
    '--build_wasm',
    '--skip_tests',
    '--parallel',
    `${parallelJobs}`,
    // Required for ONNX Runtime v1.19.0+ (non-threaded builds deprecated).
    '--enable_wasm_threads',
    // Enable SIMD for better performance.
    '--enable_wasm_simd',
    // Disable RTTI to reduce build time and binary size.
    '--disable_rtti',
    // Use minimal operators to reduce build scope and time.
    '--minimal_build',
    'extended',
    // Allow running as root (required for Docker builds).
    '--allow_running_as_root',
  ]

  // Add optimization flags based on build mode
  if (buildMode === 'prod') {
    // Production: Maximum optimization (slower compile, smaller output)
    // Note: --enable_wasm_size_optimization was removed in ONNX Runtime v1.21+
    // Size optimization is now controlled via CMAKE_CXX_FLAGS in CMakeLists.txt
    logger.substep(
      'Optimization: Production build (size optimized via CMake flags)',
    )
  } else {
    // Development: Faster compile, larger output
    logger.substep('Optimization: Standard build (dev mode, faster)')
  }

  // Use Ninja if available (much faster than Make for large C++ projects)
  if (ninjaAvailable) {
    logger.substep('Using Ninja build system (faster)')
    buildArgs.push('--cmake_generator', 'Ninja')
  } else {
    logger.warn(
      'Ninja not found - using Make (slower). Install: brew install ninja',
    )
  }

  // Set up ccache for faster C++ compilation if available
  // NOTE: DO NOT set CC/CXX when using Emscripten - the toolchain file manages this
  const buildEnv = { ...process.env }
  if (ccacheAvailable) {
    logger.substep('Using ccache for faster C++ compilation')
    // Increase ccache size for large builds
    buildEnv.CCACHE_MAXSIZE = '10G'
    buildEnv.CCACHE_COMPRESS = '1'
    buildEnv.CCACHE_COMPRESSLEVEL = '6'
    // Note: We don't override CC/CXX here because Emscripten's CMake toolchain
    // file handles compiler configuration. Overriding causes CMake include errors.
  } else {
    logger.warn(
      'ccache not found - builds will be slower. Install: brew install ccache',
    )
  }

  // Start spinner with elapsed time updates
  spinner.start('Building ONNX Runtime (30-60 min)')

  // Update spinner every 5 seconds to show elapsed time
  const updateInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000)
    spinner.text(
      `Building ONNX Runtime (${formatDuration(elapsed * 1000)} elapsed)`,
    )
  }, 5000)

  let buildScriptResult
  try {
    buildScriptResult = await spawn(buildScript, buildArgs, {
      cwd: modeSourceDir,
      shell: WIN32,
      stdio: 'inherit',
      env: buildEnv,
    })
  } finally {
    clearInterval(updateInterval)
  }

  if (buildScriptResult.code !== 0) {
    spinner.stop()

    const errorMsg = [
      'ONNX Runtime build script failed',
      '',
      'Common causes:',
      '  ✗ Insufficient disk space (need ~5GB free)',
      '  ✗ Missing dependencies (cmake, python3, emscripten)',
      '  ✗ Compilation timeout or out-of-memory',
      '  ✗ Incompatible Emscripten version',
      '',
      'Troubleshooting:',
      '  1. Check build log above for specific errors',
      `  2. Verify Emscripten version: ${emscriptenVersion}`,
      '  3. Try clean build: pnpm clean && pnpm build',
      `  4. Check disk space: df -h ${buildDir}`,
      '  5. Reduce parallelism: set jobs to 1-2 in build args',
    ].join('\n')

    throw new Error(errorMsg)
  }

  const duration = formatDuration(Date.now() - startTime)
  spinner.stop()
  logger.success(`Build completed in ${duration}`)

  // Smoke test: Verify built WASM is valid.
  const wasmFile = buildWasmFile

  if (existsSync(wasmFile)) {
    // Create checkpoint with smoke test.
    const wasmSize = await getFileSize(wasmFile)
    await createCheckpoint(
      buildDir,
      'wasm-compiled',
      async () => {
        // Smoke test: Verify WASM is valid.
        const buffer = await fs.readFile(wasmFile)

        // Check WASM magic number.
        const magic = buffer.slice(0, 4).toString('hex')
        if (magic !== '0061736d') {
          throw new Error('Invalid WASM file (bad magic number)')
        }

        // Try to compile with WebAssembly API.
        const module = new WebAssembly.Module(buffer)
        const exports = WebAssembly.Module.exports(module)
        if (exports.length === 0) {
          throw new Error('WASM module has no exports')
        }
        logger.substep(
          `WASM valid: ${exports.length} exports, ${buffer.length} bytes`,
        )
      },
      {
        binarySize: wasmSize,
        binaryPath: path.relative(buildDir, wasmFile),
        artifactPath: path.dirname(wasmFile),
      },
    )
  } else {
    throw new Error('WASM file not found after build')
  }
}
