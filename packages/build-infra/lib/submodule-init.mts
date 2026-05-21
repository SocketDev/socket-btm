/**
 * Generic submodule-init helper.
 *
 * Initializes a single git submodule on demand, with a sentinel-file
 * check so repeat calls are no-ops. Used by setup-build-toolchain
 * scripts that need a vendored upstream tree to exist before the rest
 * of the build can run.
 *
 * Pattern mirrors libdeflate-init.mts and zstd-init.mts — generalize
 * here so new builders don't need to fork the same shell logic.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'
import { spawn } from '@socketsecurity/lib-stable/spawn/spawn'

import { errorMessage } from './error-utils.mts'

const logger = getDefaultLogger()

/**
 * Ensure a git submodule is initialized.
 *
 * @param {object} options
 * @param {string} options.name - Submodule name for log/error messages
 *   (e.g., "yoga", "ultraviolet").
 * @param {string} options.submodulePath - Path FROM the monorepo root
 *   to the submodule directory (e.g., "packages/yoga-layout-builder/upstream/yoga").
 * @param {string} options.sentinelFile - Path INSIDE the submodule to a
 *   file whose existence proves it's checked out (e.g., "yoga/Yoga.h").
 * @param {string} options.monorepoRoot - Absolute path to the
 *   monorepo root containing .git and .gitmodules.
 * @returns {Promise<void>}
 */
export async function ensureSubmodule({
  monorepoRoot,
  name,
  sentinelFile,
  submodulePath,
}) {
  const absSubmodule = path.join(monorepoRoot, submodulePath)
  const absSentinel = path.join(absSubmodule, sentinelFile)

  if (existsSync(absSentinel)) {
    return
  }

  const gitDir = path.join(monorepoRoot, '.git')
  if (!existsSync(gitDir)) {
    throw new Error(
      `${name} source not found at ${absSubmodule} and no .git directory available.\n` +
        `In Docker builds, ensure the CI workflow initializes the ${name} submodule before docker build:\n` +
        `  git submodule update --init ${submodulePath}`,
    )
  }

  logger.info(`Initializing ${name} submodule…`)
  logger.log(`Running: git submodule update --init ${submodulePath}`)

  let result
  try {
    result = await spawn(
      'git',
      ['submodule', 'update', '--init', submodulePath],
      { cwd: monorepoRoot, stdio: 'inherit' },
    )
  } catch (e) {
    throw new Error(
      `${name} submodule not initialized and git command failed.\n` +
        `Run: git submodule update --init ${submodulePath}\n` +
        `Error: ${errorMessage(e)}`,
      { cause: e },
    )
  }

  const exit = result.code ?? result.exitCode ?? 0
  if (exit !== 0) {
    throw new Error(
      `Failed to initialize ${name} submodule (exit code ${exit}).\n` +
        `Run: git submodule update --init ${submodulePath}`,
    )
  }

  if (!existsSync(absSentinel)) {
    throw new Error(
      `${name} submodule initialization completed but sentinel ${sentinelFile} is missing. ` +
        `The submodule may not be properly configured.`,
    )
  }

  logger.success(`${name} submodule initialized`)
}
