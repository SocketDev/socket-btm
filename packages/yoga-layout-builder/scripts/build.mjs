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

import { WIN32 } from '@socketsecurity/lib/constants/platform'
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
// Read Yoga version from package.json (matches Yoga Layout release version).
const packageJson = JSON.parse(
  await fs.readFile(path.join(ROOT_DIR, 'package.json'), 'utf-8'),
)
const YOGA_VERSION = `v${packageJson.version}`
const YOGA_REPO = 'https://github.com/facebook/yoga.git'
const YOGA_SOURCE_DIR = path.join(BUILD_DIR, 'yoga-source')

/**
 * Clone Yoga source if not already present.
 */
async function cloneYogaSource() {
  if (!(await shouldRun(BUILD_DIR, 'yoga-layout', 'cloned', FORCE_BUILD))) {
    return
  }

  printHeader('Cloning Yoga Source')

  if (existsSync(YOGA_SOURCE_DIR)) {
    printStep('Yoga source already exists, skipping clone')
    await createCheckpoint(BUILD_DIR, 'yoga-layout', 'cloned')
    return
  }

  await fs.mkdir(BUILD_DIR, { recursive: true })

  printStep(`Cloning Yoga ${YOGA_VERSION}...`)
  const cloneResult = await spawn(
    'git',
    [
      'clone',
      '--depth',
      '1',
      '--branch',
      YOGA_VERSION,
      YOGA_REPO,
      YOGA_SOURCE_DIR,
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
  await createCheckpoint(BUILD_DIR, 'yoga-layout', 'cloned')
}

/**
 * Configure CMake with Emscripten.
 */
async function configure() {
  if (!(await shouldRun(BUILD_DIR, 'yoga-layout', 'configured', FORCE_BUILD))) {
    return
  }

  printHeader('Configuring CMake with Emscripten')

  const cmakeBuildDir = path.join(BUILD_DIR, 'cmake')
  await fs.mkdir(cmakeBuildDir, { recursive: true })

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
    printWarning('Emscripten SDK path not set')
    throw new Error('Emscripten SDK required')
  }

  printStep(`Using toolchain: ${toolchainFile}`)

  // Configure CMake with aggressive size + performance optimizations.
  // MAXIMUM AGGRESSIVE - NO BACKWARDS COMPATIBILITY!
  const cxxFlags = [
    '-Oz', // Optimize aggressively for size.
    '-flto=thin', // Thin LTO for faster builds, similar size reduction.
    '-fno-exceptions', // No C++ exceptions (smaller).
    '-fno-rtti', // No runtime type information (smaller).
    '-ffunction-sections', // Separate functions for better dead code elimination.
    '-fdata-sections', // Separate data sections.
    '-ffast-math', // Fast math optimizations (performance).
    '-fno-finite-math-only', // Re-enable infinity checks (Yoga needs this).
  ]

  const linkerFlags = [
    '--closure=1', // Google Closure Compiler (aggressive minification).
    '--gc-sections', // Garbage collect unused sections.
    '-flto=thin',
    '-Oz',
    '-sALLOW_MEMORY_GROWTH=1', // Dynamic memory.
    '-sASSERTIONS=0', // No runtime assertions (smaller, faster).
    '-sEXPORT_ES6=1', // ES6 module export.
    '-sFILESYSTEM=0', // No filesystem support (smaller).
    '-sINITIAL_MEMORY=64KB', // Minimal initial memory.
    '-sMALLOC=emmalloc', // Smaller allocator.
    '-sMODULARIZE=1', // Modular output.
    '-sNO_EXIT_RUNTIME=1', // Keep runtime alive (needed for WASM).
    '-sSTACK_SIZE=16KB', // Small stack.
    '-sSUPPORT_LONGJMP=0', // No longjmp (smaller).
    '-sWASM_ASYNC_COMPILATION=0', // CRITICAL: Synchronous instantiation for bundling.
  ]

  const cmakeArgs = [
    'cmake',
    `-DCMAKE_TOOLCHAIN_FILE=${toolchainFile}`,
    '-DCMAKE_BUILD_TYPE=Release',
    `-DCMAKE_CXX_FLAGS=${cxxFlags.join(' ')}`,
    `-DCMAKE_EXE_LINKER_FLAGS=${linkerFlags.join(' ')}`,
    `-DCMAKE_SHARED_LINKER_FLAGS=${linkerFlags.join(' ')}`,
    '-S',
    YOGA_SOURCE_DIR,
    '-B',
    cmakeBuildDir,
  ]

  printStep('Optimization flags:')
  printStep(`  CXX: ${cxxFlags.join(' ')}`)
  printStep(`  Linker: ${linkerFlags.join(' ')}`)

  const cmakeResult = await spawn('emcmake', cmakeArgs, {
    shell: WIN32,
    stdio: 'inherit',
  })

  if (cmakeResult.code !== 0) {
    throw new Error('CMake configuration failed')
  }

  printSuccess('CMake configured')
  await createCheckpoint(BUILD_DIR, 'yoga-layout', 'configured')
}

/**
 * Build Yoga with Emscripten.
 */
async function build() {
  if (!(await shouldRun(BUILD_DIR, 'yoga-layout', 'built', FORCE_BUILD))) {
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

  // Use optimization flags (note: bindings require RTTI and exceptions).
  const cxxFlags = [
    '-Oz',
    '-flto=thin',
    '-ffunction-sections',
    '-fdata-sections',
    '-ffast-math',
    '-fno-finite-math-only',
  ]

  const linkerFlags = [
    '--closure=1',
    '-Wl,--gc-sections',
    '-flto=thin',
    '-Oz',
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

  // Compile and link in one step.
  const emArgs = [
    `-I${path.join(BUILD_DIR, 'yoga-source')}`,
    ...cxxFlags,
    bindingsFile,
    staticLib,
    ...linkerFlags,
    '-o',
    jsOutput,
  ]

  const emppResult = await spawn('em++', emArgs, {
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
  await createCheckpoint(BUILD_DIR, 'yoga-layout', 'built')
}

/**
 * Optimize WASM with wasm-opt.
 */
async function optimize() {
  if (!(await shouldRun(BUILD_DIR, 'yoga-layout', 'optimized', FORCE_BUILD))) {
    return
  }

  printHeader('Optimizing WASM')

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
  await createCheckpoint(BUILD_DIR, 'yoga-layout', 'optimized')
}

/**
 * Verify WASM can load.
 */
async function verify() {
  if (!(await shouldRun(BUILD_DIR, 'yoga-layout', 'verified', FORCE_BUILD))) {
    return
  }

  printHeader('Verifying WASM')

  const cmakeBuildDir = path.join(BUILD_DIR, 'cmake')
  const wasmFile = path.join(cmakeBuildDir, 'yoga.wasm')

  if (!existsSync(wasmFile)) {
    printWarning('WASM file not found, skipping verification')
    await createCheckpoint(BUILD_DIR, 'yoga-layout', 'verified')
    return
  }

  // Check WASM file exists and is valid.
  const stats = await fs.stat(wasmFile)
  if (stats.size === 0) {
    throw new Error('WASM file is empty')
  }

  // Verify WASM magic number.
  const buffer = await fs.readFile(wasmFile)
  const magic = buffer.slice(0, 4).toString('hex')
  if (magic !== '0061736d') {
    throw new Error('Invalid WASM file (bad magic number)')
  }

  printSuccess('WASM verified')
  await createCheckpoint(BUILD_DIR, 'yoga-layout', 'verified')
}

/**
 * Export WASM to output directory.
 */
async function exportWasm() {
  printHeader('Exporting WASM')

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
}

/**
 * Main build function.
 */
async function main() {
  const totalStart = Date.now()

  printHeader('🔨 Building yoga-layout')
  const logger = getDefaultLogger()
  logger.info(`Yoga Layout ${YOGA_VERSION} minimal build`)
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
    await cleanCheckpoint(BUILD_DIR, 'yoga-layout')
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
  await configure()
  await build()
  await optimize()
  await verify()
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
