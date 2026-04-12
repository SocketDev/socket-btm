/**
 * Build opentui - Native Node.js bindings for OpenTUI TUI library.
 *
 * This script builds OpenTUI from Zig source using node-api:
 * - Zig compilation to shared library
 * - node-api for Node.js bindings
 * - Cross-platform builds for 8 targets
 *
 * Usage:
 *   node scripts/build.mjs          # Normal build with checkpoints
 *   node scripts/build.mjs --force  # Force rebuild (ignore checkpoints)
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
import { isCI } from 'build-infra/lib/setup-build-toolchain'
import { ensureToolInstalled } from 'build-infra/lib/tool-installer'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { safeDelete } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { copySource } from './source-copied/copy-source.mjs'
import { applyPatches } from './source-patched/apply-patches.mjs'
import {
  BUILD_ROOT,
  LIBRARY_EXTENSIONS,
  LIBRARY_PREFIXES,
  PACKAGE_ROOT,
  UPSTREAM_PATH,
  ZIG_TARGETS,
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
const PROD_BUILD = args.has('--prod')
const DEV_BUILD = args.has('--dev')
const BUILD_MODE = PROD_BUILD
  ? 'prod'
  : DEV_BUILD
    ? 'dev'
    : isCI()
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
const opentuiSource = packageJson.sources?.opentui
if (!opentuiSource) {
  throw new Error(
    'Missing sources.opentui in package.json. Please add source metadata.',
  )
}

const OPENTUI_VERSION = `v${opentuiSource.version}`

// Use PLATFORM_ARCH env var if set by workflow, otherwise detect
const PLATFORM_ARCH = process.env.PLATFORM_ARCH || (await getCurrentPlatform())

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
    printError(result.error || 'Install Zig from: https://ziglang.org/download/')
    throw new Error('Zig toolchain required')
  }

  const zigBin = result.path || 'zig'

  // Smoke-test: verify Zig can link on this platform.
  // Zig 0.15.x has known linker issues on macOS 26+ where system
  // symbols (abort, bzero, etc.) are undefined. Detect this early
  // with a trivial link test instead of failing deep in the build.
  try {
    const testFile = path.join(BUILD_ROOT, '_zig_link_test.zig')
    await fs.mkdir(BUILD_ROOT, { recursive: true })
    await fs.writeFile(
      testFile,
      'export fn _zig_link_test() callconv(.c) void {}\n',
    )
    const testResult = await spawn(
      zigBin,
      ['build-lib', testFile, '-dynamic', '-ODebug'],
      { cwd: BUILD_ROOT, stdio: 'pipe' },
    )
    const testExit = testResult.code ?? testResult.exitCode ?? 0
    // Clean up test artifacts.
    await safeDelete(testFile)
    await safeDelete(path.join(BUILD_ROOT, '_zig_link_test.dylib'))
    await safeDelete(path.join(BUILD_ROOT, '_zig_link_test.so'))
    if (testExit !== 0) {
      printError(
        `Zig ${result.version ?? 'unknown'} cannot link on this platform.`,
      )
      printError(
        'This is a known issue with Zig 0.15.x on macOS 26+.',
      )
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
    throw new Error(
      `No Zig target mapping for platform: ${platformArch}`,
    )
  }
  return zigTarget
}

/**
 * Get the OS name from a platform-arch string.
 */
function getPlatformOS(platformArch) {
  if (platformArch.startsWith('darwin')) return 'darwin'
  if (platformArch.startsWith('linux')) return 'linux'
  if (platformArch.startsWith('win')) return 'win32'
  return 'linux'
}

/**
 * Build the native addon using Zig.
 * @param {string} zigBin - Path to the zig binary
 */
async function buildNativeAddon(zigBin) {
  logger.step('Building native addon')

  const outputPath = getPlatformOutputPath(PLATFORM_ARCH)

  await fs.mkdir(path.dirname(outputPath), { recursive: true })

  const zigTarget = getZigTarget(PLATFORM_ARCH)
  const optimizeFlag =
    BUILD_MODE === 'prod' ? '-Doptimize=ReleaseFast' : '-Doptimize=Debug'

  logger.substep(
    `Building for ${PLATFORM_ARCH} (${BUILD_MODE} mode) [zig target: ${zigTarget}]...`,
  )

  const zigArgs = [
    'build',
    optimizeFlag,
    `-Dtarget=${zigTarget}`,
  ]

  // Strip proxy vars — SFW sets these but Zig's HTTP client doesn't work through SFW's HTTPS proxy.
  const zigEnv = { ...process.env }
  delete zigEnv['HTTP_PROXY']
  delete zigEnv['HTTPS_PROXY']
  delete zigEnv['http_proxy']
  delete zigEnv['https_proxy']

  const result = await spawn(zigBin, zigArgs, {
    cwd: SOURCE_PATCHED_DIR,
    env: zigEnv,
    shell: WIN32,
    stdio: 'inherit',
  })

  const exitCode = result.code ?? result.exitCode ?? 0
  if (exitCode !== 0) {
    throw new Error(`Zig build failed with exit code ${exitCode}`)
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
      const { glob } = await import('@socketsecurity/lib/globs')
      const foundLibs = await glob('**/*.{dylib,so,dll}', { cwd: SOURCE_PATCHED_DIR, absolute: true })
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
    logger.substep(`${FORCE_BUILD ? 'Force' : 'Clean'} build requested - removing checkpoints`)
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
