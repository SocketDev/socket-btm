/**
 * Public API for boringssl-builder. Mirrors lief-builder's ensure-lief
 * shape: createPrebuiltApi() factory wires the local-build → already-
 * downloaded → fetch-prebuilt fall-through. The factory expects a sysroot-
 * shaped `getLocalBuildDir` that contains `lib/` + `include/` subdirs;
 * boringssl-builder's out/Final tree matches that contract by design.
 */

import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { BUILD_STAGES, getPlatformBuildDir } from 'build-infra/lib/constants'
import { createPrebuiltApi } from 'build-infra/lib/ensure-prebuilt'
import { getAssetPlatformArch } from 'build-infra/lib/platform-mappings'

import { detectLibc } from '@socketsecurity/lib-stable/releases/socket-btm'

import { BORINGSSL_REQUIRED_FILES } from './required-files.mts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.resolve(__dirname, '..')

export function getBoringsslLocalBuildDir(platformArch: string): string {
  const buildDir = getPlatformBuildDir(PACKAGE_ROOT, platformArch)
  return path.join(buildDir, 'out', BUILD_STAGES.FINAL)
}

export function getCurrentBoringsslPlatformArch(): string {
  const libc = detectLibc()
  const arch = process.env['TARGET_ARCH'] || process.arch
  return getAssetPlatformArch(process.platform, arch, libc)
}

const api = createPrebuiltApi({
  getCurrentPlatformArch: getCurrentBoringsslPlatformArch,
  getLocalBuildDir: getBoringsslLocalBuildDir,
  name: 'boringssl',
  packageRoot: PACKAGE_ROOT,
  requiredFiles: BORINGSSL_REQUIRED_FILES,
})

export const downloadPrebuiltBoringssl = api.downloadPrebuilt
export const ensureBoringssl = api.ensure
export const getDownloadedBoringsslDir = api.getDownloadedDir
export const boringsslExists = api.exists
export const boringsslExistsAt = api.existsAt
export const verifyBoringsslAt = api.verifyAt
