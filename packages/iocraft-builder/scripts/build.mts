/**
 * Build iocraft - Native Node.js bindings for iocraft TUI library.
 *
 * This script builds iocraft from Rust source using napi-rs:
 * - Rust compilation via cargo
 * - napi-rs for Node.js bindings
 * - Cross-platform builds
 *
 * Usage:
 *   node scripts/build.mts          # Normal build with checkpoints
 *   node scripts/build.mts --force  # Force rebuild (ignore checkpoints)
 */

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
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
import { getBuildMode } from 'build-infra/lib/constants'
import { ensureToolInstalled } from 'build-infra/lib/tool-installer'
import { errorMessage } from 'build-infra/lib/error-utils'


import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { safeMkdir } from '@socketsecurity/lib/fs'
import { glob } from '@socketsecurity/lib/globs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { copySource } from './source-copied/copy-source.mts'
import { applyPatches } from './source-patched/apply-patches.mts'
import {
  BUILD_ROOT,
  PACKAGE_ROOT,
  UPSTREAM_PATH,
  getBuildPaths,
  getCurrentPlatform,
} from './paths.mts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Parse arguments.
const args = new Set(process.argv.slice(2))
const FORCE_BUILD = args.has('--force')
const CLEAN_BUILD = args.has('--clean')

// Build mode: --prod/--dev CLI flags win; otherwise env (BUILD_MODE, CI→prod,
// default dev). Handled centrally by build-infra's getBuildMode().
const BUILD_MODE = getBuildMode(args)

// Configuration.
let packageJson
try {
  packageJson = JSON.parse(
    await fs.readFile(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'),
  )
} catch (error) {
  throw new Error(
    `Failed to parse package.json at ${path.join(PACKAGE_ROOT, 'package.json')}: ${errorMessage(error)}`,
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

// getCurrentPlatform() now honors PLATFORM_ARCH env itself.
const PLATFORM_ARCH = await getCurrentPlatform()

const {
  buildDir: BUILD_DIR,
  outDir: OUTPUT_DIR,
  sourcePatchedDir: SOURCE_PATCHED_DIR,
  targetDir: TARGET_DIR,
  getPlatformOutputPath,
} = getBuildPaths(BUILD_MODE, PLATFORM_ARCH)

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

  const realCargo = findRealCargo()
  if (!existsSync(realCargo)) {
    printError('Cargo is required but not found')
    printError(`Checked: ${realCargo}`)
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
    printError(
      'Run: git submodule update --init packages/iocraft-builder/upstream/iocraft',
    )
    throw new Error('iocraft submodule not initialized')
  }

  logger.success('iocraft submodule found')
}

/**
 * Find the real cargo binary, bypassing Socket Firewall shims.
 * SFW injects shims into PATH that intercept HTTPS but cargo uses its own
 * TLS stack (not Node.js), so the SFW CA cert isn't trusted.
 */
function findRealCargo() {
  const cargoHome = process.env['CARGO_HOME'] || path.join(os.homedir(), '.cargo')
  const ext = WIN32 ? '.exe' : ''
  const realCargo = path.join(cargoHome, 'bin', `cargo${ext}`)
  if (existsSync(realCargo)) {
    return realCargo
  }
  // Fallback: try rustup default location
  const rustupCargo = path.join(os.homedir(), '.rustup', 'toolchains', 'stable-*', 'bin', `cargo${ext}`)
  // Just use PATH as last resort
  return `cargo${ext}`
}

/**
 * Run cargo with cross-platform handling.
 *
 * IMPORTANT: Must pass explicit env with PATH to work around Node.js 25 spawn issues.
 * Uses findRealCargo() to bypass SFW shims that break cargo's TLS.
 */
async function runCargo(args, options = {}) {
  const cargoPath = findRealCargo()
  logger.substep(`Using cargo: ${cargoPath}`)

  const result = await spawn(cargoPath, args, {
    env: process.env,
    shell: WIN32,
    stdio: options.stdio || 'inherit',
  })

  return { exitCode: result.code ?? result.exitCode ?? 0 }
}

/**
 * Build the native addon.
 */
async function buildNativeAddon() {
  logger.step('Building native addon')

  const platform = await getCurrentPlatform()
  const outputPath = getPlatformOutputPath(platform)

  await safeMkdir(path.dirname(outputPath))

  const releaseFlag = BUILD_MODE === 'prod' ? '--release' : ''
  const targetProfile = BUILD_MODE === 'prod' ? 'release' : 'debug'

  // Support cross-compilation via TARGET environment variable
  const rustTarget = process.env.TARGET

  logger.substep(
    `Building for ${platform} (${BUILD_MODE} mode)${rustTarget ? ` [target: ${rustTarget}]` : ''}...`,
  )

  const manifestPath = path.join(SOURCE_PATCHED_DIR, 'Cargo.toml')

  const cargoArgs = [
    'build',
    releaseFlag,
    '--manifest-path',
    manifestPath,
    '--target-dir',
    TARGET_DIR,
  ].filter(Boolean)

  // Add --target flag for cross-compilation
  if (rustTarget) {
    cargoArgs.push('--target', rustTarget)
  }

  const result = await runCargo(cargoArgs, {
    stdio: 'inherit',
  })

  if (result.exitCode !== 0) {
    throw new Error(`Cargo build failed with exit code ${result.exitCode}`)
  }

  const LIBRARY_EXTENSIONS = {
    __proto__: null,
    darwin: 'dylib',
    linux: 'so',
    win32: 'dll',
  }

  const LIBRARY_PREFIXES = {
    __proto__: null,
    darwin: 'lib',
    linux: 'lib',
    win32: '',
  }

  // Determine the target platform for library path (use rustTarget if cross-compiling)
  const targetPlatform = rustTarget
    ? getTargetPlatform(rustTarget)
    : process.platform
  const prefix = LIBRARY_PREFIXES[targetPlatform] ?? 'lib'
  const ext = LIBRARY_EXTENSIONS[targetPlatform] ?? 'so'

  // When cross-compiling, output goes to target/<rust-target>/<profile>/
  const builtLib = rustTarget
    ? path.join(
        TARGET_DIR,
        rustTarget,
        targetProfile,
        `${prefix}iocraft_node.${ext}`,
      )
    : path.join(TARGET_DIR, targetProfile, `${prefix}iocraft_node.${ext}`)

  if (existsSync(builtLib)) {
    await fs.copyFile(builtLib, outputPath)
    logger.success(`Built: ${outputPath}`)
  } else {
    logger.warn(`Built library not found at expected path: ${builtLib}`)
    // Try to find where the library was actually built
    const foundLibs = await glob('**/iocraft_node.*', {
      cwd: TARGET_DIR,
      absolute: true,
    })
    if (foundLibs.length > 0) {
      logger.info(`Found libraries: ${foundLibs.join(', ')}`)
    }
  }
}

/**
 * Map Rust target triple to Node.js platform.
 */
function getTargetPlatform(rustTarget) {
  if (rustTarget.includes('darwin') || rustTarget.includes('apple')) {
    return 'darwin'
  } else if (rustTarget.includes('windows') || rustTarget.includes('msvc')) {
    return 'win32'
  } else if (rustTarget.includes('linux')) {
    return 'linux'
  }
  return 'linux'
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

  // Copy source from upstream.
  logger.step('Copying source from upstream')
  await copySource()

  // Apply patches.
  logger.step('Applying patches')
  await applyPatches(PLATFORM_ARCH, BUILD_MODE)

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
