#!/usr/bin/env node
/**
 * @fileoverview Deploy built smol binaries to GitHub Releases
 *
 * This script packages the final binaries from build/${BUILD_MODE}/out/Final/ and creates
 * a GitHub release with platform-specific archives for download by socket-cli.
 *
 * Release Strategy:
 *   - Version: Generated from date and git SHA (e.g., 20251121-abc1234)
 *   - Tag: node-smol-{YYYYMMDD}-{sha} (e.g., node-smol-20251121-abc1234)
 *   - Assets: One per platform/arch combo
 *   - Format: tar.gz/zip with SMOL_SPEC embedded
 *
 * Release Assets (aligned with Node.js official naming):
 *   - node-smol-{YYYYMMDD}-{sha}-darwin-arm64.tar.gz
 *   - node-smol-{YYYYMMDD}-{sha}-darwin-x64.tar.gz
 *   - node-smol-{YYYYMMDD}-{sha}-linux-arm64.tar.gz
 *   - node-smol-{YYYYMMDD}-{sha}-linux-x64.tar.gz
 *   - node-smol-{YYYYMMDD}-{sha}-linux-arm64-musl.tar.gz
 *   - node-smol-{YYYYMMDD}-{sha}-linux-x64-musl.tar.gz
 *   - node-smol-{YYYYMMDD}-{sha}-win-arm64.zip
 *   - node-smol-{YYYYMMDD}-{sha}-win-x64.zip
 *
 * Usage:
 *   pnpm release              # Create draft release from cached binaries
 *   pnpm release --publish    # Create and publish release
 *   pnpm release --force      # Overwrite existing release
 *
 * Prerequisites:
 *   - Built binaries in build/${BUILD_MODE}/out/Final/node (or build/${BUILD_MODE}/cache/node-*)
 *   - GitHub CLI (gh) installed and authenticated
 *   - GITHUB_TOKEN environment variable (for CI)
 */

import { createHash } from 'node:crypto'
import { createReadStream, existsSync, promises as fs } from 'node:fs'
import { platform as osPlatform, arch as osArch } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import colors from 'yoctocolors-cjs'

import { parseArgs } from '@socketsecurity/lib/argv/parse'
import { which } from '@socketsecurity/lib/bin'
import { safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'
import { getBuildMode } from 'build-infra/lib/constants'

import { getBuildPaths } from '../../paths.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.join(__dirname, '..')
const BUILD_MODE = getBuildMode()
const BUILD_DIR = path.join(ROOT_DIR, 'build', BUILD_MODE)

const logger = getDefaultLogger()

/**
 * Generate version string from date and git SHA.
 * Format: {YYYYMMDD}-{short-git-sha}
 * Example: 20251119-f245c0f
 */
async function generateVersion() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')

  const datePart = `${year}${month}${day}`

  // Get short git SHA (7 characters)
  const { execSync } = await import('node:child_process')
  const gitSha = execSync('git rev-parse --short=7 HEAD', {
    encoding: 'utf-8',
  }).trim()

  return `${datePart}-${gitSha}`
}

// Parse arguments.
const { values } = parseArgs({
  options: {
    'dry-run': { type: 'boolean' },
    force: { type: 'boolean' },
    publish: { type: 'boolean' },
  },
  strict: false,
})

const DRY_RUN = !!values['dry-run']
const FORCE = !!values.force
const PUBLISH = !!values.publish

// Generate version from date and git SHA (e.g., 20251119-f245c0f).
const PACKAGE_NAME = 'node-smol'
const VERSION = await generateVersion()
const TAG = `${PACKAGE_NAME}-${VERSION}`

/**
 * Platform configurations for release assets.
 * Internal platform names match Node.js os.platform(), transformed for archives.
 * Archive naming aligned with Node.js official releases:
 *   node-v{VERSION}-{PLATFORM}-{ARCH}.{EXT}
 *   node-v{VERSION}-linux-{ARCH}-musl.{EXT}
 *   node-v{VERSION}-win-{ARCH}.{EXT}
 */
const PLATFORMS = [
  { platform: 'darwin', arch: 'arm64', ext: 'tar.gz' },
  { platform: 'darwin', arch: 'x64', ext: 'tar.gz' },
  { platform: 'linux', arch: 'x64', ext: 'tar.gz' },
  { platform: 'linux', arch: 'arm64', ext: 'tar.gz' },
  { platform: 'linux-musl', arch: 'x64', ext: 'tar.gz' },
  { platform: 'linux-musl', arch: 'arm64', ext: 'tar.gz' },
  { platform: 'win32', arch: 'x64', ext: 'zip' },
  { platform: 'win32', arch: 'arm64', ext: 'zip' },
]

/**
 * Transform platform name for archive naming to match Node.js official convention.
 * - win32 → win
 * - linux-musl + arch → linux-{arch}-musl
 * - others → unchanged
 */
function getArchivePlatform(platform, arch) {
  if (platform === 'win32') {
    return 'win'
  }
  if (platform === 'linux-musl') {
    return `linux-${arch}-musl`
  }
  return platform
}

/**
 * Check if GitHub CLI is installed.
 */
async function checkGitHubCLI() {
  try {
    const ghPath = await which('gh', { nothrow: true })
    if (!ghPath) {
      logger.error('GitHub CLI (gh) not found')
      logger.error('Install: https://cli.github.com/')
      return false
    }
    const result = await spawn(ghPath, ['--version'], { stdio: 'pipe' })
    if (result.code !== 0) {
      throw new Error('gh command failed')
    }
    return true
  } catch {
    logger.error('GitHub CLI (gh) not found')
    logger.error('Install: https://cli.github.com/')
    return false
  }
}

/**
 * Check if GitHub CLI is authenticated.
 */
async function checkGitHubAuth() {
  try {
    const ghPath = await which('gh', { nothrow: true })
    if (!ghPath) {
      return false
    }
    const result = await spawn(ghPath, ['auth', 'status'], { stdio: 'pipe' })
    return result.code === 0
  } catch {
    return false
  }
}

/**
 * Calculate SHA-256 checksum of a file.
 */
async function calculateChecksum(filePath) {
  const hash = createHash('sha256')
  const stream = createReadStream(filePath)

  for await (const chunk of stream) {
    hash.update(chunk)
  }

  return hash.digest('hex')
}

/**
 * Find binary for a given platform/arch combination.
 *
 * Looks in:
 * 1. build/${BUILD_MODE}/out/Final/node (if building for current platform)
 * 2. build/${BUILD_MODE}/cache/node-{platform}-{arch} (from cached builds)
 */
async function findBinary(platform, arch) {
  // Check Final build (if current platform).
  const binaryName = platform === 'win32' ? 'node.exe' : 'node'
  const { outputFinalDir } = getBuildPaths(BUILD_MODE, platform)
  const finalBinary = path.join(outputFinalDir, binaryName)
  if (
    platform === osPlatform() &&
    arch === osArch() &&
    existsSync(finalBinary)
  ) {
    return finalBinary
  }

  // Transform platform name to match Node.js convention for cache lookup.
  const archivePlatform = getArchivePlatform(platform, arch)

  // Check cached build (uses Node.js naming convention).
  const ext = platform === 'win32' ? '.exe' : ''
  const cachedBinary = path.join(
    BUILD_DIR,
    'cache',
    `node-${archivePlatform}${ext}`,
  )
  if (existsSync(cachedBinary)) {
    return cachedBinary
  }

  return null
}

/**
 * Embed SMOL_SPEC marker in binary.
 *
 * Format: SMOL_SPEC:@socketbin/{packageName}-{version}-{archivePlatform}\n
 * Where archivePlatform matches Node.js official convention (e.g., win, linux-x64-musl).
 *
 * This enables deterministic cache keys when the binary is used.
 */
async function embedSmolSpec(
  binaryPath,
  _platform,
  _arch,
  packageName,
  version,
  archivePlatform,
) {
  const spec = `SMOL_SPEC:@socketbin/${packageName}-${version}-${archivePlatform}\n`
  const specBuffer = Buffer.from(spec, 'utf-8')

  // Read binary.
  const binary = await fs.readFile(binaryPath)

  // Append spec to end of binary.
  const withSpec = Buffer.concat([binary, specBuffer])

  // Write back.
  await fs.writeFile(binaryPath, withSpec)

  logger.log(`  Embedded SMOL_SPEC: ${spec.trim()}`)
}

/**
 * Create release archive for a platform.
 */
async function createReleaseArchive(platform, arch, packageName, version) {
  const config = PLATFORMS.find(p => p.platform === platform && p.arch === arch)
  if (!config) {
    throw new Error(`Unknown platform: ${platform}-${arch}`)
  }

  logger.log(`\nPreparing ${platform}-${arch}...`)

  // Find binary.
  const binaryPath = await findBinary(platform, arch)
  if (!binaryPath) {
    logger.warn(`  Binary not found, skipping ${platform}-${arch}`)
    logger.warn(`  Build with: PLATFORM=${platform} ARCH=${arch} pnpm build`)
    return null
  }

  logger.log(`  Found binary: ${binaryPath}`)

  // Create temp directory for packaging.
  const tempDir = path.join(BUILD_DIR, '.release-temp', `${platform}-${arch}`)
  await safeMkdir(tempDir, { recursive: true })

  // Copy binary to temp dir.
  const tempBinaryName = platform === 'win32' ? 'node.exe' : 'node'
  const tempBinary = path.join(tempDir, tempBinaryName)
  await fs.copyFile(binaryPath, tempBinary)

  // Transform platform name for archive naming (Node.js official convention).
  const archivePlatform = getArchivePlatform(platform, arch)

  // Embed SMOL_SPEC marker.
  await embedSmolSpec(
    tempBinary,
    platform,
    arch,
    packageName,
    version,
    archivePlatform,
  )

  // Make executable (Unix).
  if (platform !== 'win32') {
    await fs.chmod(tempBinary, 0o755)
  }

  // Create archive with Node.js official naming convention.
  const archiveName = `${packageName}-${version}-${archivePlatform}.${config.ext}`
  const archivePath = path.join(BUILD_DIR, '.release-temp', archiveName)

  logger.log(`  Creating archive: ${archiveName}`)

  if (config.ext === 'tar.gz') {
    // Create tar.gz.
    const tarPath = await which('tar', { nothrow: true })
    if (!tarPath) {
      throw new Error('tar not found in PATH')
    }
    await spawn(tarPath, ['-czf', archivePath, '-C', tempDir, tempBinaryName], {
      stdio: 'inherit',
    })
  } else {
    // Create zip.
    const zipPath = await which('zip', { nothrow: true })
    if (!zipPath) {
      throw new Error('zip not found in PATH')
    }
    await spawn(zipPath, ['-j', archivePath, tempBinary], { stdio: 'inherit' })
  }

  // Calculate checksum (for release notes only, not uploaded as separate file).
  const checksum = await calculateChecksum(archivePath)
  logger.log(`  SHA-256: ${checksum}`)

  // Get file size.
  const stats = await fs.stat(archivePath)
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2)
  logger.log(`  Size: ${sizeMB} MB`)

  return {
    archivePath,
    archiveName,
    checksum,
    sizeMB,
  }
}

/**
 * Check if release already exists.
 */
async function releaseExists(tag) {
  try {
    const ghPath = await which('gh', { nothrow: true })
    if (!ghPath) {
      return false
    }
    const result = await spawn(ghPath, ['release', 'view', tag], {})
    return result.code === 0
  } catch {
    return false
  }
}

/**
 * Delete existing release.
 */
async function deleteRelease(tag) {
  logger.log(`\nDeleting existing release: ${tag}`)
  const ghPath = await which('gh', { nothrow: true })
  if (!ghPath) {
    throw new Error('gh not found in PATH')
  }
  await spawn(ghPath, ['release', 'delete', tag, '--yes'], { stdio: 'inherit' })
}

/**
 * Create GitHub release.
 */
async function createGitHubRelease(
  tag,
  archives,
  publish,
  packageName,
  version,
) {
  logger.log(`\nCreating GitHub release: ${tag}`)

  // Build release notes.
  const notes = [
    `# ${packageName} ${version}`,
    '',
    'Optimized Node.js binaries with SEA support and automatic Brotli compression.',
    '',
    '## Platform Builds',
    '',
    ...archives.map(a => `- **${a.archiveName}** (${a.sizeMB} MB)`),
    '',
    '## Features',
    '',
    '- SEA (Single Executable Application) support enabled',
    '- Automatic Brotli compression for SEA blobs (70-80% reduction)',
    '- Self-extracting compressed binaries with smart caching',
    '- V8 Lite Mode for smaller binaries (prod builds)',
    '- Small ICU (English-only, supports Unicode escapes)',
    '',
    '## Checksums',
    '',
    ...archives.map(a => `\`\`\`\n${a.checksum}  ${a.archiveName}\n\`\`\``),
    '',
    '## Usage in socket-cli',
    '',
    '```bash',
    '# Download binary',
    `curl -L https://github.com/SocketDev/socket-btm/releases/download/${tag}/${packageName}-${version}-darwin-arm64.tar.gz | tar xz`,
    '',
    '# Verify checksum (GitHub provides checksums automatically)',
    `gh release view ${tag}`,
    'shasum -a 256 node',
    '',
    '# Use binary',
    './node --version',
    '```',
  ].join('\n')

  // Write release notes to file.
  const notesPath = path.join(BUILD_DIR, '.release-temp', 'RELEASE_NOTES.md')
  await fs.writeFile(notesPath, notes)

  // Build gh command.
  const ghArgs = [
    'release',
    'create',
    tag,
    '--title',
    `${packageName} ${version}`,
    '--notes-file',
    notesPath,
  ]

  if (!publish) {
    ghArgs.push('--draft')
  }

  // Add archive files (no separate .sha256 files, GitHub provides checksums).
  for (const archive of archives) {
    ghArgs.push(archive.archivePath)
  }

  // Create release.
  if (DRY_RUN) {
    logger.log('[DRY RUN] Would create release with:')
    logger.log(`  gh ${ghArgs.join(' ')}`)
    return
  }

  const ghPath = await which('gh', { nothrow: true })
  if (!ghPath) {
    throw new Error('gh not found in PATH')
  }

  await spawn(ghPath, ghArgs, { stdio: 'inherit' })
}

/**
 * Main release workflow.
 */
async function main() {
  logger.log('')
  logger.log(`${colors.cyan('━'.repeat(60))}`)
  logger.log(`${colors.cyan('Node.js Smol Binary Release')}`)
  logger.log(`${colors.cyan('━'.repeat(60))}`)
  logger.log('')
  logger.log(`Package: ${colors.green(PACKAGE_NAME)}`)
  logger.log(`Version: ${colors.green(VERSION)}`)
  logger.log(`Tag: ${colors.green(TAG)}`)
  logger.log(
    `Mode: ${PUBLISH ? colors.yellow('PUBLISH') : colors.blue('DRAFT')}`,
  )
  if (DRY_RUN) {
    logger.log(`${colors.yellow('DRY RUN - No changes will be made')}`)
  }
  logger.log('')

  // Check prerequisites.
  logger.log('Checking prerequisites...')

  const hasGH = await checkGitHubCLI()
  if (!hasGH) {
    process.exit(1)
  }
  logger.success('GitHub CLI installed')

  const isAuthed = await checkGitHubAuth()
  if (!isAuthed) {
    logger.error('GitHub CLI not authenticated')
    logger.error('Run: gh auth login')
    process.exit(1)
  }
  logger.success('GitHub CLI authenticated')

  // Check if release exists.
  const exists = await releaseExists(TAG)
  if (exists) {
    if (FORCE) {
      await deleteRelease(TAG)
    } else {
      logger.error(`Release ${TAG} already exists`)
      logger.error('Use --force to overwrite')
      process.exit(1)
    }
  }

  // Create release archives.
  logger.log('\nCreating release archives...')

  const archives = []
  for (const { arch, platform } of PLATFORMS) {
    const archive = await createReleaseArchive(
      platform,
      arch,
      PACKAGE_NAME,
      VERSION,
    )
    if (archive) {
      archives.push(archive)
    }
  }

  if (archives.length === 0) {
    logger.error('No binaries found to release')
    logger.error('Build binaries first with: pnpm build')
    process.exit(1)
  }

  logger.log('')
  logger.success(`Created ${archives.length} release archives`)

  // Create GitHub release.
  await createGitHubRelease(TAG, archives, PUBLISH, PACKAGE_NAME, VERSION)

  logger.log('')
  logger.log(
    `${colors.green('✓')} Release ${PUBLISH ? 'published' : 'created as draft'}!`,
  )
  logger.log('')
  logger.log('View release:')
  logger.log(`  gh release view ${TAG}`)
  logger.log('')

  if (!PUBLISH) {
    logger.log('Publish release:')
    logger.log(`  gh release edit ${TAG} --draft=false`)
    logger.log('')
  }
}

main().catch(error => {
  logger.error(`Release failed: ${error.message}`)
  if (error.stack) {
    logger.error(error.stack)
  }
  process.exit(1)
})
