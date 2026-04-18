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
  getBindingsPaths,
  getBuildPaths,
  getCurrentPlatform,
  getSharedBuildPaths,
} from './paths.mts'
import { cloneYogaSource } from './source-cloned/shared/clone-source.mts'
import { configureCMake } from './source-configured/shared/configure-cmake.mts'
import { compileWasm } from './wasm-compiled/shared/compile-wasm.mts'
import { optimizeWasm } from './wasm-optimized/shared/optimize-wasm.mts'
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
// Read Yoga source metadata from package.json.
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
const yogaSource = packageJson.sources?.yoga
if (!yogaSource) {
  throw new Error(
    'Missing sources.yoga in package.json. Please add source metadata.',
  )
}
const YOGA_VERSION = `v${yogaSource.version}`
const YOGA_SHA = yogaSource.ref
const YOGA_REPO = yogaSource.url

// Load Emscripten version from external-tools.json (single source of truth)
const emscriptenVersion = await getEmscriptenVersion(PACKAGE_ROOT)

// Get paths from source of truth
const { buildDir: SHARED_BUILD_DIR, sourceDir: SHARED_SOURCE_DIR } =
  getSharedBuildPaths()

const PLATFORM_ARCH = await getCurrentPlatform()

const {
  buildDir: BUILD_DIR,
  cmakeDir: CMAKE_BUILD_DIR,
  jsFile: BUILD_JS_FILE,
  outputFinalDir: OUTPUT_FINAL_DIR,
  outputMjsFile,
  outputOptimizedDir: OUTPUT_OPTIMIZED_DIR,
  outputReleaseDir: OUTPUT_RELEASE_DIR,
  outputSyncDir: OUTPUT_SYNC_DIR,
  outputSyncJsFile,
  outputWasmFile,
  staticLibFile: STATIC_LIB_FILE,
  wasmFile: BUILD_WASM_FILE,
} = getBuildPaths(BUILD_MODE, PLATFORM_ARCH)

/**
 * Clone Yoga source if not already present.
 * Clones once to shared location for pristine checkpoint.
 */
async function cloneSource() {
  await cloneYogaSource({
    forceRebuild: FORCE_BUILD,
    sharedBuildDir: SHARED_BUILD_DIR,
    sharedSourceDir: SHARED_SOURCE_DIR,
    yogaRepo: YOGA_REPO,
    yogaSha: YOGA_SHA,
    yogaVersion: YOGA_VERSION,
  })
}

/**
 * Configure CMake with Emscripten.
 */
async function configure() {
  await configureCMake({
    buildDir: BUILD_DIR,
    buildMode: BUILD_MODE,
    cmakeBuildDir: CMAKE_BUILD_DIR,
    emscriptenVersion,
    forceRebuild: FORCE_BUILD,
    sourceDir: SHARED_SOURCE_DIR,
  })
}

/**
 * Build Yoga with Emscripten.
 */
async function buildWasm() {
  // Get bindings paths from the cloned source (ensures version match).
  const { bindingsDir, bindingsFiles } = getBindingsPaths(SHARED_SOURCE_DIR)

  await compileWasm({
    bindingsDir,
    bindingsFiles,
    buildDir: BUILD_DIR,
    buildJsFile: BUILD_JS_FILE,
    buildMode: BUILD_MODE,
    buildWasmFile: BUILD_WASM_FILE,
    cmakeBuildDir: CMAKE_BUILD_DIR,
    forceRebuild: FORCE_BUILD,
    sourceDir: SHARED_SOURCE_DIR,
    staticLibFile: STATIC_LIB_FILE,
  })
}

/**
 * Copy WASM from build to Release directory.
 */
async function copyToRelease() {
  await copyToReleaseModule({
    buildDir: BUILD_DIR,
    buildJsFile: BUILD_JS_FILE,
    buildWasmFile: BUILD_WASM_FILE,
    forceRebuild: FORCE_BUILD,
    outputReleaseDir: OUTPUT_RELEASE_DIR,
  })
}

/**
 * Optimize WASM with wasm-opt (prod builds only).
 */
async function optimize() {
  await optimizeWasm({
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

  logger.step('🔨 Building yoga-layout')
  logger.info(`Yoga Layout ${YOGA_VERSION} minimal build`)
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

  const diskOk = await checkDiskSpace(BUILD_DIR, 1)
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
  await cloneSource()
  await configure()
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
