/**
 * Binary smoke-test execution.
 *
 * Runs built binaries (natively or under QEMU/Rosetta emulation) and checks
 * the results. Strategy selection lives in smoke-test-strategy.mts; the
 * non-executable verification paths live in binary-verify.mts.
 */

import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import platformPkg from '@socketsecurity/lib-stable/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import spawnPkg from '@socketsecurity/lib-stable/process/spawn/child'
import { isSpawnError } from '@socketsecurity/lib-stable/process/spawn/errors'
import { detectLibc } from '@socketsecurity/lib-stable/releases/socket-btm'

import { staticVerifyBinary, testBinaryWithDocker } from './binary-verify.mts'
import { printError } from './build-output.mts'
import { errorMessage } from './error-utils.mts'
import { adHocSign } from './sign.mts'
import {
  isCrossCompiled,
  isDockerAvailable,
  isNodeV24WindowsStackBufferOverrunBug,
  isQemuAvailable,
  isRosettaAvailable,
  isSelfExtractingBinary,
  selectCrossCompileSmokeTestStrategy,
} from './smoke-test-strategy.mts'

const { WIN32, getArch } = platformPkg
const { spawn } = spawnPkg

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEST_FIXTURES_DIR = path.join(__dirname, '..', 'test', 'fixtures')

// Default timeout for smoke tests (30 seconds)
const SMOKE_TEST_TIMEOUT_MS = 30_000

/**
 * The spawn-result shape {@link checkSpawnResult} inspects. Matches the
 * awaited lib-stable spawn result, plus the legacy `error` field older
 * promise-spawn results carried.
 */
export interface BinaryTestSpawnResult {
  code?: number | undefined
  error?: unknown | undefined
  stderr?: string | Buffer | undefined
  stdout?: string | Buffer | undefined
}

/**
 * Options for {@link smokeTestBinary}.
 */
export interface SmokeTestBinaryOptions {
  /**
   * Target architecture (defaults to host via getArch()).
   */
  arch?: string | undefined
  /**
   * Arguments to pass (defaults to comprehensive tests).
   */
  args?: string[] | undefined
  /**
   * C library variant ('musl' or 'glibc', auto-detected via detectLibc()).
   */
  libc?: string | undefined
  /**
   * Target platform (darwin/linux/win32).
   */
  platform?: string | undefined
}

/**
 * Helper to check spawn result for errors.
 */
export function checkSpawnResult(
  result: BinaryTestSpawnResult,
  testName: string,
  binaryPath: string,
): boolean {
  if (result.error) {
    printError(
      `Binary ${testName} error: ${errorMessage(result.error)}`,
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
 * Run a single binary test with args.
 */
export async function runBinaryTest(
  binaryPath: string,
  args: string[],
  testName: string,
): Promise<boolean> {
  try {
    // Normalize path on Windows
    const execPath = WIN32 ? path.win32.normalize(binaryPath) : binaryPath
    logger.log(`  Executing: ${execPath} ${args.join(' ')}`)

    // Enable debug output for self-extracting binaries to help diagnose hangs
    const env = { ...process.env }
    if (isSelfExtractingBinary(binaryPath)) {
      env['SOCKET_SMOL_DEBUG'] = '1'
    }

    const result = await spawn(execPath, args, {
      // Use 'ignore' for stdin to prevent binary from waiting for input
      // Use 'pipe' for stdout/stderr to capture output
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: SMOKE_TEST_TIMEOUT_MS,
    })
    return checkSpawnResult(result, testName, binaryPath)
  } catch (e) {
    const execPath = WIN32 ? path.win32.normalize(binaryPath) : binaryPath
    const spawnErr = isSpawnError(e) ? e : undefined

    // Check for timeout (SIGTERM from timeout option)
    if (spawnErr?.signal === 'SIGTERM') {
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
    if (
      spawnErr &&
      isNodeV24WindowsStackBufferOverrunBug(spawnErr.code, spawnErr.stdout)
    ) {
      logger.warn(
        `Binary ${testName} exited with code ${spawnErr.code} (Node.js v24 Windows bug) but produced output - treating as success`,
      )
      return true
    }

    logger.error(
      `Binary ${testName} error: ${errorMessage(e) || 'command failed'}`,
    )
    logger.error(`  Command: ${execPath} ${args.join(' ')}`)
    logger.error(`  Error code: ${spawnErr?.code || 'unknown'}`)
    logger.error(`  Signal: ${spawnErr?.signal || 'none'}`)
    if (spawnErr?.stdout) {
      logger.error(`  stdout: ${spawnErr.stdout.toString()}`)
    }
    if (spawnErr?.stderr) {
      logger.error(`  stderr: ${spawnErr.stderr.toString()}`)
    }
    return false
  }
}

/**
 * Execute a darwin-x64 binary under Rosetta 2 on a darwin-arm64 host — the
 * darwin sibling of runBinaryTest's native execution and the QEMU branch's
 * emulated execution. `arch -x86_64` runs the binary through Rosetta rather
 * than the arm64 host's native execve path, which would otherwise reject a
 * cross-compiled darwin-x64 binary outright (the nodejs/node#59553 class of
 * bug: a cross-compiled SEA binary that's never actually executed in CI).
 * Runs a single `--version` check rather than the full battery
 * runBinaryTest's native path runs — Rosetta execution is a slower, best-
 * effort smoke, not the primary correctness gate for this architecture.
 */
export async function runRosettaBinaryTest(
  binaryPath: string,
): Promise<boolean> {
  const testName = 'Version check (Rosetta)'
  try {
    logger.log(`  Executing: arch -x86_64 ${binaryPath} --version`)
    const result = await spawn('arch', ['-x86_64', binaryPath, '--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: SMOKE_TEST_TIMEOUT_MS,
    })
    return checkSpawnResult(result, testName, binaryPath)
  } catch (e) {
    logger.error(
      `Binary ${testName} error: ${errorMessage(e) || 'command failed'}`,
    )
    return false
  }
}

/**
 * Smoke test a binary - deterministic, no automatic fallbacks.
 *
 * Test strategy is determined explicitly:
 * - Native binaries: Execute directly (must succeed)
 * - Cross-compiled with Docker: Use Docker (must succeed)
 * - Cross-compiled with QEMU: Use QEMU (must succeed)
 * - Cross-compiled, no emulation: Static verification only.
 *
 * Functional tests (when executable):
 * 1. Version check: Verify binary executes and reports version
 * 2. JavaScript execution: Verify V8 can execute code
 * 3. Built-in modules: Verify core modules load correctly.
 *
 * Static verification (when not executable):
 * 1. Binary size check
 * 2. Architecture verification
 * 3. Binary format validation
 * 4. Static linking check (musl)
 */
export async function smokeTestBinary(
  binaryPath: string,
  options: SmokeTestBinaryOptions = {},
): Promise<boolean> {
  const { args } = { __proto__: null, ...options } as SmokeTestBinaryOptions

  // Sign binary first if on macOS (required for execution)
  await adHocSign(binaryPath)

  logger.substep(`Smoke testing ${path.basename(binaryPath)}`)

  try {
    if (!existsSync(binaryPath)) {
      throw new Error(`Binary not found: ${binaryPath}`)
    }

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
        logger.log('  Using static verification instead…')
        logger.log('')
        return staticVerifyBinary(binaryPath, {
          arch: options.arch,
          platform: options.platform,
        })
      }

      logger.log('  Native binary detected - testing execution…')
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

      // Comprehensive Temporal API smoke test. Lives in its own fixture
      // so a Temporal regression doesn't cascade-mask other module
      // failures. Exercises every type / method / toString round-trip.
      const temporalTestFile = path.join(
        TEST_FIXTURES_DIR,
        'smoke-test-temporal.mjs',
      )
      if (
        !(await runBinaryTest(binaryPath, [temporalTestFile], 'Temporal API'))
      ) {
        return false
      }

      logger.success('All functional tests passed')
      return true
    }

    // Cross-compiled binaries: determine test method
    logger.log('  Cross-compiled binary detected')

    // Use explicit libc option, detect from path, or auto-detect from system
    const libc =
      options.libc ||
      (binaryPath.includes('musl') ? 'musl' : undefined) ||
      detectLibc() ||
      'glibc'
    const isMusl = libc === 'musl'
    const { arch: targetArch } = options

    // Only probe the tool a given (host, target) combination could actually
    // use — an idle `which qemu-aarch64-static` on a musl build, or an
    // `arch -x86_64 /usr/bin/true` on Linux, wastes a spawn for a strategy
    // selectCrossCompileSmokeTestStrategy will never pick anyway.
    const [hasDocker, hasQemu, hasRosetta] = await Promise.all([
      hostPlatform === 'linux' && isMusl
        ? isDockerAvailable()
        : Promise.resolve(false),
      hostPlatform === 'linux' && hostArch === 'x64' && targetArch === 'arm64'
        ? isQemuAvailable('arm64')
        : Promise.resolve(false),
      hostPlatform === 'darwin' && hostArch === 'arm64' && targetArch === 'x64'
        ? isRosettaAvailable()
        : Promise.resolve(false),
    ])

    const strategy = selectCrossCompileSmokeTestStrategy({
      hasDocker,
      hasQemu,
      hasRosetta,
      hostArch,
      hostPlatform,
      isMusl,
      targetArch,
    })

    if (strategy === 'docker-musl') {
      logger.log('  Using Docker for musl binary testing…')
      logger.log('')
      return testBinaryWithDocker(binaryPath, { expectedArch: options.arch })
    }

    if (strategy === 'docker-static') {
      logger.log('  Docker not available - using static verification…')
      logger.log('')
      return staticVerifyBinary(binaryPath, {
        arch: options.arch,
        platform: options.platform,
        static: true,
      })
    }

    if (strategy === 'qemu-arm64') {
      logger.log('  Using QEMU for ARM64 binary testing…')
      logger.log('')

      // If legacy mode with custom args, run test and return
      if (args) {
        return runBinaryTest(binaryPath, args, 'execution')
      }

      // Comprehensive mode: run all tests via QEMU
      if (!(await runBinaryTest(binaryPath, ['--version'], 'Version check'))) {
        return false
      }

      // Test JavaScript execution. Use single quotes to avoid
      // escaping issues with windowsVerbatimArguments. The
      // console.log runs *inside* the spawned binary under test,
      // not in this build helper.
      const jsCode = "console.log('Hello from node-smol')" // socket-hook: allow console
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

    if (strategy === 'qemu-static') {
      logger.log('  QEMU not available - using static verification…')
      logger.log('')
      return staticVerifyBinary(binaryPath, {
        arch: options.arch,
        platform: options.platform,
      })
    }

    if (strategy === 'rosetta-darwin-x64') {
      logger.log('  Using Rosetta 2 for darwin-x64 binary testing…')
      logger.log('')
      return runRosettaBinaryTest(binaryPath)
    }

    if (strategy === 'rosetta-static') {
      logger.log('  Rosetta 2 not available - using static verification…')
      logger.log('')
      return staticVerifyBinary(binaryPath, {
        arch: options.arch,
        platform: options.platform,
      })
    }

    // No emulation available for this cross-compile scenario
    logger.log('  No emulation available - using static verification…')
    logger.log('')
    return staticVerifyBinary(binaryPath, {
      arch: options.arch,
      platform: options.platform,
    })
  } catch (e) {
    printError(`Binary smoke test failed: ${binaryPath}`, e)
    return false
  }
}
