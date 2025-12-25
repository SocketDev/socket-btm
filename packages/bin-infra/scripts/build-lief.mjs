#!/usr/bin/env node
/**
 * Build script for LIEF library.
 * Downloads prebuilt LIEF from GitHub releases or builds from source.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createCheckpoint, shouldRun } from 'build-infra/lib/checkpoint-manager'

import { safeDelete } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.join(__dirname, '..')

// Determine build mode from environment or default to dev (following node-smol pattern).
const BUILD_MODE = process.env.BUILD_MODE || (process.env.CI ? 'prod' : 'dev')
const buildDir = path.join(packageRoot, 'build', BUILD_MODE)

const liefBuildDir = path.join(
  packageRoot,
  'build',
  BUILD_MODE,
  'out',
  'Final',
  'lief',
)

// LIEF version (tracked in upstream).
const LIEF_VERSION = '0.17.1'

// GitHub repository for LIEF releases.
const REPO = 'SocketDev/socket-btm'

/**
 * Detect if running on musl libc (Alpine Linux).
 */
function isMusl() {
  if (process.platform !== 'linux') {
    return false
  }

  // Check for Alpine release file.
  if (existsSync('/etc/alpine-release')) {
    return true
  }

  // Check ldd version for musl.
  try {
    const { execSync } = require('node:child_process')
    const lddVersion = execSync('ldd --version 2>&1', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return lddVersion.includes('musl')
  } catch {
    return false
  }
}

function getPlatformArch() {
  const platform = process.platform
  const arch = process.arch === 'x64' ? 'x64' : 'arm64'

  // Append -musl for musl libc on Linux.
  const muslSuffix = isMusl() ? '-musl' : ''

  return `${platform}-${arch}${muslSuffix}`
}

async function runCommand(command, args, cwd, env = {}) {
  logger.info(`Running: ${command} ${args.join(' ')}`)

  // Merge env properly, filtering out undefined values.
  const mergedEnv = { ...process.env }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete mergedEnv[key]
    } else {
      mergedEnv[key] = value
    }
  }

  const result = await spawn(command, args, {
    cwd,
    env: mergedEnv,
    stdio: 'inherit',
  })

  if (result.error) {
    throw new Error(`Command failed to spawn: ${result.error.message}`)
  }

  if (result.signal) {
    throw new Error(`Command terminated by signal: ${result.signal}`)
  }

  if (result.code !== 0) {
    throw new Error(`Command failed with exit code ${result.code}`)
  }
}

async function downloadPrebuiltLIEF() {
  try {
    logger.info('Checking for prebuilt LIEF releases...')

    const platformArch = getPlatformArch()
    const assetName = `lief-${platformArch}.tar.gz`

    // Find latest lief release.
    const listResult = await spawn(
      'gh',
      ['release', 'list', '--repo', REPO, '--limit', '100'],
      {
        cwd: packageRoot,
        stdio: 'pipe',
      },
    )

    if (listResult.code !== 0) {
      const errorMsg = listResult.stderr?.trim() || 'unknown error'
      throw new Error(`gh release list failed: ${errorMsg}`)
    }

    if (!listResult.stdout || listResult.stdout.trim() === '') {
      throw new Error('gh release list returned empty output')
    }

    const lines = listResult.stdout.trim().split('\n')
    let latestTag = null

    for (const line of lines) {
      const parts = line.split('\t')
      const tag = parts[2]
      if (tag?.startsWith('lief-')) {
        latestTag = tag
        break
      }
    }

    if (!latestTag) {
      logger.info('No prebuilt LIEF releases found')
      return false
    }

    logger.info(`Found LIEF release: ${latestTag}`)

    // Create build directory.
    await fs.mkdir(liefBuildDir, { recursive: true })

    // Download archive.
    logger.info(`Downloading ${assetName}...`)
    await runCommand(
      'gh',
      [
        'release',
        'download',
        latestTag,
        '--repo',
        REPO,
        '--pattern',
        assetName,
        '--dir',
        liefBuildDir,
      ],
      packageRoot,
    )

    // Extract archive.
    logger.info('Extracting LIEF archive...')

    // Ensure extract directory exists before extraction.
    await fs.mkdir(liefBuildDir, { recursive: true })

    // Use relative path for tar to avoid Windows path issues with MSYS.
    // Extract from current directory (liefBuildDir) using just the filename.
    await runCommand('tar', ['-xzf', assetName, '-C', '.'], liefBuildDir)

    // Clean up archive.
    await safeDelete(path.join(liefBuildDir, assetName))

    logger.success('Successfully downloaded and extracted prebuilt LIEF')
    return true
  } catch (error) {
    logger.info(`Failed to download prebuilt LIEF: ${error.message}`)
    return false
  }
}

async function main() {
  try {
    // Determine which LIEF library file to check for (platform-specific naming)
    const liefLibUnix = path.join(buildDir, 'out', 'Final', 'lief', 'libLIEF.a')
    const liefLibMSVC = path.join(buildDir, 'out', 'Final', 'lief', 'LIEF.lib')
    const liefLibPath = existsSync(liefLibUnix)
      ? liefLibUnix
      : existsSync(liefLibMSVC)
        ? liefLibMSVC
        : null

    // Check if LIEF is already built.
    const forceRebuild = process.argv.includes('--force')
    const checkpointExists = !(await shouldRun(
      buildDir,
      '',
      'lief-built',
      forceRebuild,
    ))

    // Validate checkpoint: both checkpoint file AND library file must exist
    if (checkpointExists && liefLibPath && existsSync(liefLibPath)) {
      logger.success('LIEF already built (checkpoint exists)')
      return
    }

    // If checkpoint exists but library is missing, invalidate and rebuild
    if (checkpointExists && !liefLibPath) {
      logger.info(
        'Checkpoint exists but LIEF library missing, rebuilding from scratch',
      )
    }

    logger.info('🔨 Building LIEF library...\n')

    // Download prebuilt LIEF (required).
    const downloaded = await downloadPrebuiltLIEF()
    if (!downloaded) {
      throw new Error(
        `Prebuilt LIEF not found for platform ${getPlatformArch()}. ` +
          'Ensure LIEF workflow has created a release with the required artifacts.',
      )
    }

    // Verify library exists after download.
    const liefLibUnixNew = path.join(
      buildDir,
      'out',
      'Final',
      'lief',
      'libLIEF.a',
    )
    const liefLibMSVCNew = path.join(
      buildDir,
      'out',
      'Final',
      'lief',
      'LIEF.lib',
    )
    const liefLibPathNew = existsSync(liefLibUnixNew)
      ? liefLibUnixNew
      : existsSync(liefLibMSVCNew)
        ? liefLibMSVCNew
        : null

    if (!liefLibPathNew || !existsSync(liefLibPathNew)) {
      throw new Error('LIEF library not found after download')
    }

    const stats = await fs.stat(liefLibPathNew)
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2)

    await createCheckpoint(
      buildDir,
      'lief-built',
      async () => {
        // Verify library exists and has reasonable size.
        const libStats = await fs.stat(liefLibPathNew)
        if (libStats.size < 1_000_000) {
          throw new Error(
            `LIEF library too small: ${libStats.size} bytes (expected >1MB)`,
          )
        }

        // Verify config.h was generated (required for compilation).
        const configHeader = path.join(
          liefBuildDir,
          'include',
          'LIEF',
          'config.h',
        )
        if (!existsSync(configHeader)) {
          throw new Error(
            `LIEF config.h not found at ${configHeader} - incomplete download`,
          )
        }
      },
      {
        source: 'prebuilt-release',
        version: LIEF_VERSION,
        libPath: path.relative(buildDir, liefLibPathNew),
        libSize: stats.size,
        libSizeMB: sizeMB,
        buildDir: path.relative(packageRoot, liefBuildDir),
        artifactPath: liefBuildDir,
      },
    )
  } catch (error) {
    logger.info('')
    logger.fail(`LIEF build failed: ${error.message}`)
    process.exit(1)
  }
}

main()
