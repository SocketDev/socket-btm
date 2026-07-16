/**
 * Phase-specific build source file collection, split out of build.mts to
 * keep the orchestrator under the file-size soft cap.
 *
 * Cache Key Strategy: each phase tracks only files that affect that phase -
 * phase-specific scripts (e.g., release tracks release scripts, NOT
 * stripped/compressed scripts), cumulative patches and additions (each phase
 * includes previous phase patches), and common scripts (affect all phases).
 *
 * This ensures modifying stripped scripts only invalidates stripped and
 * downstream phases, modifying compressed scripts only invalidates
 * compressed and downstream phases, and the release cache is never
 * invalidated by downstream phase changes.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { glob } from '@socketsecurity/lib-stable/globs/match'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import {
  getBuildSourcePaths,
  getExistingPaths,
  PACKAGE_ROOT,
} from './paths.mts'
import {
  BIN_INFRA_DIR,
  BINJECT_DIR,
  BUILD_INFRA_DIR,
  TEMPORAL_INFRA_DIR,
} from '../../paths.mts'

const __filename = fileURLToPath(import.meta.url)

/**
 * Collect source files for a specific build phase.
 * Used for phase-specific cache key generation to minimize invalidation.
 *
 * @param {string} phase - Build phase ('binary-released', 'binary-stripped',
 *   'binary-compressed', 'finalized')
 * @param {string} platform - Target platform ('darwin', 'linux', 'win32')
 * @param {string} arch - Target architecture ('x64', 'arm64')
 *
 * @returns {string[]} Array of absolute paths to source files for this phase
 */
export async function collectBuildSourceFiles(phase, platform, arch) {
  const sources = []

  // Use getBuildSourcePaths (NOT getCumulativeBuildSourcePaths) to get:
  // - Phase-specific scripts only (not cumulative)
  // - Cumulative patches and additions (correct for dependencies)
  const sourcePaths = getBuildSourcePaths(phase, platform, arch)

  const existingPatchDirs = getExistingPaths(sourcePaths.patches)
  const existingAdditionDirs = getExistingPaths(sourcePaths.additions)
  const existingScriptDirs = getExistingPaths([
    ...sourcePaths.common,
    ...sourcePaths.scripts,
  ])

  for (let i = 0, { length } = existingPatchDirs; i < length; i += 1) {
    const patchDir = existingPatchDirs[i]
    const patchFiles = await glob('*.patch', {
      absolute: true,
      cwd: patchDir,
    })
    // Add all patch files - computeSourceHash will handle missing files
    sources.push(...patchFiles)
  }

  // Include source package files (canonical source, not copies in additions/)
  // These are the source of truth that get copied to additions/source-patched/
  const sourcePackageDirs = [
    path.join(BINJECT_DIR, 'src', 'socketsecurity', 'binject'),
    path.join(BIN_INFRA_DIR, 'src', 'socketsecurity', 'bin-infra'),
    path.join(BUILD_INFRA_DIR, 'src', 'socketsecurity', 'build-infra'),
    // temporal-infra ships TWO source trees: the spec-faithful C++
    // port under src/, and the V8-facing diplomat shim under include/.
    // Both must contribute to the cache key — a libnode rebuild has
    // to fire on any shim or port change, not just on additions/
    // copies. The additions sweep below picks them up via the
    // include-of-everything fallback today, but listing them here
    // explicitly guards against a future additionsIgnorePatterns
    // entry silently dropping them out of the hash.
    path.join(TEMPORAL_INFRA_DIR, 'src', 'socketsecurity', 'temporal'),
    path.join(TEMPORAL_INFRA_DIR, 'include', 'temporal_rs'),
  ]

  for (let i = 0, { length } = sourcePackageDirs; i < length; i += 1) {
    const srcDir = sourcePackageDirs[i]
    if (existsSync(srcDir)) {
      const srcFiles = await glob('**/*.{c,cc,cpp,h,hh,hpp}', {
        absolute: true,
        cwd: srcDir,
      })
      sources.push(...srcFiles)
    }
  }

  // For additions, check both:
  // 1. Hierarchical directories (shared/, {platform}/)
  // 2. Top-level phase directory with any structure (js/, cpp/, etc.)
  // This handles custom directory structures like additions/source-patched/{js,cpp}
  const additionPhaseDirs = new Set()

  // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
  for (const addPath of sourcePaths.additions) {
    // Extract base phase directory (e.g., additions/source-patched)
    const match = addPath.match(/additions\/([^/]+)/)
    if (match) {
      const phaseDir = path.join(PACKAGE_ROOT, 'additions', match[1])
      if (existsSync(phaseDir)) {
        additionPhaseDirs.add(phaseDir)
      }
    }
  }

  // Recursively find all files in additions directories.
  // Exclude gitignored directories that are copies from source packages/submodules:
  // - src/socketsecurity/bin-infra/ (copied from packages/bin-infra/src/)
  // - src/socketsecurity/binject/ (copied from packages/binject/src/)
  // - src/socketsecurity/build-infra/ (copied from packages/build-infra/src/)
  // - deps/fast-webstreams/ (synced from node_modules)
  // - deps/lzfse/src/ (copied from lief-builder/upstream/lzfse/src)
  // - deps/libdeflate/* (copied from binject/upstream/libdeflate)
  //   Note: libdeflate.gyp is NOT gitignored but we can't use negation patterns
  //   with fast-glob ignore, so we add it explicitly after globbing.
  // These are already included via sourcePackageDirs above (for socketsecurity/*) or
  // come from external submodules that don't affect cache validity.
  const additionsIgnorePatterns = [
    '**/src/socketsecurity/bin-infra/**',
    '**/src/socketsecurity/binject/**',
    '**/src/socketsecurity/build-infra/**',
    '**/deps/fast-webstreams/**',
    '**/deps/lzfse/src/**',
    '**/deps/libdeflate/**',
  ]

  // Explicitly include libdeflate.gyp which is tracked in git (not a copy)
  const libdeflateGyp = path.join(
    PACKAGE_ROOT,
    'additions',
    'source-patched',
    'deps',
    'libdeflate',
    'libdeflate.gyp',
  )
  if (existsSync(libdeflateGyp)) {
    sources.push(libdeflateGyp)
  }

  // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
  for (const addDir of [...existingAdditionDirs, ...additionPhaseDirs]) {
    const addFiles = await glob('**/*', {
      absolute: true,
      cwd: addDir,
      ignore: additionsIgnorePatterns,
    })
    sources.push(...addFiles)
  }

  for (let i = 0, { length } = existingScriptDirs; i < length; i += 1) {
    const scriptDir = existingScriptDirs[i]
    const scriptFiles = await glob('*.mts', {
      absolute: true,
      cwd: scriptDir,
    })
    sources.push(...scriptFiles)
  }

  sources.push(__filename)

  // Apply cross-platform normalization and deduplication
  // (e.g., __filename may also be included via scriptDir glob)
  return normalizeAndDedup(sources)
}

/**
 * Normalize and deduplicate an array of file paths.
 *
 * Applies cross-platform path normalization (using @socketsecurity/lib) and
 * removes duplicates. This is a defensive pattern to prevent cache invalidation
 * bugs where the same file path is added multiple times with different formats.
 *
 * @param {string[]} paths - Array of file paths to normalize and deduplicate.
 *
 * @returns {string[]} Array of unique, normalized paths
 */
export function normalizeAndDedup(paths) {
  return [...new Set(paths.map(p => normalizePath(p)))]
}
