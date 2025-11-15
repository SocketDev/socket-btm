/**
 * Patch Validation Utilities
 *
 * Provides utilities for validating and applying patches to source code.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

import { which } from '@socketsecurity/lib/bin'
import { spawn } from '@socketsecurity/lib/spawn'

import { printError, printStep, printSubstep } from './build-output.mjs'

/**
 * Validate a patch file can be applied cleanly.
 *
 * @param {string} patchFile - Path to patch file
 * @param {string} targetDir - Directory to apply patch to
 * @returns {Promise<boolean>}
 */
export async function validatePatch(patchFile, targetDir) {
  printSubstep(`Validating ${path.basename(patchFile)}`)

  try {
    const patchPath = await which('patch', { nothrow: true })
    if (!patchPath) {
      printError('patch not found in PATH')
      return false
    }

    // Resolve to absolute path
    const absolutePatchFile = path.resolve(patchFile)

    let result
    try {
      result = await spawn(
        patchPath,
        ['-p1', '--dry-run', '-i', absolutePatchFile],
        {
          cwd: targetDir,
          env: process.env,
        },
      )
    } catch (spawnError) {
      // spawn() throws when command exits with non-zero code
      result = spawnError
    }

    const exitCode = result.code ?? 0
    if (exitCode !== 0) {
      printError(`Patch validation failed: ${patchFile}`)
      if (result.stderr) {
        printError(`stderr: ${result.stderr}`)
      }
      if (result.stdout) {
        printError(`stdout: ${result.stdout}`)
      }
      return false
    }

    return true
  } catch (e) {
    printError(`Patch validation error: ${patchFile}`, e)
    return false
  }
}

/**
 * Apply a patch file.
 *
 * @param {string} patchFile - Path to patch file
 * @param {string} targetDir - Directory to apply patch to
 * @returns {Promise<void>}
 */
export async function applyPatch(patchFile, targetDir) {
  printSubstep(`Applying ${path.basename(patchFile)}`)

  const patchPath = await which('patch', { nothrow: true })
  if (!patchPath) {
    throw new Error('patch not found in PATH')
  }

  // Resolve to absolute path since we're changing cwd
  const absolutePatchFile = path.resolve(patchFile)

  let result
  try {
    result = await spawn(patchPath, ['-p1', '-i', absolutePatchFile], {
      cwd: targetDir,
      env: process.env,
    })
  } catch (spawnError) {
    // spawn() throws when command exits with non-zero code
    result = spawnError
  }

  const exitCode = result.code ?? 0
  if (exitCode !== 0) {
    throw new Error(`Failed to apply patch: ${patchFile}`)
  }
}

/**
 * Apply all patches in a directory.
 *
 * @param {string} patchDir - Directory containing patch files
 * @param {string} targetDir - Directory to apply patches to
 * @param {object} options - Options
 * @param {boolean} options.validate - Validate patches before applying (default: true)
 * @returns {Promise<void>}
 */
export async function applyPatchDirectory(
  patchDir,
  targetDir,
  { validate = true } = {},
) {
  printStep('Applying patches')

  const entries = await fs.readdir(patchDir, { withFileTypes: true })
  const patchFiles = entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.patch'))
    .map(entry => path.join(patchDir, entry.name))
    .sort()

  if (!patchFiles.length) {
    printSubstep('No patches found')
    return
  }

  // Validate all patches first if requested.
  if (validate) {
    for (const patchFile of patchFiles) {
      // eslint-disable-next-line no-await-in-loop
      const isValid = await validatePatch(patchFile, targetDir)
      if (!isValid) {
        throw new Error(`Patch validation failed: ${patchFile}`)
      }
    }
  }

  // Apply patches in order.
  for (const patchFile of patchFiles) {
    // eslint-disable-next-line no-await-in-loop
    await applyPatch(patchFile, targetDir)
  }

  printSubstep(`Applied ${patchFiles.length} patches`)
}

/**
 * Test if a patch has already been applied.
 *
 * @param {string} patchFile - Path to patch file
 * @param {string} targetDir - Directory to check
 * @returns {Promise<boolean>}
 */
export async function testPatchApplication(patchFile, targetDir) {
  try {
    const patchPath = await which('patch', { nothrow: true })
    if (!patchPath) {
      return false
    }

    // Resolve to absolute path
    const absolutePatchFile = path.resolve(patchFile)

    let result
    try {
      result = await spawn(
        patchPath,
        ['-p1', '--dry-run', '--reverse', '-i', absolutePatchFile],
        {
          cwd: targetDir,
          env: process.env,
        },
      )
    } catch (spawnError) {
      // spawn() throws when command exits with non-zero code
      result = spawnError
    }

    // If reverse patch succeeds, the patch has been applied.
    return (result.code ?? 0) === 0
  } catch {
    return false
  }
}

/**
 * Create a patch file from git diff.
 *
 * @param {string} repoDir - Git repository directory
 * @param {string} outputFile - Output patch file path
 * @param {object} options - Options
 * @param {boolean} options.staged - Only include staged changes (default: false)
 * @returns {Promise<void>}
 */
export async function createPatchFromGit(
  repoDir,
  outputFile,
  { staged = false } = {},
) {
  printStep('Creating patch from git diff')

  const gitPath = await which('git', { nothrow: true })
  if (!gitPath) {
    throw new Error('git not found in PATH')
  }

  const args = ['diff']
  if (staged) {
    args.push('--cached')
  }

  const result = await spawn(gitPath, args, {
    cwd: repoDir,
  })

  const stdout = result.stdout ?? ''
  if (!stdout.trim()) {
    throw new Error('No changes to create patch from')
  }

  await fs.writeFile(outputFile, stdout, 'utf8')

  printSubstep(`Created patch: ${path.basename(outputFile)}`)
}

/**
 * Revert a patch that has been applied.
 *
 * @param {string} patchFile - Path to patch file
 * @param {string} targetDir - Directory to revert patch from
 * @returns {Promise<void>}
 */
export async function revertPatch(patchFile, targetDir) {
  printSubstep(`Reverting ${path.basename(patchFile)}`)

  const patchPath = await which('patch', { nothrow: true })
  if (!patchPath) {
    throw new Error('patch not found in PATH')
  }

  // Resolve to absolute path since we're changing cwd
  const absolutePatchFile = path.resolve(patchFile)

  let result
  try {
    result = await spawn(
      patchPath,
      ['-p1', '--reverse', '-i', absolutePatchFile],
      {
        cwd: targetDir,
        env: process.env,
      },
    )
  } catch (spawnError) {
    // spawn() throws when command exits with non-zero code
    result = spawnError
  }

  const exitCode = result.code ?? 0
  if (exitCode !== 0) {
    throw new Error(`Failed to revert patch: ${patchFile}`)
  }
}

/**
 * Analyze patch file content for specific modifications.
 *
 * @param {string} content - Patch file content
 * @returns {object} Analysis result
 */
export function analyzePatchContent(content) {
  return {
    modifiesV8Includes: content.includes('v8.h') || content.includes('v8-'),
    modifiesSEA: content.includes('SEA') || content.includes('sea_'),
    modifiesBrotli: content.includes('brotli') || content.includes('Brotli'),
  }
}

/**
 * Check for conflicts between patches.
 *
 * @param {Array} patchData - Array of patch data objects
 * @param {string} version - Node.js version
 * @returns {Array} Array of conflict objects
 */
export function checkPatchConflicts(_patchData, _version) {
  // Stub implementation - no conflicts detected by default.
  // In a full implementation, this would analyze patch overlaps.
  return []
}
