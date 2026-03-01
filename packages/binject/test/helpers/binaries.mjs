/**
 * Helper for downloading Node.js binaries for cross-platform testing
 * Downloads node-smol binaries or falls back to official Node.js releases
 */

import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { PROJECT_ROOT } from './paths.mjs'

const CACHE_DIR = path.join(PROJECT_ROOT, 'build', 'downloaded')

/**
 * Read Node.js version from .node-version file
 * Falls back to a default if not found
 */
function getNodeVersion() {
  const nodeVersionPath = path.join(PROJECT_ROOT, '..', '..', '.node-version')
  try {
    const version = readFileSync(nodeVersionPath, 'utf8').trim()
    return version.startsWith('v') ? version : `v${version}`
  } catch {
    // Fallback to a known version
    return 'v25.5.0'
  }
}

const NODE_VERSION = getNodeVersion()

/**
 * Get platform/arch configuration for binary downloads
 * Uses lazy evaluation to ensure NODE_VERSION is resolved
 */
function getBinaryConfig(platform, arch) {
  const version = NODE_VERSION
  const key = `${platform}-${arch}`

  const configs = {
    'linux-x64': {
      nodeSmol: `https://github.com/SocketDev/node-smol/releases/download/${version}/node-${version}-linux-x64`,
      official: `https://nodejs.org/dist/${version}/node-${version}-linux-x64.tar.gz`,
      format: 'elf',
      extractPath: `node-${version}-linux-x64/bin/node`,
    },
    'linux-arm64': {
      nodeSmol: `https://github.com/SocketDev/node-smol/releases/download/${version}/node-${version}-linux-arm64`,
      official: `https://nodejs.org/dist/${version}/node-${version}-linux-arm64.tar.gz`,
      format: 'elf',
      extractPath: `node-${version}-linux-arm64/bin/node`,
    },
    'darwin-arm64': {
      nodeSmol: `https://github.com/SocketDev/node-smol/releases/download/${version}/node-${version}-darwin-arm64`,
      official: `https://nodejs.org/dist/${version}/node-${version}-darwin-arm64.tar.gz`,
      format: 'macho',
      extractPath: `node-${version}-darwin-arm64/bin/node`,
    },
    'darwin-x64': {
      nodeSmol: `https://github.com/SocketDev/node-smol/releases/download/${version}/node-${version}-darwin-x64`,
      official: `https://nodejs.org/dist/${version}/node-${version}-darwin-x64.tar.gz`,
      format: 'macho',
      extractPath: `node-${version}-darwin-x64/bin/node`,
    },
    'win32-x64': {
      nodeSmol: `https://github.com/SocketDev/node-smol/releases/download/${version}/node-${version}-win-x64.exe`,
      official: `https://nodejs.org/dist/${version}/node-${version}-win-x64.zip`,
      format: 'pe',
      extractPath: `node-${version}-win-x64/node.exe`,
    },
  }

  return configs[key]
}

/**
 * Get all supported platform/arch keys
 */
const SUPPORTED_PLATFORMS = [
  'linux-x64',
  'linux-arm64',
  'darwin-arm64',
  'darwin-x64',
  'win32-x64',
]

/**
 * Download a binary from a URL
 * @param {string} url - URL to download from
 * @returns {Promise<Buffer>} Binary data
 */
async function downloadBinary(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(
      `Failed to download ${url}: ${response.status} ${response.statusText}`,
    )
  }
  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

/**
 * Extract binary from tar.gz
 * @param {Buffer} tarGzData - Tar.gz archive data
 * @param {string} extractPath - Path within archive to extract
 * @returns {Promise<Buffer>} Extracted binary data
 */
async function extractFromTarGz(tarGzData, extractPath) {
  const { extract } = await import('tar')
  const tempDir = path.join(os.tmpdir(), `binject-extract-${Date.now()}`)
  await mkdir(tempDir, { recursive: true })

  // Write tar.gz to temp file
  const tarGzPath = path.join(tempDir, 'archive.tar.gz')
  await writeFile(tarGzPath, tarGzData)

  // Extract specific file
  await extract({
    cwd: tempDir,
    file: tarGzPath,
    filter: entryPath => entryPath === extractPath,
  })

  const extractedPath = path.join(tempDir, extractPath)
  const { readFile, rm } = await import('node:fs/promises')
  const binary = await readFile(extractedPath)

  // Cleanup
  await rm(tempDir, { recursive: true, force: true })

  return binary
}

/**
 * Extract binary from zip
 * @param {Buffer} zipData - Zip archive data
 * @param {string} extractPath - Path within archive to extract
 * @returns {Promise<Buffer>} Extracted binary data
 */
async function extractFromZip(zipData, extractPath) {
  const AdmZip = (await import('adm-zip')).default
  const zip = new AdmZip(zipData)
  const entry = zip.getEntry(extractPath)
  if (!entry) {
    throw new Error(`Entry ${extractPath} not found in zip`)
  }
  return zip.readFile(entry)
}

/**
 * Get a Node.js binary for a specific platform/arch
 * Downloads from node-smol if available, falls back to official Node.js
 *
 * @param {string} platform - Platform (linux, darwin, win32)
 * @param {string} arch - Architecture (x64, arm64)
 * @returns {Promise<{path: string, format: string, version: string}>} Path to cached binary, its format, and version
 */
export async function getNodeBinary(platform, arch) {
  const key = `${platform}-${arch}`
  const config = getBinaryConfig(platform, arch)

  if (!config) {
    throw new Error(`Unsupported platform/arch: ${platform}/${arch}`)
  }

  // Ensure cache directory exists
  await mkdir(CACHE_DIR, { recursive: true })

  const extension = platform === 'win32' ? '.exe' : ''
  const cachedPath = path.join(
    CACHE_DIR,
    `node-${NODE_VERSION}-${key}${extension}`,
  )

  // Return cached if exists
  if (existsSync(cachedPath)) {
    return {
      path: cachedPath,
      format: config.format,
      version: NODE_VERSION.replace(/^v/, ''),
    }
  }

  let binaryData

  // Try node-smol first
  try {
    console.log(`Downloading node-smol binary for ${key}...`)
    binaryData = await downloadBinary(config.nodeSmol)
  } catch (nodeSmolError) {
    console.log(
      `node-smol not available, falling back to official Node.js: ${nodeSmolError.message}`,
    )

    // Fall back to official Node.js
    try {
      console.log(`Downloading official Node.js binary for ${key}...`)
      const archiveData = await downloadBinary(config.official)

      // Extract based on archive type
      if (config.official.endsWith('.tar.gz')) {
        binaryData = await extractFromTarGz(archiveData, config.extractPath)
      } else if (config.official.endsWith('.zip')) {
        binaryData = await extractFromZip(archiveData, config.extractPath)
      } else {
        throw new Error(`Unsupported archive format: ${config.official}`)
      }
    } catch (officialError) {
      throw new Error(
        'Failed to download binary from both node-smol and official sources:\n' +
          `  node-smol: ${nodeSmolError.message}\n` +
          `  official: ${officialError.message}`,
      )
    }
  }

  // Cache the binary
  await writeFile(cachedPath, binaryData, { mode: 0o755 })
  console.log(`Cached binary to ${cachedPath}`)

  return {
    path: cachedPath,
    format: config.format,
    version: NODE_VERSION.replace(/^v/, ''),
  }
}

/**
 * Get all supported platform/arch combinations
 * @returns {Array<{platform: string, arch: string, format: string}>}
 */
export function getSupportedPlatforms() {
  return SUPPORTED_PLATFORMS.map(key => {
    const [platform, arch] = key.split('-')
    const config = getBinaryConfig(platform, arch)
    return { platform, arch, format: config.format }
  })
}

/**
 * Export the NODE_VERSION for tests that need it
 */
export { NODE_VERSION }
