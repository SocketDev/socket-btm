export * from '../../../scripts/fleet/paths.mts'

/**
 * @file Keychain-addon-builder path owner (1 path, 1 reference). Inherits the
 *   repo-root path constants, then owns the keychain.node output path so
 *   build.mts and the test reference one computed value.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

/**
 * The addon's file name. socket-addon republishes it as
 * @socketaddon/keychain-*.
 */
export const KEYCHAIN_ADDON_NAME = 'keychain.node'

/**
 * The build output dir for a mode + platform-arch (matches common.mk layout).
 */
export function getKeychainAddonOutDir(
  mode: string,
  platformArch: string,
): string {
  return path.join(packageRoot, 'build', mode, platformArch, 'out', 'Final')
}

/**
 * The fully-resolved keychain.node path for a mode + platform-arch.
 */
export function getKeychainAddonBinaryPath(
  mode: string,
  platformArch: string,
): string {
  return path.join(
    getKeychainAddonOutDir(mode, platformArch),
    KEYCHAIN_ADDON_NAME,
  )
}
