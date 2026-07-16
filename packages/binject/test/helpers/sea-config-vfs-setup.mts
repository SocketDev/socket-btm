/**
 * @file Shared beforeAll setup for the SEA config VFS test suites (main +
 *   error/edge-case sibling). Builds a temp test dir with a copied node
 *   binary and .tar/.tar.gz VFS archives. Split out so both files stay
 *   under the file-size soft cap without duplicating the archive setup.
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { makeExecutable } from 'build-infra/lib/build-helpers'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { MAX_NODE_BINARY_SIZE } from './constants.mts'
import { execCommand } from './exec-command-with-output.mts'

const logger = getDefaultLogger()

export interface SeaConfigVfsFixture {
  binjectExists: boolean
  nodeBinary: string | undefined
  testDir: string
}

/**
 * Create the shared temp test dir, copy in a node binary, and build the
 * .tar/.tar.gz VFS archive fixtures the suite injects.
 */
export async function setupSeaConfigVfsTestDir(
  findNodeBinary: () => Promise<string | undefined>,
  dirPrefix: string,
): Promise<SeaConfigVfsFixture> {
  const testDir = await fs.mkdtemp(path.join(os.tmpdir(), dirPrefix))

  // Find suitable Node.js binary for testing.
  const foundBinary = await findNodeBinary()

  if (!foundBinary) {
    return { binjectExists: false, nodeBinary: undefined, testDir }
  }

  // Check if binary is small enough for binject.
  // oxlint-disable-next-line socket/prefer-exists-sync -- access(X_OK) checks executable permission, not just existence; stats.size verifies non-empty binary; existsSync can't substitute for either.
  const stats = await fs.stat(foundBinary)
  if (stats.size > MAX_NODE_BINARY_SIZE) {
    logger.warn(
      `Node binary too large for binject tests: ${(stats.size / 1024 / 1024).toFixed(2)}MB > ${MAX_NODE_BINARY_SIZE / 1024 / 1024}MB`,
    )
    return { binjectExists: false, nodeBinary: undefined, testDir }
  }

  // Copy node binary to testDir.
  const ext = os.platform() === 'win32' ? '.exe' : ''
  const nodeBinary = path.join(testDir, `node-copy${ext}`)
  await fs.copyFile(foundBinary, nodeBinary)
  await makeExecutable(nodeBinary)

  // Create test VFS content directory.
  const vfsDir = path.join(testDir, 'node_modules')
  await fs.mkdir(vfsDir, { recursive: true })
  await fs.writeFile(
    path.join(vfsDir, 'test.json'),
    JSON.stringify({ name: 'test', version: '1.0.0' }),
  )
  await fs.writeFile(path.join(vfsDir, 'test.js'), "console.log('test');\n")

  // Create .tar archive.
  await execCommand('tar', ['-cf', 'vfs-test.tar', '-C', 'node_modules', '.'], {
    cwd: testDir,
  })

  // Create .tar.gz archive.
  await execCommand(
    'tar',
    ['-czf', 'vfs-test.tar.gz', '-C', 'node_modules', '.'],
    {
      cwd: testDir,
    },
  )

  return { binjectExists: true, nodeBinary, testDir }
}
