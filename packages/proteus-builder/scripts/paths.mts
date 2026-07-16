export * from '../../../scripts/fleet/paths.mts'

/**
 * @file Proteus-builder path owner (1 path, 1 reference). Inherits the repo-root
 *   path constants above, then adds the daemon-binary path so build.mts and the
 *   lifecycle test reference one computed value instead of re-joining segments.
 */

import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

/**
 * The daemon binary's base name. Windows appends `.exe`.
 */
export const PROTEUS_BINARY_NAME = 'proteus'

/**
 * The build output directory for a mode + platform-arch, matching common.mk's
 * `build/<mode>/<platform-arch>/out/Final/`.
 */
export function getProteusFinalOutDir(
  mode: string,
  platformArch: string,
): string {
  return path.join(packageRoot, 'build', mode, platformArch, 'out', 'Final')
}

/**
 * The fully-resolved daemon binary path for a mode + platform-arch.
 */
export function getProteusBinaryPath(
  mode: string,
  platformArch: string,
): string {
  const name =
    process.platform === 'win32'
      ? `${PROTEUS_BINARY_NAME}.exe`
      : PROTEUS_BINARY_NAME
  return path.join(getProteusFinalOutDir(mode, platformArch), name)
}
