/**
 * @file Generate embedded stubs for binpress
 *   This script:
 *
 *   1. For the current platform: Uses local stub if available (for testing local
 *      changes)
 *   2. For other platforms: Downloads pre-built stubs from GitHub releases
 *   3. Extracts downloaded stubs from tarballs
 *   4. Converts all stubs to C arrays
 *   5. Generates embedded_stubs.c with all stub binaries Stubs are needed for:
 *
 *   - darwin-arm64, darwin-x64
 *   - linux-arm64, linux-x64, linux-arm64-musl, linux-x64-musl
 *   - win32-arm64, win32-x64
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { safeDelete, safeMkdir } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { getLatestRelease } from '@socketsecurity/lib-stable/releases/github-listing'
import { downloadReleaseAsset } from '@socketsecurity/lib-stable/releases/github-downloads'
import { SOCKET_BTM_REPO } from '@socketsecurity/lib-stable/releases/socket-btm'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { getBuildMode, getPlatformBuildDir } from 'build-infra/lib/constants'
// logTransientErrorHelp loaded lazily inside catch block below (see
// curl-builder/scripts/build.mts for full rationale on the
// http-request/convenience CJS/ESM interop crash).
import { errorMessage } from 'build-infra/lib/error-utils'
import { getDownloadedDir, getFinalBinaryPath } from 'build-infra/lib/paths'
import {
  getCurrentPlatformArch,
  isMusl,
} from 'build-infra/lib/platform-mappings'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const BINPRESS_DIR = path.dirname(__dirname)
const BUILD_INFRA_DIR = path.join(BINPRESS_DIR, '..', 'build-infra')
const BIN_STUB_BUILDER_DIR = path.join(BINPRESS_DIR, '..', 'bin-stub-builder')
const BUILD_MODE = getBuildMode()

/**
 * Download and extract a stub for a specific platform-arch. `activePlatform`
 * / `activeArch` / `activeLibc` / `releaseTag` describe the run's resolved
 * context (current host + chosen stubs release), threaded in explicitly so
 * this function stays a plain top-level export with no module-scope closure.
 */
async function downloadStub(
  platform: string,
  arch: string,
  libc: string | undefined,
  buildDir: string,
  downloadDir: string,
  localStubPath: string,
  activePlatform: string,
  activeArch: string,
  activeLibc: string | undefined,
  releaseTag: string | undefined,
): Promise<string | undefined> {
  const libcSuffix = libc ? `-${libc}` : ''
  const platformName = `${platform}-${arch}${libcSuffix}`

  // Check if this is the current platform and a local stub exists
  const isCurrentPlatform =
    platform === activePlatform && arch === activeArch && libc === activeLibc
  if (isCurrentPlatform && existsSync(localStubPath)) {
    logger.info(`Using local ${platformName} stub…`)

    // Copy local stub to build directory with platform-specific name
    const stubOut = path.join(
      buildDir,
      `smol_stub_${platform}_${arch}${libc ? `_${libc}` : ''}`,
    )
    await fs.copyFile(localStubPath, stubOut)

    // oxlint-disable-next-line socket/prefer-exists-sync -- fs.stat() calls consume stats.size for the per-stub log message and per-platform size summary.
    const stats = await fs.stat(stubOut)
    logger.success(
      `${platformName} stub (local, ${(stats.size / 1024).toFixed(1)}KB)`,
    )

    return stubOut
  }

  // If no release available, skip non-current platforms (dev mode)
  if (!releaseTag) {
    logger.warn(
      `Skipping ${platformName} stub (no release, not current platform)`,
    )
    return undefined
  }

  logger.info(`Downloading ${platformName} stub…`)

  // Determine asset name (all hyphens, following lief convention)
  const assetName = `smol-stub-${platformName}.tar.gz`

  // Download to build/downloaded/stubs/{platform-arch}/
  const platformDir = path.join(downloadDir, platformName)
  await safeMkdir(platformDir)
  const tarballPath = path.join(platformDir, assetName)

  try {
    await downloadReleaseAsset(
      releaseTag,
      assetName,
      tarballPath,
      SOCKET_BTM_REPO,
      {
        quiet: true,
      },
    )

    // Extract tarball
    const result = await spawn('tar', ['-xzf', assetName], {
      cwd: platformDir,
      stdio: 'pipe',
    })

    if (result.code !== 0) {
      logger.warn(`Failed to extract ${platformName} stub`)
      return undefined
    }

    // Determine extracted file name
    const extractedName = platform === 'win32' ? 'smol_stub.exe' : 'smol_stub'
    const extractedPath = path.join(platformDir, extractedName)

    // Move to build directory with platform-specific name for embedding
    const stubOut = path.join(
      buildDir,
      `smol_stub_${platform}_${arch}${libc ? `_${libc}` : ''}`,
    )
    await fs.rename(extractedPath, stubOut)

    // oxlint-disable-next-line socket/prefer-exists-sync -- fs.stat() calls consume stats.size for the per-stub log message and per-platform size summary.
    const stats = await fs.stat(stubOut)
    logger.success(`${platformName} stub (${(stats.size / 1024).toFixed(1)}KB)`)

    // Remove tarball after extraction
    await safeDelete(tarballPath)

    return stubOut
  } catch (e) {
    logger.group()
    logger.error(`${platformName} stub: ${errorMessage(e)}`)

    // Log helpful messages if this is a transient GitHub/network error.
    try {
      const { logTransientErrorHelp } =
        await import('build-infra/lib/github-error-utils')
      await logTransientErrorHelp(e)
    } catch {
      // Hint module failed to load — original error already logged.
    }

    logger.groupEnd()
    throw new Error(
      `Failed to download required stub ${platformName}. ` +
        `All stubs must be available in the release: ${releaseTag}`,
      { cause: e },
    )
  }
}

/**
 * Convert binary to C array.
 */
// oxlint-disable-next-line socket/sort-source-methods -- script ordered as a top-down stub-generation pipeline (resolve platforms → fetch or build → embed → write); alphabetizing would scatter the flow.
async function binaryToCArray(stubPath: string, varName: string) {
  // Read binary
  const data = await fs.readFile(stubPath)

  // Convert to hex string
  const hexBytes: string[] = []
  for (let i = 0; i < data.length; i++) {
    const byte = data[i]
    if (byte === undefined) {
      continue
    }
    if (i % 12 === 0) {
      hexBytes.push('\n  ')
    }
    hexBytes.push(`0x${byte.toString(16).padStart(2, '0')}`)
    if (i < data.length - 1) {
      hexBytes.push(', ')
    }
  }

  return `const unsigned char ${varName}[] = {${hexBytes.join('')}\n};\nconst size_t ${varName}_len = ${data.length};\n\n`
}

// Generate empty stub placeholder.
function emptyStubCArray(varName: string) {
  return `/* Stub not available - empty placeholder */\nconst unsigned char ${varName}[] = { 0x00 };\nconst size_t ${varName}_len = 0;\n\n`
}

export async function main() {
  const platformArch = await getCurrentPlatformArch()
  const buildDir = getPlatformBuildDir(BINPRESS_DIR, platformArch)
  // Stubs download cache lives under build-infra so multiple consumers
  // (binpress, lief-builder, etc.) share one cache; helper from
  // build-infra/lib/paths owns the 'build/downloaded' segment.
  const downloadDir = path.join(getDownloadedDir(BUILD_INFRA_DIR), 'stubs')
  // Use EMBEDDED_STUBS_OUTPUT from Makefile if provided, otherwise default
  const outputFile = process.env['EMBEDDED_STUBS_OUTPUT']
    ? path.resolve(process.env['EMBEDDED_STUBS_OUTPUT'])
    : path.join(buildDir, 'embedded_stubs.c')
  // Local stub path (built by bin-stub-builder package). Final-binary layout
  // owned by build-infra/lib/paths.getFinalBinaryPath.
  const localStubPath = getFinalBinaryPath(
    BIN_STUB_BUILDER_DIR,
    BUILD_MODE,
    platformArch,
    'smol_stub',
  )

  logger.info('Generating embedded stubs…')

  // Ensure build directory exists
  await safeMkdir(buildDir)
  // Also ensure output file's parent directory exists (may differ when EMBEDDED_STUBS_OUTPUT is set)
  await safeMkdir(path.dirname(outputFile))

  // Detect current platform for local stub usage
  const activePlatform = process.platform
  const activeArch = process.env['TARGET_ARCH'] || process.arch
  const activeLibc = (await isMusl()) ? 'musl' : undefined

  // Check if we have a local stub for current platform
  const hasLocalStub = existsSync(localStubPath)
  if (hasLocalStub) {
    logger.info(
      `Found local stub for ${activePlatform}-${activeArch}${activeLibc ? `-${activeLibc}` : ''}`,
    )
  }

  // Get latest stubs release (required for cross-platform stubs)
  const releaseTag = await getLatestRelease('stubs', SOCKET_BTM_REPO)
  if (!releaseTag && !hasLocalStub) {
    throw new Error(
      'No prebuilt release found and no local artifact available. Please run the prebuilt workflow first.',
    )
  }

  if (releaseTag) {
    logger.info(`Using stubs release: ${releaseTag}`)
  } else {
    logger.warn(
      'No stubs release found - will use local stub for current platform only',
    )
  }

  // Download all stubs in parallel (or use local stub for current platform)
  logger.info('Downloading stubs…')
  const stubConfigs = [
    {
      arch: 'arm64',
      libc: undefined,
      name: 'darwin-arm64',
      platform: 'darwin',
    },
    { arch: 'x64', libc: undefined, name: 'darwin-x64', platform: 'darwin' },
    { arch: 'arm64', libc: undefined, name: 'linux-arm64', platform: 'linux' },
    { arch: 'x64', libc: undefined, name: 'linux-x64', platform: 'linux' },
    {
      arch: 'arm64',
      libc: 'musl',
      name: 'linux-arm64-musl',
      platform: 'linux',
    },
    { arch: 'x64', libc: 'musl', name: 'linux-x64-musl', platform: 'linux' },
    { arch: 'arm64', libc: undefined, name: 'win32-arm64', platform: 'win32' },
    { arch: 'x64', libc: undefined, name: 'win32-x64', platform: 'win32' },
  ]
  const stubResults = await Promise.allSettled(
    stubConfigs.map(config =>
      downloadStub(
        config.platform,
        config.arch,
        config.libc,
        buildDir,
        downloadDir,
        localStubPath,
        activePlatform,
        activeArch,
        activeLibc,
        releaseTag,
      ),
    ),
  )

  // Extract values and collect failures
  const stubDownloadFailures = stubResults.filter(r => r.status === 'rejected')
  if (stubDownloadFailures.length > 0) {
    throw new Error(
      `Failed to download ${stubDownloadFailures.length} stubs: ${stubDownloadFailures.map(r => r.reason?.message || r.reason).join(', ')}`,
    )
  }
  // Every result is fulfilled past the rejected-count throw above; the
  // ternary keeps positions stable for the destructuring below.
  const stubFiles = stubResults.map(r =>
    r.status === 'fulfilled' ? r.value : undefined,
  )
  const [
    stubDarwinArm64,
    stubDarwinX64,
    stubLinuxArm64,
    stubLinuxX64,
    stubLinuxArm64Musl,
    stubLinuxX64Musl,
    stubWinArm64,
    stubWinX64,
  ] = stubFiles

  logger.error('')
  logger.info('Embedding stubs into C arrays…')

  // Convert to C arrays in parallel (or use empty placeholders for missing stubs)
  const cArrayResults = await Promise.allSettled([
    stubDarwinArm64
      ? binaryToCArray(stubDarwinArm64, 'stub_darwin_arm64')
      : emptyStubCArray('stub_darwin_arm64'),
    stubDarwinX64
      ? binaryToCArray(stubDarwinX64, 'stub_darwin_x64')
      : emptyStubCArray('stub_darwin_x64'),
    stubLinuxArm64
      ? binaryToCArray(stubLinuxArm64, 'stub_linux_arm64')
      : emptyStubCArray('stub_linux_arm64'),
    stubLinuxX64
      ? binaryToCArray(stubLinuxX64, 'stub_linux_x64')
      : emptyStubCArray('stub_linux_x64'),
    stubLinuxArm64Musl
      ? binaryToCArray(stubLinuxArm64Musl, 'stub_linux_arm64_musl')
      : emptyStubCArray('stub_linux_arm64_musl'),
    stubLinuxX64Musl
      ? binaryToCArray(stubLinuxX64Musl, 'stub_linux_x64_musl')
      : emptyStubCArray('stub_linux_x64_musl'),
    stubWinArm64
      ? binaryToCArray(stubWinArm64, 'stub_win_arm64')
      : emptyStubCArray('stub_win_arm64'),
    stubWinX64
      ? binaryToCArray(stubWinX64, 'stub_win_x64')
      : emptyStubCArray('stub_win_x64'),
  ])
  const cArrayFailures = cArrayResults.filter(r => r.status === 'rejected')
  if (cArrayFailures.length > 0) {
    throw new Error(
      `Failed to convert ${cArrayFailures.length} stubs to C arrays: ${cArrayFailures.map(r => r.reason?.message || r.reason).join(', ')}`,
    )
  }
  // Every result is fulfilled past the rejected-count throw above.
  const cArrays = cArrayResults.map(r =>
    r.status === 'fulfilled' ? r.value : '',
  )

  // Start output file
  let output = `/**
 * @fileoverview Embedded stub binaries
 *
 * Auto-generated by scripts/generate-embedded-stubs.mts
 * DO NOT EDIT MANUALLY
 *
 * Contains pre-compiled self-extracting stub binaries as C arrays.
 * Downloaded from GitHub release: ${releaseTag}
 */

#include <stddef.h>

`
  output += cArrays.join('')

  // Write output
  await fs.writeFile(outputFile, output, 'utf8')

  logger.success(`Generated: ${outputFile}`)

  // Print summary
  logger.error('')
  logger.info('Stub summary:')
  const stubEntries: Array<[string, string | undefined]> = [
    ['darwin-arm64', stubDarwinArm64],
    ['darwin-x64', stubDarwinX64],
    ['linux-arm64', stubLinuxArm64],
    ['linux-x64', stubLinuxX64],
    ['linux-arm64-musl', stubLinuxArm64Musl],
    ['linux-x64-musl', stubLinuxX64Musl],
    ['win32-arm64', stubWinArm64],
    ['win32-x64', stubWinX64],
  ]
  const stubSummary = stubEntries.filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined && entry[1] !== '',
  )

  // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
  for (const [name, stubPath] of stubSummary) {
    try {
      // oxlint-disable-next-line socket/prefer-exists-sync -- fs.stat() calls consume stats.size for the per-stub log message and per-platform size summary.
      const stats = await fs.stat(stubPath)
      logger.info(`${name}: ${(stats.size / 1024).toFixed(1)}KB`)
    } catch {
      logger.warn(`${name}: file not found or inaccessible`)
    }
  }

  // Clean up downloaded stubs from build directory
  // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
  for (const [, stubPath] of stubSummary) {
    await safeDelete(stubPath)
  }
}

main().catch(err => {
  logger.error(errorMessage(err))
  process.exitCode = 1
})
