/**
 * @fileoverview Shared test directory helper.
 *
 * Creates isolated temp directories for integration tests with a symlinked
 * node_modules so spawned binaries can resolve devDependencies (e.g., snappy).
 *
 * Cross-platform: uses junction on Windows (no admin required) and symlink
 * on POSIX. Cleans up on dispose.
 */

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { fileURLToPath } from 'node:url'

import { safeDelete } from '@socketsecurity/lib/fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..')

/**
 * Create an isolated test directory with a symlinked node_modules.
 *
 * @param {string} name - Directory name suffix (e.g., 'vfs-tests')
 * @returns {Promise<{ dir: string, cleanup: () => Promise<void> }>}
 */
export async function createTestDir(name) {
  const dir = path.join(os.tmpdir(), `socket-btm-${name}-${Date.now()}`)
  await fs.mkdir(dir, { recursive: true })

  // Symlink node_modules so spawned binaries can resolve packages.
  // Uses 'junction' on Windows (no admin privileges required).
  const nmLink = path.join(dir, 'node_modules')
  if (!existsSync(nmLink)) {
    const target = path.join(PACKAGE_ROOT, 'node_modules')
    const type = os.platform() === 'win32' ? 'junction' : undefined
    await fs.symlink(target, nmLink, type)
  }

  return {
    dir,
    cleanup: () => safeDelete(dir),
  }
}
