#!/usr/bin/env node
/**
 * Update VFS Tools Script
 *
 * Fetches the latest versions and SHA256 checksums for VFS tools (Trivy, TruffleHog, OpenGrep)
 * and updates the vfs-tools-downloader.mjs file.
 *
 * Usage:
 *   node scripts/update-vfs-tools.mjs [--dry-run] [--tool=<name>]
 *
 * Options:
 *   --dry-run    Show what would be updated without making changes
 *   --tool=name  Update only the specified tool (trivy, trufflehog, opengrep, python)
 */

import { createHash } from 'node:crypto'
import { createWriteStream, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { escapeRegExp } from '@socketsecurity/lib/regexps'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const logger = getDefaultLogger()

/** GitHub API base URL */
const GITHUB_API = 'https://api.github.com'

/** Version pattern for matching semver-like versions in filenames */
const VERSION_PATTERN = '[\\d.]+'

/**
 * Create a regex pattern from a filename template.
 * Use {version} as placeholder for version numbers.
 *
 * @param {string} template - Filename template with {version} placeholder
 * @returns {RegExp} Regex pattern matching the template
 */
function assetPattern(template) {
  // Split by {version}, escape each part, rejoin with version pattern
  const parts = template.split('{version}')
  const escaped = parts.map(escapeRegExp).join(VERSION_PATTERN)
  return new RegExp(`${escaped}$`)
}

/** Python embeddable package configurations (not GitHub releases) */
const PYTHON_CONFIG = {
  baseUrl: 'https://www.python.org/ftp/python',
  // Check https://www.python.org/downloads/ for latest stable version
  version: '3.11.9',
  assets: {
    'win32-x64': 'python-{version}-embed-amd64.zip',
    'win32-arm64': 'python-{version}-embed-arm64.zip',
  },
}

/** Tool configurations for fetching releases */
const TOOL_CONFIGS = {
  trivy: {
    owner: 'aquasecurity',
    repo: 'trivy',
    assetPatterns: {
      // Note: Trivy uses lowercase for Windows but mixed case for others
      'win32-x64': assetPattern('trivy_{version}_windows-64bit.zip'),
      'win32-arm64': assetPattern('trivy_{version}_windows-arm64.zip'),
      'darwin-x64': assetPattern('trivy_{version}_macOS-64bit.tar.gz'),
      'darwin-arm64': assetPattern('trivy_{version}_macOS-ARM64.tar.gz'),
      'linux-x64': assetPattern('trivy_{version}_Linux-64bit.tar.gz'),
      'linux-arm64': assetPattern('trivy_{version}_Linux-ARM64.tar.gz'),
    },
    checksumAsset: assetPattern('trivy_{version}_checksums.txt'),
  },
  trufflehog: {
    owner: 'trufflesecurity',
    repo: 'trufflehog',
    assetPatterns: {
      'win32-x64': assetPattern('trufflehog_{version}_windows_amd64.tar.gz'),
      'win32-arm64': assetPattern('trufflehog_{version}_windows_arm64.tar.gz'),
      'darwin-x64': assetPattern('trufflehog_{version}_darwin_amd64.tar.gz'),
      'darwin-arm64': assetPattern('trufflehog_{version}_darwin_arm64.tar.gz'),
      'linux-x64': assetPattern('trufflehog_{version}_linux_amd64.tar.gz'),
      'linux-arm64': assetPattern('trufflehog_{version}_linux_arm64.tar.gz'),
    },
    checksumAsset: assetPattern('trufflehog_{version}_checksums.txt'),
  },
  opengrep: {
    owner: 'opengrep',
    repo: 'opengrep',
    assetPatterns: {
      // OpenGrep uses opengrep-core tarballs for bundled distributions (no version in filename)
      'darwin-x64': assetPattern('opengrep-core_osx_x86.tar.gz'),
      'darwin-arm64': assetPattern('opengrep-core_osx_aarch64.tar.gz'),
      'linux-x64': assetPattern('opengrep-core_linux_x86.tar.gz'),
      'linux-arm64': assetPattern('opengrep-core_linux_aarch64.tar.gz'),
      'win32-x64': assetPattern('opengrep-core_windows_x86.zip'),
    },
    // OpenGrep doesn't have checksum file, we'll compute manually
    checksumAsset: undefined,
  },
}

/**
 * Fetch JSON from URL with GitHub API headers.
 */
async function fetchJson(url) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'socket-btm-vfs-tools-updater/1.0',
  }

  // Use GITHUB_TOKEN if available for higher rate limits
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  }

  const response = await fetch(url, { headers })

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}: ${response.statusText} for ${url}`,
    )
  }

  return response.json()
}

/**
 * Fetch text content from URL.
 */
async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'socket-btm-vfs-tools-updater/1.0' },
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }

  return response.text()
}

/**
 * Download file and compute SHA256.
 */
async function downloadAndHash(url) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vfs-hash-'))
  const tmpFile = path.join(tmpDir, 'download')

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'socket-btm-vfs-tools-updater/1.0' },
      redirect: 'follow',
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const fileStream = createWriteStream(tmpFile)
    await pipeline(response.body, fileStream)

    // Compute hash
    const content = await fs.readFile(tmpFile)
    const hash = createHash('sha256').update(content).digest('hex')

    return hash
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Parse checksum file (format: "hash  filename" or "hash filename")
 */
function parseChecksumFile(content) {
  const checksums = new Map()

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    // Try "hash  filename" (two spaces) or "hash filename" (one space)
    const match = trimmed.match(/^([a-f0-9]{64})\s+(.+)$/i)
    if (match) {
      const [, hash, filename] = match
      checksums.set(filename, hash.toLowerCase())
    }
  }

  return checksums
}

/**
 * Get Python embeddable package info (downloads and computes hashes).
 */
async function getPythonRelease() {
  const { assets: assetPatterns, baseUrl, version } = PYTHON_CONFIG
  const assets = new Map()

  for (const [platform, pattern] of Object.entries(assetPatterns)) {
    const filename = pattern.replace('{version}', version)
    const url = `${baseUrl}/${version}/${filename}`

    logger.info(`  Computing SHA256 for ${filename}...`)
    const sha256 = await downloadAndHash(url)

    assets.set(platform, {
      url,
      sha256,
      filename,
    })
  }

  return { version, assets }
}

/**
 * Get latest release info for a tool.
 */
async function getLatestRelease(toolName) {
  const config = TOOL_CONFIGS[toolName]
  if (!config) {
    throw new Error(`Unknown tool: ${toolName}`)
  }

  const url = `${GITHUB_API}/repos/${config.owner}/${config.repo}/releases/latest`
  const release = await fetchJson(url)

  const version = release.tag_name.replace(/^v/, '')
  const assets = new Map()
  let checksums = new Map()

  // Find checksum file first if available
  if (config.checksumAsset) {
    const checksumAsset = release.assets.find(a =>
      config.checksumAsset.test(a.name),
    )
    if (checksumAsset) {
      const checksumContent = await fetchText(
        checksumAsset.browser_download_url,
      )
      checksums = parseChecksumFile(checksumContent)
    }
  }

  // Match assets to platforms
  for (const [platform, pattern] of Object.entries(config.assetPatterns)) {
    const asset = release.assets.find(a => pattern.test(a.name))
    if (asset) {
      let sha256 = checksums.get(asset.name)

      // If no checksum in file, compute it
      if (!sha256) {
        logger.info(`  Computing SHA256 for ${asset.name}...`)
        sha256 = await downloadAndHash(asset.browser_download_url)
      }

      assets.set(platform, {
        url: asset.browser_download_url,
        sha256,
        filename: asset.name,
      })
    }
  }

  return { version, assets }
}

/**
 * Generate the updated VFS_TOOL_URLS object as a string.
 */
function generateToolConfig(toolName, version, assets) {
  const lines = [`  ${toolName}: {`, `    version: '${version}',`]

  // Determine which platforms this tool supports
  let expectedPlatforms
  if (toolName === 'python') {
    expectedPlatforms = Object.keys(PYTHON_CONFIG.assets)
  } else {
    expectedPlatforms = Object.keys(TOOL_CONFIGS[toolName]?.assetPatterns || {})
  }

  const platforms = [
    'win32-x64',
    'win32-arm64',
    'darwin-x64',
    'darwin-arm64',
    'linux-x64',
    'linux-arm64',
  ]

  for (const platform of platforms) {
    const asset = assets.get(platform)
    if (asset) {
      lines.push(`    '${platform}': {`)
      lines.push(`      url: '${asset.url}',`)
      lines.push(`      sha256: '${asset.sha256}',`)
      lines.push('    },')
    } else if (expectedPlatforms.includes(platform)) {
      // Platform is expected but not found
      lines.push(
        `    '${platform}': undefined, // Not available in this release`,
      )
    }
  }

  lines.push('  },')

  return lines.join('\n')
}

/**
 * Update the vfs-tools-downloader.mjs file.
 */
async function updateDownloaderFile(updates, dryRun) {
  const downloaderPath = path.join(
    __dirname,
    '..',
    'lib',
    'vfs-tools-downloader.mjs',
  )
  let content = await fs.readFile(downloaderPath, 'utf8')

  for (const [toolName, { assets, version }] of Object.entries(updates)) {
    const newConfig = generateToolConfig(toolName, version, assets)

    // Find and replace the tool's config block
    // This regex matches the tool config from "  toolname: {" to the closing "},"
    const toolRegex = new RegExp(`(  ${toolName}: \\{[\\s\\S]*?^  \\},)`, 'm')

    if (toolRegex.test(content)) {
      content = content.replace(toolRegex, newConfig)
      logger.success(`Updated ${toolName} to v${version}`)
    } else {
      logger.warn(`Could not find ${toolName} config block in file`)
    }
  }

  if (dryRun) {
    logger.info('\n--- Dry run - would write: ---')
    logger.info(`${content.slice(0, 2000)}...`)
  } else {
    await fs.writeFile(downloaderPath, content)
    logger.info('')
    logger.success(`Updated ${downloaderPath}`)
  }
}

/**
 * Main entry point.
 */
async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const toolArg = args.find(a => a.startsWith('--tool='))
  const specificTool = toolArg ? toolArg.split('=')[1] : undefined

  // All supported tools (GitHub-based + Python)
  const allTools = ['python', ...Object.keys(TOOL_CONFIGS)]
  const toolsToUpdate = specificTool ? [specificTool] : allTools

  logger.info('Fetching latest releases for VFS tools...\n')

  const updates = {}

  for (const toolName of toolsToUpdate) {
    // Handle Python separately (not a GitHub release)
    if (toolName === 'python') {
      try {
        logger.info(`Checking ${toolName}...`)
        const { assets, version } = await getPythonRelease()
        logger.info(`  Version: ${version}`)
        logger.info(`  Assets found: ${assets.size}`)
        updates[toolName] = { version, assets }
      } catch (error) {
        logger.error(`  Error fetching ${toolName}: ${error.message}`)
      }
      continue
    }

    if (!TOOL_CONFIGS[toolName]) {
      logger.error(`Unknown tool: ${toolName}`)
      continue
    }

    try {
      logger.info(`Checking ${toolName}...`)
      const { assets, version } = await getLatestRelease(toolName)
      logger.info(`  Latest version: ${version}`)
      logger.info(`  Assets found: ${assets.size}`)

      updates[toolName] = { version, assets }
    } catch (error) {
      logger.error(`  Error fetching ${toolName}: ${error.message}`)
    }
  }

  if (Object.keys(updates).length > 0) {
    await updateDownloaderFile(updates, dryRun)
  } else {
    logger.info('\nNo updates to apply.')
  }
}

main().catch(error => {
  logger.error('Fatal error:', error)
  process.exitCode = 1
})
