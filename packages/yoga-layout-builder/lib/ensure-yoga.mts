/**
 * Public API for yoga-layout-builder.
 *
 * Mirrors lib/ensure-X.mts shape across the fleet (lief, curl, libpq,
 * dawn). Yoga is consumed by node:smol-tui at boot, so downstream
 * (node-smol-builder's build-released) can `await ensureYoga()` to
 * resolve the WASM bundle + JS glue: local build → already-downloaded
 * → fetch-from-gh-release.
 *
 * Built on the shared factory in `build-infra/lib/ensure-prebuilt.mts`.
 *
 * Note on the layout: Yoga's prebuilt tarball is platform-independent
 * (Emscripten WASM). Per-platform-arch directories under
 * `build/downloaded/yoga/<platformArch>/` collapse to identical
 * contents — we pay one download per platform for cache locality
 * rather than a single shared download.
 */

import { createPrebuiltApi } from 'build-infra/lib/ensure-prebuilt'
import { getAssetPlatformArch } from 'build-infra/lib/platform-mappings'

import { detectLibc } from '@socketsecurity/lib-stable/releases/socket-btm'

import { YOGA_REQUIRED_FILES } from './required-files.mts'
import { getBuildPaths, PACKAGE_ROOT } from '../scripts/paths.mts'

// Sync libc detection + sync platform-arch resolution.
export function getCurrentYogaPlatformArch(): string {
  const libc = detectLibc()
  const arch = process.env.TARGET_ARCH || process.arch
  return getAssetPlatformArch(process.platform, arch, libc)
}

// Yoga's getBuildPaths returns an object with `outputFinalDir` — the
// dir containing yoga.wasm + yoga.mjs etc. Point the factory at the
// prod outputFinalDir; required-files lookup runs relative to it.
export function getYogaLocalBuildDir(platformArch: string): string {
  return getBuildPaths('prod', platformArch).outputFinalDir
}

const api = createPrebuiltApi({
  getCurrentPlatformArch: getCurrentYogaPlatformArch,
  getLocalBuildDir: getYogaLocalBuildDir,
  name: 'yoga',
  packageRoot: PACKAGE_ROOT,
  requiredFiles: YOGA_REQUIRED_FILES,
})

export const downloadPrebuiltYoga = api.downloadPrebuilt
export const ensureYoga = api.ensure
export const getDownloadedYogaDir = api.getDownloadedDir
export const verifyYogaAt = api.verifyAt
export const yogaExists = api.exists
export const yogaExistsAt = api.existsAt
