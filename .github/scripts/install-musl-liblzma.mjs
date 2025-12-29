#!/usr/bin/env node
/**
 * Install musl-compatible liblzma from source
 * Required for static linking in musl builds
 *
 * Usage: node install-musl-liblzma.mjs <arch>
 *   arch: x64 or arm64
 */

import { createWriteStream, existsSync } from 'node:fs'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'

import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()
const WIN32 = process.platform === 'win32'

const XZ_VERSION = '5.4.5'
const XZ_URL = `https://github.com/tukaani-project/xz/releases/download/v${XZ_VERSION}/xz-${XZ_VERSION}.tar.gz`
const INSTALL_PREFIX = '/usr/local/musl'
const MAX_RETRIES = 5
const RETRY_DELAY = 10000 // 10 seconds

/**
 * Main installation function
 */
async function main() {
  const arch = process.argv[2]

  if (!arch) {
    logger.error('Error: Architecture not specified')
    logger.log('Usage: node install-musl-liblzma.mjs <arch>')
    logger.log('  arch: x64 or arm64')
    process.exit(1)
  }

  if (arch !== 'x64' && arch !== 'arm64') {
    logger.error(`Error: Invalid architecture: ${arch}`)
    logger.log("Must be 'x64' or 'arm64'")
    process.exit(1)
  }

  logger.info(`Building liblzma from source for musl (${arch})...`)

  const tmpDir = path.join(os.tmpdir(), `xz-build-${Date.now()}`)
  const xzDir = path.join(tmpDir, `xz-${XZ_VERSION}`)
  const tarballPath = path.join(tmpDir, `xz-${XZ_VERSION}.tar.gz`)

  try {
    // Create temp directory
    await safeMkdir(tmpDir)

    // Download with retry logic
    await downloadWithRetry(XZ_URL, tarballPath)

    // Extract tarball
    logger.info('Extracting tarball...')
    await spawn('tar', ['-xzf', tarballPath], {
      cwd: tmpDir,
      shell: WIN32,
      stdio: 'inherit',
    })

    // Configure based on architecture
    logger.info('Configuring build...')
    const configureEnv = { ...process.env }
    const configureArgs = [
      '--enable-static',
      '--disable-shared',
      `--prefix=${INSTALL_PREFIX}`,
    ]

    if (arch === 'x64') {
      configureEnv.CC = 'musl-gcc'
    } else if (arch === 'arm64') {
      configureEnv.CC = 'aarch64-linux-gnu-gcc'
      configureArgs.push('--host=aarch64-linux-gnu')
    }

    await spawn('./configure', configureArgs, {
      cwd: xzDir,
      env: configureEnv,
      shell: WIN32,
      stdio: 'inherit',
    })

    // Build
    logger.info('Building...')
    const nproc = os.cpus().length
    await spawn('make', [`-j${nproc}`], {
      cwd: xzDir,
      shell: WIN32,
      stdio: 'inherit',
    })

    // Install
    logger.info('Installing...')
    await spawn('sudo', ['make', 'install'], {
      cwd: xzDir,
      shell: WIN32,
      stdio: 'inherit',
    })

    logger.success(`✓ liblzma installed to ${INSTALL_PREFIX}`)

    // Cleanup
    await safeDelete(tmpDir)
  } catch (error) {
    logger.error(`Installation failed: ${error.message}`)
    // Try to cleanup on failure
    if (existsSync(tmpDir)) {
      try {
        await safeDelete(tmpDir)
      } catch {
        // Ignore cleanup errors
      }
    }
    process.exit(1)
  }
}

/**
 * Download file with retry logic using Node.js https module
 */
async function downloadWithRetry(url, outputPath) {
  let currentDelay = RETRY_DELAY

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      logger.info(`Download attempt ${attempt}/${MAX_RETRIES}...`)

      await downloadFile(url, outputPath)

      // Success!
      logger.success('Download complete')
      return
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        logger.warn(
          `✗ Attempt ${attempt}/${MAX_RETRIES} failed: ${error.message}`,
        )
        logger.log(`  Retrying in ${currentDelay / 1000}s...`)
        await sleep(currentDelay)
        // Exponential backoff: double the delay for next retry
        currentDelay *= 2
      } else {
        throw new Error(
          `Failed to download ${url} after ${MAX_RETRIES} attempts: ${error.message}`,
        )
      }
    }
  }
}

/**
 * Download a file using Node.js https module
 * Handles redirects (GitHub releases redirect to different CDN URLs)
 */
function downloadFile(url, outputPath) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(outputPath)
    let redirectCount = 0
    const MAX_REDIRECTS = 5

    const makeRequest = requestUrl => {
      https
        .get(requestUrl, response => {
          // Handle redirects (GitHub releases use redirects)
          if (
            response.statusCode >= 300 &&
            response.statusCode < 400 &&
            response.headers.location
          ) {
            redirectCount++
            if (redirectCount > MAX_REDIRECTS) {
              file.close()
              reject(new Error(`Too many redirects (>${MAX_REDIRECTS})`))
              return
            }
            logger.log(`  Following redirect to: ${response.headers.location}`)
            makeRequest(response.headers.location)
            return
          }

          if (response.statusCode !== 200) {
            file.close()
            reject(
              new Error(
                `HTTP ${response.statusCode}: ${response.statusMessage}`,
              ),
            )
            return
          }

          const totalBytes = Number.parseInt(
            response.headers['content-length'],
            10,
          )
          let downloadedBytes = 0
          let lastLoggedPercent = 0

          response.on('data', chunk => {
            downloadedBytes += chunk.length
            const percent = Math.floor((downloadedBytes / totalBytes) * 100)

            // Log progress every 10%
            if (percent >= lastLoggedPercent + 10) {
              logger.log(
                `  Progress: ${percent}% (${(downloadedBytes / 1024 / 1024).toFixed(1)} MB / ${(totalBytes / 1024 / 1024).toFixed(1)} MB)`,
              )
              lastLoggedPercent = percent
            }
          })

          response.pipe(file)

          file.on('finish', () => {
            file.close()
            resolve()
          })

          file.on('error', err => {
            file.close()
            reject(err)
          })
        })
        .on('error', err => {
          file.close()
          reject(err)
        })
    }

    makeRequest(url)
  })
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Run main function
main()
