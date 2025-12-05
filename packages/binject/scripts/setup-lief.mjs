#!/usr/bin/env node
/**
 * setup-lief.mjs - Download and setup LIEF library for binject
 *
 * This script downloads the appropriate LIEF release for the current platform
 * and extracts it to the external/lief directory.
 */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream, promises as fs } from 'node:fs'
import { get } from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const BINJECT_DIR = path.resolve(__dirname, '..')
const EXTERNAL_DIR = path.join(BINJECT_DIR, 'external')
const LIEF_DIR = path.join(EXTERNAL_DIR, 'lief')
const LIEF_VERSION = '0.14.0'

// Platform detection
function detectPlatform() {
  const platform = os.platform()
  const arch = os.arch()

  switch (platform) {
    case 'darwin':
      return arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64'
    case 'linux':
      return arch === 'arm64' || arch === 'aarch64'
        ? 'linux-arm64'
        : 'linux-x64'
    case 'win32':
      return 'win32-x64'
    default:
      throw new Error(`Unsupported OS: ${platform}`)
  }
}

// Get download URL for platform
function getDownloadUrl(platform) {
  const baseUrl = `https://github.com/lief-project/LIEF/releases/download/${LIEF_VERSION}`

  switch (platform) {
    case 'darwin-arm64':
      return `${baseUrl}/LIEF-${LIEF_VERSION}-Darwin-arm64.tar.gz`
    case 'darwin-x64':
      return `${baseUrl}/LIEF-${LIEF_VERSION}-Darwin-x86_64.tar.gz`
    case 'linux-x64':
      return `${baseUrl}/LIEF-${LIEF_VERSION}-Linux-x86_64.tar.gz`
    case 'linux-arm64':
      return `${baseUrl}/LIEF-${LIEF_VERSION}-Linux-aarch64.tar.gz`
    case 'win32-x64':
      return `${baseUrl}/LIEF-${LIEF_VERSION}-win64.zip`
    default:
      throw new Error(`Unknown platform: ${platform}`)
  }
}

// Get expected SHA256 for platform
function getExpectedSha256(platform) {
  const hashes = {
    'darwin-arm64':
      'f8ecc3f985610cc699991d3747c20c141c918705b88b321c9172a8ec9c964173',
    // Other platforms marked as TBD in external-tools.json
    // Will be calculated when needed
  }

  return hashes[platform]
}

// Download file with progress
async function downloadFile(url, outputPath) {
  return new Promise((resolve, reject) => {
    get(url, { headers: { 'User-Agent': 'binject-setup' } }, response => {
      // Follow redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location
        console.log(`  Following redirect to: ${redirectUrl}`)
        downloadFile(redirectUrl, outputPath).then(resolve).catch(reject)
        return
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Download failed with status ${response.statusCode}`))
        return
      }

      const totalBytes = Number.parseInt(response.headers['content-length'], 10)
      let downloadedBytes = 0
      const writeStream = createWriteStream(outputPath)

      response.on('data', chunk => {
        downloadedBytes += chunk.length
        const progress = ((downloadedBytes / totalBytes) * 100).toFixed(1)
        process.stdout.write(
          `\r  Downloading: ${progress}% (${(downloadedBytes / 1024 / 1024).toFixed(1)}MB / ${(totalBytes / 1024 / 1024).toFixed(1)}MB)`,
        )
      })

      response.on('end', () => {
        process.stdout.write('\n')
      })

      pipeline(response, writeStream)
        .then(() => resolve(outputPath))
        .catch(reject)
    }).on('error', reject)
  })
}

// Calculate SHA256 of file
async function calculateSha256(filePath) {
  const hash = createHash('sha256')
  const fileStream = (await import('node:fs')).createReadStream(filePath)

  return new Promise((resolve, reject) => {
    fileStream.on('data', chunk => hash.update(chunk))
    fileStream.on('end', () => resolve(hash.digest('hex')))
    fileStream.on('error', reject)
  })
}

// Execute command with stdio inheritance
function execCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: 'inherit',
      ...options,
    })

    proc.on('close', code => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Command failed with exit code ${code}`))
      }
    })

    proc.on('error', reject)
  })
}

// Extract tar.gz archive
async function extractTarGz(archivePath, destDir) {
  console.log('  Extracting archive...')
  await execCommand('tar', ['xzf', archivePath, '-C', destDir])
}

// Extract zip archive
async function extractZip(archivePath, destDir) {
  console.log('  Extracting archive...')
  await execCommand('unzip', ['-q', archivePath, '-d', destDir])
}

// Main setup function
async function main() {
  console.log('Setting up LIEF library for binject...')

  // Detect platform
  const platform = detectPlatform()
  console.log(`  Platform: ${platform}`)

  // Check if already installed
  try {
    await fs.access(LIEF_DIR)
    console.log(`  LIEF already installed at ${LIEF_DIR}`)
    console.log('  To reinstall, remove the directory and run again')
    return
  } catch {
    // Directory doesn't exist, continue with installation
  }

  // Get download URL and expected hash
  const downloadUrl = getDownloadUrl(platform)
  const expectedSha256 = getExpectedSha256(platform)
  console.log(`  Download URL: ${downloadUrl}`)

  // Create external directory
  await fs.mkdir(EXTERNAL_DIR, { recursive: true })

  // Download archive
  const isZip = downloadUrl.endsWith('.zip')
  const archivePath = path.join(
    EXTERNAL_DIR,
    isZip ? 'lief.zip' : 'lief.tar.gz',
  )

  console.log('  Downloading LIEF...')
  await downloadFile(downloadUrl, archivePath)

  // Verify SHA256 if available
  if (expectedSha256) {
    console.log('  Verifying SHA256...')
    const actualSha256 = await calculateSha256(archivePath)
    if (actualSha256 !== expectedSha256) {
      throw new Error(
        'SHA256 mismatch!\n' +
          `  Expected: ${expectedSha256}\n` +
          `  Actual:   ${actualSha256}`,
      )
    }
    console.log('  ✓ SHA256 verified')
  } else {
    console.log(
      `  ⚠ SHA256 not available for ${platform}, skipping verification`,
    )
    console.log(`  Calculated SHA256: ${await calculateSha256(archivePath)}`)
  }

  // Extract archive
  if (isZip) {
    await extractZip(archivePath, EXTERNAL_DIR)
  } else {
    await extractTarGz(archivePath, EXTERNAL_DIR)
  }

  // Remove archive
  await fs.unlink(archivePath)

  // Find extracted directory (will be named LIEF-{VERSION}-{PLATFORM})
  const entries = await fs.readdir(EXTERNAL_DIR)
  const extractedDir = entries.find(entry => entry.startsWith('LIEF-'))

  if (!extractedDir) {
    throw new Error('Failed to find extracted LIEF directory')
  }

  // Rename to just 'lief'
  await fs.rename(path.join(EXTERNAL_DIR, extractedDir), LIEF_DIR)

  console.log(`  ✓ LIEF installed to ${LIEF_DIR}`)

  // Verify installation
  const headersExist = await fs
    .access(path.join(LIEF_DIR, 'include', 'LIEF', 'LIEF.hpp'))
    .then(() => true)
    .catch(() => fs.access(path.join(LIEF_DIR, 'include', 'LIEF', 'LIEF.h')))
    .then(() => true)
    .catch(() => false)

  if (!headersExist) {
    throw new Error('LIEF headers not found')
  }
  console.log('  ✓ LIEF headers found')

  // Check for library (platform-specific)
  const libExtensions = ['.a', '.dylib', '.so', '.lib']
  const libExists = await Promise.any(
    libExtensions.map(ext =>
      fs.access(path.join(LIEF_DIR, 'lib', `libLIEF${ext}`)),
    ),
  )
    .then(() => true)
    .catch(() => false)

  if (!libExists) {
    throw new Error('LIEF library not found')
  }
  console.log('  ✓ LIEF library found')

  console.log('')
  console.log('LIEF setup complete!')
}

// Run main function
main().catch(err => {
  console.error('')
  console.error(`✗ Setup failed: ${err.message}`)
  process.exit(1)
})
