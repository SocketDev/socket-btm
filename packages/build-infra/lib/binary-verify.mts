/**
 * Non-native binary verification.
 *
 * Verification paths for binaries the host cannot execute directly: static
 * inspection via the `file` command, and functional testing inside an Alpine
 * container for musl builds. Strategy selection lives in
 * smoke-test-strategy.mts.
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import platformPkg from '@socketsecurity/lib-stable/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import spawnPkg from '@socketsecurity/lib-stable/process/spawn/child'

import { printError } from './build-output.mts'

const { WIN32 } = platformPkg
const { spawn } = spawnPkg

const logger = getDefaultLogger()

/**
 * Options for {@link staticVerifyBinary}.
 */
export interface StaticVerifyBinaryOptions {
  /**
   * Expected architecture (arm64/x64).
   */
  arch?: string | undefined
  /**
   * Target platform (darwin/linux/win32).
   */
  platform?: string | undefined
  /**
   * Expect static linking.
   */
  static?: boolean | undefined
}

/**
 * Options for {@link testBinaryWithDocker}.
 */
export interface DockerBinaryTestOptions {
  /**
   * Expected architecture (arm64/x64).
   */
  expectedArch?: string | undefined
}

/**
 * Perform static verification on a binary (for cross-compiled builds).
 *
 * Verifies:
 * 1. Binary is not empty
 * 2. Correct architecture (if cross-compiled)
 * 3. Valid binary format (Mach-O/ELF/PE)
 * 4. Static linking (for musl builds)
 */
export async function staticVerifyBinary(
  binaryPath: string,
  options: StaticVerifyBinaryOptions = {},
): Promise<boolean> {
  const opts = { __proto__: null, ...options } as StaticVerifyBinaryOptions
  const { arch } = opts
  const targetPlatform = opts.platform || os.platform()
  const expectStatic = opts.static

  logger.substep('Performing static verification (cross-compiled binary)')

  try {
    // oxlint-disable-next-line socket/prefer-exists-sync -- need stats.size to reject 0-byte cross-compiled artifacts the linker may have silently emitted.
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
      const archPatterns: Partial<Record<string, RegExp>> = {
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

    // Verify binary format by target platform (not host — supports cross-compilation).
    const formatChecks: Partial<
      Record<string, { format: string | string[]; name: string }>
    > = {
      darwin: { format: 'Mach-O', name: 'Mach-O' },
      linux: { format: 'ELF', name: 'ELF' },
      win32: { format: ['PE32', 'MS Windows'], name: 'PE' },
    }

    const check = formatChecks[targetPlatform]
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
      if (targetPlatform === 'linux' && expectStatic) {
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
 */
export async function testBinaryWithDocker(
  binaryPath: string,
  options: DockerBinaryTestOptions = {},
): Promise<boolean> {
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
        // Argument string passed to the node-smol binary under test;
        // the console.log runs *inside* that smoke-test child
        // process, not in this build helper.
        "console.log('Hello from node-smol')", // socket-hook: allow console
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
