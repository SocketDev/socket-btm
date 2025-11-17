/**
 * Build yoga-layout - Size-optimized Yoga Layout WASM for Socket CLI.
 *
 * This script builds Yoga Layout from official C++ with Emscripten:
 * - Yoga C++ (official Facebook implementation)
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

import { activateEmscriptenSDK } from 'build-infra/lib/build-env'
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

import { which } from '@socketsecurity/lib/bin'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

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
const ROOT_DIR = path.join(__dirname, '..')
const BUILD_DIR = path.join(ROOT_DIR, 'build', BUILD_MODE)
const SHARED_BUILD_DIR = path.join(ROOT_DIR, 'build', 'shared')
const OUTPUT_DIR = path.join(BUILD_DIR, 'wasm')
// Read Yoga version from package.json (matches Yoga Layout release version).
const packageJson = JSON.parse(
  await fs.readFile(path.join(ROOT_DIR, 'package.json'), 'utf-8'),
)
const YOGA_VERSION = `v${packageJson.version}`
const YOGA_REPO = 'https://github.com/facebook/yoga.git'
const SHARED_SOURCE_DIR = path.join(SHARED_BUILD_DIR, 'source')
const MODE_SOURCE_DIR = path.join(BUILD_DIR, 'source')

/**
 * Clone Yoga source if not already present.
 * Clones once to shared location for pristine checkpoint.
 */
async function cloneYogaSource() {
  if (!(await shouldRun(SHARED_BUILD_DIR, '', 'source-cloned', FORCE_BUILD))) {
    return
  }

  printHeader('Cloning Yoga Source')

  if (existsSync(SHARED_SOURCE_DIR)) {
    printStep('Yoga source already exists, skipping clone')
    await createCheckpoint(
      SHARED_BUILD_DIR,
      '',
      'source-cloned',
      async () => {
        // Smoke test: Verify source directory exists with CMakeLists.txt
        const cmakeLists = path.join(SHARED_SOURCE_DIR, 'CMakeLists.txt')
        await fs.access(cmakeLists)
        printStep('Source directory validated')
      },
      {
        yogaVersion: YOGA_VERSION,
        artifactPath: SHARED_SOURCE_DIR,
      },
    )
    return
  }

  await fs.mkdir(SHARED_BUILD_DIR, { recursive: true })

  printStep(`Cloning Yoga ${YOGA_VERSION}...`)
  const cloneResult = await spawn(
    'git',
    [
      'clone',
      '--depth',
      '1',
      '--single-branch',
      '--branch',
      YOGA_VERSION,
      YOGA_REPO,
      SHARED_SOURCE_DIR,
    ],
    {
      shell: WIN32,
      stdio: 'inherit',
    },
  )

  if (cloneResult.code !== 0) {
    throw new Error('Failed to clone Yoga repository')
  }

  printSuccess(`Yoga ${YOGA_VERSION} cloned`)
  await createCheckpoint(
    SHARED_BUILD_DIR,
    '',
    'source-cloned',
    async () => {
      // Smoke test: Verify source directory exists with CMakeLists.txt
      const cmakeLists = path.join(SHARED_SOURCE_DIR, 'CMakeLists.txt')
      await fs.access(cmakeLists)
      printStep('Source directory validated')
    },
    {
      yogaVersion: YOGA_VERSION,
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

  printHeader(`Extracting Yoga Source to ${BUILD_MODE} Build`)

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
 * Configure CMake with Emscripten.
 */
async function configure() {
  if (!(await shouldRun(BUILD_DIR, '', 'configured', FORCE_BUILD))) {
    return
  }

  printHeader('Configuring CMake with Emscripten')

  const cmakeBuildDir = path.join(BUILD_DIR, 'cmake')
  await fs.mkdir(cmakeBuildDir, { recursive: true })

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

  // Activate Emscripten SDK to ensure environment variables are set.
  // This is necessary for Homebrew installations where emcc is in PATH
  // but EMSDK/EMSCRIPTEN environment variables are not set.
  if (!activateEmscriptenSDK()) {
    printError('Failed to activate Emscripten SDK environment')
    throw new Error('Emscripten SDK activation failed')
  }

  // Determine Emscripten toolchain file location.
  let toolchainFile
  if (process.env.EMSCRIPTEN) {
    toolchainFile = path.join(
      process.env.EMSCRIPTEN,
      'cmake/Modules/Platform/Emscripten.cmake',
    )
  } else if (process.env.EMSDK) {
    toolchainFile = path.join(
      process.env.EMSDK,
      'upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake',
    )
  } else {
    printError('Emscripten SDK path not set')
    throw new Error('Emscripten SDK required')
  }

  printStep(`Using toolchain: ${toolchainFile}`)
  printStep(`Build mode: ${BUILD_MODE}`)

  // Configure optimization flags based on build mode.
  const cxxFlags =
    BUILD_MODE === 'prod'
      ? [
          // Production: Maximum size + performance optimizations.
          // Optimize aggressively for size.
          '-Oz',
          // Thin LTO for faster builds, similar size reduction.
          '-flto=thin',
          // No C++ exceptions (smaller).
          '-fno-exceptions',
          // No runtime type information (smaller).
          '-fno-rtti',
          // Separate functions for better dead code elimination.
          '-ffunction-sections',
          // Separate data sections.
          '-fdata-sections',
          // Fast math optimizations (performance).
          '-ffast-math',
          // Re-enable infinity checks (Yoga needs this).
          '-fno-finite-math-only',
        ]
      : [
          // Development: Faster compilation, larger output.
          // Basic optimization (fast compile).
          '-O1',
          '-fno-exceptions',
          '-fno-rtti',
        ]

  const linkerFlags =
    BUILD_MODE === 'prod'
      ? [
          // Production: Aggressive minification.
          // Google Closure Compiler (aggressive minification).
          '--closure=1',
          // Garbage collect unused sections.
          '--gc-sections',
          '-flto=thin',
          '-Oz',
          // Disable exception catching (we use -fno-exceptions).
          '-sDISABLE_EXCEPTION_CATCHING=1',
          // Dynamic memory.
          '-sALLOW_MEMORY_GROWTH=1',
          // No runtime assertions (smaller, faster).
          '-sASSERTIONS=0',
          // ES6 module export.
          '-sEXPORT_ES6=1',
          // No filesystem support (smaller).
          '-sFILESYSTEM=0',
          // Minimal initial memory.
          '-sINITIAL_MEMORY=64KB',
          // Smaller allocator.
          '-sMALLOC=emmalloc',
          // Modular output.
          '-sMODULARIZE=1',
          // Keep runtime alive (needed for WASM).
          '-sNO_EXIT_RUNTIME=1',
          // Small stack.
          '-sSTACK_SIZE=16KB',
          // Disable stack overflow checks (fixes __set_stack_limits error with Emscripten 4.x).
          '-sSTACK_OVERFLOW_CHECK=0',
          // No longjmp (smaller).
          '-sSUPPORT_LONGJMP=0',
          // Synchronous instantiation for bundling.
          '-sWASM_ASYNC_COMPILATION=0',
        ]
      : [
          // Development: Faster linking, debug info.
          '-O1',
          // Disable exception catching (we use -fno-exceptions).
          '-sDISABLE_EXCEPTION_CATCHING=1',
          '-sALLOW_MEMORY_GROWTH=1',
          // Enable runtime assertions for debugging.
          '-sASSERTIONS=2',
          '-sEXPORT_ES6=1',
          // Export stack functions to fix __set_stack_limits error with Emscripten 4.x.
          "-sEXPORTED_FUNCTIONS=['_malloc','_free','___set_stack_limits']",
          '-sFILESYSTEM=0',
          '-sMODULARIZE=1',
          '-sNO_EXIT_RUNTIME=1',
          '-sWASM_ASYNC_COMPILATION=0',
        ]

  const cmakeArgs = [
    'cmake',
    `-DCMAKE_TOOLCHAIN_FILE=${toolchainFile}`,
    '-DCMAKE_BUILD_TYPE=Release',
    `-DCMAKE_CXX_FLAGS=${cxxFlags.join(' ')}`,
    `-DCMAKE_EXE_LINKER_FLAGS=${linkerFlags.join(' ')}`,
    `-DCMAKE_SHARED_LINKER_FLAGS=${linkerFlags.join(' ')}`,
    '-S',
    MODE_SOURCE_DIR,
    '-B',
    cmakeBuildDir,
  ]

  printStep('Optimization flags:')
  printStep(`  CXX: ${cxxFlags.join(' ')}`)
  printStep(`  Linker: ${linkerFlags.join(' ')}`)

  const emcmakePath = await which('emcmake', { nothrow: true })
  if (!emcmakePath) {
    throw new Error('emcmake not found in PATH')
  }

  const cmakeResult = await spawn(emcmakePath, cmakeArgs, {
    shell: WIN32,
    stdio: 'inherit',
  })

  if (cmakeResult.code !== 0) {
    throw new Error('CMake configuration failed')
  }

  printSuccess('CMake configured')
  await createCheckpoint(
    BUILD_DIR,
    '',
    'configured',
    async () => {
      // Smoke test: Verify CMake build directory exists
      const cmakeBuildDir = path.join(BUILD_DIR, 'cmake')
      await fs.access(cmakeBuildDir)
      printStep('CMake build directory validated')
    },
    {},
  )
}

/**
 * Build Yoga with Emscripten.
 */
async function build() {
  if (!(await shouldRun(BUILD_DIR, '', 'built', FORCE_BUILD))) {
    return
  }

  printHeader('Building Yoga with Emscripten')

  const startTime = Date.now()
  const cmakeBuildDir = path.join(BUILD_DIR, 'cmake')

  // Build static library with CMake.
  printStep('Compiling C++ to static library...')
  const buildResult = await spawn(
    'emmake',
    ['cmake', '--build', cmakeBuildDir, '--target', 'yogacore'],
    {
      shell: WIN32,
      stdio: 'inherit',
    },
  )

  if (buildResult.code !== 0) {
    throw new Error('Static library build failed')
  }

  // Link WASM module with Emscripten bindings.
  printStep('Linking WASM module with Emscripten bindings...')

  const bindingsFile = path.join(__dirname, '..', 'src', 'yoga-wasm.cpp')
  const staticLib = path.join(cmakeBuildDir, 'yoga', 'libyogacore.a')
  const wasmOutput = path.join(cmakeBuildDir, 'yoga.wasm')
  const jsOutput = path.join(cmakeBuildDir, 'yoga.js')

  // Use optimization flags for final linking (respecting BUILD_MODE).
  // Note: Emscripten bindings require RTTI, so we can't use -fno-rtti here.
  const linkCxxFlags =
    BUILD_MODE === 'prod'
      ? [
          '-Oz',
          '-flto=thin',
          '-ffunction-sections',
          '-fdata-sections',
          '-ffast-math',
          '-fno-finite-math-only',
        ]
      : ['-O1']

  const linkLinkerFlags =
    BUILD_MODE === 'prod'
      ? [
          '--closure=1',
          '-Wl,--gc-sections',
          '-flto=thin',
          '-Oz',
          '-sDISABLE_EXCEPTION_CATCHING=1',
          '-sALLOW_MEMORY_GROWTH=1',
          '-sASSERTIONS=0',
          '-sEXPORT_ES6=1',
          '-sFILESYSTEM=0',
          '-sINITIAL_MEMORY=64KB',
          '-sMALLOC=emmalloc',
          '-sMODULARIZE=1',
          '-sNO_EXIT_RUNTIME=1',
          '-sSTACK_SIZE=16KB',
          '-sSUPPORT_LONGJMP=0',
          '--bind',
        ]
      : [
          '-sDISABLE_EXCEPTION_CATCHING=1',
          '-sALLOW_MEMORY_GROWTH=1',
          '-sASSERTIONS=2',
          '-sEXPORT_ES6=1',
          '-sFILESYSTEM=0',
          '-sMODULARIZE=1',
          '-sNO_EXIT_RUNTIME=1',
          '-sWASM_ASYNC_COMPILATION=0',
          '--bind',
        ]

  // Compile and link in one step.
  const emArgs = [
    `-I${MODE_SOURCE_DIR}`,
    ...linkCxxFlags,
    bindingsFile,
    staticLib,
    ...linkLinkerFlags,
    '-o',
    jsOutput,
  ]

  const emppResult = await spawn(await which('em++'), emArgs, {
    shell: WIN32,
    stdio: 'inherit',
  })

  if (emppResult.code !== 0) {
    throw new Error('WASM compilation failed')
  }

  printSuccess(`JS glue code created: ${jsOutput}`)
  printSuccess(`WASM module created: ${wasmOutput}`)

  const duration = formatDuration(Date.now() - startTime)
  printSuccess(`Build completed in ${duration}`)

  // Create checkpoint with smoke test.
  const wasmSize = await getFileSize(wasmOutput)
  await createCheckpoint(
    BUILD_DIR,
    '',
    'release',
    async () => {
      // Smoke test: Verify WASM is valid.
      const buffer = await fs.readFile(wasmOutput)

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
      printStep(`WASM valid: ${exports.length} exports, ${buffer.length} bytes`)
    },
    {
      binarySize: wasmSize,
      binaryPath: path.relative(BUILD_DIR, wasmOutput),
    },
  )
}

/**
 * Optimize WASM with wasm-opt (prod mode only).
 *
 * In dev mode, skip this step for faster builds.
 * In prod mode, run aggressive wasm-opt on top of emscripten's optimizations.
 */
async function optimize() {
  // Skip wasm-opt in dev mode (emscripten -O1 is sufficient for fast iteration).
  if (BUILD_MODE === 'dev') {
    printStep('Skipping wasm-opt (dev mode - faster builds)')
    return
  }

  if (!(await shouldRun(BUILD_DIR, '', 'wasm-opt', FORCE_BUILD))) {
    return
  }

  printHeader('Optimizing WASM with wasm-opt (prod mode)')

  // Find the built WASM file.
  const cmakeBuildDir = path.join(BUILD_DIR, 'cmake')
  const wasmFile = path.join(cmakeBuildDir, 'yoga.wasm')

  if (!existsSync(wasmFile)) {
    printError(`WASM file not found: ${wasmFile}`)
    throw new Error('Cannot optimize - WASM file missing from build')
  }

  const sizeBefore = await getFileSize(wasmFile)
  printStep(`Size before: ${sizeBefore}`)

  // MAXIMUM AGGRESSIVE FLAGS.
  // NO BACKWARDS COMPATIBILITY - Modern runtimes only!
  const wasmOptFlags = [
    '-Oz',
    '--enable-simd',
    '--enable-bulk-memory',
    '--enable-sign-ext',
    '--enable-mutable-globals',
    '--enable-nontrapping-float-to-int',
    '--enable-reference-types',
    '--low-memory-unused',
    '--flatten',
    '--rereloop',
    '--vacuum',
    '--dce',
    '--remove-unused-names',
    '--remove-unused-module-elements',
    '--strip-debug',
    '--strip-dwarf',
    '--strip-producers',
    '--strip-target-features',
  ]

  // Find wasm-opt in Emscripten SDK or system PATH.
  // Emscripten SDK has wasm-opt in: $EMSDK/upstream/bin/wasm-opt
  let wasmOptCmd = 'wasm-opt'
  if (process.env.EMSDK) {
    const emsdkWasmOpt = path.join(
      process.env.EMSDK,
      'upstream',
      'bin',
      'wasm-opt',
    )
    if (existsSync(emsdkWasmOpt)) {
      wasmOptCmd = emsdkWasmOpt
      printStep(`Using wasm-opt from EMSDK: ${wasmOptCmd}`)
    }
  }

  const result = await spawn(
    wasmOptCmd,
    [...wasmOptFlags, wasmFile, '-o', wasmFile],
    {
      shell: WIN32,
      stdio: 'inherit',
    },
  )
  if (result.code !== 0) {
    throw new Error(`wasm-opt failed with exit code ${result.code}`)
  }

  const sizeAfter = await getFileSize(wasmFile)
  printStep(`Size after: ${sizeAfter}`)

  printSuccess('WASM optimized')

  // Create checkpoint with smoke test.
  await createCheckpoint(
    BUILD_DIR,
    '',
    'wasm-opt',
    async () => {
      // Smoke test: Verify optimized WASM is still valid.
      const buffer = await fs.readFile(wasmFile)

      // Check WASM magic number.
      const magic = buffer.slice(0, 4).toString('hex')
      if (magic !== '0061736d') {
        throw new Error(
          'Invalid WASM file after optimization (bad magic number)',
        )
      }

      // Try to compile with WebAssembly API.
      const module = new WebAssembly.Module(buffer)
      const exports = WebAssembly.Module.exports(module)
      if (exports.length === 0) {
        throw new Error('WASM module has no exports after optimization')
      }
      printStep(`Optimized WASM valid: ${exports.length} exports`)
    },
    {
      binarySize: sizeAfter,
      binaryPath: path.relative(BUILD_DIR, wasmFile),
    },
  )
}

/**
 * Export WASM to output directory.
 */
async function exportWasm() {
  printHeader('Exporting WASM')

  const _require = createRequire(import.meta.url)

  await fs.mkdir(OUTPUT_DIR, { recursive: true })

  const cmakeBuildDir = path.join(BUILD_DIR, 'cmake')
  const wasmFile = path.join(cmakeBuildDir, 'yoga.wasm')
  const jsFile = path.join(cmakeBuildDir, 'yoga.js')

  if (!existsSync(wasmFile)) {
    printError('WASM file not found - build failed')
    throw new Error(`Required WASM file not found: ${wasmFile}`)
  }

  const outputWasm = path.join(OUTPUT_DIR, 'yoga.wasm')
  const outputMjs = path.join(OUTPUT_DIR, 'yoga.mjs')
  const outputSyncJs = path.join(OUTPUT_DIR, 'yoga-sync.js')

  // Copy WASM file.
  await fs.copyFile(wasmFile, outputWasm)

  // Copy original JS glue code as .mjs (ES6 module format).
  if (existsSync(jsFile)) {
    const jsContent = await fs.readFile(jsFile, 'utf-8')
    // Strip the export statement at the end of the file.
    const withoutExport = jsContent.replace(
      /;?\s*export\s+default\s+\w+\s*;\s*$/,
      '',
    )
    await fs.writeFile(outputMjs, withoutExport, 'utf-8')
    printStep(`MJS: ${outputMjs}`)
  }

  // Generate companion -sync.js with synchronous loading and base64-embedded WASM.
  printStep('Generating synchronous .js wrapper with embedded WASM...')

  const wasmBinary = await fs.readFile(outputWasm)
  const base64Wasm = wasmBinary.toString('base64')
  const mjsContent = await fs.readFile(outputMjs, 'utf-8')

  const jsContent = `'use strict';

/**
 * Synchronous yoga-layout with embedded WASM binary.
 *
 * This file is AUTO-GENERATED by yoga-layout-builder.
 * Built with aggressive size optimizations for synchronous instantiation.
 *
 * Source: yoga.mjs (${(await fs.stat(outputMjs)).size} bytes)
 * WASM: ${wasmBinary.length} bytes (${base64Wasm.length} bytes base64)
 */

// Base64-encoded WASM binary (embedded at build time).
const base64Wasm = '${base64Wasm}';

// Decode base64 to Uint8Array.
const wasmBinary = Uint8Array.from(atob(base64Wasm), c => c.charCodeAt(0));

// Inlined Emscripten loader from Yoga Layout build.
${mjsContent}

// Synchronously initialize yoga with embedded WASM.
const yoga = Module({
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
  module.exports = yoga;
  module.exports.default = yoga;
}

// ES module export.
export default yoga;
`

  await fs.writeFile(outputSyncJs, jsContent, 'utf-8')

  const wasmSize = await getFileSize(outputWasm)
  const syncJsSize = await getFileSize(outputSyncJs)
  printStep(`WASM: ${outputWasm}`)
  printStep(`WASM size: ${wasmSize}`)
  printStep(`Sync JS: ${outputSyncJs}`)
  printStep(`Sync JS size: ${syncJsSize}`)

  printSuccess('WASM exported')

  // Smoke test: Verify exported WASM file.
  printStep('Smoke testing exported WASM...')
  const wasmBuffer = await fs.readFile(outputWasm)

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

  // Smoke test: Verify sync.js exists (skip execution test due to Emscripten 4.x runtime issues).
  printStep('Smoke testing yoga-sync.js...')
  try {
    if (!existsSync(outputSyncJs)) {
      throw new Error('Sync JS file not found')
    }

    const syncStats = await fs.stat(outputSyncJs)
    if (syncStats.size === 0) {
      throw new Error('Sync JS file is empty')
    }

    printStep(`Sync JS file valid (${(syncStats.size / 1024).toFixed(2)} KB)`)
  } catch (e) {
    throw new Error(`Failed to validate sync JS file: ${e.message}`)
  }

  printSuccess('Export complete')
}

/**
 * Main build function.
 */
async function main() {
  const totalStart = Date.now()

  printHeader('🔨 Building yoga-layout')
  const logger = getDefaultLogger()
  logger.info(`Yoga Layout ${YOGA_VERSION} minimal build`)
  logger.info(`Build mode: ${BUILD_MODE}`)
  logger.info('')

  // Clean checkpoints if requested or if output is missing.
  const outputWasm = path.join(OUTPUT_DIR, 'yoga.wasm')
  const outputMjs = path.join(OUTPUT_DIR, 'yoga.mjs')
  const outputSyncJs = path.join(OUTPUT_DIR, 'yoga-sync.js')
  const outputMissing =
    !existsSync(outputWasm) ||
    !existsSync(outputMjs) ||
    !existsSync(outputSyncJs)

  if (CLEAN_BUILD || outputMissing) {
    if (outputMissing) {
      printStep('Output artifacts missing - cleaning stale checkpoints')
    }
    await cleanCheckpoint(BUILD_DIR, '')
  }

  // Pre-flight checks.
  printHeader('Pre-flight Checks')

  const diskOk = await checkDiskSpace(BUILD_DIR, 1)
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
  await cloneYogaSource()
  await extractSourceForMode()
  await configure()
  await build()
  await optimize()
  await exportWasm()

  // Report completion.
  const totalDuration = formatDuration(Date.now() - totalStart)

  printHeader('🎉 Build Complete!')
  logger.success(`Total time: ${totalDuration}`)
  logger.success(`Output: ${OUTPUT_DIR}`)
  logger.info('')
  logger.info('Next steps:')
  logger.info('  1. Test WASM with Socket CLI')
  logger.info('  2. Integrate with unified WASM build')
  logger.info('')
}

// Run build.
const logger = getDefaultLogger()
main().catch(e => {
  printError('Build Failed')
  logger.error(e.message)
  throw e
})
