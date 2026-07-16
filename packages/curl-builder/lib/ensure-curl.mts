/**
 * Public API for curl-builder.
 *
 * Migrated to use the shared `build-infra/lib/ensure-prebuilt` factory
 * for the local-build → already-downloaded → fetch-prebuilt fall-through
 * pattern.
 *
 * Downstream consumers (verified via grep):
 * - bin-infra/lib/build-stubs.mts (1 ensureCurl() call)
 * - bin-stub-builder/scripts/build.mts (1 ensureCurl() call)
 *
 * Both consume the return value as a directory string. Factory's
 * ensure() also returns a directory string; behavior preserved.
 *
 * Symbol compatibility: every export name retained from the prior
 * re-export-from-scripts/build.mts shape — both legacy + factory-
 * canonical names exposed (see end of file).
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

import { CURL_REQUIRED_FILES } from './required-files.mts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// curl-builder doesn't ship a scripts/paths.mts (unlike dawn/yoga/
// opentui), so compute PACKAGE_ROOT locally — matches the pattern in
// scripts/build.mts.
const PACKAGE_ROOT = path.resolve(__dirname, '..')

// curl-builder has no upstream dependencies on other socket-btm
// packages, so the checkpoint chain is a single FINALIZED checkpoint.
// Kept here (not via the factory) because the factory is platform/
// asset-scoped and doesn't know about CHECKPOINTS.
export function getCheckpointChain(): string[] {
  return [CHECKPOINTS.FINALIZED]
}

// curl's CMake build produces libcurl.a + mbedTLS at
// <buildDir>/out/<FINAL>/curl/dist/. Mirrors scripts/build.mts:
// `const localDir = path.join(curlBuildDir, 'dist')` where
// curlBuildDir = getBuildDirs(arch).curlBuildDir.
export function getCurlLocalBuildDir(platformArch: string): string {
  const buildDir = getPlatformBuildDir(PACKAGE_ROOT, platformArch)
  return path.join(buildDir, 'out', BUILD_STAGES.FINAL, 'curl', 'dist')
}

// Sync libc detection + sync platform-arch resolution. The existing
// scripts/build.mts:ensureCurl() called the async
// getCurrentPlatformArch() from platform-mappings; here we use the
// sync detectLibc() + getAssetPlatformArch() pair so the factory's
// sync config signature is satisfied. Result is byte-identical for
// the asset-lookup path.
export function getCurrentCurlPlatformArch(): string {
  const libc = detectLibc()
  const arch = process.env['TARGET_ARCH'] || process.arch
  return getAssetPlatformArch(process.platform, arch, libc)
}

const api = createPrebuiltApi({
  getCurrentPlatformArch: getCurrentCurlPlatformArch,
  getLocalBuildDir: getCurlLocalBuildDir,
  name: 'curl',
  packageRoot: PACKAGE_ROOT,
  requiredFiles: CURL_REQUIRED_FILES,
})

// Public API exports.
//
// Two naming conventions are exposed simultaneously:
//   - Legacy (preserved from the original scripts/build.mts re-exports;
//     in-use by bin-infra/lib/build-stubs.mts + bin-stub-builder/scripts/
//     build.mts as `ensureCurl`):
//     curlExistsAt, downloadCurl, ensureCurl
//   - Factory-canonical (uniform across all builders):
//     curlExists, downloadPrebuiltCurl, verifyCurlAt, getDownloadedCurlDir
//
// New consumers should prefer the factory-canonical names. Legacy
// names will be removed once no fleet importer uses them.
export const curlExists = api.exists
export const curlExistsAt = api.existsAt
export const downloadCurl = api.downloadPrebuilt
export const downloadPrebuiltCurl = api.downloadPrebuilt
export const ensureCurl = api.ensure
export const getDownloadedCurlDir = api.getDownloadedDir
export const verifyCurlAt = api.verifyAt
