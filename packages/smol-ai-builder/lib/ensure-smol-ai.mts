/**
 * Public API for smol-ai-builder.
 *
 * Mirrors the rest of the fleet's builder helper surface so callers can treat
 * the native addon as a first-class packaged artifact.
 */

import { createPrebuiltApi } from 'build-infra/lib/ensure-prebuilt'
import { getAssetPlatformArch } from 'build-infra/lib/platform-mappings'

import { detectLibc } from '@socketsecurity/lib-stable/releases/socket-btm'

import { SMOL_AI_REQUIRED_FILES } from './required-files.mts'
import { getBuildDir, packageRoot } from '../scripts/paths.mts'

export function getCurrentSmolAiPlatformArch(): string {
  const libc = detectLibc()
  const arch = process.env['TARGET_ARCH'] || process.arch
  return getAssetPlatformArch(process.platform, arch, libc)
}

export function getSmolAiLocalBuildDir(platformArch: string): string {
  return getBuildDir('prod', platformArch)
}

const api = createPrebuiltApi({
  getCurrentPlatformArch: getCurrentSmolAiPlatformArch,
  getLocalBuildDir: getSmolAiLocalBuildDir,
  name: 'smol-ai-napi',
  packageRoot,
  requiredFiles: SMOL_AI_REQUIRED_FILES,
})

export const downloadPrebuiltSmolAi = api.downloadPrebuilt
export const ensureSmolAi = api.ensure
export const getDownloadedSmolAiDir = api.getDownloadedDir
export const smolAiExists = api.exists
export const smolAiExistsAt = api.existsAt
export const verifySmolAiAt = api.verifyAt
