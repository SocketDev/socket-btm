/**
 * Helper for downloading Node.js binaries for cross-platform testing
 * Downloads node-smol binaries or falls back to official Node.js releases.
 */

import { existsSync, promises as fs, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import AdmZip from 'adm-zip'
import { extract } from 'tar'

import { getDownloadedDir } from 'build-infra/lib/paths'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { httpRequest } from '@socketsecurity/lib-stable/http-request/request'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { PROJECT_ROOT } from './paths.mts'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

const logger = getDefaultLogger()

const CACHE_DIR = getDownloadedDir(PROJECT_ROOT)

/**
 * Read Node.js version from .node-version file
 * Falls back to a default if not found.
 */
export function getNodeVersion() {
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
 * Uses lazy evaluation to ensure NODE_VERSION is resolved.
 */
// oxlint-disable-next-line socket/sort-source-methods -- helpers ordered by download pipeline (resolve URL → fetch → extract → cache → return path); alphabetizing would scatter the flow.
export function getBinaryConfig(platform: string, arch: string) {
  const version = NODE_VERSION
  const key = `${platform}-${arch}`

  const configs: Record<
    string,
    {
      extractPath: string
      format: string
      nodeSmol: string
      official: string
    }
  > = {
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
    'linux-arm64': {
      nodeSmol: `https://github.com/SocketDev/node-smol/releases/download/${version}/node-${version}-linux-arm64`,
      official: `https://nodejs.org/dist/${version}/node-${version}-linux-arm64.tar.gz`,
      format: 'elf',
      extractPath: `node-${version}-linux-arm64/bin/node`,
    },
    'linux-x64': {
      nodeSmol: `https://github.com/SocketDev/node-smol/releases/download/${version}/node-${version}-linux-x64`,
      official: `https://nodejs.org/dist/${version}/node-${version}-linux-x64.tar.gz`,
      format: 'elf',
      extractPath: `node-${version}-linux-x64/bin/node`,
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
 * Get all supported platform/arch keys.
 */
const SUPPORTED_PLATFORMS = [
  'linux-x64',
  'linux-arm64',
  'darwin-arm64',
  'darwin-x64',
  'win32-x64',
]

/**
 * Download a binary from a URL.
 *
 * @param {string} url - URL to download from.
 *
 * @returns {Promise<Buffer>} Binary data
 */
// oxlint-disable-next-line socket/sort-source-methods -- helpers ordered by download pipeline (resolve URL → fetch → extract → cache → return path); alphabetizing would scatter the flow.
export async function downloadBinary(url: string) {
  const response = await httpRequest(url)
  if (!response.ok) {
    throw new Error(
      `Failed to download ${url}: ${response.status} ${response.statusText}`,
    )
  }
  return response.body
}

/**
 * Extract binary from tar.gz.
 *
 * @param {Buffer} tarGzData - Tar.gz archive data.
 * @param {string} extractPath - Path within archive to extract.
 *
 * @returns {Promise<Buffer>} Extracted binary data
 */
// oxlint-disable-next-line socket/sort-source-methods -- helpers ordered by download pipeline (resolve URL → fetch → extract → cache → return path); alphabetizing would scatter the flow.
export async function extractFromTarGz(tarGzData: Buffer, extractPath: string) {
  const tempDir = path.join(os.tmpdir(), `binject-extract-${Date.now()}`)
  await fs.mkdir(tempDir, { recursive: true })

  // Write tar.gz to temp file
  const tarGzPath = path.join(tempDir, 'archive.tar.gz')
  await fs.writeFile(tarGzPath, tarGzData)

  // Extract specific file
  await extract({
    cwd: tempDir,
    file: tarGzPath,
    filter: entryPath => entryPath === extractPath,
  })

  const extractedPath = path.join(tempDir, extractPath)
  const binary = await fs.readFile(extractedPath)

  // Cleanup
  await safeDelete(tempDir)

  return binary
}

/**
 * Extract binary from zip.
 *
 * @param {Buffer} zipData - Zip archive data.
 * @param {string} extractPath - Path within archive to extract.
 *
 * @returns {Promise<Buffer>} Extracted binary data
 */
// oxlint-disable-next-line socket/sort-source-methods -- helpers ordered by download pipeline (resolve URL → fetch → extract → cache → return path); alphabetizing would scatter the flow.
export async function extractFromZip(
  zipData: Buffer,
  extractPath: string,
): Promise<Buffer> {
  const zip = new AdmZip(zipData)
  const entry = zip.getEntry(extractPath)
  if (!entry) {
    throw new Error(`Entry ${extractPath} not found in zip`)
  }
  const data = zip.readFile(entry)
  if (data === null) {
    throw new Error(`Failed to read entry ${extractPath} from zip`)
  }
  return data
}

/**
 * Get a Node.js binary for a specific platform/arch
 * Downloads from node-smol if available, falls back to official Node.js.
 *
 * @param {string} platform - Platform (linux, darwin, win32)
 * @param {string} arch - Architecture (x64, arm64)
 *
 * @returns {Promise<{ path: string; format: string; version: string }>} Path to
 *   cached binary, its format, and version.
 */
// oxlint-disable-next-line socket/sort-source-methods -- helpers ordered by download pipeline (resolve URL → fetch → extract → cache → return path); alphabetizing would scatter the flow.
export async function getNodeBinary(platform: string, arch: string) {
  const key = `${platform}-${arch}`
  const config = getBinaryConfig(platform, arch)

  if (!config) {
    throw new Error(`Unsupported platform/arch: ${platform}/${arch}`)
  }

  // Ensure cache directory exists
  await fs.mkdir(CACHE_DIR, { recursive: true })

  const extension = platform === 'win32' ? '.exe' : ''
  const cachedPath = path.join(
    CACHE_DIR,
    `node-${NODE_VERSION}-${key}${extension}`,
  )

  // Return cached if exists
  if (existsSync(cachedPath)) {
    return {
      format: config.format,
      path: cachedPath,
      version: NODE_VERSION.replace(/^v/, ''),
    }
  }

  let binaryData

  // Try node-smol first
  try {
    logger.info(`Downloading node-smol binary for ${key}...`)
    binaryData = await downloadBinary(config.nodeSmol)
  } catch (nodeSmolErr) {
    const nodeSmolMessage = errorMessage(nodeSmolErr)
    logger.info(
      `node-smol not available, falling back to official Node.js: ${nodeSmolMessage}`,
    )

    // Fall back to official Node.js
    try {
      logger.info(`Downloading official Node.js binary for ${key}...`)
      const archiveData = await downloadBinary(config.official)

      // Extract based on archive type
      if (config.official.endsWith('.tar.gz')) {
        binaryData = await extractFromTarGz(archiveData, config.extractPath)
      } else if (config.official.endsWith('.zip')) {
        binaryData = await extractFromZip(archiveData, config.extractPath)
      } else {
        throw new Error(`Unsupported archive format: ${config.official}`, {
          cause: nodeSmolErr,
        })
      }
    } catch (officialError) {
      const officialMessage = errorMessage(officialError)
      throw new Error(
        'Failed to download binary from both node-smol and official sources:\n' +
          `  node-smol: ${nodeSmolMessage}\n` +
          `  official: ${officialMessage}`,
        { cause: officialError },
      )
    }
  }

  // Cache the binary
  await fs.writeFile(cachedPath, binaryData, { mode: 0o755 })
  logger.info(`Cached binary to ${cachedPath}`)

  return {
    format: config.format,
    path: cachedPath,
    version: NODE_VERSION.replace(/^v/, ''),
  }
}

/**
 * Get all supported platform/arch combinations.
 *
 * @returns {{ platform: string; arch: string; format: string }[]}
 */
export function getSupportedPlatforms() {
  return SUPPORTED_PLATFORMS.flatMap(key => {
    const parts = key.split('-')
    const platform = parts[0] ?? ''
    const arch = parts[1] ?? ''
    const config = getBinaryConfig(platform, arch)
    if (!config) {
      return []
    }
    return [{ arch, format: config.format, platform }]
  })
}

/**
 * Export the NODE_VERSION for tests that need it.
 */
export { NODE_VERSION }
