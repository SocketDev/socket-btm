/**
 * Build Helper Utilities
 *
 * Provides utilities for checking prerequisites, validating environment,
 * and testing built binaries.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

import binPkg, { which } from '@socketsecurity/lib/bin'
import platformPkg from '@socketsecurity/lib/constants/platform'
import { getCI } from '@socketsecurity/lib/env/ci'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import spawnPkg from '@socketsecurity/lib/spawn'

import { printError } from './build-output.mjs'

const { whichSync } = binPkg
const { WIN32 } = platformPkg
const { spawn } = spawnPkg

const logger = getDefaultLogger()

/**
 * Execute command using spawn.
 *
 * @param {string} command - Command to execute
 * @param {string[]} args - Command arguments
 * @param {object} options - Spawn options
 * @returns {Promise<object>} Spawn result
 */
export async function exec(command, args = [], options = {}) {
  const result = await spawn(
    Array.isArray(args) ? command : `${command} ${args}`,
    Array.isArray(args) ? args : [],
    {
      stdio: 'inherit',
      ...options,
    },
  )
  if (result.code !== 0) {
    throw new Error(`Command failed with exit code ${result.code}: ${command}`)
  }
  return result
}

/**
 * Check available disk space.
 *
 * @param {string} dir - Directory to check
 * @param {number} [requiredGB=5] - Required GB (defaults to 5GB)
 * @returns {Promise<{availableGB: number|null, sufficient: boolean}>}
 */
export async function checkDiskSpace(dir, requiredGB = 5) {
  logger.substep('Checking disk space')

  try {
    // Use Node.js built-in fs.statfs for cross-platform disk space check.
    // If directory doesn't exist yet, check parent or current directory.
    let checkDir = dir
    try {
      await fs.access(dir)
    } catch {
      // Directory doesn't exist - check parent directory.
      checkDir = path.dirname(dir)
    }

    const stats = await fs.statfs(checkDir)
    const availableBytes = stats.bavail * stats.bsize
    const availableGBValue = Number(
      (availableBytes / (1024 * 1024 * 1024)).toFixed(2),
    )
    const sufficient = availableGBValue >= requiredGB

    logger.info(`Available: ${availableGBValue} GB, Required: ${requiredGB} GB`)

    return {
      availableGB: availableGBValue,
      sufficient,
    }
  } catch {
    // Fallback to df command if fs.statfs fails (older Node versions).
    try {
      const dfPath = await which('df', { nothrow: true })
      if (!dfPath) {
        logger.warn('Could not check disk space (df not found)')
        return { availableGB: null, sufficient: true }
      }
      const result = await spawn(dfPath, ['-k', dir], {})
      const lines = (result.stdout ?? '').trim().split('\n')
      if (lines.length < 2) {
        logger.warn('Could not determine disk space')
        return { availableGB: null, sufficient: true }
      }

      const stats = lines[1].split(/\s+/)
      const availableKB = Number.parseInt(stats[3], 10)
      const availableBytes = availableKB * 1024
      const availableGBValue = Number(
        (availableBytes / (1024 * 1024 * 1024)).toFixed(2),
      )
      const sufficient = availableGBValue >= requiredGB

      logger.info(
        `Available: ${availableGBValue} GB, Required: ${requiredGB} GB`,
      )

      return {
        availableGB: availableGBValue,
        sufficient,
      }
    } catch {
      logger.warn('Could not check disk space')
      return { availableGB: null, sufficient: true }
    }
  }
}

/**
 * Free disk space by removing large unused packages.
 * Removes pre-installed packages on GitHub runners that are not needed.
 * Handles Linux, macOS, and Windows platforms.
 * Only runs in CI environments to avoid deleting packages on developer machines.
 *
 * @returns {Promise<void>}
 */
export async function freeDiskSpace() {
  // Only run in CI environments (GitHub Actions, GitLab CI, etc.)
  if (!getCI()) {
    logger.substep('Skipping disk space cleanup (not running in CI)')
    return
  }

  logger.substep('Freeing disk space')

  try {
    const platform = process.platform

    // Check disk space before cleanup
    if (WIN32) {
      // Windows: Use fsutil to check disk space
      try {
        const result = await spawn('fsutil', ['volume', 'diskfree', 'C:'], {
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

    if (platform === 'linux') {
      // Linux-specific cleanup (~10GB total)
      const linuxCleanupTasks = [
        { path: '/usr/share/dotnet', desc: '.NET SDK (~3GB)' },
        { path: '/usr/local/lib/android', desc: 'Android SDK (~4GB)' },
        { path: '/opt/ghc', desc: 'Haskell GHC (~1GB)' },
        { path: '/opt/hostedtoolcache/CodeQL', desc: 'CodeQL (~2GB)' },
        { path: '/usr/local/share/boost', desc: 'Boost (~1GB)' },
      ]

      for (const { desc, path: targetPath } of linuxCleanupTasks) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await spawn('sudo', ['rm', '-rf', targetPath], { stdio: 'inherit' })
          logger.info(`✓ Removed ${desc}`)
        } catch (error) {
          logger.warn(`Could not remove ${targetPath}: ${error.message}`)
        }
      }

      // Clean apt cache
      try {
        await spawn('sudo', ['apt-get', 'clean'], { stdio: 'inherit' })
        logger.info('✓ Cleaned apt cache')
      } catch (error) {
        logger.warn(`Could not clean apt cache: ${error.message}`)
      }
    } else if (platform === 'darwin') {
      // macOS-specific cleanup (~20GB total)
      const runnerHome = process.env.HOME || '/Users/runner'
      const macosCleanupTasks = [
        {
          path: `${runnerHome}/Library/Android/sdk`,
          desc: 'Android SDK (~10GB)',
        },
        { path: '/usr/local/share/dotnet', desc: '.NET SDK (~2GB)' },
        {
          path: '/Library/Developer/CoreSimulator/Profiles/Runtimes',
          desc: 'iOS Simulators (~5GB)',
        },
        { path: '/usr/local/share/boost', desc: 'Boost (~1GB)' },
        { path: '/opt/hostedtoolcache/CodeQL', desc: 'CodeQL (~2GB)' },
      ]

      for (const { desc, path: targetPath } of macosCleanupTasks) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await spawn('sudo', ['rm', '-rf', targetPath], { stdio: 'inherit' })
          logger.info(`✓ Removed ${desc}`)
        } catch (error) {
          logger.warn(`Could not remove ${targetPath}: ${error.message}`)
        }
      }

      // Clean Homebrew cache
      try {
        await spawn('brew', ['cleanup', '-s'], { stdio: 'inherit' })
        logger.info('✓ Cleaned Homebrew cache')
      } catch (error) {
        logger.warn(`Could not clean Homebrew cache: ${error.message}`)
      }
    } else if (WIN32) {
      // Windows-specific cleanup (~15GB total)
      const windowsCleanupTasks = [
        {
          path: 'C:\\Android',
          desc: 'Android SDK (~10GB)',
        },
        {
          path: 'C:\\Program Files\\dotnet',
          desc: '.NET SDK (~2GB)',
        },
        {
          path: 'C:\\hostedtoolcache\\windows\\CodeQL',
          desc: 'CodeQL (~2GB)',
        },
        {
          path: 'C:\\ProgramData\\chocolatey',
          desc: 'Chocolatey cache (~1GB)',
        },
      ]

      for (const { desc, path: targetPath } of windowsCleanupTasks) {
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
          logger.info(`✓ Removed ${desc}`)
        } catch (error) {
          logger.warn(`Could not remove ${targetPath}: ${error.message}`)
        }
      }
    }

    // Remove docker images (cross-platform)
    try {
      await spawn('docker', ['image', 'prune', '--all', '--force'], {
        stdio: 'inherit',
      })
      logger.info('✓ Cleaned Docker images')
    } catch (error) {
      // Docker might not be available on all platforms/configs
      logger.warn(`Could not clean Docker images: ${error.message}`)
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
  } catch (error) {
    logger.warn(`Disk space cleanup encountered errors: ${error.message}`)
  }
}

/**
 * Check if compiler is available.
 * Tries multiple compilers if none specified.
 *
 * @param {string|string[]} [compilers] - Compiler command(s) to check (e.g., 'clang++', ['clang++', 'g++', 'c++'])
 * @returns {Promise<{available: boolean, compiler: string|undefined}>}
 */
export async function checkCompiler(compilers) {
  const compilerList = Array.isArray(compilers)
    ? compilers
    : compilers
      ? [compilers]
      : ['clang++', 'g++', 'c++']

  for (const compiler of compilerList) {
    logger.substep(`Checking for ${compiler}`)

    const binPath = whichSync(compiler, { nothrow: true })
    if (binPath) {
      return { available: true, compiler }
    }
  }

  return { available: false, compiler: undefined }
}

/**
 * Check Python version.
 *
 * @param {string} [minVersion='3.6'] - Minimum required version (e.g., '3.8')
 * @returns {Promise<{available: boolean, sufficient: boolean, version: string|null}>}
 */
export async function checkPythonVersion(minVersion = '3.6') {
  logger.substep('Checking Python version')

  // Try multiple Python command names.
  // Use shell on all platforms to ensure PATH resolution works with setup-python.
  const pythonCommands = ['python3', 'python']

  for (const pythonCmd of pythonCommands) {
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
      if (!result || result.code === undefined || result.code === null) {
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

      const [major, minor] = version.split('.').map(Number)
      const [minMajor, minMinor] = minVersion.split('.').map(Number)

      const sufficient =
        major > minMajor || (major === minMajor && minor >= minMinor)

      return {
        available: true,
        sufficient,
        version,
      }
    } catch {}
  }

  // None of the Python commands worked.
  return {
    available: false,
    sufficient: false,
    version: null,
  }
}

/**
 * Estimate build time based on CPU cores.
 *
 * @param {number} baseMinutes - Base time in minutes (single core)
 * @param {number} cores - Number of CPU cores
 * @returns {number} Estimated minutes
 */
export function estimateBuildTime(baseMinutes, cores) {
  // Amdahl's law approximation: not all build steps parallelize perfectly.
  const parallelFraction = 0.8
  const serialFraction = 1 - parallelFraction

  return Math.ceil(baseMinutes * (serialFraction + parallelFraction / cores))
}

/**
 * Format duration in human-readable format.
 *
 * @param {number} milliseconds - Duration in milliseconds
 * @returns {string} Formatted duration
 */
export function formatDuration(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    const remainingMinutes = minutes % 60
    return `${hours}h ${remainingMinutes}m`
  }

  if (minutes > 0) {
    const remainingSeconds = seconds % 60
    return `${minutes}m ${remainingSeconds}s`
  }

  return `${seconds}s`
}

/**
 * Smoke test a binary by running it with args.
 *
 * @param {string} binaryPath - Path to binary
 * @param {string[]} args - Arguments to pass
 * @returns {Promise<boolean>}
 */
export async function smokeTestBinary(binaryPath, args = ['--version']) {
  logger.substep(`Smoke testing ${path.basename(binaryPath)}`)

  try {
    await fs.access(binaryPath)
    const result = await spawn(binaryPath, args, {
      shell: WIN32,
    })

    if ((result.code ?? 0) !== 0) {
      printError(`Binary failed smoke test: ${binaryPath}`)
      return false
    }

    return true
  } catch (e) {
    printError(`Binary smoke test failed: ${binaryPath}`, e)
    return false
  }
}

/**
 * Get file size in human-readable format.
 *
 * @param {string} filePath - Path to file
 * @returns {Promise<string>} Size string (e.g., '1.2 MB')
 */
export async function getFileSize(filePath) {
  const stats = await fs.stat(filePath)
  const bytes = stats.size

  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`
  }

  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }

  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/**
 * Get build log path.
 *
 * @param {string} buildDir - Build directory
 * @returns {string} Log file path
 */
export function getBuildLogPath(buildDir) {
  return path.join(buildDir, 'build.log')
}

/**
 * Save build output to log file.
 *
 * @param {string} buildDir - Build directory
 * @param {string} content - Content to log
 * @returns {Promise<void>}
 */
export async function saveBuildLog(buildDir, content) {
  const logPath = getBuildLogPath(buildDir)
  try {
    await fs.appendFile(logPath, `${content}\n`)
  } catch {
    // Don't fail build if logging fails.
  }
}

/**
 * Get last N lines from build log.
 *
 * @param {string} buildDir - Build directory
 * @param {number} lines - Number of lines to get
 * @returns {Promise<string|null>} Last lines or null
 */
export async function getLastLogLines(buildDir, lines = 50) {
  const logPath = getBuildLogPath(buildDir)
  try {
    const content = await fs.readFile(logPath, 'utf8')
    const allLines = content.split('\n')
    return allLines.slice(-lines).join('\n')
  } catch {
    return null
  }
}

/**
 * Read checkpoint.
 *
 * @param {string} buildDir - Build directory
 * @returns {Promise<object|null>} Checkpoint data or null
 */
export async function readCheckpoint(buildDir) {
  const checkpointFile = path.join(buildDir, 'build-checkpoint')
  try {
    const content = await fs.readFile(checkpointFile, 'utf8')
    return JSON.parse(content)
  } catch {
    return null
  }
}

/**
 * Check network connectivity.
 *
 * @returns {Promise<object>} Connection status
 */
export async function checkNetworkConnectivity() {
  try {
    // In CI, assume network connectivity is available.
    // The build will fail later if it's actually not available.
    if (process.env.CI) {
      return { connected: true, statusCode: 'skipped-in-ci' }
    }

    // Platform-specific network connectivity check.
    if (WIN32) {
      // Windows: Use PowerShell's Invoke-WebRequest.
      const result = await spawn(await which('powershell'), [
        '-NoProfile',
        '-Command',
        'try { $null = Invoke-WebRequest -Uri "https://github.com" -Method Head -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop; Write-Output "200" } catch { Write-Output "0" }',
      ])

      const statusCode = (result.stdout ?? '').trim()
      return {
        connected: statusCode === '200',
        statusCode: statusCode === '200' ? '200' : null,
      }
    }

    // Unix/Linux/macOS: Use curl.
    const result = await spawn(await which('curl'), [
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
    return { connected: false, statusCode: null }
  }
}

// Re-export workflow checkpoint functions from checkpoint-manager
// These provide GitHub Actions workflow checkpoint support with metadata
export {
  createCheckpoint,
  restoreCheckpoint,
  cleanCheckpoint,
  getCacheHashFile,
  needsCacheRebuild,
  writeCacheHash,
  getCacheHash,
} from './checkpoint-manager.mjs'
