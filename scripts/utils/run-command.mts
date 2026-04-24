/** @fileoverview Utility for running shell commands with proper error handling. */

import os from 'node:os'
import type { SpawnOptions, SpawnSyncOptions } from 'node:child_process'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn, spawnSync } from '@socketsecurity/lib/spawn'

// Initialize logger
const logger = getDefaultLogger()

type SpawnError = {
  code: number
  stderr: string
  stdout: string
}

type CommandDefinition = {
  args?: string[]
  command: string
  options?: SpawnOptions
}

type QuietCommandResult = {
  exitCode: number
  stderr: string
  stdout: string
}

/**
 * Run a command and return a promise that resolves with the exit code.
 * @param {string} command - The command to run
 * @param {string[]} args - Arguments to pass to the command
 * @param {object} options - Spawn options
 * @returns {Promise<number>} Exit code
 */
export async function runCommand(
  command: string,
  args: string[] = [],
  options: SpawnOptions = {},
): Promise<number> {
  try {
    const result = await spawn(command, args, {
      shell: WIN32,
      stdio: 'inherit',
      ...options,
    })
    return result.code
  } catch (e) {
    // spawn() from @socketsecurity/lib throws on non-zero exit
    // Return the exit code from the error
    if (
      e &&
      typeof e === 'object' &&
      'code' in e &&
      typeof (e as { code: unknown }).code === 'number'
    ) {
      return (e as { code: number }).code
    }
    throw e
  }
}

/**
 * Run a command synchronously.
 * @param {string} command - The command to run
 * @param {string[]} args - Arguments to pass to the command
 * @param {object} options - Spawn options
 * @returns {number} Exit code
 */
export function runCommandSync(
  command: string,
  args: string[] = [],
  options: SpawnSyncOptions = {},
): number {
  const result = spawnSync(command, args, {
    shell: WIN32,
    stdio: 'inherit',
    ...options,
  })
  // spawnSync returns status: null when the child was killed by a signal
  // (SIGTERM/SIGKILL/SIGINT). `|| 0` treated null as success, so a crashed
  // or OOM-killed subprocess was reported as a clean exit — callers would
  // press on with a failed build. Return 128+signal for signal-kill (POSIX
  // convention) and 1 for the null-without-signal edge case.
  if (result.status != null) {
    return result.status
  }
  if (result.signal) {
    const signalNum = os.constants.signals[result.signal]
    return signalNum ? 128 + signalNum : 1
  }
  return 1
}

/**
 * Run a pnpm script.
 * @param {string} scriptName - The pnpm script to run
 * @param {string[]} extraArgs - Additional arguments
 * @param {object} options - Spawn options
 * @returns {Promise<number>} Exit code
 */
export async function runPnpmScript(
  scriptName: string,
  extraArgs: string[] = [],
  options: SpawnOptions = {},
): Promise<number> {
  return runCommand('pnpm', ['run', scriptName, ...extraArgs], options)
}

/**
 * Run multiple commands in sequence, stopping on first failure.
 * @param {Array<{command: string, args?: string[], options?: object}>} commands
 * @returns {Promise<number>} Exit code of first failing command, or 0 if all succeed
 */
export async function runSequence(
  commands: CommandDefinition[],
): Promise<number> {
  for (const { args = [], command, options = {} } of commands) {
    const exitCode = await runCommand(command, args, options)
    if (exitCode !== 0) {
      return exitCode
    }
  }
  return 0
}

/**
 * Run multiple commands in parallel.
 * @param {Array<{command: string, args?: string[], options?: object}>} commands
 * @returns {Promise<number[]>} Array of exit codes
 */
export async function runParallel(
  commands: CommandDefinition[],
): Promise<number[]> {
  const promises = commands.map(({ args = [], command, options = {} }) =>
    runCommand(command, args, options),
  )
  const results = await Promise.allSettled(promises)
  return results.map(r => (r.status === 'fulfilled' ? r.value : 1))
}

/**
 * Run a command and suppress output.
 * @param {string} command - The command to run
 * @param {string[]} args - Arguments to pass to the command
 * @param {object} options - Spawn options
 * @returns {Promise<{exitCode: number, stdout: string, stderr: string}>}
 */
export async function runCommandQuiet(
  command: string,
  args: string[] = [],
  options: SpawnOptions = {},
): Promise<QuietCommandResult> {
  try {
    const result = await spawn(command, args, {
      shell: WIN32,
      ...options,
    })

    return {
      exitCode: result.code,
      stderr: String(result.stderr),
      stdout: String(result.stdout),
    }
  } catch (e) {
    // spawn() from @socketsecurity/lib throws on non-zero exit
    // Return the exit code and output from the error
    if (
      e &&
      typeof e === 'object' &&
      'code' in e &&
      'stdout' in e &&
      'stderr' in e
    ) {
      const error = e as SpawnError
      return {
        exitCode: error.code,
        stderr: error.stderr,
        stdout: error.stdout,
      }
    }
    throw e
  }
}

/**
 * Log and run a command.
 * @param {string} description - Description of what the command does
 * @param {string} command - The command to run
 * @param {string[]} args - Arguments
 * @param {object} options - Spawn options
 * @returns {Promise<number>} Exit code
 */
export async function logAndRun(
  description: string,
  command: string,
  args: string[] = [],
  options: SpawnOptions = {},
): Promise<number> {
  logger.log(description)
  return runCommand(command, args, options)
}
