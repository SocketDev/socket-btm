/**
 * Public API for lief-builder.
 *
 * Migrated to use the shared `build-infra/lib/ensure-prebuilt` factory
 * for the local-build → already-downloaded → fetch-prebuilt fall-through
 * pattern.
 *
 * Downstream consumers (verified via grep):
 *
 * - Binpress/scripts/build.mts + test.mts (ensureLief)
 * - Binject/scripts/build.mts + test.mts (ensureLief)
 * - Lief-builder/test/ensure-lief.test.mts (every export above)
 *
 * All consume ensureLief() as a directory string. Factory's ensure()
 * also returns a directory string — behavior preserved.
 *
 * LIEF-specific wrinkles preserved:
 *
 * - Required-files manifest handles MSVC (LIEF.lib) vs Unix (libLIEF.a) naming
 *   alternation. The factory's verifyAt walks the alternation correctly because
 *   LIEF_REQUIRED_FILES uses the array-of-alternatives shape `[['libLIEF.a',
 *   'LIEF.lib'], ...]`.
 * - GetLiefLibPath(arch) resolves to the actual lib path within the install dir
 *   (factory only resolves the dir; the lib name disambiguation is
 *   per-builder).
 *
 * Symbol compatibility: every export name retained — both legacy
 * names + factory-canonical names exposed (see end of file).
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createPrebuiltApi } from 'build-infra/lib/ensure-prebuilt'
import { BUILD_STAGES, getPlatformBuildDir } from 'build-infra/lib/constants'
import { getAssetPlatformArch } from 'build-infra/lib/platform-mappings'

import { detectLibc } from '@socketsecurity/lib-stable/releases/socket-btm'

import { LIEF_REQUIRED_FILES } from './required-files.mts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// lief-builder doesn't ship a scripts/paths.mts (unlike dawn/yoga/
// opentui), so compute PACKAGE_ROOT locally.
const PACKAGE_ROOT = path.resolve(__dirname, '..')

// Sync libc detection + sync platform-arch resolution. The existing
// scripts/build.mts:getCurrentLiefPlatformArch used the same pair.
export function getCurrentLiefPlatformArch(): string {
  const libc = detectLibc()
  const arch = process.env['TARGET_ARCH'] || process.arch
  return getAssetPlatformArch(process.platform, arch, libc)
}

// Return the LIEF lib path for the current (or specified) platform-arch.
// Mirrors scripts/build.mts:getLiefLibPath.
export function getLiefLibPath(platformArch?: string): string | undefined {
  const resolvedPlatformArch = platformArch ?? getCurrentLiefPlatformArch()
  return getLiefLibPathAt(getLiefLocalBuildDir(resolvedPlatformArch))
}

// Resolve the actual LIEF lib file within `dir`, handling the MSVC
// vs Unix naming alternation:
//   - Unix / MinGW: libLIEF.a
//   - MSVC on Windows: LIEF.lib
// Returns the resolved path, or `undefined` if neither file exists.
export function getLiefLibPathAt(dir: string): string | undefined {
  const unixPath = path.join(dir, 'libLIEF.a')
  if (existsSync(unixPath)) {
    return unixPath
  }
  const msvcPath = path.join(dir, 'LIEF.lib')
  if (existsSync(msvcPath)) {
    return msvcPath
  }
  return undefined
}

// LIEF's CMake build produces the static library at
// <buildDir>/out/<FINAL>/lief/. Mirrors scripts/build.mts:
// getLiefBuildDirs(arch).liefBuildDir.
export function getLiefLocalBuildDir(platformArch: string): string {
  const buildDir = getPlatformBuildDir(PACKAGE_ROOT, platformArch)
  return path.join(buildDir, 'out', BUILD_STAGES.FINAL, 'lief')
}

const api = createPrebuiltApi({
  getCurrentPlatformArch: getCurrentLiefPlatformArch,
  getLocalBuildDir: getLiefLocalBuildDir,
  name: 'lief',
  packageRoot: PACKAGE_ROOT,
  requiredFiles: LIEF_REQUIRED_FILES,
})

// Public API exports.
//
// Two naming conventions are exposed simultaneously:
//   - Legacy (preserved from the original scripts/build.mts re-exports;
//     in-use by binpress + binject scripts as `ensureLief`):
//     ensureLief, liefExists, liefExistsAt, verifyLiefAt, getLiefLibPath
//   - Factory-canonical (uniform across all builders):
//     downloadPrebuiltLief, getDownloadedLiefDir
//
// New consumers should prefer the factory-canonical names. Legacy
// names will be removed once no fleet importer uses them.
export const downloadPrebuiltLief = api.downloadPrebuilt
export const ensureLief = api.ensure
export const getDownloadedLiefDir = api.getDownloadedDir
export const liefExists = api.exists
export const liefExistsAt = api.existsAt
export const verifyLiefAt = api.verifyAt
