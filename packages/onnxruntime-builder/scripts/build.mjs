/**
 * Build onnxruntime - Size-optimized ONNX Runtime WASM for Socket CLI.
 *
 * This script builds ONNX Runtime from official source with Emscripten:
 * - ONNX Runtime C++ (official Microsoft implementation)
 * - Emscripten for C++ → WASM compilation
 * - CMake configuration
 * - Aggressive WASM optimizations
 *
 * Usage:
 *   node scripts/build.mjs          # Normal build with checkpoints
 *   node scripts/build.mjs --force  # Force rebuild (ignore checkpoints)
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  checkDiskSpace,
  formatDuration,
  getFileSize,
} from 'build-infra/lib/build-helpers'
import {
  printError,
  printHeader,
  printStep,
  printSuccess,
  printWarning,
} from 'build-infra/lib/build-output'
import {
  cleanCheckpoint,
  createCheckpoint,
  shouldRun,
} from 'build-infra/lib/checkpoint-manager'
import { ensureEmscripten } from 'build-infra/lib/emscripten-installer'
import { ensureToolInstalled } from 'build-infra/lib/tool-installer'

import { whichBinSync } from '@socketsecurity/lib/bin'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { safeDelete, safeReadFile } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Parse arguments.
const args = process.argv.slice(2)
const FORCE_BUILD = args.includes('--force')
const CLEAN_BUILD = args.includes('--clean')

// Configuration.
const ROOT_DIR = path.join(__dirname, '..')
const BUILD_DIR = path.join(ROOT_DIR, 'build')
const OUTPUT_DIR = path.join(BUILD_DIR, 'wasm')
// Read ONNX Runtime version from package.json (matches ONNX Runtime release version).
const packageJson = JSON.parse(
  await fs.readFile(path.join(ROOT_DIR, 'package.json'), 'utf-8'),
)
const ONNX_VERSION = `v${packageJson.version}`
const ONNX_REPO = 'https://github.com/microsoft/onnxruntime.git'
const ONNX_SOURCE_DIR = path.join(BUILD_DIR, 'onnxruntime-source')

/**
 * Clone ONNX Runtime source if not already present.
 */
async function cloneOnnxSource() {
  if (!(await shouldRun(BUILD_DIR, 'onnxruntime', 'cloned', FORCE_BUILD))) {
    return
  }

  printHeader('Cloning ONNX Runtime Source')

  // Check if source exists and if it has the patches.
  if (existsSync(ONNX_SOURCE_DIR)) {
    printStep('ONNX Runtime source already exists')

    // Define patches to verify.
    const patches = [
      {
        name: 'Eigen hash',
        path: path.join(ONNX_SOURCE_DIR, 'cmake', 'deps.txt'),
        marker: '51982be81bbe52572b54180454df11a3ece9a934',
      },
      {
        name: 'MLFloat16 build',
        path: path.join(
          ONNX_SOURCE_DIR,
          'cmake',
          'onnxruntime_webassembly.cmake',
        ),
        marker: '# add_compile_definitions(\n  #   BUILD_MLAS_NO_ONNXRUNTIME',
      },
      {
        name: 'wasm_post_build.js',
        path: path.join(
          ONNX_SOURCE_DIR,
          'js',
          'web',
          'script',
          'wasm_post_build.js',
        ),
        marker: 'if (matches.length === 0) {',
      },
    ]

    // Check if all patches have been applied.
    const results = await Promise.allSettled(
      patches.map(async ({ marker, path: filePath }) => {
        const content = await safeReadFile(filePath, 'utf-8')
        return content?.includes(marker) ?? false
      }),
    )
    const allPatchesApplied = results.every(
      r => r.status === 'fulfilled' && r.value === true,
    )

    if (!allPatchesApplied) {
      // Source exists but patches not applied - need to re-clone.
      printWarning('Source exists but patches not applied')
      printStep('Removing old source to re-clone with patches...')
      await safeDelete(ONNX_SOURCE_DIR)
      printSuccess('Old source removed')
    } else {
      printStep('All patches already applied, skipping clone')
      await createCheckpoint(BUILD_DIR, 'onnxruntime', 'cloned')
      return
    }
  }

  await fs.mkdir(BUILD_DIR, { recursive: true })

  printStep(`Cloning ONNX Runtime ${ONNX_VERSION}...`)
  const cloneResult = await spawn(
    'git',
    [
      '-c',
      'http.postBuffer=524288000',
      '-c',
      'http.version=HTTP/1.1',
      'clone',
      '--depth',
      '1',
      '--branch',
      ONNX_VERSION,
      ONNX_REPO,
      ONNX_SOURCE_DIR,
    ],
    {
      shell: WIN32,
      stdio: 'inherit',
    },
  )

  if (cloneResult.code !== 0) {
    throw new Error('Failed to clone ONNX Runtime repository')
  }

  printSuccess(`ONNX Runtime ${ONNX_VERSION} cloned`)

  // Patch 1: Update Eigen hash (see docs/patches.md).
  printStep('Patching deps.txt to accept current Eigen hash...')
  const depsPath = path.join(ONNX_SOURCE_DIR, 'cmake', 'deps.txt')
  const depsContent = await fs.readFile(depsPath, 'utf-8')
  const updatedDeps = depsContent.replace(
    /eigen;([^;]+);5ea4d05e62d7f954a46b3213f9b2535bdd866803/g,
    'eigen;$1;51982be81bbe52572b54180454df11a3ece9a934',
  )
  await fs.writeFile(depsPath, updatedDeps, 'utf-8')
  printSuccess('Eigen hash updated in deps.txt')

  // Patch 2: Fix MLFloat16 build (see docs/patches.md).
  printStep('Patching onnxruntime_webassembly.cmake to fix MLFloat16 build...')
  const cmakePath = path.join(
    ONNX_SOURCE_DIR,
    'cmake',
    'onnxruntime_webassembly.cmake',
  )
  let cmakeContent = await fs.readFile(cmakePath, 'utf-8')
  cmakeContent = cmakeContent.replace(
    /add_compile_definitions\(\s*BUILD_MLAS_NO_ONNXRUNTIME\s*\)/,
    '# add_compile_definitions(\n  #   BUILD_MLAS_NO_ONNXRUNTIME\n  # )',
  )
  await fs.writeFile(cmakePath, cmakeContent, 'utf-8')
  printSuccess('BUILD_MLAS_NO_ONNXRUNTIME commented out')

  // Patch 3: Modern Emscripten compatibility (see docs/patches.md).
  //
  // PROBLEM: ONNX Runtime's wasm_post_build.js expects specific Worker URL pattern
  // from older Emscripten versions. Modern Emscripten (3.1.50+) doesn't generate
  // this pattern, causing build to fail with "Unexpected number of matches" error.
  //
  // SOLUTION: Patch the script to handle modern Emscripten gracefully:
  // 1. Allow zero matches (modern Emscripten generates correct code already)
  // 2. Improve error message to show actual match count
  //
  // CACHE HANDLING: CMake copies wasm_post_build.js from source to build directory
  // during configuration. GitHub Actions may restore cached builds with old unpatched
  // copies, so we must:
  // 1. Patch source file (single source of truth)
  // 2. Delete cached build copy if present (forces CMake recopy from patched source)
  // 3. Clear CMake cache (ensures full reconfiguration)
  printStep('Patching wasm_post_build.js to handle modern Emscripten...')
  const postBuildSourcePath = path.join(
    ONNX_SOURCE_DIR,
    'js',
    'web',
    'script',
    'wasm_post_build.js',
  )
  if (existsSync(postBuildSourcePath)) {
    let postBuildContent = await fs.readFile(postBuildSourcePath, 'utf-8')

    // Patch 1: Allow zero matches (modern Emscripten case).
    // Insert early return when no Worker URL pattern found.
    postBuildContent = postBuildContent.replace(
      /if \(matches\.length !== 1\) \{/,
      `if (matches.length === 0) {\n      console.log('No Worker URL pattern found - skipping post-build transformation (modern Emscripten)');\n      return;\n    }\n    if (matches.length !== 1) {`,
    )

    // Patch 2: Improve error message to show actual match count.
    // Helps debug if we get unexpected pattern variations.
    postBuildContent = postBuildContent.replace(
      /Unexpected number of matches for "" in "": \./,
      'Unexpected number of Worker URL matches: found ${matches.length}, expected 1. Pattern: ${regex}',
    )

    await fs.writeFile(postBuildSourcePath, postBuildContent, 'utf-8')
    printSuccess('wasm_post_build.js (source) patched')
  }

  await createCheckpoint(BUILD_DIR, 'onnxruntime', 'cloned')
}

/**
 * Build ONNX Runtime with Emscripten using official build script.
 */
async function build() {
  if (!(await shouldRun(BUILD_DIR, 'onnxruntime', 'built', FORCE_BUILD))) {
    return
  }

  printHeader('Building ONNX Runtime with Emscripten')

  const startTime = Date.now()

  // Clean stale cached files before build.
  // GitHub Actions may have restored old unpatched files from cache after clone step.
  // Delete them now to force CMake to recopy patched versions from source.
  printStep('Checking for stale cached build files...')
  const platform = process.platform === 'darwin' ? 'MacOS' : 'Linux'
  const buildCacheDir = path.join(ONNX_SOURCE_DIR, 'build', platform, 'Release')

  // Delete cached wasm_post_build.js (CMake will recopy from patched source).
  const postBuildBuildPath = path.join(buildCacheDir, 'wasm_post_build.js')
  if (existsSync(postBuildBuildPath)) {
    await safeDelete(postBuildBuildPath)
    printSuccess('Removed stale wasm_post_build.js from cache')
  }

  // Clear CMake cache to force full reconfiguration.
  const cmakeCachePath = path.join(buildCacheDir, 'CMakeCache.txt')
  if (existsSync(cmakeCachePath)) {
    await safeDelete(cmakeCachePath)
    printSuccess('Cleared CMake cache')
  }

  // ONNX Runtime has its own build script: ./build.sh --config Release --build_wasm
  // We need to pass WASM_ASYNC_COMPILATION=0 via EMCC_CFLAGS environment variable.

  printStep('Running ONNX Runtime build script...')
  printStep('This may take 30-60 minutes on first build...')

  const buildScript = path.join(ONNX_SOURCE_DIR, 'build.sh')

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
  const ninjaAvailable = whichBinSync('ninja', { nothrow: true })

  const buildArgs = [
    '--config',
    'Release',
    '--build_wasm',
    '--skip_tests',
    '--parallel',
    '--enable_wasm_threads', // Required for ONNX Runtime v1.19.0+ (non-threaded builds deprecated).
    '--enable_wasm_simd', // Enable SIMD for better performance.
  ]

  // Use Ninja if available (much faster than Make for large C++ projects)
  if (ninjaAvailable) {
    printStep('Using Ninja build system (faster)')
    buildArgs.push('--cmake_generator', 'Ninja')
  } else {
    printWarning(
      'Ninja not found - using Make (slower). Install: brew install ninja',
    )
  }

  const buildScriptResult = await spawn(buildScript, buildArgs, {
    cwd: ONNX_SOURCE_DIR,
    shell: WIN32,
    stdio: 'inherit',
  })

  if (buildScriptResult.code !== 0) {
    throw new Error('ONNX Runtime build script failed')
  }

  const duration = formatDuration(Date.now() - startTime)
  printSuccess(`Build completed in ${duration}`)
  await createCheckpoint(BUILD_DIR, 'onnxruntime', 'built')
}

/**
 * Export WASM to output directory.
 */
async function exportWasm() {
  printHeader('Exporting WASM')

  await fs.mkdir(OUTPUT_DIR, { recursive: true })

  // ONNX Runtime build outputs to: build/Linux/Release/
  // or build/MacOS/Release/ on macOS
  const platform = process.platform === 'darwin' ? 'MacOS' : 'Linux'
  const buildOutputDir = path.join(
    ONNX_SOURCE_DIR,
    'build',
    platform,
    'Release',
  )

  // Look for threaded WASM files (threading + SIMD enabled).
  // With threading enabled, outputs are: ort-wasm-simd-threaded.{wasm,mjs}.
  const wasmFile = path.join(buildOutputDir, 'ort-wasm-simd-threaded.wasm')
  const jsFile = path.join(buildOutputDir, 'ort-wasm-simd-threaded.mjs')

  if (!existsSync(wasmFile)) {
    printError('WASM file not found - build failed')
    printError(`Expected: ${wasmFile}`)
    throw new Error(`Required WASM file not found: ${wasmFile}`)
  }

  const outputWasm = path.join(OUTPUT_DIR, 'ort.wasm')
  const outputMjs = path.join(OUTPUT_DIR, 'ort.mjs')
  const outputSyncJs = path.join(OUTPUT_DIR, 'ort-sync.js')

  // Copy WASM file.
  await fs.copyFile(wasmFile, outputWasm)

  // Copy original .mjs glue code (ES6 module format with threading).
  if (existsSync(jsFile)) {
    await fs.copyFile(jsFile, outputMjs)
    printStep(`MJS: ${outputMjs}`)
  }

  const wasmSize = await getFileSize(outputWasm)
  printStep(`WASM: ${outputWasm}`)
  printStep(`WASM size: ${wasmSize}`)

  // Generate companion -sync.js with synchronous loading and base64-embedded WASM.
  printStep('Generating synchronous .js wrapper with embedded WASM...')

  const wasmBinary = await fs.readFile(outputWasm)
  const base64Wasm = wasmBinary.toString('base64')
  const mjsContent = await fs.readFile(outputMjs, 'utf-8')

  const jsContent = `'use strict';

/**
 * Synchronous ONNX Runtime with embedded WASM binary.
 *
 * This file is AUTO-GENERATED by onnxruntime-builder.
 * Built with WASM threading + SIMD for synchronous instantiation.
 *
 * Source: ort.mjs (${(await fs.stat(outputMjs)).size} bytes)
 * WASM: ${wasmBinary.length} bytes (${base64Wasm.length} bytes base64)
 */

// Base64-encoded WASM binary (embedded at build time).
const base64Wasm = '${base64Wasm}';

// Decode base64 to Uint8Array.
const wasmBinary = Uint8Array.from(atob(base64Wasm), c => c.charCodeAt(0));

// Inlined Emscripten loader from ONNX Runtime build.
${mjsContent}

// Synchronously initialize ONNX Runtime with embedded WASM.
const ort = ortWasmThreaded({
  wasmBinary,
  instantiateWasm(imports, successCallback) {
    // Synchronously instantiate WASM module.
    const module = new WebAssembly.Module(wasmBinary);
    const instance = new WebAssembly.Instance(module, imports);
    successCallback(instance, module);
    return instance.exports;
  }
});

// CommonJS export for Node.js compatibility.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ort;
  module.exports.default = ort;
  module.exports.InferenceSession = ort.InferenceSession;
  module.exports.Tensor = ort.Tensor;
}

// ES module export.
export default ort;
export const InferenceSession = ort.InferenceSession;
export const Tensor = ort.Tensor;
`

  await fs.writeFile(outputSyncJs, jsContent, 'utf-8')
  const syncJsSize = await getFileSize(outputSyncJs)
  printStep(`Sync JS (sync + embedded): ${outputSyncJs}`)
  printStep(`Sync JS size: ${syncJsSize}`)

  printSuccess('WASM exported with synchronous -sync.js wrapper')
}

/**
 * Main build function.
 */
async function main() {
  const totalStart = Date.now()

  printHeader('🔨 Building onnxruntime')
  const logger = getDefaultLogger()
  logger.info(`ONNX Runtime ${ONNX_VERSION} build for Socket CLI`)
  logger.info('')

  // Clean checkpoints if requested or if output is missing.
  const outputWasm = path.join(OUTPUT_DIR, 'ort.wasm')
  const outputMjs = path.join(OUTPUT_DIR, 'ort.mjs')
  const outputSyncJs = path.join(OUTPUT_DIR, 'ort-sync.js')
  const outputMissing =
    !existsSync(outputWasm) ||
    !existsSync(outputMjs) ||
    !existsSync(outputSyncJs)

  if (CLEAN_BUILD || outputMissing) {
    if (outputMissing) {
      printStep('Output artifacts missing - cleaning stale checkpoints')
    }
    await cleanCheckpoint(BUILD_DIR, 'onnxruntime')
  }

  // Pre-flight checks.
  printHeader('Pre-flight Checks')

  const diskOk = await checkDiskSpace(BUILD_DIR, 5) // ONNX needs more space.
  if (!diskOk) {
    printWarning('Could not check disk space')
  }

  // Ensure CMake is installed.
  printStep('Checking for CMake...')
  const cmakeResult = await ensureToolInstalled('cmake', { autoInstall: true })
  if (!cmakeResult.available) {
    printError('CMake is required but not found')
    printError('Install CMake from: https://cmake.org/download/')
    throw new Error('CMake required')
  }

  if (cmakeResult.installed) {
    printSuccess('Installed CMake')
  } else {
    printSuccess('CMake found')
  }

  // Ensure Emscripten SDK is available.
  printStep('Checking for Emscripten SDK...')
  const emscriptenResult = await ensureEmscripten({
    version: 'latest',
    autoInstall: true,
    quiet: false,
  })

  if (!emscriptenResult.available) {
    printError('')
    printError('Failed to install Emscripten SDK')
    printError('Please install manually:')
    printError('  git clone https://github.com/emscripten-core/emsdk.git')
    printError('  cd emsdk')
    printError('  ./emsdk install latest')
    printError('  ./emsdk activate latest')
    printError('  source ./emsdk_env.sh')
    printError('')
    throw new Error('Emscripten SDK required')
  }

  if (emscriptenResult.installed) {
    printSuccess('Installed Emscripten SDK')
  } else if (emscriptenResult.activated) {
    printSuccess('Activated Emscripten SDK')
  } else {
    printSuccess('Emscripten SDK found')
  }

  // Optional: Check for Ninja (much faster than Make for large C++ projects).
  printStep('Checking for Ninja build system (optional, recommended)...')
  const ninjaResult = await ensureToolInstalled('ninja', { autoInstall: true })
  if (ninjaResult.available) {
    if (ninjaResult.installed) {
      printSuccess('Installed Ninja build system')
    } else {
      printSuccess('Ninja found')
    }
  } else {
    printWarning(
      'Ninja not found (optional, but MUCH faster than Make for C++ builds)',
    )
    printWarning('Install: brew install ninja')
  }

  // Optional: Check for wasm-opt (Binaryen) for additional optimization.
  printStep('Checking for wasm-opt (optional)...')
  const wasmOptResult = await ensureToolInstalled('wasm-opt', {
    autoInstall: true,
  })
  if (wasmOptResult.available) {
    if (wasmOptResult.installed) {
      printSuccess('Installed wasm-opt (Binaryen)')
    } else {
      printSuccess('wasm-opt found')
    }
  } else {
    printWarning(
      'wasm-opt not found (optional, provides additional optimization)',
    )
  }

  printSuccess('Pre-flight checks passed')

  // Build phases.
  await cloneOnnxSource()
  await build()
  await exportWasm()

  // Report completion.
  const totalDuration = formatDuration(Date.now() - totalStart)

  printHeader('🎉 Build Complete!')
  logger.success(`Total time: ${totalDuration}`)
  logger.success(`Output: ${OUTPUT_DIR}`)
  logger.info('')
  logger.info('Next steps:')
  logger.info('  1. Test WASM with Socket CLI')
  logger.info(
    '  2. Run extract-onnx-runtime.mjs in socket-cli to create synchronous loader',
  )
  logger.info('')
}

// Run build.
const logger = getDefaultLogger()
main().catch(e => {
  printError('Build Failed')
  logger.error(e.message)
  throw e
})
