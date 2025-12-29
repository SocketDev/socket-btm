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
 *   - GITHUB_TOKEN environment variable with repo access
 */

import { createHash } from 'node:crypto'
import { createReadStream, existsSync, promises as fs } from 'node:fs'
import { platform as osPlatform, arch as osArch } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getBuildMode } from 'build-infra/lib/constants'
import colors from 'yoctocolors-cjs'
import { Octokit } from 'octokit'

import { parseArgs } from '@socketsecurity/lib/argv/parse'
import { which } from '@socketsecurity/lib/bin'
import { safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { getBuildPaths } from '../../paths.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.join(__dirname, '..')
const BUILD_MODE = getBuildMode()
const BUILD_DIR = path.join(ROOT_DIR, 'build', BUILD_MODE)

const logger = getDefaultLogger()

const OWNER = 'SocketDev'
const REPO = 'socket-btm'

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
 * Check if GitHub API is authenticated.
 * Validates by attempting to get authenticated user.
 */
async function checkGitHubAuth() {
  try {
    const octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN,
    })
    await octokit.rest.users.getAuthenticated()
    return true
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
    const octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN,
    })
    await octokit.rest.repos.getReleaseByTag({
      owner: OWNER,
      repo: REPO,
      tag,
    })
    return true
  } catch {
    return false
  }
}

/**
 * Delete existing release.
 */
async function deleteRelease(tag) {
  logger.log(`\nDeleting existing release: ${tag}`)
  const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN,
  })

  // Get release by tag to get release ID.
  const { data: release } = await octokit.rest.repos.getReleaseByTag({
    owner: OWNER,
    repo: REPO,
    tag,
  })

  // Delete the release.
  await octokit.rest.repos.deleteRelease({
    owner: OWNER,
    release_id: release.id,
    repo: REPO,
  })
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
    '# Verify checksum',
    'shasum -a 256 node',
    '',
    '# Use binary',
    './node --version',
    '```',
  ].join('\n')

  // Create release.
  if (DRY_RUN) {
    logger.log('[DRY RUN] Would create release:')
    logger.log(`  Tag: ${tag}`)
    logger.log(`  Title: ${packageName} ${version}`)
    logger.log(`  Draft: ${!publish}`)
    logger.log(`  Assets: ${archives.length}`)
    return
  }

  const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN,
  })

  // Create the release.
  const { data: release } = await octokit.rest.repos.createRelease({
    body: notes,
    draft: !publish,
    name: `${packageName} ${version}`,
    owner: OWNER,
    repo: REPO,
    tag_name: tag,
  })

  logger.log(`Created release: ${release.html_url}`)

  // Upload assets.
  logger.log('Uploading assets...')
  for (const archive of archives) {
    logger.log(`  Uploading ${archive.archiveName}...`)
    const data = await fs.readFile(archive.archivePath)

    await octokit.rest.repos.uploadReleaseAsset({
      data,
      headers: {
        'content-length': data.length,
        'content-type': 'application/octet-stream',
      },
      name: archive.archiveName,
      owner: OWNER,
      release_id: release.id,
      repo: REPO,
    })
  }
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

  const isAuthed = await checkGitHubAuth()
  if (!isAuthed) {
    logger.error('GitHub API not authenticated')
    logger.error('Set GITHUB_TOKEN environment variable')
    process.exit(1)
  }
  logger.success('GitHub API authenticated')

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
  logger.log(`  https://github.com/${OWNER}/${REPO}/releases/tag/${TAG}`)
  logger.log('')

  if (!PUBLISH) {
    logger.log('Publish release from GitHub web interface or use:')
    logger.log('  pnpm release --publish')
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
