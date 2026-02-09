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
  freeDiskSpace,
} from 'build-infra/lib/build-helpers'
import { printError } from 'build-infra/lib/build-output'
import { cleanCheckpoint } from 'build-infra/lib/checkpoint-manager'
import { ensureEmscripten } from 'build-infra/lib/emscripten-installer'
import { ensureToolInstalled } from 'build-infra/lib/tool-installer'
import { getEmscriptenVersion } from 'build-infra/lib/version-helpers'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { finalizeWasm as finalizeWasmModule } from './finalized/shared/finalize-wasm.mjs'
import {
  BINDINGS_FILE,
  PACKAGE_ROOT,
  getBuildPaths,
  getSharedBuildPaths,
} from './paths.mjs'
import { cloneYogaSource } from './source-cloned/shared/clone-source.mjs'
import { configureCMake } from './source-configured/shared/configure-cmake.mjs'
import { compileWasm } from './wasm-compiled/shared/compile-wasm.mjs'
import { optimizeWasm } from './wasm-optimized/shared/optimize-wasm.mjs'
import { copyToRelease as copyToReleaseModule } from './wasm-released/shared/copy-to-release.mjs'
import { generateSync as generateSyncModule } from './wasm-synced/shared/generate-sync.mjs'

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
// Read Yoga source metadata from package.json.
const packageJson = JSON.parse(
  await fs.readFile(path.join(PACKAGE_ROOT, 'package.json'), 'utf-8'),
)
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
} = getBuildPaths(BUILD_MODE)

/**
 * Clone Yoga source if not already present.
 * Clones once to shared location for pristine checkpoint.
 */
async function cloneSource() {
  await cloneYogaSource({
    yogaVersion: YOGA_VERSION,
    yogaSha: YOGA_SHA,
    yogaRepo: YOGA_REPO,
    sharedBuildDir: SHARED_BUILD_DIR,
    sharedSourceDir: SHARED_SOURCE_DIR,
    forceRebuild: FORCE_BUILD,
  })
}

/**
 * Configure CMake with Emscripten.
 */
async function configure() {
  await configureCMake({
    buildDir: BUILD_DIR,
    cmakeBuildDir: CMAKE_BUILD_DIR,
    sourceDir: SHARED_SOURCE_DIR,
    buildMode: BUILD_MODE,
    forceRebuild: FORCE_BUILD,
  })
}

/**
 * Build Yoga with Emscripten.
 */
async function buildWasm() {
  await compileWasm({
    buildDir: BUILD_DIR,
    cmakeBuildDir: CMAKE_BUILD_DIR,
    sourceDir: SHARED_SOURCE_DIR,
    buildWasmFile: BUILD_WASM_FILE,
    buildJsFile: BUILD_JS_FILE,
    bindingsFile: BINDINGS_FILE,
    staticLibFile: STATIC_LIB_FILE,
    buildMode: BUILD_MODE,
    forceRebuild: FORCE_BUILD,
  })
}

/**
 * Copy WASM from build to Release directory.
 */
async function copyToRelease() {
  await copyToReleaseModule({
    buildDir: BUILD_DIR,
    outputReleaseDir: OUTPUT_RELEASE_DIR,
    buildWasmFile: BUILD_WASM_FILE,
    buildJsFile: BUILD_JS_FILE,
    forceRebuild: FORCE_BUILD,
  })
}

/**
 * Optimize WASM with wasm-opt (prod builds only).
 */
async function optimize() {
  await optimizeWasm({
    buildDir: BUILD_DIR,
    releaseDir: OUTPUT_RELEASE_DIR,
    optimizedDir: OUTPUT_OPTIMIZED_DIR,
    buildMode: BUILD_MODE,
    forceRebuild: FORCE_BUILD,
  })
}

/**
 * Generate synchronous wrapper for WASM.
 */
async function generateSync() {
  await generateSyncModule({
    buildDir: BUILD_DIR,
    buildMode: BUILD_MODE,
    outputReleaseDir: OUTPUT_RELEASE_DIR,
    outputOptimizedDir: OUTPUT_OPTIMIZED_DIR,
    outputSyncDir: OUTPUT_SYNC_DIR,
    forceRebuild: FORCE_BUILD,
  })
}

/**
 * Copy final artifacts to Final directory for distribution.
 */
async function finalize() {
  await finalizeWasmModule({
    buildDir: BUILD_DIR,
    outputSyncDir: OUTPUT_SYNC_DIR,
    outputFinalDir: OUTPUT_FINAL_DIR,
    outputWasmFile,
    outputMjsFile,
    outputSyncJsFile,
    forceRebuild: FORCE_BUILD,
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
    version: emscriptenVersion,
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
main().catch(e => {
  printError('Build Failed')
  logger.error(e.message)
  throw e
})
