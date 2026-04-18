/**
 * Build opentui - Native Node.js bindings for OpenTUI TUI library.
 *
 * This script builds OpenTUI from Zig source using node-api:
 * - Zig compilation to shared library
 * - node-api for Node.js bindings
 * - Cross-platform builds for 8 targets
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
import { getBuildMode } from 'build-infra/lib/constants'
import { ensureToolInstalled } from 'build-infra/lib/tool-installer'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
import { glob } from '@socketsecurity/lib/globs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { copySource } from './source-copied/copy-source.mts'
import { applyPatches } from './source-patched/apply-patches.mts'
import {
  LIBRARY_EXTENSIONS,
  LIBRARY_PREFIXES,
  PACKAGE_ROOT,
  UPSTREAM_PATH,
  ZIG_TARGETS,
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
    `Failed to parse package.json at ${path.join(PACKAGE_ROOT, 'package.json')}: ${error.message}`,
    { cause: error },
  )
}
const opentuiSource = packageJson.sources?.opentui
if (!opentuiSource) {
  throw new Error(
    'Missing sources.opentui in package.json. Please add source metadata.',
  )
}

const OPENTUI_VERSION = `v${opentuiSource.version}`

// getCurrentPlatform() now honors PLATFORM_ARCH env itself.
const PLATFORM_ARCH = await getCurrentPlatform()

const {
  buildDir: BUILD_DIR,
  outDir: OUTPUT_DIR,
  sourcePatchedDir: SOURCE_PATCHED_DIR,
  getPlatformOutputPath,
} = getBuildPaths(BUILD_MODE, PLATFORM_ARCH)

const logger = getDefaultLogger()

/**
 * Ensure Zig toolchain is available at the required version.
 * Uses build-infra's tool-installer with pinned tool auto-download.
 * Returns the path to the zig binary.
 */
async function ensureZig() {
  logger.substep('Checking for Zig toolchain...')

  const result = await ensureToolInstalled('zig', {
    autoInstall: true,
    toolOptions: { packageRoot: PACKAGE_ROOT },
  })

  if (!result.available) {
    printError('Zig toolchain is required but not found')
    printError(
      result.error || 'Install Zig from: https://ziglang.org/download/',
    )
    throw new Error('Zig toolchain required')
  }

  const zigBin = result.path || 'zig'

  // Smoke-test: verify Zig can link on this platform.
  // Zig 0.15.x has known linker issues on macOS 26+ where system
  // symbols (abort, bzero, etc.) are undefined. Detect this early
  // with a trivial link test instead of failing deep in the build.
  try {
    // Zig linker probe — scope to BUILD_DIR (build/<mode>/<platform-arch>)
    // so concurrent builds on different platforms don't collide on these names.
    const testFile = path.join(BUILD_DIR, '_zig_link_test.zig')
    await safeMkdir(BUILD_DIR)
    await fs.writeFile(
      testFile,
      'export fn _zig_link_test() callconv(.c) void {}\n',
    )
    const testResult = await spawn(
      zigBin,
      ['build-lib', testFile, '-dynamic', '-ODebug'],
      { cwd: BUILD_DIR, stdio: 'pipe' },
    )
    const testExit = testResult.code ?? testResult.exitCode ?? 0
    // Clean up test artifacts.
    await safeDelete(testFile)
    await safeDelete(path.join(BUILD_DIR, '_zig_link_test.dylib'))
    await safeDelete(path.join(BUILD_DIR, '_zig_link_test.so'))
    if (testExit !== 0) {
      printError(
        `Zig ${result.version ?? 'unknown'} cannot link on this platform.`,
      )
      printError('This is a known issue with Zig 0.15.x on macOS 26+.')
      printError('Workarounds: upgrade Zig when a fix ships, or build in CI.')
      throw new Error('Zig linker incompatible with current platform')
    }
  } catch (error) {
    if (error.message === 'Zig linker incompatible with current platform') {
      throw error
    }
    // If smoke test itself threw (spawn failed), warn but continue.
    logger.warn(`Zig link smoke test failed: ${error.message}`)
  }

  logger.success(`Zig ready: ${zigBin}`)
  return zigBin
}

/**
 * Check if upstream submodule is initialized.
 */
async function checkUpstream() {
  logger.substep('Checking OpenTUI submodule...')

  const buildZigPath = path.join(
    UPSTREAM_PATH,
    'packages',
    'core',
    'src',
    'zig',
    'build.zig',
  )
  if (!existsSync(buildZigPath)) {
    printError('OpenTUI submodule not initialized')
    printError(
      'Run: git submodule update --init packages/opentui-builder/upstream/opentui',
    )
    throw new Error('OpenTUI submodule not initialized')
  }

  logger.success('OpenTUI submodule found')
}

/**
 * Resolve the Zig target triple for the current platform.
 */
function getZigTarget(platformArch) {
  // Allow explicit override via ZIG_TARGET env var
  if (process.env.ZIG_TARGET) {
    return process.env.ZIG_TARGET
  }
  const zigTarget = ZIG_TARGETS[platformArch]
  if (!zigTarget) {
    throw new Error(`No Zig target mapping for platform: ${platformArch}`)
  }
  return zigTarget
}

/**
 * Get the OS name from a platform-arch string.
 */
function getPlatformOS(platformArch) {
  if (platformArch.startsWith('darwin')) {
    return 'darwin'
  }
  if (platformArch.startsWith('linux')) {
    return 'linux'
  }
  if (platformArch.startsWith('win')) {
    return 'win32'
  }
  return 'linux'
}

/**
 * Build the native addon using Zig.
 * @param {string} zigBin - Path to the zig binary
 */
async function buildNativeAddon(zigBin) {
  logger.step('Building native addon')

  const outputPath = getPlatformOutputPath(PLATFORM_ARCH)

  await safeMkdir(path.dirname(outputPath))

  const zigTarget = getZigTarget(PLATFORM_ARCH)
  const optimizeFlag =
    BUILD_MODE === 'prod' ? '-Doptimize=ReleaseFast' : '-Doptimize=Debug'

  logger.substep(
    `Building for ${PLATFORM_ARCH} (${BUILD_MODE} mode) [zig target: ${zigTarget}]...`,
  )

  const zigArgs = ['build', optimizeFlag, `-Dtarget=${zigTarget}`]

  // Retry build up to 3 times — Zig fetches dependencies from GitHub at build time
  // and CI connections can be flaky (HttpConnectionClosing errors).
  let lastError
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = await spawn(zigBin, zigArgs, {
      cwd: SOURCE_PATCHED_DIR,
      shell: WIN32,
      stdio: 'inherit',
    })

    const exitCode = result.code ?? result.exitCode ?? 0
    if (exitCode === 0) {
      lastError = undefined
      break
    }
    lastError = new Error(`Zig build failed with exit code ${exitCode}`)
    if (attempt < 3) {
      logger.warn(
        `Build attempt ${attempt}/3 failed, retrying in ${attempt * 2}s...`,
      )
      await new Promise(resolve => setTimeout(resolve, 2000 * attempt))
    }
  }
  if (lastError) {
    throw lastError
  }

  // Find the built shared library
  const osName = getPlatformOS(PLATFORM_ARCH)
  const prefix = LIBRARY_PREFIXES[osName] ?? 'lib'
  const ext = LIBRARY_EXTENSIONS[osName] ?? 'so'
  const libName = `${prefix}opentui.${ext}`

  // Zig outputs to lib/<output-name>/ directory
  const zigOutputName = zigTarget
    .replace('-gnu', '')
    .replace('-windows-gnu', '-windows')

  // Try several possible output locations
  const possiblePaths = [
    path.join(SOURCE_PATCHED_DIR, 'lib', zigOutputName, libName),
    path.join(SOURCE_PATCHED_DIR, 'zig-out', 'lib', zigOutputName, libName),
    path.join(SOURCE_PATCHED_DIR, 'zig-out', 'lib', libName),
  ]

  let builtLib
  for (const candidate of possiblePaths) {
    if (existsSync(candidate)) {
      builtLib = candidate
      break
    }
  }

  if (builtLib) {
    await fs.copyFile(builtLib, outputPath)
    logger.success(`Built: ${outputPath}`)
  } else {
    logger.warn(`Built library not found at expected paths:`)
    for (const p of possiblePaths) {
      logger.warn(`  ${p}`)
    }
    // Try to find where the library was actually built
    try {
      const foundLibs = await glob('**/*.{dylib,so,dll}', {
        cwd: SOURCE_PATCHED_DIR,
        absolute: true,
      })
      if (foundLibs.length > 0) {
        logger.info(`Found libraries: ${foundLibs.join(', ')}`)
      }
    } catch {
      // glob not available, skip
    }
    throw new Error('Built library not found')
  }
}

/**
 * Main build function.
 */
async function main() {
  const totalStart = Date.now()

  logger.step('Building opentui-builder')
  logger.info(`OpenTUI ${OPENTUI_VERSION} native bindings`)
  logger.info(`Build mode: ${BUILD_MODE}`)
  logger.info('')

  // Clean checkpoints if requested or forced.
  if (CLEAN_BUILD || FORCE_BUILD) {
    logger.substep(
      `${FORCE_BUILD ? 'Force' : 'Clean'} build requested - removing checkpoints`,
    )
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

  const zigBin = await ensureZig()
  await checkUpstream()

  logger.success('Pre-flight checks passed')

  // Copy source from upstream.
  logger.step('Copying source from upstream')
  await copySource()

  // Apply patches.
  logger.step('Applying patches')
  await applyPatches(PLATFORM_ARCH, BUILD_MODE)

  // Build.
  await buildNativeAddon(zigBin)

  // Report completion.
  const totalDuration = formatDuration(Date.now() - totalStart)

  logger.step('Build Complete!')
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
