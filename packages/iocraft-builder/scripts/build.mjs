/**
 * Build iocraft - Native Node.js bindings for iocraft TUI library.
 *
 * This script builds iocraft from Rust source using napi-rs:
 * - Rust compilation via cargo
 * - napi-rs for Node.js bindings
 * - Cross-platform builds
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
import { ensureToolInstalled } from 'build-infra/lib/tool-installer'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import {
  BUILD_ROOT,
  PACKAGE_ROOT,
  UPSTREAM_PATH,
  getBuildPaths,
  getCurrentPlatform,
} from './paths.mjs'

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
let packageJson
try {
  packageJson = JSON.parse(
    await fs.readFile(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'),
  )
} catch (error) {
  throw new Error(
    `Failed to parse package.json at ${path.join(PACKAGE_ROOT, 'package.json')}: ${error.message}`,
    { cause: error },
  )
}
const iocraftSource = packageJson.sources?.iocraft
if (!iocraftSource) {
  throw new Error(
    'Missing sources.iocraft in package.json. Please add source metadata.',
  )
}

const IOCRAFT_VERSION = `v${iocraftSource.version}`
const IOCRAFT_REF = iocraftSource.ref

const { buildDir: BUILD_DIR, outDir: OUTPUT_DIR, targetDir: TARGET_DIR, getPlatformOutputPath } =
  getBuildPaths(BUILD_MODE)

const logger = getDefaultLogger()

/**
 * Check if Rust toolchain is available.
 */
async function checkRustToolchain() {
  logger.substep('Checking for Rust toolchain...')

  const rustcResult = await ensureToolInstalled('rustc', { autoInstall: false })
  if (!rustcResult.available) {
    printError('Rust toolchain is required but not found')
    printError('Install Rust from: https://rustup.rs/')
    throw new Error('Rust toolchain required')
  }

  const cargoResult = await ensureToolInstalled('cargo', { autoInstall: false })
  if (!cargoResult.available) {
    printError('Cargo is required but not found')
    throw new Error('Cargo required')
  }

  logger.success('Rust toolchain found')
}

/**
 * Check if upstream submodule is initialized.
 */
async function checkUpstream() {
  logger.substep('Checking iocraft submodule...')

  if (!existsSync(path.join(UPSTREAM_PATH, 'Cargo.toml'))) {
    printError('iocraft submodule not initialized')
    printError('Run: git submodule update --init packages/iocraft-builder/upstream/iocraft')
    throw new Error('iocraft submodule not initialized')
  }

  logger.success('iocraft submodule found')
}

/**
 * Build the native addon.
 */
async function buildNativeAddon() {
  logger.step('Building native addon')

  const platform = getCurrentPlatform()
  const outputPath = getPlatformOutputPath(platform)

  // Ensure output directory exists.
  await fs.mkdir(path.dirname(outputPath), { recursive: true })

  // Build with cargo.
  const releaseFlag = BUILD_MODE === 'prod' ? '--release' : ''
  const targetProfile = BUILD_MODE === 'prod' ? 'release' : 'debug'

  logger.substep(`Building for ${platform} (${BUILD_MODE} mode)...`)

  const { spawn } = await import('@socketsecurity/lib/spawn')

  const result = await spawn(
    'cargo',
    ['build', releaseFlag, '--target-dir', TARGET_DIR].filter(Boolean),
    {
      cwd: PACKAGE_ROOT,
      stdio: 'inherit',
    },
  )

  if (result.exitCode !== 0) {
    throw new Error(`Cargo build failed with exit code ${result.exitCode}`)
  }

  // Copy the built .node file to output directory.
  const builtLib = path.join(
    TARGET_DIR,
    targetProfile,
    `libiocraft_node.${process.platform === 'win32' ? 'dll' : process.platform === 'darwin' ? 'dylib' : 'so'}`,
  )

  if (existsSync(builtLib)) {
    await fs.copyFile(builtLib, outputPath)
    logger.success(`Built: ${outputPath}`)
  } else {
    logger.warn(`Built library not found at expected path: ${builtLib}`)
  }
}

/**
 * Main build function.
 */
async function main() {
  const totalStart = Date.now()

  logger.step('🔨 Building iocraft-builder')
  logger.info(`iocraft ${IOCRAFT_VERSION} native bindings`)
  logger.info(`Build mode: ${BUILD_MODE}`)
  logger.info('')

  // Clean checkpoints if requested.
  if (CLEAN_BUILD) {
    logger.substep('Clean build requested - removing checkpoints')
    await cleanCheckpoint(BUILD_DIR, '')
  }

  // Pre-flight checks.
  logger.step('Pre-flight Checks')

  // Free up disk space (CI environments).
  await freeDiskSpace()

  const diskOk = await checkDiskSpace(BUILD_DIR, 1)
  if (!diskOk) {
    logger.warn('Could not check disk space')
  }

  await checkRustToolchain()
  await checkUpstream()

  logger.success('Pre-flight checks passed')

  // Build.
  await buildNativeAddon()

  // Report completion.
  const totalDuration = formatDuration(Date.now() - totalStart)

  logger.step('🎉 Build Complete!')
  logger.success(`Total time: ${totalDuration}`)
  logger.success(`Output: ${OUTPUT_DIR}`)
  logger.info('')
}

// Run build.
main().catch(error => {
  printError('Build Failed')
  logger.error(error.message)
  throw error
})
