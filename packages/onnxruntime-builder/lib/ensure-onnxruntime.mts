/**
 * Public API for onnxruntime-builder.
 *
 * Mirrors the lib/ensure-X.mts shape across the fleet (lief, curl,
 * libpq, dawn, yoga, opentui). Built on the shared factory in
 * `build-infra/lib/ensure-prebuilt.mts`.
 *
 * ORT's Emscripten build produces a WASM bundle + JS glue (same
 * shape as yoga). The artifact is platform-independent but we
 * still partition the downloaded cache per platform-arch for
 * locality with the rest of the prebuilt-asset layout.
 */

import { createPrebuiltApi } from 'build-infra/lib/ensure-prebuilt'
import { getAssetPlatformArch } from 'build-infra/lib/platform-mappings'

import { detectLibc } from '@socketsecurity/lib-stable/releases/socket-btm'

import { ONNXRUNTIME_REQUIRED_FILES } from './required-files.mts'
import { getBuildPaths, PACKAGE_ROOT } from '../scripts/paths.mts'

// Sync libc detection + sync platform-arch resolution.
export function getCurrentOnnxruntimePlatformArch(): string {
  const libc = detectLibc()
  const arch = process.env['TARGET_ARCH'] || process.arch
  return getAssetPlatformArch(process.platform, arch, libc)
}

// ORT's getBuildPaths returns `outputFinalDir` containing ort.wasm +
// ort.mjs etc. Point the factory there for the required-files check.
export function getOnnxruntimeLocalBuildDir(platformArch: string): string {
  return getBuildPaths('prod', platformArch).outputFinalDir
}

const api = createPrebuiltApi({
  getCurrentPlatformArch: getCurrentOnnxruntimePlatformArch,
  getLocalBuildDir: getOnnxruntimeLocalBuildDir,
  name: 'onnxruntime',
  packageRoot: PACKAGE_ROOT,
  requiredFiles: ONNXRUNTIME_REQUIRED_FILES,
})

export const downloadPrebuiltOnnxruntime = api.downloadPrebuilt
export const ensureOnnxruntime = api.ensure
export const getDownloadedOnnxruntimeDir = api.getDownloadedDir
export const onnxruntimeExists = api.exists
export const onnxruntimeExistsAt = api.existsAt
export const verifyOnnxruntimeAt = api.verifyAt
