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
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse } from '@babel/parser'
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
  restoreCheckpoint,
  shouldRun,
} from 'build-infra/lib/checkpoint-manager'
import { ensureEmscripten } from 'build-infra/lib/emscripten-installer'
import { ensureToolInstalled } from 'build-infra/lib/tool-installer'
import MagicString from 'magic-string'

import { whichSync } from '@socketsecurity/lib/bin'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { safeDelete, safeReadFile } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import {
  PACKAGE_ROOT,
  getBuildOutputPaths,
  getBuildPaths,
  getSharedBuildPaths,
} from './paths.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Parse arguments.
const args = process.argv.slice(2)
const FORCE_BUILD = args.includes('--force')
const CLEAN_BUILD = args.includes('--clean')

// Build mode: prod (default for CI) or dev (default for local, faster builds).
const IS_CI = Boolean(process.env.CI)
const PROD_BUILD = args.includes('--prod')
const DEV_BUILD = args.includes('--dev')
const BUILD_MODE = PROD_BUILD
  ? 'prod'
  : DEV_BUILD
    ? 'dev'
    : IS_CI
      ? 'prod'
      : 'dev'

// Configuration.
// Read ONNX Runtime version from package.json (matches ONNX Runtime release version).
const packageJson = JSON.parse(
  await fs.readFile(path.join(PACKAGE_ROOT, 'package.json'), 'utf-8'),
)
const ONNX_VERSION = `v${packageJson.version}`
const ONNX_REPO = 'https://github.com/microsoft/onnxruntime.git'

// Get paths from source of truth
const {
  buildDir: SHARED_BUILD_DIR,
  cmakeDepsFile: SHARED_CMAKE_DEPS_FILE,
  cmakeListsFile: SHARED_CMAKE_LISTS_FILE,
  cmakeWebassemblyFile: SHARED_CMAKE_WEBASSEMBLY_FILE,
  postBuildSourceFile: SHARED_POST_BUILD_SOURCE_FILE,
  sourceDir: SHARED_SOURCE_DIR,
} = getSharedBuildPaths()

const {
  buildDir: BUILD_DIR,
  buildScriptFile,
  outputMjsFile,
  outputSyncJsFile,
  outputWasmFile,
  sourceDir: MODE_SOURCE_DIR,
  wasmDir: OUTPUT_DIR,
} = getBuildPaths(BUILD_MODE)

/**
 * Clone ONNX Runtime source if not already present.
 * Clones once to shared location for pristine checkpoint.
 */
async function cloneOnnxSource() {
  if (!(await shouldRun(SHARED_BUILD_DIR, '', 'source-cloned', FORCE_BUILD))) {
    return
  }

  printHeader('Cloning ONNX Runtime Source')

  // Check if source exists and if it has the patches.
  if (existsSync(SHARED_SOURCE_DIR)) {
    printStep('ONNX Runtime source already exists')

    // Define patches to verify.
    const patches = [
      {
        name: 'Eigen hash',
        path: SHARED_CMAKE_DEPS_FILE,
        marker: '51982be81bbe52572b54180454df11a3ece9a934',
      },
      {
        name: 'MLFloat16 build',
        path: SHARED_CMAKE_WEBASSEMBLY_FILE,
        marker: '# add_compile_definitions(\n  #   BUILD_MLAS_NO_ONNXRUNTIME',
      },
      {
        name: 'wasm_post_build.js',
        path: SHARED_POST_BUILD_SOURCE_FILE,
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
      await safeDelete(SHARED_SOURCE_DIR)
      printSuccess('Old source removed')
    } else {
      printStep('All patches already applied, skipping clone')
      await createCheckpoint(
        SHARED_BUILD_DIR,
        '',
        'source-cloned',
        async () => {
          // Smoke test: Verify source directory exists with CMakeLists.txt
          const cmakeLists = path.join(
            SHARED_SOURCE_DIR,
            'cmake',
            'CMakeLists.txt',
          )
          await fs.access(cmakeLists)
          printStep('Source directory validated')
        },
        {
          onnxVersion: ONNX_VERSION,
          artifactPath: SHARED_SOURCE_DIR,
        },
      )
      return
    }
  }

  await fs.mkdir(SHARED_BUILD_DIR, { recursive: true })

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
      '--single-branch',
      '--branch',
      ONNX_VERSION,
      ONNX_REPO,
      SHARED_SOURCE_DIR,
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
  const depsPath = SHARED_CMAKE_DEPS_FILE
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
    SHARED_SOURCE_DIR,
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
    SHARED_SOURCE_DIR,
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
      'Unexpected number of Worker URL matches: found $' +
        '{matches.length}, expected 1. Pattern: $' +
        '{regex}',
    )

    await fs.writeFile(postBuildSourcePath, postBuildContent, 'utf-8')
    printSuccess('wasm_post_build.js (source) patched')
  }

  await createCheckpoint(
    SHARED_BUILD_DIR,
    '',
    'source-cloned',
    async () => {
      // Smoke test: Verify source directory exists with CMakeLists.txt
      const cmakeLists = SHARED_CMAKE_LISTS_FILE
      await fs.access(cmakeLists)
      printStep('Source directory validated')
    },
    {
      onnxVersion: ONNX_VERSION,
      artifactPath: SHARED_SOURCE_DIR,
    },
  )
}

/**
 * Extract pristine source from shared checkpoint to mode-specific directory.
 * This gives each build mode (dev/prod) its own isolated copy.
 */
async function extractSourceForMode() {
  // Skip if mode-specific source already exists
  if (existsSync(MODE_SOURCE_DIR)) {
    return
  }

  printHeader(`Extracting ONNX Runtime Source to ${BUILD_MODE} Build`)

  const logger = getDefaultLogger()
  logger.log(`Extracting from shared checkpoint to ${BUILD_MODE}/source...`)

  // Extract shared checkpoint to mode-specific directory
  const restored = await restoreCheckpoint(
    SHARED_BUILD_DIR,
    '',
    'source-cloned',
    { destDir: BUILD_DIR },
  )

  if (!restored) {
    printError(
      'Source Extraction Failed',
      'Shared checkpoint not found. Run with --clean to rebuild.',
    )
    throw new Error('Source extraction failed')
  }

  logger.success(`Source extracted to ${BUILD_MODE}/source`)
}

/**
 * Build ONNX Runtime with Emscripten using official build script.
 */
async function build() {
  if (!(await shouldRun(BUILD_DIR, '', 'built', FORCE_BUILD))) {
    return
  }

  printHeader('Building ONNX Runtime with Emscripten')

  // Auto-detect and activate Emscripten SDK.
  const emscriptenResult = await ensureEmscripten({
    version: 'latest',
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
  printStep('Checking for stale cached build files...')
  const { buildCmakeCacheFile, buildPostBuildScriptFile } =
    getBuildOutputPaths(MODE_SOURCE_DIR)

  // Delete cached wasm_post_build.js (CMake will recopy from patched source).
  if (existsSync(buildPostBuildScriptFile)) {
    await safeDelete(buildPostBuildScriptFile)
    printSuccess('Removed stale wasm_post_build.js from cache')
  }

  // Clear CMake cache to force full reconfiguration.
  if (existsSync(buildCmakeCacheFile)) {
    await safeDelete(buildCmakeCacheFile)
    printSuccess('Cleared CMake cache')
  }

  // ONNX Runtime has its own build script: ./build.sh --config Release --build_wasm
  // We need to pass WASM_ASYNC_COMPILATION=0 via EMCC_CFLAGS environment variable.

  printStep('Running ONNX Runtime build script...')
  printStep('This may take 30-60 minutes on first build...')

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

  printStep(`Build mode: ${BUILD_MODE}`)

  const buildArgs = [
    '--config',
    'Release',
    '--build_wasm',
    '--skip_tests',
    '--parallel',
    // Required for ONNX Runtime v1.19.0+ (non-threaded builds deprecated).
    '--enable_wasm_threads',
    // Enable SIMD for better performance.
    '--enable_wasm_simd',
  ]

  // Add optimization flags based on build mode
  if (BUILD_MODE === 'prod') {
    // Production: Maximum optimization (slower compile, smaller output)
    // Note: --enable_wasm_size_optimization was removed in ONNX Runtime v1.21+
    // Size optimization is now controlled via CMAKE_CXX_FLAGS in CMakeLists.txt
    printStep('Optimization: Production build (size optimized via CMake flags)')
  } else {
    // Development: Faster compile, larger output
    printStep('Optimization: Standard build (dev mode, faster)')
  }

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
    cwd: MODE_SOURCE_DIR,
    shell: WIN32,
    stdio: 'inherit',
  })

  if (buildScriptResult.code !== 0) {
    throw new Error('ONNX Runtime build script failed')
  }

  const duration = formatDuration(Date.now() - startTime)
  printSuccess(`Build completed in ${duration}`)

  // Smoke test: Verify built WASM is valid.
  const { buildWasmFile: wasmFile } = getBuildOutputPaths(MODE_SOURCE_DIR)

  if (existsSync(wasmFile)) {
    // Create checkpoint with smoke test.
    const wasmSize = await getFileSize(wasmFile)
    await createCheckpoint(
      BUILD_DIR,
      '',
      'release',
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
        printStep(
          `WASM valid: ${exports.length} exports, ${buffer.length} bytes`,
        )
      },
      {
        binarySize: wasmSize,
        binaryPath: path.relative(BUILD_DIR, wasmFile),
      },
    )
  } else {
    throw new Error('WASM file not found after build')
  }
}

/**
 * Export WASM to output directory.
 */
async function exportWasm() {
  printHeader('Exporting WASM')

  const require = createRequire(import.meta.url)

  await fs.mkdir(OUTPUT_DIR, { recursive: true })

  // Get WASM build outputs (platform-dependent paths).
  const { buildMjsFile: jsFile, buildWasmFile: wasmFile } =
    getBuildOutputPaths(MODE_SOURCE_DIR)

  if (!existsSync(wasmFile)) {
    printError('WASM file not found - build failed')
    printError(`Expected: ${wasmFile}`)
    throw new Error(`Required WASM file not found: ${wasmFile}`)
  }

  // Copy WASM file.
  await fs.copyFile(wasmFile, outputWasmFile)

  // Copy original .mjs glue code (ES6 module format with threading).
  if (existsSync(jsFile)) {
    await fs.copyFile(jsFile, outputMjsFile)
    printStep(`MJS: ${outputMjsFile}`)
  }

  // Generate companion -sync.js with synchronous loading and base64-embedded WASM.
  printStep('Generating synchronous .js wrapper with embedded WASM...')

  const wasmBinary = await fs.readFile(outputWasmFile)
  const base64Wasm = wasmBinary.toString('base64')
  let mjsContent = await fs.readFile(outputMjsFile, 'utf-8')

  // Use @babel/parser + magic-string to properly remove export statements.
  // This is more robust than regex for handling ES module syntax.
  const ast = parse(mjsContent, {
    sourceType: 'module',
    plugins: [],
  })

  const s = new MagicString(mjsContent)

  // Remove all export statements by walking the AST.
  for (const node of ast.program.body) {
    if (node.type === 'ExportDefaultDeclaration') {
      // Remove: export default ortWasmThreaded;
      s.remove(node.start, node.end)
    } else if (node.type === 'ExportNamedDeclaration') {
      if (node.declaration) {
        // Remove "export" keyword: "export const foo" → "const foo"
        s.remove(node.start, node.declaration.start)
      } else {
        // Remove standalone: export { InferenceSession, Tensor };
        s.remove(node.start, node.end)
      }
    }
  }

  mjsContent = s.toString()

  const jsContent = `'use strict';

/**
 * Synchronous ONNX Runtime with embedded WASM binary.
 *
 * This file is AUTO-GENERATED by onnxruntime-builder.
 * Built with WASM threading + SIMD for synchronous instantiation.
 *
 * Source: ort.mjs (${(await fs.stat(outputMjsFile)).size} bytes)
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
// Note: We don't add module.exports.default here to avoid conflicts with ES module default export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ort;
}

// ES module export.
export default ort;
`

  await fs.writeFile(outputSyncJsFile, jsContent, 'utf-8')
  const wasmSize = await getFileSize(outputWasmFile)
  const syncJsSize = await getFileSize(outputSyncJsFile)
  printStep(`WASM: ${outputWasmFile}`)
  printStep(`WASM size: ${wasmSize}`)
  printStep(`Sync JS (sync + embedded): ${outputSyncJsFile}`)
  printStep(`Sync JS size: ${syncJsSize}`)

  printSuccess('WASM exported with synchronous -sync.js wrapper')

  // Smoke test: Verify exported WASM file.
  printStep('Smoke testing exported WASM...')
  const wasmBuffer = await fs.readFile(outputWasmFile)

  // Check WASM magic number.
  const magic = wasmBuffer.slice(0, 4).toString('hex')
  if (magic !== '0061736d') {
    throw new Error('Invalid exported WASM file (bad magic number)')
  }

  // Try to compile with WebAssembly API.
  try {
    const module = new WebAssembly.Module(wasmBuffer)
    const exports = WebAssembly.Module.exports(module)
    if (exports.length === 0) {
      throw new Error('Exported WASM module has no exports')
    }
    printStep(`Exported WASM valid: ${exports.length} exports`)
  } catch (e) {
    throw new Error(`Failed to load exported WASM: ${e.message}`)
  }

  // Smoke test: Verify sync.js can load.
  printStep('Smoke testing ort-sync.js...')
  try {
    const syncModule = require(outputSyncJsFile)

    if (!syncModule) {
      throw new Error('Sync module failed to load')
    }

    // NOTE: InferenceSession and Tensor are not part of the low-level WASM module.
    // They would come from a separate JavaScript API layer.
    // Commenting out these checks as they test for the wrong thing.
    // if (!syncModule.InferenceSession) {
    //   throw new Error('Sync module missing InferenceSession export')
    // }

    // if (!syncModule.Tensor) {
    //   throw new Error('Sync module missing Tensor export')
    // }

    printStep('Sync JS module loaded successfully')
  } catch (e) {
    throw new Error(`Failed to load sync JS module: ${e.message}`)
  }

  printSuccess('Export complete')
}

/**
 * Main build function.
 */
async function main() {
  const totalStart = Date.now()

  printHeader('🔨 Building onnxruntime')
  const logger = getDefaultLogger()
  logger.info(`ONNX Runtime ${ONNX_VERSION} build for Socket CLI`)
  logger.info(`Build mode: ${BUILD_MODE}`)
  logger.info('')

  // Clean checkpoints if requested or if output is missing.
  const outputMissing =
    !existsSync(outputWasmFile) ||
    !existsSync(outputMjsFile) ||
    !existsSync(outputSyncJsFile)

  if (CLEAN_BUILD || outputMissing) {
    if (outputMissing) {
      printStep('Output artifacts missing - cleaning stale checkpoints')
    }
    await cleanCheckpoint(BUILD_DIR, '')
  }

  // Pre-flight checks.
  printHeader('Pre-flight Checks')

  // ONNX needs more space.
  const diskOk = await checkDiskSpace(BUILD_DIR, 5)
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
  await extractSourceForMode()
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
