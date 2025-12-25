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

const liefUpstream = path.join(packageRoot, 'upstream/lief')
const liefBuildDir = path.join(
  packageRoot,
  'build',
  BUILD_MODE,
  'out',
  'Final',
  'lief',
)

const WIN32 = process.platform === 'win32'

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

    // Try downloading prebuilt LIEF first.
    const downloaded = await downloadPrebuiltLIEF()
    if (downloaded) {
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

      if (liefLibPathNew && existsSync(liefLibPathNew)) {
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
        return
      }
    }

    // Fall back to building from source.
    logger.info('Building LIEF from source...')

    // Skip LIEF build only if submodule not initialized.
    const liefSourceDir = path.join(packageRoot, 'upstream', 'lief')
    const liefCMakeLists = path.join(liefSourceDir, 'CMakeLists.txt')

    if (!existsSync(liefCMakeLists)) {
      logger.info('Skipping LIEF build (submodule not initialized)')
      logger.info(
        '  Run: git submodule update --init --recursive packages/bin-infra/upstream/lief',
      )
      await createCheckpoint(buildDir, 'lief-built', async () => {}, {
        skipped: true,
        platform: process.platform,
        reason: 'submodule-not-initialized',
        artifactPath: liefBuildDir,
      })
      return
    }

    logger.info(
      `Building LIEF on ${process.platform} for cross-platform binary injection support`,
    )

    // Create build directory.
    await fs.mkdir(buildDir, { recursive: true })

    // Check if LIEF upstream exists.
    if (!existsSync(liefUpstream)) {
      throw new Error(
        `LIEF upstream not found at ${liefUpstream}. Run 'git submodule update --init --recursive' first.`,
      )
    }
    logger.info('LIEF upstream found')

    // Create build directory.
    await fs.mkdir(liefBuildDir, { recursive: true })

    // Configure LIEF with CMake.
    logger.info('Configuring LIEF with CMake...')
    const cmakeArgs = [
      liefUpstream,
      '-DCMAKE_BUILD_TYPE=Release',
      '-DLIEF_PYTHON_API=OFF',
      '-DLIEF_C_API=OFF',
      '-DLIEF_EXAMPLES=OFF',
      '-DLIEF_TESTS=OFF',
      '-DLIEF_DOC=OFF',
      '-DLIEF_LOGGING=OFF',
      '-DLIEF_LOGGING_DEBUG=OFF',
      '-DLIEF_ENABLE_JSON=OFF',
    ]

    // On Windows, use gcc/MinGW for consistent ABI (CI and binsuite)
    // LIEF must use the same compiler/ABI as binject to avoid linker errors
    if (WIN32) {
      // Always use gcc/g++ on Windows for MinGW ABI compatibility
      // Even if CC/CXX env vars are set to clang, override for LIEF build
      const cc = 'gcc'
      const cxx = 'g++'

      cmakeArgs.push(`-DCMAKE_C_COMPILER=${cc}`, `-DCMAKE_CXX_COMPILER=${cxx}`)

      // Use MinGW Makefiles generator for MinGW toolchain
      cmakeArgs.push('-G', 'MinGW Makefiles')

      logger.info('Building LIEF with gcc/g++ using MinGW Makefiles')
    }

    // On musl, disable fortify source to avoid glibc-specific fortify functions.
    // musl libc does not provide __*_chk functions (e.g., __snprintf_chk, __memcpy_chk).
    // This prevents linking errors when binject (built on musl) tries to link LIEF.
    // Use -U to undefine first in case it's set elsewhere, then define as 0.
    if (isMusl()) {
      cmakeArgs.push(
        '-DCMAKE_C_FLAGS=-U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=0',
        '-DCMAKE_CXX_FLAGS=-U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=0',
      )
      logger.info('Disabling fortify source for musl libc compatibility')
    }

    // Use ccache if available.
    try {
      await runCommand('which', ['ccache'], liefBuildDir)
      cmakeArgs.push('-DCMAKE_CXX_COMPILER_LAUNCHER=ccache')
      logger.info('Using ccache for faster compilation')
    } catch {
      logger.info('ccache not available, building without cache')
    }

    // Clear compiler flags that may have been set for the main binject build.
    // LIEF build uses its own compiler settings and shouldn't inherit these.
    // Exception: For musl, we must set CFLAGS/CXXFLAGS as environment variables
    // to ensure subdependencies (like mbedtls) also disable fortify source.
    const cleanEnv = {
      CFLAGS: isMusl() ? '-U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=0' : undefined,
      CXXFLAGS: isMusl() ? '-U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=0' : undefined,
      LDFLAGS: undefined,
    }
    await runCommand('cmake', cmakeArgs, liefBuildDir, cleanEnv)
    logger.info('')

    // Build LIEF.
    logger.info('Building LIEF (this may take 10-20 minutes)...')
    const buildStart = Date.now()
    // Use the same cleanEnv to ensure subdependencies get the flags.
    await runCommand(
      'cmake',
      ['--build', '.', '--config', 'Release', '-j2'],
      liefBuildDir,
      cleanEnv,
    )
    const buildDuration = Math.round((Date.now() - buildStart) / 1000)
    logger.info(
      `LIEF build completed in ${buildDuration}s (${Math.floor(buildDuration / 60)}m ${buildDuration % 60}s)`,
    )
    logger.info('')

    logger.success('LIEF build completed successfully!')

    // Verify library exists (platform-specific naming).
    // When using clang on Windows with Ninja/Unix Makefiles, it produces LIEF.lib (MSVC-style)
    // When using gcc/MinGW on Windows, it produces libLIEF.a (Unix-style)
    // On Unix platforms: libLIEF.a
    let libPath = path.join(liefBuildDir, 'libLIEF.a')
    if (!existsSync(libPath)) {
      // Try Windows MSVC-style naming
      libPath = path.join(liefBuildDir, 'LIEF.lib')
      if (!existsSync(libPath)) {
        throw new Error(
          `LIEF library not found (checked libLIEF.a and LIEF.lib in ${liefBuildDir})`,
        )
      }
    }

    const stats = await fs.stat(libPath)
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2)
    logger.info(`LIEF library size: ${sizeMB} MB`)

    // Create checkpoint.
    await createCheckpoint(
      buildDir,
      'lief-built',
      async () => {
        // Verify library exists and has reasonable size.
        const libStats = await fs.stat(libPath)
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
            `LIEF config.h not found at ${configHeader} - incomplete build`,
          )
        }
      },
      {
        version: LIEF_VERSION,
        libPath: path.relative(buildDir, libPath),
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
