#!/usr/bin/env node
/**
 * Build script for bin-stubs package.
 * Wraps the Makefile build target for pnpm integration.
 */

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildBinSuitePackage } from 'bin-infra/lib/builder'
import { getAssetPlatformArch } from 'build-infra/lib/platform-mappings'
import { extract } from 'tar'

import {
  detectLibc,
  downloadSocketBtmRelease,
} from '@socketsecurity/lib/releases/socket-btm'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.join(__dirname, '..')

/**
 * Ensures curl libraries are available for bin-stubs (downloads if needed).
 * Returns the directory containing libcurl.a and related libraries.
 */
async function ensureCurlForStubs() {
  const platform = os.platform()
  // Respect TARGET_ARCH environment variable for cross-compilation.
  const arch = process.env.TARGET_ARCH || os.arch()
  const libc = detectLibc()
  // Use asset platform naming (win instead of win32).
  const platformArch = getAssetPlatformArch(platform, arch, libc)

  // Check if curl exists in built location first.
  // Use BUILD_MODE env var (defaults to dev).
  const buildMode = process.env.BUILD_MODE || 'dev'
  const builtDir = path.join(
    packageRoot,
    'build',
    buildMode,
    'out',
    'Final',
    'curl',
    'dist',
  )
  if (existsSync(path.join(builtDir, 'libcurl.a'))) {
    console.log(`✓ Using built curl at ${builtDir}`)
    return builtDir
  }

  // Check downloaded location.
  const downloadedDir = path.join(
    packageRoot,
    'build',
    'downloaded',
    'curl',
    platformArch,
  )
  if (existsSync(path.join(downloadedDir, 'libcurl.a'))) {
    console.log(`✓ Using downloaded curl at ${downloadedDir}`)
    return downloadedDir
  }

  // Download and extract curl.
  const downloadBaseDir = path.join(packageRoot, 'build', 'downloaded')
  const tarballPath = path.join(
    downloadBaseDir,
    'curl',
    'assets',
    `curl-${platformArch}.tar.gz`,
  )

  // Download curl using the standard helper.
  await downloadSocketBtmRelease({
    tool: 'curl',
    asset: `curl-${platformArch}.tar.gz`,
    downloadDir: downloadBaseDir,
    quiet: false,
  })

  // Extract the tarball to the platform-specific directory.
  await fs.mkdir(downloadedDir, { recursive: true })
  await extract({
    cwd: downloadedDir,
    file: tarballPath,
  })

  console.log(`✓ Extracted curl to ${downloadedDir}`)
  return downloadedDir
}

buildBinSuitePackage({
  packageName: 'smol_stub',
  packageDir: packageRoot,
  beforeBuild: async () => {
    // Try to ensure curl libraries are available (optional for stub builds).
    // If curl isn't available, stubs will build without HTTPS update checking.
    try {
      const curlDir = await ensureCurlForStubs()
      console.log(`✓ curl libraries ready at ${curlDir}`)
    } catch (error) {
      console.log(
        `⚠ curl libraries not available (${error.message}), building stub without HTTPS update checking support`,
      )
    }
  },
  smokeTest: async binaryPath => {
    // Custom smoke test for smol_stub (doesn't have --version flag).
    // Just verify binary exists and has reasonable size.
    const stats = await fs.stat(binaryPath)
    if (stats.size < 1000) {
      throw new Error(`Binary too small: ${stats.size} bytes (expected >1KB)`)
    }
    console.log(`✓ Stub binary validated: ${stats.size} bytes`)
  },
})
