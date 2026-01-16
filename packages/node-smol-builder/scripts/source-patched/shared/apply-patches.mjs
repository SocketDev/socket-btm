/**
 * Source patching phase for Node.js
 *
 * Applies Socket Security patches to Node.js source code with validation.
 */

import { existsSync, readdirSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { createCheckpoint } from 'build-infra/lib/build-helpers'
import { shouldRun } from 'build-infra/lib/checkpoint-manager'
import {
  analyzePatchContent,
  checkPatchConflicts,
  validatePatch,
} from 'build-infra/lib/patch-validator'
import colors from 'yoctocolors-cjs'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

/**
 * Find all Socket patches for this build.
 *
 * @param {string} patchesReleaseDir - Static patches directory
 * @param {string} buildPatchesDir - Dynamic patches directory
 * @returns {Array} Array of patch objects
 */
function findSocketPatches(patchesReleaseDir, buildPatchesDir) {
  const patches = []

  // Get static patches from patches/ directory
  if (existsSync(patchesReleaseDir)) {
    const staticPatches = readdirSync(patchesReleaseDir)
      .filter(f => f.endsWith('.patch') && !f.endsWith('.template.patch'))
      .map(f => ({
        name: f,
        path: path.join(patchesReleaseDir, f),
        source: 'patches/',
      }))
    patches.push(...staticPatches)
  }

  // Get dynamic patches from build/patches/ directory
  if (existsSync(buildPatchesDir)) {
    const dynamicPatches = readdirSync(buildPatchesDir)
      .filter(f => f.endsWith('.patch'))
      .map(f => ({
        name: f,
        path: path.join(buildPatchesDir, f),
        source: 'build/patches/',
      }))
    patches.push(...dynamicPatches)
  }

  // Sort by name for consistent ordering
  patches.sort((a, b) => a.name.localeCompare(b.name))

  return patches
}

/**
 * Apply Socket patches to Node.js source.
 *
 * @param {object} options - Patch options
 * @param {string} options.nodeVersion - Node.js version
 * @param {string} options.buildDir - Build directory
 * @param {string} options.modeSourceDir - Source directory to patch
 * @param {string} options.packageName - Package name
 * @param {string} options.patchedFile - File to verify after patching
 * @param {string} options.patchesReleaseDir - Static patches directory
 * @param {string} options.buildPatchesDir - Dynamic patches directory
 * @param {boolean} options.cleanBuild - Force clean build
 */
export async function applySocketPatches(options) {
  const {
    buildDir,
    buildPatchesDir,
    cleanBuild,
    modeSourceDir,
    nodeVersion,
    packageName,
    patchedFile,
    patchesReleaseDir,
  } = options

  // Find all patches
  const socketPatches = findSocketPatches(patchesReleaseDir, buildPatchesDir)
  const patchFilePaths = socketPatches.map(p => p.path)

  if (
    !(await shouldRun(
      buildDir,
      packageName,
      'source-patched',
      cleanBuild,
      patchFilePaths,
    ))
  ) {
    logger.skip('Socket patches already applied, skipping')
    logger.log('')
    return
  }

  if (socketPatches.length === 0) {
    throw new Error(
      `No Socket patches found for Node.js ${nodeVersion}.\n\n` +
        `Expected patches in: ${patchesReleaseDir}`,
    )
  }

  // Validate patches
  logger.step('Validating Socket Patches')
  logger.log(`Found ${socketPatches.length} patch(es) for ${nodeVersion}`)
  logger.log('Checking integrity, compatibility, and conflicts...')
  logger.log('')

  const patchData = []
  let allValid = true

  for (const patch of socketPatches) {
    logger.group(` ${colors.blue('ℹ')}   Validating ${patch.name}`)

    const isValid = await validatePatch(patch.path, modeSourceDir)
    if (!isValid) {
      logger.fail('INVALID: Patch validation failed')
      logger.groupEnd()
      allValid = false
      continue
    }

    const content = await fs.readFile(patch.path, 'utf8')
    const analysis = analyzePatchContent(content)

    patchData.push({
      analysis,
      content,
      name: patch.name,
      path: patch.path,
    })
    if (analysis.modifiesV8Includes) {
      logger.success('Modifies V8 includes')
    }
    if (analysis.modifiesSEA) {
      logger.success('Modifies SEA detection')
    }
    logger.success('Valid')
    logger.groupEnd()
  }

  if (!allValid) {
    throw new Error(
      'Socket patch validation failed.\n\n' +
        `One or more Socket patches are invalid or incompatible with Node.js ${nodeVersion}.\n\n` +
        'To fix:\n' +
        `  1. Verify patch files in ${patchesReleaseDir}\n` +
        '  2. Check build/patches/README.md for guidance',
    )
  }

  // Check for conflicts
  const conflicts = checkPatchConflicts(patchData)
  if (conflicts.length > 0) {
    logger.warn('Patch Conflicts Detected:')
    logger.warn()
    for (const conflict of conflicts) {
      if (conflict.severity === 'error') {
        logger.fail(`ERROR: ${conflict.message}`)
        allValid = false
      } else {
        logger.warn(`WARNING: ${conflict.message}`)
      }
    }
    logger.warn()

    if (!allValid) {
      throw new Error(
        'Critical patch conflicts detected.\n\n' +
          'Conflicts found:\n' +
          conflicts
            .filter(c => c.severity === 'error')
            .map(c => `  - ${c.message}`)
            .join('\n'),
      )
    }
  } else {
    logger.success('All Socket patches validated successfully')
    logger.success('No conflicts detected')
    logger.log('')
  }

  // Apply patches
  if (allValid) {
    logger.step('Applying Socket Patches')
    for (const { name, path: patchPath } of patchData) {
      logger.log(`Applying ${name}...`)

      let result
      try {
        result = await spawn(
          'sh',
          ['-c', `patch -p1 --batch --forward < "${patchPath}"`],
          {
            cwd: modeSourceDir,
          },
        )
      } catch (e) {
        result = e
      }

      if (result.code !== 0) {
        const stdout = (result.stdout ?? '').toString()
        const stderr = (result.stderr ?? '').toString()
        const output = stdout + stderr
        const isAlreadyApplied =
          output.includes('Ignoring previously applied') ||
          output.includes('Reversed (or previously applied) patch detected')

        if (isAlreadyApplied) {
          logger.skip(`${name} already applied, skipping`)
          continue
        }

        throw new Error(
          'Socket patch application failed.\n\n' +
            `Failed to apply patch: ${name}\n` +
            `Output:\n${output}`,
        )
      }

      logger.success(`${name} applied`)
    }
    logger.success('All Socket patches applied successfully')
    await createCheckpoint(
      buildDir,
      'source-patched',
      async () => {
        await fs.access(patchedFile)
        logger.substep('Patches verified')
      },
      {
        packageName,
        patchCount: socketPatches.length,
        sourcePaths: patchFilePaths,
        artifactPath: modeSourceDir,
      },
    )
    logger.log('')
  }
}
