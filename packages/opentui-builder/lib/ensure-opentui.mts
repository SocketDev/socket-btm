/**
 * Public API for opentui-builder.
 *
 * Mirrors lib/ensure-X.mts shape across the fleet (lief, curl, libpq,
 * dawn, yoga). Built on the shared factory in
 * `build-infra/lib/ensure-prebuilt.mts`.
 *
 * OpenTUI's Zig build produces a Node-API native binding `.node`
 * per platform-arch. The factory's local-build resolution uses the
 * zig-target subdirectory under `build/<mode>/<platformArch>/out/`.
 */

import path from 'node:path'

import { createPrebuiltApi } from 'build-infra/lib/ensure-prebuilt'
import { getAssetPlatformArch } from 'build-infra/lib/platform-mappings'

import { detectLibc } from '@socketsecurity/lib-stable/releases/socket-btm'

import { OPENTUI_REQUIRED_FILES } from './required-files.mts'
import {
  PACKAGE_ROOT,
  ZIG_TARGETS,
  getBuildPaths,
} from '../scripts/paths.mts'

// Sync libc detection + sync platform-arch resolution.
export function getCurrentOpentuiPlatformArch(): string {
  const libc = detectLibc()
  const arch = process.env.TARGET_ARCH || process.arch
  return getAssetPlatformArch(process.platform, arch, libc)
}

// OpenTUI's getBuildPaths().getPlatformOutputPath(platform) returns
// the path to `out/<zig-target>/opentui.node`. The required-files
// check expects a directory containing `opentui.node`, so resolve
// the parent of that path.
export function getOpentuiLocalBuildDir(platformArch: string): string {
  const zigTarget = (ZIG_TARGETS as Record<string, string>)[platformArch]
  if (!zigTarget) {
    throw new Error(
      `OpenTUI has no zig-target mapping for platformArch '${platformArch}'. ` +
        `Known targets: ${Object.keys(ZIG_TARGETS).join(', ')}.`,
    )
  }
  const paths = getBuildPaths('prod', platformArch)
  return path.dirname(paths.getPlatformOutputPath(zigTarget))
}

const api = createPrebuiltApi({
  getCurrentPlatformArch: getCurrentOpentuiPlatformArch,
  getLocalBuildDir: getOpentuiLocalBuildDir,
  name: 'opentui',
  packageRoot: PACKAGE_ROOT,
  requiredFiles: OPENTUI_REQUIRED_FILES,
})

export const downloadPrebuiltOpentui = api.downloadPrebuilt
export const ensureOpentui = api.ensure
export const getDownloadedOpentuiDir = api.getDownloadedDir
export const opentuiExists = api.exists
export const opentuiExistsAt = api.existsAt
export const verifyOpentuiAt = api.verifyAt
