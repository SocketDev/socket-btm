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
 *   node scripts/build.mts          # Normal build with checkpoints
 *   node scripts/build.mts --force  # Force rebuild (ignore checkpoints)
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import {
  checkDiskSpace,
  formatDuration,
  freeDiskSpace,
} from 'build-infra/lib/build-helpers'
import { printError } from 'build-infra/lib/build-output'
import { cleanCheckpoint } from 'build-infra/lib/checkpoint-manager'
import { ensureEmscripten } from 'build-infra/lib/emscripten-installer'
import { ensureToolInstalled } from 'build-infra/lib/tool-installer'
import { getEmscriptenVersion } from 'build-infra/lib/version-helpers'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { finalizeWasm as finalizeWasmModule } from './finalized/shared/finalize-wasm.mts'
import {
  PACKAGE_ROOT,
  getBuildOutputPaths,
  getBuildPaths,
  getSharedBuildPaths,
} from './paths.mts'
// Import extracted checkpoint modules
import { cloneOnnxSource as cloneOnnxSourceModule } from './source-cloned/shared/clone-source.mts'
import { compileWasm as compileWasmModule } from './wasm-compiled/shared/compile-wasm.mts'
import { optimizeWasm as optimizeWasmModule } from './wasm-optimized/shared/optimize-wasm.mts'
import { copyToRelease as copyToReleaseModule } from './wasm-released/shared/copy-to-release.mts'
import { generateSync as generateSyncModule } from './wasm-synced/shared/generate-sync.mts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Parse arguments.
const args = new Set(process.argv.slice(2))
const FORCE_BUILD = args.has('--force')
const CLEAN_BUILD = args.has('--clean')

// Build mode: prod (default for CI) or dev (default for local, faster builds).
const IS_CI = Boolean(process.env.CI)
const PROD_BUILD = args.has('--prod')
const DEV_BUILD = args.has('--dev')
const BUILD_MODE = PROD_BUILD
  ? 'prod'
  : DEV_BUILD
    ? 'dev'
    : IS_CI
      ? 'prod'
      : 'dev'

// Configuration.
// Read ONNX Runtime source metadata from package.json.
const packageJsonPath = path.join(PACKAGE_ROOT, 'package.json')
let packageJson
try {
  packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'))
} catch (error) {
  throw new Error(
    `Failed to parse package.json at ${packageJsonPath}: ${error.message}`,
    { cause: error },
  )
}
const onnxSource = packageJson.sources?.onnxruntime
if (!onnxSource) {
  throw new Error(
    'Missing sources.onnxruntime in package.json. Please add source metadata.',
  )
}
const ONNX_VERSION = `v${onnxSource.version}`
const ONNX_SHA = onnxSource.ref
const ONNX_REPO = onnxSource.url

const eigenSource = packageJson.sources?.eigen
if (!eigenSource) {
  throw new Error(
    'Missing sources.eigen in package.json. Please add source metadata.',
  )
}
const EIGEN_COMMIT = eigenSource.ref
const EIGEN_SHA1 = eigenSource.sha1

// Load emscripten version from package-level external-tools.json
const emscriptenVersion = await getEmscriptenVersion(PACKAGE_ROOT)

// Get paths from source of truth
const {
  buildDir: SHARED_BUILD_DIR,
  buildScriptFile: SHARED_BUILD_SCRIPT_FILE,
  cmakeDepsFile: SHARED_CMAKE_DEPS_FILE,
  cmakeListsFile: SHARED_CMAKE_LISTS_FILE,
  cmakeWebassemblyFile: SHARED_CMAKE_WEBASSEMBLY_FILE,
  postBuildSourceFile: SHARED_POST_BUILD_SOURCE_FILE,
  sourceDir: SHARED_SOURCE_DIR,
} = getSharedBuildPaths()

const {
  buildDir: BUILD_DIR,
  outputFinalDir: OUTPUT_FINAL_DIR,
  outputMjsFile,
  outputOptimizedDir: OUTPUT_OPTIMIZED_DIR,
  outputReleaseDir: OUTPUT_RELEASE_DIR,
  outputSyncDir: OUTPUT_SYNC_DIR,
  outputSyncJsFile,
  outputWasmFile,
} = getBuildPaths(BUILD_MODE)

/**
 * Clone ONNX Runtime source if not already present.
 * Clones once to shared location for pristine checkpoint.
 */
async function cloneOnnxSource() {
  await cloneOnnxSourceModule({
    eigenCommit: EIGEN_COMMIT,
    eigenSha1: EIGEN_SHA1,
    forceRebuild: FORCE_BUILD,
    onnxRepo: ONNX_REPO,
    onnxSha: ONNX_SHA,
    onnxVersion: ONNX_VERSION,
    sharedBuildDir: SHARED_BUILD_DIR,
    sharedCmakeDepsFile: SHARED_CMAKE_DEPS_FILE,
    sharedCmakeListsFile: SHARED_CMAKE_LISTS_FILE,
    sharedCmakeWebassemblyFile: SHARED_CMAKE_WEBASSEMBLY_FILE,
    sharedPostBuildSourceFile: SHARED_POST_BUILD_SOURCE_FILE,
    sharedSourceDir: SHARED_SOURCE_DIR,
  })
}

/**
 * Build ONNX Runtime with Emscripten using official build script.
 */
async function buildWasm() {
  await compileWasmModule({
    buildDir: BUILD_DIR,
    buildMode: BUILD_MODE,
    buildOutputPaths: getBuildOutputPaths(SHARED_SOURCE_DIR),
    buildScriptFile: SHARED_BUILD_SCRIPT_FILE,
    emscriptenVersion,
    forceRebuild: FORCE_BUILD,
    isCI: IS_CI,
    modeSourceDir: SHARED_SOURCE_DIR,
  })
}

/**
 * Copy WASM from source build to Release directory.
 */
async function copyToRelease() {
  // Get WASM build outputs (platform-dependent paths).
  const { buildMjsFile, buildWasmFile } = getBuildOutputPaths(SHARED_SOURCE_DIR)

  await copyToReleaseModule({
    buildDir: BUILD_DIR,
    buildMjsFile,
    buildWasmFile,
    forceRebuild: FORCE_BUILD,
    outputReleaseDir: OUTPUT_RELEASE_DIR,
  })
}

/**
 * Optimize WASM with wasm-opt (prod builds only).
 */
async function optimize() {
  await optimizeWasmModule({
    buildDir: BUILD_DIR,
    buildMode: BUILD_MODE,
    forceRebuild: FORCE_BUILD,
    optimizedDir: OUTPUT_OPTIMIZED_DIR,
    releaseDir: OUTPUT_RELEASE_DIR,
  })
}

/**
 * Generate synchronous wrapper for WASM.
 */
/**
 * Generate synchronous wrapper for WASM.
 */
async function generateSync() {
  await generateSyncModule({
    buildDir: BUILD_DIR,
    buildMode: BUILD_MODE,
    forceRebuild: FORCE_BUILD,
    outputOptimizedDir: OUTPUT_OPTIMIZED_DIR,
    outputReleaseDir: OUTPUT_RELEASE_DIR,
    outputSyncDir: OUTPUT_SYNC_DIR,
  })
}

/**
 * Copy final artifacts to Final directory for distribution.
 */
async function finalize() {
  await finalizeWasmModule({
    buildDir: BUILD_DIR,
    forceRebuild: FORCE_BUILD,
    outputFinalDir: OUTPUT_FINAL_DIR,
    outputMjsFile,
    outputSyncDir: OUTPUT_SYNC_DIR,
    outputSyncJsFile,
    outputWasmFile,
  })
}

/**
 * Main build function.
 */
async function main() {
  const totalStart = Date.now()

  logger.step('🔨 Building onnxruntime')
  logger.info(`ONNX Runtime ${ONNX_VERSION} build for Socket CLI`)
  logger.info(`Build mode: ${BUILD_MODE}`)
  logger.info('')

  // Clean checkpoints if requested or if output is missing.
  const outputMissing =
    !existsSync(outputWasmFile) ||
    !existsSync(outputMjsFile) ||
    !existsSync(outputSyncJsFile)

  if (CLEAN_BUILD) {
    logger.substep('Clean build requested - removing checkpoints')
    await cleanCheckpoint(BUILD_DIR, '')
  } else if (outputMissing) {
    logger.substep('Output artifacts missing - cleaning stale checkpoints')
    await cleanCheckpoint(BUILD_DIR, '')
  }

  // Pre-flight checks.
  logger.step('Pre-flight Checks')

  // Free up disk space (CI environments)
  await freeDiskSpace()

  // ONNX needs more space.
  const diskOk = await checkDiskSpace(BUILD_DIR, 5)
  if (!diskOk) {
    logger.warn('Could not check disk space')
  }

  // Ensure CMake is installed.
  logger.substep('Checking for CMake...')
  const cmakeResult = await ensureToolInstalled('cmake', { autoInstall: true })
  if (!cmakeResult.available) {
    printError('CMake is required but not found')
    printError('Install CMake from: https://cmake.org/download/')
    throw new Error('CMake required')
  }

  if (cmakeResult.installed) {
    logger.success('Installed CMake')
  } else {
    logger.success('CMake found')
  }

  // Ensure Python 3 is installed (required by build.sh).
  logger.substep('Checking for Python 3...')
  const pythonResult = await ensureToolInstalled('python3', {
    autoInstall: true,
  })
  if (!pythonResult.available) {
    printError('Python 3 is required but not found')
    printError('Install Python from: https://www.python.org/downloads/')
    throw new Error('Python 3 required')
  }

  if (pythonResult.installed) {
    logger.success('Installed Python 3')
  } else {
    logger.success('Python 3 found')
  }

  // Ensure Emscripten SDK is available.
  logger.substep(
    `Checking for Emscripten SDK (version ${emscriptenVersion})...`,
  )
  const emscriptenResult = await ensureEmscripten({
    autoInstall: true,
    quiet: false,
    version: emscriptenVersion,
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
    logger.success('Installed Emscripten SDK')
  } else if (emscriptenResult.activated) {
    logger.success('Activated Emscripten SDK')
  } else {
    logger.success('Emscripten SDK found')
  }

  // Ninja is required for ONNX Runtime builds (40-50% faster than Make for large C++ projects).
  logger.substep(
    'Checking for Ninja build system (required for fast builds)...',
  )
  const ninjaResult = await ensureToolInstalled('ninja', { autoInstall: true })
  if (ninjaResult.available) {
    if (ninjaResult.installed) {
      logger.success('Installed Ninja build system')
    } else {
      logger.success('Ninja found')
    }
  } else {
    // In CI environments, fail if Ninja is not available (critical for build performance).
    if (IS_CI) {
      printError('Ninja is required for CI builds (40-50% faster than Make)')
      printError(
        'Install: apt-get install ninja-build (Linux) or brew install ninja (macOS)',
      )
      throw new Error('Ninja required for CI builds')
    }
    // For local builds, warn but allow fallback to Make.
    logger.warn(
      'Ninja not found (RECOMMENDED: 40-50% faster than Make for C++ builds)',
    )
    logger.warn(
      'Install: brew install ninja (macOS) or apt-get install ninja-build (Linux)',
    )
  }

  // Optional: Check for wasm-opt (Binaryen) for additional optimization.
  logger.substep('Checking for wasm-opt (optional)...')
  const wasmOptResult = await ensureToolInstalled('wasm-opt', {
    autoInstall: true,
  })
  if (wasmOptResult.available) {
    if (wasmOptResult.installed) {
      logger.success('Installed wasm-opt (Binaryen)')
    } else {
      logger.success('wasm-opt found')
    }
  } else {
    logger.warn(
      'wasm-opt not found (optional, provides additional optimization)',
    )
  }

  logger.success('Pre-flight checks passed')

  // Build phases.
  await cloneOnnxSource()
  await buildWasm()
  await copyToRelease()
  await optimize()
  await generateSync()
  await finalize()

  // Report completion.
  const totalDuration = formatDuration(Date.now() - totalStart)

  logger.step('🎉 Build Complete!')
  logger.success(`Total time: ${totalDuration}`)
  logger.success(`Output: ${OUTPUT_FINAL_DIR}`)
  logger.info('')
  logger.info('Files:')
  logger.info(`  - ${path.relative(PACKAGE_ROOT, outputWasmFile)}`)
  logger.info(`  - ${path.relative(PACKAGE_ROOT, outputMjsFile)}`)
  logger.info(`  - ${path.relative(PACKAGE_ROOT, outputSyncJsFile)}`)
  logger.info('')
}

// Run build.
const logger = getDefaultLogger()
main().catch(error => {
  printError('Build Failed')
  logger.error(error.message)
  throw error
})
