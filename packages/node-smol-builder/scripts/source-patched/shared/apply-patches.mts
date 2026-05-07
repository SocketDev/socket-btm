/**
 * Source patching phase for Node.js
 *
 * Applies Socket Security patches to Node.js source code with validation.
 */

import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { createCheckpoint } from 'build-infra/lib/build-helpers'
import { shouldRun } from 'build-infra/lib/checkpoint-manager'
import { CHECKPOINTS } from 'build-infra/lib/constants'
import { applyPatch, validatePatch } from 'build-infra/lib/patch-validator'
import { errorMessage } from 'build-infra/lib/error-utils'

import { glob } from '@socketsecurity/lib/globs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { BINJECT_DIR, BIN_INFRA_DIR, BUILD_INFRA_DIR } from '../../paths.mts'

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

  // Include source package files (canonical source, not copies in additions/)
  // These are the source of truth that get copied to additions/source-patched/
  const sourcePackageDirs = [
    path.join(BINJECT_DIR, 'src', 'socketsecurity', 'binject'),
    path.join(BIN_INFRA_DIR, 'src', 'socketsecurity', 'bin-infra'),
    path.join(BUILD_INFRA_DIR, 'src', 'socketsecurity', 'build-infra'),
  ]

  const sourcePackageFiles = []
  for (const srcDir of sourcePackageDirs) {
    if (existsSync(srcDir)) {
      const srcFiles = await glob('**/*.{c,cc,cpp,h,hh,hpp}', {
        absolute: true,
        cwd: srcDir,
      })
      sourcePackageFiles.push(...srcFiles)
    }
  }

  // Combine patches and source package files for cache key
  const allSourcePaths = [...patchFilePaths, ...sourcePackageFiles]

  if (
    !(await shouldRun(
      buildDir,
      packageName,
      CHECKPOINTS.SOURCE_PATCHED,
      cleanBuild,
      allSourcePaths,
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

  // Validate + apply cumulatively. Patches are ordered 001-NNN and
  // later patches may depend on context added by earlier ones (e.g.
  // 021 lands alongside linux-specific blocks introduced by 019).
  // Validating each patch against the pristine tree would reject every
  // such chain, so we dry-run + apply in the same pass — dry-run
  // validates against the cumulative state, then the real apply
  // mutates modeSourceDir for the next iteration.
  logger.step('Applying Socket Patches')
  logger.substep(`Found ${socketPatches.length} patch(es) for ${nodeVersion}`)
  logger.log('')

  for (const patch of socketPatches) {
    logger.group()
    logger.info(`Applying ${patch.name}`)

    const isValid = await validatePatch(patch.path, modeSourceDir)
    if (!isValid) {
      logger.fail('INVALID: Patch validation failed')
      logger.groupEnd()
      throw new Error(
        'Socket patch validation failed.\n\n' +
          `Patch: ${patch.name}\n` +
          `Node.js version: ${nodeVersion}\n\n` +
          'To fix:\n' +
          `  1. Verify the patch file: ${patch.path}\n` +
          '  2. Check build/patches/README.md for guidance\n' +
          '  3. Regenerate with /regenerating-patches if upstream Node drifted',
      )
    }

    try {
      await applyPatch(patch.path, modeSourceDir)
      logger.success(`${patch.name} applied`)
    } catch (e) {
      logger.groupEnd()
      throw new Error(
        'Socket patch application failed.\n\n' +
          `Failed to apply patch: ${patch.name}\n` +
          `Error: ${errorMessage(e)}`,
      )
    }
    logger.groupEnd()
  }

  logger.success('All Socket patches applied successfully')
  await createCheckpoint(
    buildDir,
    CHECKPOINTS.SOURCE_PATCHED,
    async () => {
      if (!existsSync(patchedFile)) {
        throw new Error(`Patched file not found: ${patchedFile}`)
      }
      logger.substep('Patches verified')
    },
    {
      artifactPath: modeSourceDir,
      packageName,
      patchCount: socketPatches.length,
      sourcePaths: allSourcePaths,
    },
  )
  logger.log('')
}
