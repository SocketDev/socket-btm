/**
 * Build Helper Utilities
 *
 * Provides utilities for checking prerequisites, validating environment,
 * and testing built binaries.
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import binPkg, { which } from '@socketsecurity/lib/bin'
import platformPkg from '@socketsecurity/lib/constants/platform'
import { getCI } from '@socketsecurity/lib/env/ci'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { detectLibc } from '@socketsecurity/lib/releases/socket-btm'
import spawnPkg from '@socketsecurity/lib/spawn'

import { printError } from './build-output.mjs'
import { getCleanupPaths } from './ci-cleanup-paths.mjs'
import { BYTES } from './constants.mjs'
import { getMinPythonVersion } from './version-helpers.mjs'

const { whichSync } = binPkg
const { WIN32, getArch } = platformPkg
const { spawn } = spawnPkg

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEST_FIXTURES_DIR = path.join(__dirname, '..', 'test-fixtures')

// Windows Node.js v24 bug: exit code 3221226505 (0xC0000409 STATUS_STACK_BUFFER_OVERRUN)
// See: https://github.com/nodejs/corepack/issues/715
const NODE_V24_WINDOWS_BUG_EXIT_CODE = 3_221_226_505

/**
 * Helper to check spawn result for errors.
 *
 * @param {object} result - Spawn result
 * @param {string} testName - Name of test (for error messages)
 * @param {string} binaryPath - Path to binary
 * @returns {boolean} True if passed, false if failed
 */
function checkSpawnResult(result, testName, binaryPath) {
  if (result.error) {
    printError(
      `Binary ${testName} error: ${result.error.message}`,
      result.error,
    )
    return false
  }

  const exitCode = result.code ?? 0
  if (exitCode !== 0) {
    if (isNodeV24WindowsStackBufferOverrunBug(exitCode, result.stdout)) {
      logger.warn(
        `Binary ${testName} exited with code ${exitCode} (Node.js v24 Windows bug) but produced output - treating as success`,
      )
      return true
    }

    printError(`Binary failed smoke test (${testName}): ${binaryPath}`)
    return false
  }

  return true
}

/**
 * Checks if we're testing a cross-compiled binary.
 *
 * @param {object} options - Options object
 * @param {string} hostArch - Host architecture
 * @returns {boolean} True if cross-compiled
 */
function isCrossCompiled(options, hostArch) {
  const { arch = getArch() } = { __proto__: null, ...options }
  return arch !== hostArch
}

/**
 * Check if Docker is available for musl testing.
 *
 * @returns {Promise<boolean>}
 */
async function isDockerAvailable() {
  try {
    const result = await spawn('docker', ['--version'], {
      shell: WIN32,
      stdio: 'pipe',
    })
    return result.code === 0
  } catch {
    return false
  }
}

/**
 * Check if a binary is a self-extracting compressed binary.
 *
 * The Final binary is a copy of the Compressed binary, so we check for both.
 *
 * @param {string} binaryPath - Path to binary
 * @returns {boolean}
 */
function isSelfExtractingBinary(binaryPath) {
  // Check if path contains 'Compressed' or 'Final' directory (Final is a copy of Compressed)
  return /[/\\](?:Compressed|Final)[/\\]/i.test(binaryPath)
}

/**
 * Check if exit code matches the known Node.js v24 Windows stack buffer overrun bug.
 * This bug causes node.exe to exit with STATUS_STACK_BUFFER_OVERRUN even when
 * the binary executes successfully. If stdout has valid output, treat as success.
 *
 * @param {number} exitCode - Process exit code
 * @param {Buffer|string} stdout - Process stdout
 * @returns {boolean} True if this matches the Node.js v24 Windows bug pattern
 */
function isNodeV24WindowsStackBufferOverrunBug(exitCode, stdout) {
  return (
    WIN32 &&
    exitCode === NODE_V24_WINDOWS_BUG_EXIT_CODE &&
    stdout?.toString().trim()
  )
}

/**
 * Check if QEMU user-mode emulation is available for cross-arch testing.
 *
 * @param {string} arch - Target architecture (arm64/x64)
 * @returns {Promise<boolean>}
 */
async function isQemuAvailable(arch) {
  try {
    const qemuBinary =
      arch === 'arm64' ? 'qemu-aarch64-static' : 'qemu-x86_64-static'
    const result = await spawn('which', [qemuBinary], {
      shell: WIN32,
      stdio: 'pipe',
    })
    return result.code === 0
  } catch {
    return false
  }
}

// Default timeout for smoke tests (30 seconds)
const SMOKE_TEST_TIMEOUT_MS = 30_000

/**
 * Run a single binary test with args.
 *
 * @param {string} binaryPath - Path to binary
 * @param {string[]} args - Arguments to pass
 * @param {string} testName - Name of test (for error messages)
 * @returns {Promise<boolean>} True if passed
 */
async function runBinaryTest(binaryPath, args, testName) {
  try {
    // Normalize path on Windows
    const execPath = WIN32 ? path.win32.normalize(binaryPath) : binaryPath
    logger.log(`  Executing: ${execPath} ${args.join(' ')}`)

    // Enable debug output for self-extracting binaries to help diagnose hangs
    const env = { ...process.env }
    if (isSelfExtractingBinary(binaryPath)) {
      env.SOCKET_SMOL_DEBUG = '1'
    }

    const result = await spawn(execPath, args, {
      // Use 'ignore' for stdin to prevent binary from waiting for input
      // Use 'pipe' for stdout/stderr to capture output
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: SMOKE_TEST_TIMEOUT_MS,
      env,
    })
    return checkSpawnResult(result, testName, binaryPath)
  } catch (error) {
    const execPath = WIN32 ? path.win32.normalize(binaryPath) : binaryPath

    // Check for timeout (SIGTERM from timeout option)
    if (error.signal === 'SIGTERM') {
      logger.error(
        `Binary ${testName} timed out after ${SMOKE_TEST_TIMEOUT_MS / 1000}s`,
      )
      logger.error(`  Command: ${execPath} ${args.join(' ')}`)
      logger.error(
        '  The binary may be hanging during startup or self-extraction',
      )
      return false
    }

    // Check for Windows Node.js v24 stack buffer overrun bug
    // The spawn throws an error, but if stdout has output, it actually worked
    if (isNodeV24WindowsStackBufferOverrunBug(error.code, error.stdout)) {
      logger.warn(
        `Binary ${testName} exited with code ${error.code} (Node.js v24 Windows bug) but produced output - treating as success`,
      )
      return true
    }

    logger.error(
      `Binary ${testName} error: ${error.message || 'command failed'}`,
    )
    logger.error(`  Command: ${execPath} ${args.join(' ')}`)
    logger.error(`  Error code: ${error.code || 'unknown'}`)
    logger.error(`  Signal: ${error.signal || 'none'}`)
    if (error.stdout) {
      logger.error(`  stdout: ${error.stdout.toString()}`)
    }
    if (error.stderr) {
      logger.error(`  stderr: ${error.stderr.toString()}`)
    }
    return false
  }
}

/**
 * Perform static verification on a binary (for cross-compiled builds).
 *
 * Verifies:
 * 1. Binary is not empty
 * 2. Correct architecture (if cross-compiled)
 * 3. Valid binary format (Mach-O/ELF/PE)
 * 4. Static linking (for musl builds)
 *
 * @param {string} binaryPath - Path to binary
 * @param {object} options - Verification options
 * @param {string} [options.arch] - Expected architecture (arm64/x64)
 * @param {boolean} [options.static] - Expect static linking
 * @returns {Promise<boolean>}
 */
async function staticVerifyBinary(binaryPath, options = {}) {
  const opts = { __proto__: null, ...options }
  const arch = opts.arch
  const expectStatic = opts.static

  logger.substep('Performing static verification (cross-compiled binary)')

  try {
    // Verify file is not empty
    const stats = await fs.stat(binaryPath)
    if (stats.size === 0) {
      printError('Binary is empty')
      return false
    }
    logger.success(`Binary size: ${stats.size} bytes`)

    // Get file info using `file` command (may not be available on all platforms)
    let fileInfo = ''
    try {
      const fileResult = await spawn('file', [binaryPath], {
        shell: WIN32,
        stdio: 'pipe',
      })

      if (fileResult.code !== 0) {
        logger.warn('Could not run file command, skipping format checks')
        return true
      }

      fileInfo = fileResult.stdout?.toString() || ''
      logger.log(`  Binary info: ${fileInfo.trim()}`)
    } catch {
      // file command not available (e.g., Windows without Git Bash tools)
      logger.warn('file command not available, skipping format checks')
      logger.success('Static verification passed (basic checks only)')
      return true
    }

    // Verify architecture if specified
    if (arch) {
      const archPatterns = {
        arm64: /arm64|aarch64/i,
        x64: /x86[-_]64|x64|amd64/i,
      }

      const pattern = archPatterns[arch]
      if (pattern && !pattern.test(fileInfo)) {
        printError(`Expected ${arch} architecture but got: ${fileInfo}`)
        return false
      }
      logger.success(`Confirmed ${arch} architecture`)
    }

    // Verify binary format by platform
    const hostPlatform = os.platform()
    const formatChecks = {
      darwin: { format: 'Mach-O', name: 'Mach-O' },
      linux: { format: 'ELF', name: 'ELF' },
      win32: { format: ['PE32', 'MS Windows'], name: 'PE' },
    }

    const check = formatChecks[hostPlatform]
    if (check) {
      const formats = Array.isArray(check.format)
        ? check.format
        : [check.format]
      const hasValidFormat = formats.some(fmt => fileInfo.includes(fmt))

      if (!hasValidFormat) {
        printError(`Expected ${check.name} binary but got: ${fileInfo}`)
        return false
      }
      logger.success(`Valid ${check.name} binary`)

      // Check static linking for musl (Linux only)
      if (hostPlatform === 'linux' && expectStatic) {
        if (fileInfo.includes('statically linked')) {
          logger.success('Binary is statically linked (musl)')
        } else {
          logger.warn('Binary may not be statically linked')
        }
      }
    }

    logger.success('Static verification passed')
    return true
  } catch (e) {
    printError('Static verification failed', e)
    return false
  }
}

/**
 * Test binary using Docker (for musl builds).
 *
 * @param {string} binaryPath - Path to binary
 * @param {object} options - Test options
 * @param {string} options.expectedArch - Expected architecture
 * @returns {Promise<boolean>}
 */
async function testBinaryWithDocker(binaryPath, options = {}) {
  const { expectedArch = 'x64' } = options
  const dockerArch = expectedArch === 'arm64' ? 'linux/arm64' : 'linux/amd64'

  logger.substep('Testing musl binary in Alpine container (Docker)')

  try {
    // Test 1: Version check
    let result = await spawn(
      'docker',
      [
        'run',
        '--rm',
        '--platform',
        dockerArch,
        '-v',
        `${path.dirname(binaryPath)}:/test`,
        'alpine:latest',
        `/test/${path.basename(binaryPath)}`,
        '--version',
      ],
      {
        shell: WIN32,
        stdio: 'pipe',
      },
    )

    if (result.code !== 0) {
      printError('Docker test failed (version check)')
      return false
    }

    // Test 2: JavaScript execution
    result = await spawn(
      'docker',
      [
        'run',
        '--rm',
        '--platform',
        dockerArch,
        '-v',
        `${path.dirname(binaryPath)}:/test`,
        'alpine:latest',
        `/test/${path.basename(binaryPath)}`,
        '-e',
        "console.log('Hello from node-smol')",
      ],
      {
        shell: WIN32,
        stdio: 'pipe',
      },
    )

    if (result.code !== 0) {
      printError('Docker test failed (JavaScript execution)')
      return false
    }

    // Test 3: Built-in modules
    result = await spawn(
      'docker',
      [
        'run',
        '--rm',
        '--platform',
        dockerArch,
        '-v',
        `${path.dirname(binaryPath)}:/test`,
        'alpine:latest',
        `/test/${path.basename(binaryPath)}`,
        '-e',
        "require('fs'); require('path'); require('os')",
      ],
      {
        shell: WIN32,
        stdio: 'pipe',
      },
    )

    if (result.code !== 0) {
      printError('Docker test failed (built-in modules)')
      return false
    }

    logger.success('All Docker tests passed (Alpine/musl)')
    return true
  } catch (e) {
    printError('Docker test failed', e)
    return false
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
 * Check available disk space.
 *
 * @param {string} dir - Directory to check
 * @param {number} [requiredGB=5] - Required GB (defaults to 5GB)
 * @returns {Promise<{availableGB: number|undefined, sufficient: boolean}>}
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
        statusCode: statusCode === '200' ? '200' : undefined,
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
    return { connected: false, statusCode: undefined }
  }
}

/**
 * Check Python version.
 *
 * @param {string} [minVersion] - Minimum required version (defaults to external-tools.json minimumVersion)
 * @returns {Promise<{available: boolean, sufficient: boolean, version: string|undefined}>}
 */
export async function checkPythonVersion(minVersion) {
  // Use single source of truth from external-tools.json if no version specified
  const effectiveMinVersion = minVersion ?? getMinPythonVersion()
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

      const [major, minor] = version.split('.').map(Number)
      const [minMajor, minMinor] = effectiveMinVersion.split('.').map(Number)

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
    version: undefined,
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
 * Execute command using spawn.
 *
 * @param {string} command - Command to execute
 * @param {string[]} args - Command arguments
 * @param {object} options - Spawn options
 * @returns {Promise<object>} Spawn result
 */
export async function exec(command, args = [], options = {}) {
  const spawnOptions = {
    ...options,
  }
  // Only set stdio to 'inherit' if encoding is not specified (which requires capturing output)
  if (!spawnOptions.encoding) {
    spawnOptions.stdio = 'inherit'
  }
  const result = await spawn(
    Array.isArray(args) ? command : `${command} ${args}`,
    Array.isArray(args) ? args : [],
    spawnOptions,
  )
  if (result.code !== 0) {
    throw new Error(`Command failed with exit code ${result.code}: ${command}`)
  }
  return result
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

    // Get cleanup paths from centralized configuration
    const cleanupTasks = getCleanupPaths(platform)

    if (platform === 'linux') {
      // Linux-specific cleanup (~10GB total)
      for (const { desc, path: targetPath } of cleanupTasks) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await spawn('sudo', ['rm', '-rf', targetPath], { stdio: 'inherit' })
          logger.success(`Removed ${desc}`)
        } catch (error) {
          logger.warn(`Could not remove ${targetPath}: ${error.message}`)
        }
      }

      // Clean apt cache
      try {
        await spawn('sudo', ['apt-get', 'clean'], { stdio: 'inherit' })
        logger.success('Cleaned apt cache')
      } catch (error) {
        logger.warn(`Could not clean apt cache: ${error.message}`)
      }
    } else if (platform === 'darwin') {
      // macOS-specific cleanup (~20GB total)
      for (const { desc, path: targetPath } of cleanupTasks) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await spawn('sudo', ['rm', '-rf', targetPath], { stdio: 'inherit' })
          logger.success(`Removed ${desc}`)
        } catch (error) {
          logger.warn(`Could not remove ${targetPath}: ${error.message}`)
        }
      }

      // Clean Homebrew cache
      try {
        await spawn('brew', ['cleanup', '-s'], { stdio: 'inherit' })
        logger.success('Cleaned Homebrew cache')
      } catch (error) {
        logger.warn(`Could not clean Homebrew cache: ${error.message}`)
      }
    } else if (WIN32) {
      // Windows-specific cleanup (~15GB total)
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
      logger.success('Cleaned Docker images')
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
 * Get build log path.
 *
 * @param {string} buildDir - Build directory
 * @returns {string} Log file path
 */
export function getBuildLogPath(buildDir) {
  return path.join(buildDir, 'build.log')
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

  if (bytes < BYTES.KB) {
    return `${bytes} B`
  }

  if (bytes < BYTES.MB) {
    return `${(bytes / BYTES.KB).toFixed(2)} KB`
  }

  if (bytes < BYTES.GB) {
    return `${(bytes / BYTES.MB).toFixed(2)} MB`
  }

  return `${(bytes / BYTES.GB).toFixed(2)} GB`
}

/**
 * Get last N lines from build log.
 *
 * @param {string} buildDir - Build directory
 * @param {number} lines - Number of lines to get
 * @returns {Promise<string|undefined>} Last lines or undefined
 */
export async function getLastLogLines(buildDir, lines = 50) {
  const logPath = getBuildLogPath(buildDir)
  try {
    const content = await fs.readFile(logPath, 'utf8')
    const allLines = content.split('\n')
    return allLines.slice(-lines).join('\n')
  } catch {
    return undefined
  }
}

/**
 * Read checkpoint.
 *
 * @param {string} buildDir - Build directory
 * @returns {Promise<object|undefined>} Checkpoint data or undefined
 */
export async function readCheckpoint(buildDir) {
  const checkpointFile = path.join(buildDir, 'build-checkpoint')
  try {
    const content = await fs.readFile(checkpointFile, 'utf8')
    return JSON.parse(content)
  } catch {
    return undefined
  }
}

/**
 * Clear the build log file (truncate to empty).
 * Call this at the start of each build to prevent log accumulation.
 *
 * @param {string} buildDir - Build directory
 * @returns {Promise<void>}
 */
export async function clearBuildLog(buildDir) {
  const logPath = getBuildLogPath(buildDir)
  try {
    await fs.writeFile(logPath, '')
  } catch {
    // Don't fail build if logging fails.
  }
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
 * Smoke test a binary - deterministic, no automatic fallbacks.
 *
 * Test strategy is determined explicitly:
 * - Native binaries: Execute directly (must succeed)
 * - Cross-compiled with Docker: Use Docker (must succeed)
 * - Cross-compiled with QEMU: Use QEMU (must succeed)
 * - Cross-compiled, no emulation: Static verification only
 *
 * Functional tests (when executable):
 * 1. Version check: Verify binary executes and reports version
 * 2. JavaScript execution: Verify V8 can execute code
 * 3. Built-in modules: Verify core modules load correctly
 *
 * Static verification (when not executable):
 * 1. Binary size check
 * 2. Architecture verification
 * 3. Binary format validation
 * 4. Static linking check (musl)
 *
 * @param {string} binaryPath - Path to binary
 * @param {object} [options] - Additional options
 * @param {string[]} [options.args] - Arguments to pass (defaults to comprehensive tests)
 * @param {string} [options.arch] - Target architecture (defaults to host via getArch())
 * @param {string} [options.libc] - C library variant ('musl' or 'glibc', auto-detected via detectLibc())
 * @returns {Promise<boolean>}
 */
export async function smokeTestBinary(binaryPath, options = {}) {
  const { args } = { __proto__: null, ...options }

  // Sign binary first if on macOS (required for execution)
  const { adHocSign } = await import('./sign.mjs')
  await adHocSign(binaryPath)

  logger.substep(`Smoke testing ${path.basename(binaryPath)}`)

  try {
    await fs.access(binaryPath)

    const hostPlatform = os.platform()
    const hostArch = getArch()
    const crossCompiled = isCrossCompiled(options, hostArch)

    // Native binaries: run directly
    if (!crossCompiled) {
      // Self-extracting binaries (compressed) on Windows may hang during extraction.
      // Fall back to static verification on Windows only.
      // Linux/macOS: Always execute the binary to catch runtime issues like segfaults.
      const isWindows = os.platform() === 'win32'
      if (isSelfExtractingBinary(binaryPath) && isWindows) {
        logger.log(
          '  Self-extracting binary detected (Windows PE stub may hang during extraction)',
        )
        logger.log('  Using static verification instead...')
        logger.log('')
        return staticVerifyBinary(binaryPath, { arch: options.arch })
      }

      logger.log('  Native binary detected - testing execution...')
      logger.log('')

      // If custom args provided, run single test (legacy behavior)
      if (args) {
        return runBinaryTest(binaryPath, args, 'execution')
      }

      // Comprehensive mode: run all three tests
      if (!(await runBinaryTest(binaryPath, ['--version'], 'Version check'))) {
        return false
      }

      // Test JavaScript execution using test fixture file
      // This avoids shell quoting issues on Windows
      const simpleTestFile = path.join(
        TEST_FIXTURES_DIR,
        'smoke-test-simple.mjs',
      )
      if (
        !(await runBinaryTest(
          binaryPath,
          [simpleTestFile],
          'JavaScript execution',
        ))
      ) {
        return false
      }

      // Test built-in modules using test fixture file
      const modulesTestFile = path.join(
        TEST_FIXTURES_DIR,
        'smoke-test-modules.mjs',
      )
      if (
        !(await runBinaryTest(
          binaryPath,
          [modulesTestFile],
          'Built-in modules',
        ))
      ) {
        return false
      }

      logger.success('All functional tests passed')
      return true
    }

    // Cross-compiled binaries: determine test method
    logger.log('  Cross-compiled binary detected')

    // Docker for musl builds (Linux only)
    // Use explicit libc option, detect from path, or auto-detect from system
    const libc =
      options.libc ||
      (binaryPath.includes('musl') ? 'musl' : undefined) ||
      detectLibc() ||
      'glibc'
    const isMusl = libc === 'musl'
    if (hostPlatform === 'linux' && isMusl) {
      const hasDocker = await isDockerAvailable()
      if (hasDocker) {
        logger.log('  Using Docker for musl binary testing...')
        logger.log('')
        return testBinaryWithDocker(binaryPath, options)
      }
      logger.log('  Docker not available - using static verification...')
      logger.log('')
      return staticVerifyBinary(binaryPath, {
        arch: options.arch,
        static: true,
      })
    }

    // QEMU for ARM64 binaries (Linux x64 -> arm64 only)
    const arch = options.arch
    const isLinuxArm64CrossCompile =
      hostPlatform === 'linux' && arch === 'arm64' && hostArch === 'x64'

    if (isLinuxArm64CrossCompile) {
      const hasQemu = await isQemuAvailable('arm64')
      if (hasQemu) {
        logger.log('  Using QEMU for ARM64 binary testing...')
        logger.log('')

        // If legacy mode with custom args, run test and return
        if (args) {
          return runBinaryTest(binaryPath, args, 'execution')
        }

        // Comprehensive mode: run all tests via QEMU
        if (
          !(await runBinaryTest(binaryPath, ['--version'], 'Version check'))
        ) {
          return false
        }

        // Test JavaScript execution
        // Use single quotes to avoid escaping issues with windowsVerbatimArguments
        const jsCode = "console.log('Hello from node-smol')"
        if (
          !(await runBinaryTest(
            binaryPath,
            ['-e', jsCode],
            'JavaScript execution',
          ))
        ) {
          return false
        }

        if (
          !(await runBinaryTest(
            binaryPath,
            ['-e', "require('fs'); require('path'); require('os')"],
            'Built-in modules',
          ))
        ) {
          return false
        }

        logger.success('All functional tests passed via QEMU')
        return true
      }

      logger.log('  QEMU not available - using static verification...')
      logger.log('')
      return staticVerifyBinary(binaryPath, { arch: options.arch })
    }

    // No emulation available for this cross-compile scenario
    logger.log('  No emulation available - using static verification...')
    logger.log('')
    return staticVerifyBinary(binaryPath, { arch: options.arch })
  } catch (e) {
    printError(`Binary smoke test failed: ${binaryPath}`, e)
    return false
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
