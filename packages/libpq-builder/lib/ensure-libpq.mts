/**
 * Public API for libpq-builder.
 *
 * Migrated to use the shared `build-infra/lib/ensure-prebuilt` factory
 * for the local-build → already-downloaded → fetch-prebuilt fall-through
 * pattern. Per-builder customization lives in this file's config block.
 *
 * Symbol compatibility: every export name retained from the prior
 * re-export-from-scripts/build.mts shape so any downstream consumers
 * (currently zero in the fleet — verified via grep) stay buildable.
 *
 * EnsureLibpq(options?) → Promise<string> factory.ensure
 * downloadLibpq(options?) → Promise<string|undefined> factory.downloadPrebuilt
 * libpqExistsAt(dir) → boolean factory.existsAt getCheckpointChain() → string[]
 * libpq-specific (here)
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createPrebuiltApi } from 'build-infra/lib/ensure-prebuilt'
import {
  BUILD_STAGES,
  CHECKPOINTS,
  getPlatformBuildDir,
} from 'build-infra/lib/constants'
import { getAssetPlatformArch } from 'build-infra/lib/platform-mappings'

import { detectLibc } from '@socketsecurity/lib-stable/releases/socket-btm'

import { LIBPQ_REQUIRED_FILES } from './required-files.mts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// libpq-builder doesn't ship a scripts/paths.mts (unlike dawn/yoga/
// opentui), so compute PACKAGE_ROOT locally — matches the pattern in
// scripts/build.mts at line 64.
const PACKAGE_ROOT = path.resolve(__dirname, '..')

// libpq has no dependencies on other socket-btm packages, so the
// checkpoint chain is a single FINALIZED checkpoint. Kept here
// (not via the factory) because the factory is platform/asset-
// scoped and doesn't know about CHECKPOINTS.
export function getCheckpointChain(): string[] {
  return [CHECKPOINTS.FINALIZED]
}

// Sync libc detection + sync platform-arch resolution (mirrors
// lief-builder's getCurrentLiefPlatformArch and matches what
// scripts/build.mts:getAssetPlatformArch(...) did inline).
export function getCurrentLibpqPlatformArch(): string {
  const libc = detectLibc()
  const arch = process.env['TARGET_ARCH'] || process.arch
  return getAssetPlatformArch(process.platform, arch, libc)
}

// libpq's CMake island-build produces libpq.a at
// <buildDir>/out/<FINAL>/libpq/. Mirrors scripts/build.mts:getBuildDirs().
export function getLibpqLocalBuildDir(platformArch: string): string {
  const buildDir = getPlatformBuildDir(PACKAGE_ROOT, platformArch)
  return path.join(buildDir, 'out', BUILD_STAGES.FINAL, 'libpq')
}

const api = createPrebuiltApi({
  getCurrentPlatformArch: getCurrentLibpqPlatformArch,
  getLocalBuildDir: getLibpqLocalBuildDir,
  name: 'libpq',
  packageRoot: PACKAGE_ROOT,
  requiredFiles: LIBPQ_REQUIRED_FILES,
})

// Public API exports.
//
// Two naming conventions are exposed simultaneously:
//   - Legacy (preserved from the original scripts/build.mts re-exports):
//     downloadLibpq, ensureLibpq, libpqExistsAt
//   - Factory-canonical (uniform across all builders via the
//     build-infra/lib/ensure-prebuilt factory):
//     downloadPrebuiltLibpq, libpqExists, verifyLibpqAt, getDownloadedLibpqDir
//
// New consumers should prefer the factory-canonical names. Legacy
// names will be removed once no fleet importer uses them.
export const downloadLibpq = api.downloadPrebuilt
export const downloadPrebuiltLibpq = api.downloadPrebuilt
export const ensureLibpq = api.ensure
export const getDownloadedLibpqDir = api.getDownloadedDir
export const libpqExists = api.exists
export const libpqExistsAt = api.existsAt
export const verifyLibpqAt = api.verifyAt
