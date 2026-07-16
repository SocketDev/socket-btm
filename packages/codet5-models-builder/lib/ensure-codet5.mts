/**
 * Public API for codet5-models-builder.
 *
 * Mirrors lib/ensure-X.mts shape across the fleet. Built on the
 * shared factory in `build-infra/lib/ensure-prebuilt.mts`.
 *
 * CodeT5 produces quantized ONNX encoder/decoder pairs + tokenizer/config.
 * Tier-1b — published independently for socket-cli + other downstream
 * consumers, NOT linked into node-smol.
 *
 * Canonical published artifact: prod build with int4 quantization
 * (smaller models). Dev / int8 stays local-only.
 */

import { createPrebuiltApi } from 'build-infra/lib/ensure-prebuilt'
import { getAssetPlatformArch } from 'build-infra/lib/platform-mappings'

import { detectLibc } from '@socketsecurity/lib-stable/releases/socket-btm'

import { CODET5_REQUIRED_FILES } from './required-files.mts'
import { getBuildPaths, PACKAGE_ROOT } from '../scripts/paths.mts'

// Published quant level is int4 (smaller binaries). int8 is local-dev only.
const CODET5_PUBLISHED_QUANT = 'int4'

export function getCodet5LocalBuildDir(platformArch: string): string {
  return getBuildPaths('prod', platformArch, CODET5_PUBLISHED_QUANT).outputDir
}

// Sync libc detection + sync platform-arch resolution.
export function getCurrentCodet5PlatformArch(): string {
  const libc = detectLibc()
  const arch = process.env['TARGET_ARCH'] || process.arch
  return getAssetPlatformArch(process.platform, arch, libc)
}

const api = createPrebuiltApi({
  getCurrentPlatformArch: getCurrentCodet5PlatformArch,
  getLocalBuildDir: getCodet5LocalBuildDir,
  name: 'codet5',
  packageRoot: PACKAGE_ROOT,
  requiredFiles: CODET5_REQUIRED_FILES,
})

export const codet5Exists = api.exists
export const codet5ExistsAt = api.existsAt
export const downloadPrebuiltCodet5 = api.downloadPrebuilt
export const ensureCodet5 = api.ensure
export const getDownloadedCodet5Dir = api.getDownloadedDir
export const verifyCodet5At = api.verifyAt
