/**
 * Host environment preflight checks.
 *
 * Probes the build host for the resources a build needs before it starts:
 * compilers, disk space, network reachability, and a usable Python — plus the
 * CI disk-space reclaimer that deletes pre-installed runner bloat.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import binPkg from '@socketsecurity/lib-stable/bin/which'
import platformPkg from '@socketsecurity/lib-stable/constants/platform'
import { getCI } from '@socketsecurity/lib-stable/env/ci'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import spawnPkg from '@socketsecurity/lib-stable/process/spawn/child'

import { getCleanupPaths } from './ci-cleanup-paths.mts'
import { BYTES } from './constants.mts'
import { errorMessage } from './error-utils.mts'
import { getMinPythonVersion } from './version-helpers.mts'
import { whichRequired } from './which-required.mts'

const { whichSync } = binPkg
const { WIN32 } = platformPkg
const { spawn } = spawnPkg

const logger = getDefaultLogger()

/**
 * Check if compiler is available.
 * Tries multiple compilers if none specified.
 */
export async function checkCompiler(
  compilers?: string | string[] | undefined,
): Promise<{ available: boolean; compiler: string | undefined }> {
  const compilerList = Array.isArray(compilers)
    ? compilers
    : compilers
      ? [compilers]
      : ['clang++', 'g++', 'c++']

  for (let i = 0, { length } = compilerList; i < length; i += 1) {
    const compiler = compilerList[i]
    if (!compiler) {
      continue
    }
    logger.substep(`Checking for ${compiler}`)

    const binPath = whichSync(compiler, { nothrow: true })
    if (binPath) {
      return { available: true, compiler }
    }
  }

  return { available: false, compiler: undefined }
}

/**
 * Check available disk space.
 */
export async function checkDiskSpace(
  dir: string,
  requiredGB = 5,
): Promise<{ availableGB: number | undefined; sufficient: boolean }> {
  logger.substep('Checking disk space')

  try {
    // Use Node.js built-in fs.statfs for cross-platform disk space check.
    // If directory doesn't exist yet, check parent or current directory.
    let checkDir = dir
    if (!existsSync(dir)) {
      // Directory doesn't exist - check parent directory.
      checkDir = path.dirname(dir)
    }

    const stats = await fs.statfs(checkDir)
    const availableBytes = stats.bavail * stats.bsize
    const availableGBValue = Number((availableBytes / BYTES.GB).toFixed(2))
    const sufficient = availableGBValue >= requiredGB

    logger.info(`Available: ${availableGBValue} GB, Required: ${requiredGB} GB`)

    return {
      availableGB: availableGBValue,
      sufficient,
    }
  } catch {
    logger.warn('Could not check disk space')
    return { availableGB: undefined, sufficient: true }
  }
}

/**
 * Check network connectivity.
 */
export async function checkNetworkConnectivity(): Promise<{
  connected: boolean
  statusCode: string | undefined
}> {
  try {
    // In CI, assume network connectivity is available.
    // The build will fail later if it's actually not available.
    if (getCI()) {
      return { connected: true, statusCode: 'skipped-in-ci' }
    }

    // Platform-specific network connectivity check.
    if (WIN32) {
      // Windows: Use PowerShell's Invoke-WebRequest.
      const result = await spawn(await whichRequired('powershell'), [
        '-NoProfile',
        '-Command',
        'try { $null = Invoke-WebRequest -Uri "https://github.com" -Method Head -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop; Write-Output "200" } catch { Write-Output "0" }',
      ])

      const statusCode = (result.stdout ?? '').trim()
      return {
        connected: statusCode === '200',
        statusCode: statusCode === '200' ? '200' : undefined,
      }
    }

    // Unix/Linux/macOS: Use curl.
    const result = await spawn(await whichRequired('curl'), [
      '-s',
      '-o',
      '/dev/null',
      '-w',
      '%{http_code}',
      '--connect-timeout',
      '5',
      'https://github.com',
    ])

    const statusCode = (result.stdout ?? '').trim()
    return {
      connected:
        statusCode === '200' || statusCode === '301' || statusCode === '302',
      statusCode,
    }
  } catch {
    return { connected: false, statusCode: undefined }
  }
}

/**
 * Check Python version.
 */
export async function checkPythonVersion(
  minVersion?: string | undefined,
): Promise<{
  available: boolean
  sufficient: boolean
  version: string | undefined
}> {
  // Use single source of truth from external-tools.json if no version specified
  const effectiveMinVersion = minVersion ?? getMinPythonVersion()
  logger.substep('Checking Python version')

  // Try multiple Python command names.
  // Use shell on all platforms to ensure PATH resolution works with setup-python.
  const pythonCommands = ['python3', 'python']

  for (let i = 0, { length } = pythonCommands; i < length; i += 1) {
    const pythonCmd = pythonCommands[i]
    if (!pythonCmd) {
      continue
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await spawn(
        pythonCmd,
        [
          '-c',
          "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')",
        ],
        { shell: WIN32 },
      )

      // Check if spawn failed or returned undefined code.
      // promise-spawn returns 'code' not 'status'.
      if (!result || result.code === undefined) {
        continue
      }

      if (result.code !== 0) {
        if (result.stderr) {
          logger.warn(`${pythonCmd} failed: ${result.stderr}`)
        }
        continue
      }

      const version = (result.stdout ?? '').trim()
      if (!version) {
        continue
      }

      const versionParts = version.split('.').map(Number)
      const minParts = effectiveMinVersion.split('.').map(Number)

      const major = versionParts[0]
      const minor = versionParts[1]
      const minMajor = minParts[0]
      const minMinor = minParts[1]

      // Validate that we have at least major.minor and no NaN values
      if (
        major === undefined ||
        minor === undefined ||
        minMajor === undefined ||
        minMinor === undefined ||
        versionParts.some(n => Number.isNaN(n)) ||
        minParts.some(n => Number.isNaN(n))
      ) {
        continue
      }

      const sufficient =
        major > minMajor || (major === minMajor && minor >= minMinor)

      return {
        available: true,
        sufficient,
        version,
      }
      // eslint-disable-next-line no-empty
    } catch {}
  }

  // None of the Python commands worked.
  return {
    available: false,
    sufficient: false,
    version: undefined,
  }
}

/**
 * Free disk space by removing large unused packages. Removes pre-installed
 * packages on GitHub runners that are not needed. Handles Linux, macOS, and
 * Windows platforms. Only runs in CI environments to avoid deleting packages on
 * developer machines.
 */
export async function freeDiskSpace(): Promise<void> {
  // Only run in CI environments (GitHub Actions, GitLab CI, etc.)
  if (!getCI()) {
    logger.substep('Skipping disk space cleanup (not running in CI)')
    return
  }

  logger.substep('Freeing disk space')

  try {
    const { platform } = process

    // Check disk space before cleanup
    if (WIN32) {
      // Windows: Use fsutil to check disk space
      try {
        const result = await spawn('fsutil', ['volume', 'diskfree', 'C:'], {
          shell: WIN32,
          stdio: 'pipe',
        })
        logger.info('Disk space before cleanup:')
        logger.info(result.stdout?.trim() || '')
      } catch {
        logger.warn('Could not check disk space')
      }
    } else {
      // Unix (Linux/macOS): Use df
      const dfBefore = await spawn('df', ['-h', '/'], { stdio: 'pipe' })
      logger.info('Disk space before cleanup:')
      logger.info(dfBefore.stdout?.trim() || '')
    }

    // Get cleanup paths from centralized configuration
    const cleanupTasks = getCleanupPaths(platform)

    if (platform === 'linux') {
      // Linux-specific cleanup (~10GB total)
      // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
      for (const { desc, path: targetPath } of cleanupTasks) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await spawn('sudo', ['rm', '-rf', targetPath], { stdio: 'inherit' })
          logger.success(`Removed ${desc}`)
        } catch (e) {
          logger.warn(`Could not remove ${targetPath}: ${errorMessage(e)}`)
        }
      }

      // Clean apt cache
      try {
        await spawn('sudo', ['apt-get', 'clean'], { stdio: 'inherit' })
        logger.success('Cleaned apt cache')
      } catch (e) {
        logger.warn(`Could not clean apt cache: ${errorMessage(e)}`)
      }
    } else if (platform === 'darwin') {
      // macOS-specific cleanup (~20GB total)
      // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
      for (const { desc, path: targetPath } of cleanupTasks) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await spawn('sudo', ['rm', '-rf', targetPath], { stdio: 'inherit' })
          logger.success(`Removed ${desc}`)
        } catch (e) {
          logger.warn(`Could not remove ${targetPath}: ${errorMessage(e)}`)
        }
      }

      // Clean Homebrew cache
      try {
        await spawn('brew', ['cleanup', '-s'], { stdio: 'inherit' })
        logger.success('Cleaned Homebrew cache')
      } catch (e) {
        logger.warn(`Could not clean Homebrew cache: ${errorMessage(e)}`)
      }
    } else if (WIN32) {
      // Windows-specific cleanup (~15GB total)
      // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
      for (const { desc, path: targetPath } of cleanupTasks) {
        try {
          // Windows: Use rmdir or Remove-Item
          // eslint-disable-next-line no-await-in-loop
          await spawn(
            'powershell',
            [
              '-Command',
              `if (Test-Path '${targetPath}') { Remove-Item -Path '${targetPath}' -Recurse -Force -ErrorAction SilentlyContinue }`,
            ],
            { stdio: 'inherit' },
          )
          logger.success(`Removed ${desc}`)
        } catch (e) {
          logger.warn(`Could not remove ${targetPath}: ${errorMessage(e)}`)
        }
      }
    }

    // Remove docker images (cross-platform)
    try {
      await spawn('docker', ['image', 'prune', '--all', '--force'], {
        shell: WIN32,
        stdio: 'inherit',
      })
      logger.success('Cleaned Docker images')
    } catch (e) {
      // Docker might not be available on all platforms/configs
      logger.warn(`Could not clean Docker images: ${errorMessage(e)}`)
    }

    // Check disk space after cleanup
    if (WIN32) {
      try {
        const result = await spawn('fsutil', ['volume', 'diskfree', 'C:'], {
          stdio: 'pipe',
        })
        logger.info('Disk space after cleanup:')
        logger.info(result.stdout?.trim() || '')
      } catch {
        logger.warn('Could not check disk space')
      }
    } else {
      const dfAfter = await spawn('df', ['-h', '/'], { stdio: 'pipe' })
      logger.info('Disk space after cleanup:')
      logger.info(dfAfter.stdout?.trim() || '')
    }
  } catch (e) {
    logger.warn(`Disk space cleanup encountered errors: ${errorMessage(e)}`)
  }
}
