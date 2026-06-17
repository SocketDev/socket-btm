/**
 * Public API for minilm-builder.
 *
 * Mirrors lib/ensure-X.mts shape across the fleet. Built on the
 * shared factory in `build-infra/lib/ensure-prebuilt.mts`.
 *
 * MiniLM produces a quantized ONNX embedding model + tokenizer files
 * under modelsDir. Tier-1b — published independently for socket-cli +
 * other downstream consumers, NOT linked into node-smol.
 *
 * Canonical published artifact: prod build with int4 quantization
 * (smaller models). Build mode and quant level are coupled in minilm
 * (int4 -> prod, int8 -> dev) per scripts/build.mts:70-71.
 */

import { createPrebuiltApi } from 'build-infra/lib/ensure-prebuilt'
import { getAssetPlatformArch } from 'build-infra/lib/platform-mappings'

import { detectLibc } from '@socketsecurity/lib-stable/releases/socket-btm'

import { MINILM_REQUIRED_FILES } from './required-files.mts'
import { getBuildPaths, PACKAGE_ROOT } from '../scripts/paths.mts'

// Sync libc detection + sync platform-arch resolution.
export function getCurrentMinilmPlatformArch(): string {
  const libc = detectLibc()
  const arch = process.env.TARGET_ARCH || process.arch
  return getAssetPlatformArch(process.platform, arch, libc)
}

// Published quant level is int4 → prod build mode (per build.mts).
const MINILM_PUBLISHED_QUANT = 'int4'

export function getMinilmLocalBuildDir(platformArch: string): string {
  return getBuildPaths('prod', platformArch, MINILM_PUBLISHED_QUANT).modelsDir
}

const api = createPrebuiltApi({
  getCurrentPlatformArch: getCurrentMinilmPlatformArch,
  getLocalBuildDir: getMinilmLocalBuildDir,
  name: 'minilm',
  packageRoot: PACKAGE_ROOT,
  requiredFiles: MINILM_REQUIRED_FILES,
})

export const downloadPrebuiltMinilm = api.downloadPrebuilt
export const ensureMinilm = api.ensure
export const getDownloadedMinilmDir = api.getDownloadedDir
export const minilmExists = api.exists
export const minilmExistsAt = api.existsAt
export const verifyMinilmAt = api.verifyAt
