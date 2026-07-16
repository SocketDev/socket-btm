/**
 * @file Download the latest node-smol release from GitHub for tests that
 *   need a real Node.js binary and don't have a local build available.
 *   Split out of sea-json-config.test.mts to keep it under the file-size
 *   soft cap.
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { execCommand } from './exec-command-with-output.mts'

/**
 * Download latest node-smol release from GitHub Returns path to downloaded
 * binary in cache directory.
 */
export async function downloadNodeSmolRelease() {
  try {
    // Use a persistent cache directory (not testDir which gets cleaned up)
    const cacheDir = path.join(os.tmpdir(), 'binject-node-cache')
    await fs.mkdir(cacheDir, { recursive: true })

    // Get latest release info using gh CLI
    const { stdout: releaseJson } = await execCommand('gh', [
      'release',
      'view',
      '--repo',
      'SocketDev/socket-btm',
      '--json',
      'tagName,assets',
    ])

    const release = JSON.parse(releaseJson)
    if (!release || !release.tagName || !release.assets) {
      return undefined
    }

    // Determine platform-specific asset name
    const platform = os.platform()
    const arch = os.arch()
    let assetPattern: string

    if (platform === 'darwin') {
      assetPattern = `node-smol-.*-darwin-${arch}.tar.gz`
    } else if (platform === 'linux') {
      assetPattern = `node-smol-.*-linux-${arch}.tar.gz`
    } else if (platform === 'win32') {
      assetPattern = `node-smol-.*-win-${arch}.zip`
    } else {
      return undefined
    }

    // Find matching asset
    const asset = (release.assets as Array<{ name: string }>).find(a =>
      new RegExp(assetPattern).test(a.name),
    )
    if (!asset) {
      return undefined
    }

    const ext = platform === 'win32' ? '.exe' : ''
    const cachedBinary = path.join(cacheDir, `node-${release.tagName}${ext}`)

    // Check if already downloaded and cached
    try {
      // oxlint-disable-next-line socket/prefer-exists-sync -- access(X_OK) checks executable permission, not just existence; stats.size verifies non-empty binary; existsSync can't substitute for either.
      await fs.access(cachedBinary, fs.constants.X_OK)
      return cachedBinary
    } catch {
      // Not cached, proceed with download
    }

    // Download asset to cache directory
    const downloadPath = path.join(cacheDir, asset.name)
    await execCommand('gh', [
      'release',
      'download',
      release.tagName,
      '--repo',
      'SocketDev/socket-btm',
      '--pattern',
      asset.name,
      '--dir',
      cacheDir,
    ])

    // Extract archive
    const extractedBinary = path.join(cacheDir, `node${ext}`)

    if (asset.name.endsWith('.tar.gz')) {
      await execCommand('tar', ['-xzf', downloadPath, '-C', cacheDir])
    } else if (asset.name.endsWith('.zip')) {
      await execCommand('unzip', ['-o', downloadPath, '-d', cacheDir])
    }

    // Rename to include version tag for cache identification
    await fs.rename(extractedBinary, cachedBinary)

    // Verify cached binary exists and is executable
    // oxlint-disable-next-line socket/prefer-exists-sync -- access(X_OK) checks executable permission, not just existence; stats.size verifies non-empty binary; existsSync can't substitute for either.
    await fs.access(cachedBinary, fs.constants.X_OK)
    return cachedBinary
  } catch {
    return undefined
  }
}
