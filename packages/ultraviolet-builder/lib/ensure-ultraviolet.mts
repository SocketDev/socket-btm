/**
 * Public API for ultraviolet-builder.
 *
 * Mirrors lib/ensure-X.mts shape across the fleet. Built on the
 * shared factory in `build-infra/lib/ensure-prebuilt.mts`.
 *
 * Ultraviolet's Go napi-go build produces a `.node` per platform-arch
 * landing under `lib/<platformArch>/ultraviolet.node`. Tier-1b — TUI
 * library, not yet integrated into node-smol.
 */

import path from 'node:path'

import { createPrebuiltApi } from 'build-infra/lib/ensure-prebuilt'
import { getAssetPlatformArch } from 'build-infra/lib/platform-mappings'

import { detectLibc } from '@socketsecurity/lib-stable/releases/socket-btm'

import { ULTRAVIOLET_REQUIRED_FILES } from './required-files.mts'
import { LIB_DIR, PACKAGE_ROOT } from '../scripts/paths.mts'

// Sync libc detection + sync platform-arch resolution.
export function getCurrentUltravioletPlatformArch(): string {
  const libc = detectLibc()
  const arch = process.env.TARGET_ARCH || process.arch
  return getAssetPlatformArch(process.platform, arch, libc)
}

// Ultraviolet's binding lives at `lib/<platformArch>/ultraviolet.node`.
// Factory's required-files check runs at the per-platform install dir.
export function getUltravioletLocalBuildDir(platformArch: string): string {
  return path.join(LIB_DIR, platformArch)
}

const api = createPrebuiltApi({
  getCurrentPlatformArch: getCurrentUltravioletPlatformArch,
  getLocalBuildDir: getUltravioletLocalBuildDir,
  name: 'ultraviolet',
  packageRoot: PACKAGE_ROOT,
  requiredFiles: ULTRAVIOLET_REQUIRED_FILES,
})

export const downloadPrebuiltUltraviolet = api.downloadPrebuilt
export const ensureUltraviolet = api.ensure
export const getDownloadedUltravioletDir = api.getDownloadedDir
export const ultravioletExists = api.exists
export const ultravioletExistsAt = api.existsAt
export const verifyUltravioletAt = api.verifyAt
