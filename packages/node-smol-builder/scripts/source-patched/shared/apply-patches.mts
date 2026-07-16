/**
 * Source patching phase for Node.js.
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

import { glob } from '@socketsecurity/lib-stable/globs/match'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  EXTERNAL_PIN_FILES,
  MONOREPO_PACKAGE_SOURCES,
} from '../../binary-released/shared/prepare-external-sources.mts'

const logger = getDefaultLogger()

/**
 * Apply Socket patches to Node.js source.
 *
 * @param {object} options - Patch options.
 * @param {string} options.nodeVersion - Node.js version.
 * @param {string} options.buildDir - Build directory.
 * @param {string} options.modeSourceDir - Source directory to patch.
 * @param {string} options.packageName - Package name.
 * @param {string} options.patchedFile - File to verify after patching.
 * @param {string} options.patchesReleaseDir - Static patches directory.
 * @param {string} options.buildPatchesDir - Dynamic patches directory.
 * @param {boolean} options.cleanBuild - Force clean build.
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
  } = { __proto__: null, ...options } as typeof options

  const socketPatches = findSocketPatches(patchesReleaseDir, buildPatchesDir)
  const allSourcePaths = await computeSourcePatchedCachePaths({
    buildPatchesDir,
    modeSourceDir,
    patchesReleaseDir,
  })

  // Combined-key short-circuit: nothing changed at all (patches OR additions).
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
        `Expected patches in:\n` +
        `  - ${patchesReleaseDir} (static)\n` +
        `  - ${buildPatchesDir} (dynamic)`,
    )
  }

  // Patch-only-key check: are the upstream-touching patches stale,
  // or did only addition source files change? If only additions
  // changed, the patched tree is still valid — skip the actual
  // patch operation and just refresh the checkpoint metadata so
  // the combined cache key reflects the new addition hashes.
  // build-released.mts skips its modeSourceDir wipe based on this
  // same patch-only key; if we re-applied patches here, they would
  // hit "hunks already applied" against the (still-valid) patched
  // tree.
  const patchChainPaths = computePatchChainCachePaths({
    buildPatchesDir,
    modeSourceDir,
    patchesReleaseDir,
  })
  const patchChainStale = await shouldRun(
    buildDir,
    packageName,
    CHECKPOINTS.SOURCE_PATCHED,
    cleanBuild,
    patchChainPaths,
  )

  if (!patchChainStale) {
    logger.skip(
      'Patches already applied; refreshing checkpoint for addition-only changes',
    )
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
        tarExcludes: ['out'],
      },
    )
    logger.log('')
    return
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

  for (let i = 0, { length } = socketPatches; i < length; i += 1) {
    const patch = socketPatches[i]
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
      // SOURCE_PATCHED captures pristine + patches, not compiled output.
      // A previous successful build leaves source/out/Release/ behind
      // (~22GB). Without this exclude, the next time apply-patches
      // re-runs (e.g. patch text changed), createCheckpoint tries to
      // tarball the whole source dir and trips the 2GB size guardrail.
      tarExcludes: ['out'],
    },
  )
  logger.log('')
}

/**
 * Compute the patch-chain-only cache-key paths. Used by build-released.mts
 * to decide whether the patched source tree needs to be re-extracted
 * from a pristine baseline. When this key is fresh but the combined
 * source-patched key is stale, only addition source files changed —
 * the patched source tree is still valid and just needs a re-overlay
 * (copyBuildAdditions handles that, ninja recompiles affected .o).
 */
export function computePatchChainCachePaths(options: {
  buildPatchesDir: string
  modeSourceDir: string
  patchesReleaseDir: string
}): string[] {
  const { buildPatchesDir, modeSourceDir, patchesReleaseDir } = {
    __proto__: null,
    ...options,
  } as typeof options
  const socketPatches = findSocketPatches(patchesReleaseDir, buildPatchesDir)
  const patchFilePaths = socketPatches.map(p => p.path)

  // Include canonical upstream-Node files in the cache key so an
  // upstream Node bump (different source tree under modeSourceDir,
  // byte-identical patches) invalidates this stage. Without these,
  // byte-identical patches against a different Node version
  // short-circuit and we ship unpatched output.
  const upstreamSentinelPaths = [
    path.join(modeSourceDir, 'src', 'node.cc'),
    path.join(modeSourceDir, 'src', 'node_main.cc'),
  ].filter(p => existsSync(p))

  return [...patchFilePaths, ...upstreamSentinelPaths]
}

/**
 * Compute the cache-key path list for SOURCE_PATCHED. Reused by
 * applySocketPatches (to decide whether to re-apply patches) AND by
 * build-released.mts (to decide whether to refresh the patched tree).
 * Both call sites MUST agree on staleness or we land in the "patches
 * re-apply over stale source dir with leftover out/Release" state that
 * trips the checkpoint guardrail.
 */
export async function computeSourcePatchedCachePaths(options: {
  buildPatchesDir: string
  modeSourceDir: string
  patchesReleaseDir: string
}): Promise<string[]> {
  const patchChainPaths = computePatchChainCachePaths(options)

  const sourcePackageFiles: string[] = []
  for (let i = 0, { length } = MONOREPO_PACKAGE_SOURCES; i < length; i += 1) {
    const srcDir = MONOREPO_PACKAGE_SOURCES[i]!.from
    if (existsSync(srcDir)) {
      const srcFiles = await glob('**/*.{c,cc,cpp,h,hh,hpp,cjs,js,mjs}', {
        absolute: true,
        cwd: srcDir,
      })
      sourcePackageFiles.push(...srcFiles)
    }
  }

  // External pin files — single files (like .gitmodules + lockstep.json)
  // whose content captures the version of external deps linked at build
  // time but whose source isn't copied into the patched tree. See
  // EXTERNAL_PIN_FILES in prepare-external-sources.mts for the list.
  const externalPinFiles: string[] = []
  for (let i = 0, { length } = EXTERNAL_PIN_FILES; i < length; i += 1) {
    const pinFile = EXTERNAL_PIN_FILES[i]!
    if (existsSync(pinFile)) {
      externalPinFiles.push(pinFile)
    }
  }

  return [...patchChainPaths, ...sourcePackageFiles, ...externalPinFiles]
}

/**
 * Find all Socket patches for this build.
 *
 * @param {string} patchesReleaseDir - Static patches directory.
 * @param {string} buildPatchesDir - Dynamic patches directory.
 *
 * @returns {Array} Array of patch objects
 */
export function findSocketPatches(patchesReleaseDir, buildPatchesDir) {
  // Dedupe by filename — when a hot-fix sits in build/patches/ with the
  // same name as a release patch, the dynamic copy wins. Without dedupe
  // both entries would be sorted and applied; the second application
  // throws "hunks already applied" with a misleading patch-content error,
  // which is hard to diagnose during local patch iteration.
  const byName = new Map()

  // Static patches first; dynamic ones overwrite (build/ wins).
  if (existsSync(patchesReleaseDir)) {
    for (const f of readdirSync(patchesReleaseDir)) {
      if (f.endsWith('.patch')) {
        byName.set(f, {
          name: f,
          path: path.join(patchesReleaseDir, f),
          source: 'patches/',
        })
      }
    }
  }
  if (existsSync(buildPatchesDir)) {
    for (const f of readdirSync(buildPatchesDir)) {
      if (f.endsWith('.patch')) {
        byName.set(f, {
          name: f,
          path: path.join(buildPatchesDir, f),
          source: 'build/patches/',
        })
      }
    }
  }

  // Sort by name for consistent ordering
  return [...byName.values()].toSorted((a, b) => a.name.localeCompare(b.name))
}
