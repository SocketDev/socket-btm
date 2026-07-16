/**
 * @file Monorepo script runner utilities for common build operations.
 *   Provides DRY helpers for running pnpm scripts, commands, and sequences.
 */

import { which } from '@socketsecurity/lib-stable/bin/which'
import { WIN32 } from '@socketsecurity/lib-stable/constants/platform'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

const logger = getDefaultLogger()

const PNPM_NOT_FOUND_MSG = 'pnpm not found in PATH'

// The lib spawn's options parameter — reused so every runner forwards the
// exact shape spawn accepts without re-declaring it.
export type SpawnExtra = NonNullable<Parameters<typeof spawn>[2]>

export interface CommandSpec {
  readonly args?: string[] | undefined
  readonly command: string
  readonly description?: string | undefined
  readonly options?: SpawnExtra | undefined
}

/**
 * Run a command with inherited stdio, throwing on non-zero exit.
 * This is the common pattern used across build/clean/test scripts.
 *
 * @param {string} command - Command to run.
 * @param {string[]} args - Arguments.
 * @param {string} [cwd] - Working directory.
 *
 * @returns {Promise<void>}
 *
 * @throws {Error} If command exits with non-zero code
 */
export async function runCommand(
  command: string,
  args: string[] = [],
  cwd: string | undefined = undefined,
): Promise<void> {
  logger.info(`Running: ${command} ${args.join(' ')}`)

  const result = await spawn(command, args, {
    cwd,
    shell: WIN32,
    stdio: 'inherit',
  })

  if (result.code !== 0) {
    throw new Error(`Command failed with exit code ${result.code}`)
  }
}

/**
 * Run multiple commands in parallel.
 *
 * @param {{ command: string; args?: string[]; options?: object }[]} commands
 * @param {object} globalOptions - Options to merge into all commands.
 *
 * @returns {Promise<
 *   { code: number; stdout?: string; stderr?: string; error?: Error }[]
 * >}
 */
export async function runParallel(
  commands: readonly CommandSpec[],
  globalOptions: SpawnExtra = {},
) {
  const promises = commands.map(({ args = [], command, options = {} }) =>
    spawn(command, args, {
      shell: WIN32,
      stdio: 'inherit',
      ...globalOptions,
      ...options,
    }),
  )

  const results = await Promise.allSettled(promises)

  // Check for failures and log them.
  for (let i = 0, { length } = results; i < length; i += 1) {
    const result = results[i]!
    if (result.status !== 'rejected') {
      continue
    }
    const command = commands[i]
    const cmdStr = command
      ? `${command.command} ${(command.args ?? []).join(' ')}`
      : `command #${i}`
    const reason: unknown = result.reason
    logger.error(`Command failed: ${cmdStr}`)
    logger.group()
    logger.error(`Error: ${errorMessage(reason)}`)
    logger.groupEnd()
  }

  return results.map(r =>
    r.status === 'fulfilled'
      ? r.value
      : {
          code: 1,
          error:
            r.reason instanceof Error ? r.reason : new Error(String(r.reason)),
          stderr:
            r.reason instanceof Error ? r.reason.message : String(r.reason),
        },
  )
}

/**
 * Run a pnpm script in a specific package.
 *
 * @param {string} packageName - Package name (e.g., '@socketsecurity/cli')
 * @param {string} scriptName - Script name from package.json.
 * @param {string[]} args - Additional arguments.
 * @param {object} options - Spawn options.
 *
 * @returns {Promise<{ code: number; stdout?: string; stderr?: string }>}
 */
export async function runPnpmScript(
  packageName: string,
  scriptName: string,
  args: string[] = [],
  options: SpawnExtra = {},
) {
  const pnpmResolved = await which('pnpm', { nothrow: true })
  // which() may return string[] under some option shapes — take the first hit.
  const pnpmPath = Array.isArray(pnpmResolved) ? pnpmResolved[0] : pnpmResolved
  if (!pnpmPath) {
    throw new Error(PNPM_NOT_FOUND_MSG)
  }

  const pnpmArgs = ['--filter', packageName, 'run', scriptName, ...args]

  return spawn(pnpmPath, pnpmArgs, {
    shell: WIN32,
    stdio: 'inherit',
    ...options,
  })
}

/**
 * Run a pnpm script across all packages that have the script.
 *
 * @param {string} scriptName - Script name from package.json.
 * @param {string[]} args - Additional arguments.
 * @param {object} options - Spawn options.
 *
 * @returns {Promise<{ code: number; stdout?: string; stderr?: string }>}
 */
export async function runPnpmScriptAll(
  scriptName: string,
  args: string[] = [],
  options: SpawnExtra = {},
) {
  const pnpmResolved = await which('pnpm', { nothrow: true })
  // which() may return string[] under some option shapes — take the first hit.
  const pnpmPath = Array.isArray(pnpmResolved) ? pnpmResolved[0] : pnpmResolved
  if (!pnpmPath) {
    throw new Error(PNPM_NOT_FOUND_MSG)
  }

  const pnpmArgs = ['run', '-r', scriptName, ...args]

  return spawn(pnpmPath, pnpmArgs, {
    shell: WIN32,
    stdio: 'inherit',
    ...options,
  })
}

/**
 * Run a command quietly (capture output).
 *
 * @param {string} command - Command to run.
 * @param {string[]} args - Arguments.
 * @param {object} options - Spawn options.
 *
 * @returns {Promise<{ code: number; stdout: string; stderr: string }>}
 */
export async function runQuiet(
  command: string,
  args: string[] = [],
  options: SpawnExtra = {},
) {
  return spawn(command, args, {
    shell: WIN32,
    ...options,
  })
}

/**
 * Run multiple commands in sequence, stopping on first failure.
 *
 * @param {{
 *   command: string
 *   args?: string[]
 *   options?: object
 *   description?: string
 * }[]} commands
 * @param {object} globalOptions - Options to merge into all commands.
 *
 * @returns {Promise<number>} Exit code of first failing command, or 0 if all
 *   succeed.
 */
export async function runSequence(
  commands: readonly CommandSpec[],
  globalOptions: SpawnExtra = {},
): Promise<number> {
  // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
  for (const { args = [], command, description, options = {} } of commands) {
    if (description) {
      logger.step(description)
    }

    // eslint-disable-next-line no-await-in-loop
    const result = await spawn(command, args, {
      shell: WIN32,
      stdio: 'inherit',
      ...globalOptions,
      ...options,
    })

    if (result.code !== 0) {
      return result.code
    }
  }

  return 0
}

/**
 * Common pnpm operations with proper error handling.
 */
export const pnpm = {
  /**
   * Build all packages or specific package.
   */
  build: async (
    packageName: string | undefined = undefined,
    options: SpawnExtra = {},
  ) => {
    logger.step(packageName ? `Building ${packageName}` : 'Building packages')
    const pnpmResolved = await which('pnpm', { nothrow: true })
    // which() may return string[] under some option shapes — take the first hit.
    const pnpmPath = Array.isArray(pnpmResolved)
      ? pnpmResolved[0]
      : pnpmResolved
    if (!pnpmPath) {
      throw new Error(PNPM_NOT_FOUND_MSG)
    }
    const args = packageName
      ? ['--filter', packageName, 'run', 'build']
      : ['run', '-r', 'build']

    return spawn(pnpmPath, args, {
      shell: WIN32,
      stdio: 'inherit',
      ...options,
    })
  },

  /**
   * Run pnpm install with frozen lockfile.
   */
  install: async (options: SpawnExtra = {}) => {
    logger.step('Installing dependencies')
    const pnpmResolved = await which('pnpm', { nothrow: true })
    // which() may return string[] under some option shapes — take the first hit.
    const pnpmPath = Array.isArray(pnpmResolved)
      ? pnpmResolved[0]
      : pnpmResolved
    if (!pnpmPath) {
      throw new Error(PNPM_NOT_FOUND_MSG)
    }
    return spawn(pnpmPath, ['install', '--frozen-lockfile'], {
      shell: WIN32,
      stdio: 'inherit',
      ...options,
    })
  },

  /**
   * Run tests in specific package or all packages.
   */
  test: async (
    packageName: string | undefined = undefined,
    options: SpawnExtra = {},
  ) => {
    logger.step(packageName ? `Testing ${packageName}` : 'Running tests')
    const pnpmResolved = await which('pnpm', { nothrow: true })
    // which() may return string[] under some option shapes — take the first hit.
    const pnpmPath = Array.isArray(pnpmResolved)
      ? pnpmResolved[0]
      : pnpmResolved
    if (!pnpmPath) {
      throw new Error(PNPM_NOT_FOUND_MSG)
    }
    const args = packageName
      ? ['--filter', packageName, 'run', 'test']
      : ['run', '-r', 'test']

    return spawn(pnpmPath, args, {
      shell: WIN32,
      stdio: 'inherit',
      ...options,
    })
  },
}
