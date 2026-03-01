/**
 * @fileoverview Generate embedded stubs for binpress
 *
 * This script:
 * 1. For the current platform: Uses local stub if available (for testing local changes)
 * 2. For other platforms: Downloads pre-built stubs from GitHub releases
 * 3. Extracts downloaded stubs from tarballs
 * 4. Converts all stubs to C arrays
 * 5. Generates embedded_stubs.c with all stub binaries
 *
 * Stubs are needed for:
 * - darwin-arm64, darwin-x64
 * - linux-arm64, linux-x64, linux-arm64-musl, linux-x64-musl
 * - win-arm64, win-x64
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { getBuildMode } from '../../build-infra/lib/constants.mjs'
import {
  downloadReleaseAsset,
  getLatestRelease,
} from '../../build-infra/lib/github-releases.mjs'
import { isMusl } from '../../build-infra/lib/platform-mappings.mjs'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const BINPRESS_DIR = path.dirname(__dirname)
const BUILD_MODE = getBuildMode()
const BUILD_DIR = path.join(BINPRESS_DIR, 'build', BUILD_MODE)
// Stubs download to centralized location
const DOWNLOAD_DIR = path.join(
  BINPRESS_DIR,
  '..',
  'build-infra',
  'build',
  'downloaded',
  'stubs',
)
const OUTPUT_FILE = path.join(BUILD_DIR, 'embedded_stubs.c')
// Local stub path (built by bin-stubs package)
const LOCAL_STUB_PATH = path.join(
  BINPRESS_DIR,
  '..',
  'bin-stubs',
  'build',
  BUILD_MODE,
  'out',
  'Final',
  'smol_stub',
)

logger.info('Generating embedded stubs...')

// Ensure build directory exists
await safeMkdir(BUILD_DIR)

// Detect current platform for local stub usage
const currentPlatform = process.platform === 'win32' ? 'win' : process.platform
const currentArch = process.env.TARGET_ARCH || process.arch
const currentLibc = (await isMusl()) ? 'musl' : undefined

// Check if we have a local stub for current platform
const hasLocalStub = existsSync(LOCAL_STUB_PATH)
if (hasLocalStub) {
  logger.info(
    `Found local stub for ${currentPlatform}-${currentArch}${currentLibc ? `-${currentLibc}` : ''}`,
  )
}

// Get latest stubs release (required for cross-platform stubs)
const stubsTag = await getLatestRelease('stubs')
if (!stubsTag && !hasLocalStub) {
  throw new Error(
    'No stubs release found and no local stub available. Please run the stubs workflow first.',
  )
}

if (stubsTag) {
  logger.info(`Using stubs release: ${stubsTag}`)
} else {
  logger.warn(
    'No stubs release found - will use local stub for current platform only',
  )
}

/**
 * Download and extract a stub for a specific platform-arch
 */
async function downloadStub(
  platform,
  arch,
  libc,
  currentPlatform,
  currentArch,
  currentLibc,
  stubsTag,
) {
  const libcSuffix = libc ? `-${libc}` : ''
  const platformName = `${platform}-${arch}${libcSuffix}`

  // Check if this is the current platform and a local stub exists
  const isCurrentPlatform =
    platform === currentPlatform && arch === currentArch && libc === currentLibc
  if (isCurrentPlatform && existsSync(LOCAL_STUB_PATH)) {
    logger.info(`  Using local ${platformName} stub...`)

    // Copy local stub to build directory with platform-specific name
    const stubOut = path.join(
      BUILD_DIR,
      `smol_stub_${platform}_${arch}${libc ? `_${libc}` : ''}`,
    )
    await fs.copyFile(LOCAL_STUB_PATH, stubOut)

    const stats = await fs.stat(stubOut)
    logger.info(
      `  ✓ ${platformName} stub (local, ${(stats.size / 1024).toFixed(1)}KB)`,
    )

    return stubOut
  }

  // If no release available, skip non-current platforms (dev mode)
  if (!stubsTag) {
    logger.warn(
      `  Skipping ${platformName} stub (no release, not current platform)`,
    )
    return undefined
  }

  logger.info(`  Downloading ${platformName} stub...`)

  // Determine asset name (all hyphens, following lief convention)
  const assetName = `smol-stub-${platformName}.tar.gz`

  // Download to build/downloaded/stubs/{platform-arch}/
  const platformDir = path.join(DOWNLOAD_DIR, platformName)
  await safeMkdir(platformDir)
  const tarballPath = path.join(platformDir, assetName)

  try {
    await downloadReleaseAsset(stubsTag, assetName, tarballPath, {
      quiet: true,
    })

    // Extract tarball
    const result = await spawn('tar', ['-xzf', assetName], {
      cwd: platformDir,
      stdio: 'pipe',
    })

    if (result.code !== 0) {
      logger.warn(`  Failed to extract ${platformName} stub`)
      return undefined
    }

    // Determine extracted file name
    const extractedName = platform === 'win' ? 'smol_stub.exe' : 'smol_stub'
    const extractedPath = path.join(platformDir, extractedName)

    // Move to build directory with platform-specific name for embedding
    const stubOut = path.join(
      BUILD_DIR,
      `smol_stub_${platform}_${arch}${libc ? `_${libc}` : ''}`,
    )
    await fs.rename(extractedPath, stubOut)

    const stats = await fs.stat(stubOut)
    logger.info(
      `  ✓ ${platformName} stub (${(stats.size / 1024).toFixed(1)}KB)`,
    )

    // Remove tarball after extraction
    await safeDelete(tarballPath)

    return stubOut
  } catch (err) {
    logger.group()
    logger.error(`Failed to download ${platformName} stub: ${err.message}`)
    logger.groupEnd()
    throw new Error(
      `Failed to download required stub ${platformName}. ` +
        `All stubs must be available in the release: ${stubsTag}`,
    )
  }
}

/**
 * Convert binary to C array
 */
async function binaryToCArray(stubPath, varName) {
  // Read binary
  const data = await fs.readFile(stubPath)

  // Convert to hex string
  const hexBytes = []
  for (let i = 0; i < data.length; i++) {
    if (i % 12 === 0) {
      hexBytes.push('\n  ')
    }
    hexBytes.push(`0x${data[i].toString(16).padStart(2, '0')}`)
    if (i < data.length - 1) {
      hexBytes.push(', ')
    }
  }

  return `const unsigned char ${varName}[] = {${hexBytes.join('')}\n};\nconst size_t ${varName}_len = ${data.length};\n\n`
}

// Start output file
let output = `/**
 * @fileoverview Embedded stub binaries
 *
 * Auto-generated by scripts/generate-embedded-stubs.mjs
 * DO NOT EDIT MANUALLY
 *
 * Contains pre-compiled self-extracting stub binaries as C arrays.
 * Downloaded from GitHub release: ${stubsTag}
 */

#include <stddef.h>

`

// Download all stubs (or use local stub for current platform)
logger.info('Downloading stubs...')
const stubDarwinArm64 = await downloadStub(
  'darwin',
  'arm64',
  undefined,
  currentPlatform,
  currentArch,
  currentLibc,
  stubsTag,
)
const stubDarwinX64 = await downloadStub(
  'darwin',
  'x64',
  undefined,
  currentPlatform,
  currentArch,
  currentLibc,
  stubsTag,
)
const stubLinuxArm64 = await downloadStub(
  'linux',
  'arm64',
  undefined,
  currentPlatform,
  currentArch,
  currentLibc,
  stubsTag,
)
const stubLinuxX64 = await downloadStub(
  'linux',
  'x64',
  undefined,
  currentPlatform,
  currentArch,
  currentLibc,
  stubsTag,
)
const stubLinuxArm64Musl = await downloadStub(
  'linux',
  'arm64',
  'musl',
  currentPlatform,
  currentArch,
  currentLibc,
  stubsTag,
)
const stubLinuxX64Musl = await downloadStub(
  'linux',
  'x64',
  'musl',
  currentPlatform,
  currentArch,
  currentLibc,
  stubsTag,
)
const stubWinArm64 = await downloadStub(
  'win',
  'arm64',
  undefined,
  currentPlatform,
  currentArch,
  currentLibc,
  stubsTag,
)
const stubWinX64 = await downloadStub(
  'win',
  'x64',
  undefined,
  currentPlatform,
  currentArch,
  currentLibc,
  stubsTag,
)

logger.info('\nEmbedding stubs into C arrays...')

// Helper to generate empty stub placeholder
function emptyStubCArray(varName) {
  return `/* Stub not available - empty placeholder */\nconst unsigned char ${varName}[] = { 0x00 };\nconst size_t ${varName}_len = 0;\n\n`
}

// Convert to C arrays (or use empty placeholders for missing stubs)
output += stubDarwinArm64
  ? await binaryToCArray(stubDarwinArm64, 'stub_darwin_arm64')
  : emptyStubCArray('stub_darwin_arm64')

output += stubDarwinX64
  ? await binaryToCArray(stubDarwinX64, 'stub_darwin_x64')
  : emptyStubCArray('stub_darwin_x64')

output += stubLinuxArm64
  ? await binaryToCArray(stubLinuxArm64, 'stub_linux_arm64')
  : emptyStubCArray('stub_linux_arm64')

output += stubLinuxX64
  ? await binaryToCArray(stubLinuxX64, 'stub_linux_x64')
  : emptyStubCArray('stub_linux_x64')

output += stubLinuxArm64Musl
  ? await binaryToCArray(stubLinuxArm64Musl, 'stub_linux_arm64_musl')
  : emptyStubCArray('stub_linux_arm64_musl')

output += stubLinuxX64Musl
  ? await binaryToCArray(stubLinuxX64Musl, 'stub_linux_x64_musl')
  : emptyStubCArray('stub_linux_x64_musl')

output += stubWinArm64
  ? await binaryToCArray(stubWinArm64, 'stub_win_arm64')
  : emptyStubCArray('stub_win_arm64')

output += stubWinX64
  ? await binaryToCArray(stubWinX64, 'stub_win_x64')
  : emptyStubCArray('stub_win_x64')

// Write output
await fs.writeFile(OUTPUT_FILE, output, 'utf-8')

logger.success(`Generated: ${OUTPUT_FILE}`)

// Print summary
logger.info('\nStub summary:')
const stubs = [
  ['darwin-arm64', stubDarwinArm64],
  ['darwin-x64', stubDarwinX64],
  ['linux-arm64', stubLinuxArm64],
  ['linux-x64', stubLinuxX64],
  ['linux-arm64-musl', stubLinuxArm64Musl],
  ['linux-x64-musl', stubLinuxX64Musl],
  ['win-arm64', stubWinArm64],
  ['win-x64', stubWinX64],
].filter(([, stubPath]) => stubPath !== undefined)

for (const [name, stubPath] of stubs) {
  const stats = await fs.stat(stubPath)
  logger.info(`  ${name}: ${(stats.size / 1024).toFixed(1)}KB`)
}

// Clean up downloaded stubs from build directory
for (const [, stubPath] of stubs) {
  await safeDelete(stubPath)
}
