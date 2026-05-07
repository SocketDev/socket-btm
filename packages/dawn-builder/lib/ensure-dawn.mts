/**
 * Public API for dawn-builder.
 *
 * Mirrors the lib/ensure-X.mts shape used by lief-builder, curl-builder,
 * libpq-builder. Downstream consumers (node-smol-builder's build-released
 * step) call `ensureDawn()` to get a Dawn install directory ready for the
 * link step: local build → already-downloaded → fetch-from-gh-release
 * fall-through.
 *
 * Built on top of the shared factory in
 * `build-infra/lib/ensure-prebuilt.mts` — each builder's lib/ensure-X.mts
 * is just configuration (name, required-files, build-dir resolver).
 *
 * Surface:
 *
 *   ensureDawn(options?) -> Promise<string>
 *     Resolve the Dawn install dir. Throws if all three fall-through
 *     branches fail.
 *
 *   dawnExists(platformArch?) -> boolean
 *     Quick check whether the local build is complete.
 *
 *   dawnExistsAt(dir) -> boolean
 *     Same shape as the LIEF / curl / libpq helpers.
 *
 *   downloadPrebuiltDawn(options?) -> Promise<string | undefined>
 *     Just the download leg of `ensureDawn`. Returns the extract dir
 *     on success, undefined on failure (caller decides whether to
 *     fall through to source build).
 *
 *   verifyDawnAt(dir) -> { valid, missing }
 *     Required-files validation with the missing-files list.
 *
 *   getDownloadedDawnDir(platformArch) -> string
 *     Where downloaded tarballs land.
 */

import { createPrebuiltApi } from 'build-infra/lib/ensure-prebuilt'
import { getAssetPlatformArch } from 'build-infra/lib/platform-mappings'

import { detectLibc } from '@socketsecurity/lib-stable/releases/socket-btm'

import { DAWN_REQUIRED_FILES } from './required-files.mts'
import { PACKAGE_ROOT, getBuildPaths } from '../scripts/paths.mts'

// Sync libc detection + sync platform-arch resolution (same shape as
// lief-builder's getCurrentLiefPlatformArch). The async
// getCurrentPlatformArch() from platform-mappings.mts is for callers
// that read /etc/alpine-release etc. on disk; the sync detectLibc()
// suffices for the prebuilt-asset lookup path.
export function getCurrentDawnPlatformArch(): string {
  const libc = detectLibc()
  const arch = process.env.TARGET_ARCH || process.arch
  return getAssetPlatformArch(process.platform, arch, libc)
}

// Dawn produces a single mode-prod artifact for release. Dev builds
// stay local — the published prebuilt is always built with
// `--mode=prod`, so we point the factory at the prod install dir.
export function getDawnLocalBuildDir(platformArch: string): string {
  return getBuildPaths('prod', platformArch).outputDir
}

const api = createPrebuiltApi({
  getCurrentPlatformArch: getCurrentDawnPlatformArch,
  getLocalBuildDir: getDawnLocalBuildDir,
  name: 'dawn',
  packageRoot: PACKAGE_ROOT,
  requiredFiles: DAWN_REQUIRED_FILES,
})

export const dawnExists = api.exists
export const dawnExistsAt = api.existsAt
export const downloadPrebuiltDawn = api.downloadPrebuilt
export const ensureDawn = api.ensure
export const getDownloadedDawnDir = api.getDownloadedDir
export const verifyDawnAt = api.verifyAt
