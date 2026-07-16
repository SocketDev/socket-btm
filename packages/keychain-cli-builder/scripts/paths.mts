/**
 * @file Canonical build-output paths for the standalone socket-keychain CLI.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

export const KEYCHAIN_CLI_BINARY_NAME = 'socket-keychain'

export function getKeychainCliOutDir(
  mode: string,
  platformArch: string,
): string {
  return path.join(packageRoot, 'build', mode, platformArch, 'out', 'Final')
}

export function getKeychainCliBinaryPath(
  mode: string,
  platformArch: string,
): string {
  const suffix = platformArch.startsWith('win32-') ? '.exe' : ''
  return path.join(
    getKeychainCliOutDir(mode, platformArch),
    `${KEYCHAIN_CLI_BINARY_NAME}${suffix}`,
  )
}
