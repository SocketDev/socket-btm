/**
 * @file VFS integration tests: symlink support (part A) —
 *   lstatSync/readlinkSync, EINVAL on non-symlinks, async readlink callback.
 *   Requires a built smol binary. Run `pnpm build --dev` first.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { makeExecutable } from 'build-infra/lib/build-helpers'

import { safeDelete, safeMkdir } from '@socketsecurity/lib-stable/fs/safe'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { MACHO_SEGMENT_NODE_SEA } from 'bin-infra/test/helpers/segment-names'
import { runBinject } from '../helpers/binject.mts'
import { getLatestFinalBinary } from '../paths.mts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const finalBinaryPath = getLatestFinalBinary()
const skipTests = !finalBinaryPath || !existsSync(finalBinaryPath)
const testTmpDir = path.join(os.tmpdir(), 'socket-btm-vfs-symlink-a-tests')

describe.sequential.skipIf(skipTests)('vFS — symlink support (A)', () => {
  beforeAll(async () => {
    await safeMkdir(testTmpDir)
  })

  afterAll(async () => {
    await safeDelete(testTmpDir)
  })

  describe('vFS symlink support', () => {
    it('should support fs.lstatSync() and fs.readlinkSync() on symlinks', async () => {
      const testDir = path.join(testTmpDir, 'vfs-symlinks')
      await safeMkdir(testDir)

      const appJs = path.join(testDir, 'app.js')
      await fs.writeFile(
        appJs,
        `
const fs = require('fs')

const results = []

const symlinkStats = fs.lstatSync('/snapshot/link-to-file.txt')
results.push('LSTAT_IS_SYMLINK=' + symlinkStats.isSymbolicLink())
results.push('LSTAT_IS_FILE=' + symlinkStats.isFile())
results.push('LSTAT_IS_DIRECTORY=' + symlinkStats.isDirectory())

const linkTarget = fs.readlinkSync('/snapshot/link-to-file.txt')
results.push('READLINK_TARGET=' + linkTarget)

const dirLinkStats = fs.lstatSync('/snapshot/link-to-dir')
results.push('DIR_LSTAT_IS_SYMLINK=' + dirLinkStats.isSymbolicLink())
results.push('DIR_LSTAT_IS_DIRECTORY=' + dirLinkStats.isDirectory())

const dirLinkTarget = fs.readlinkSync('/snapshot/link-to-dir')
results.push('DIR_READLINK_TARGET=' + dirLinkTarget)

const fileStats = fs.lstatSync('/snapshot/target.txt')
results.push('FILE_LSTAT_IS_SYMLINK=' + fileStats.isSymbolicLink())
results.push('FILE_LSTAT_IS_FILE=' + fileStats.isFile())

console.log(results.join('\\n'))
`,
      )

      const vfsDir = path.join(testDir, 'vfs-content')
      await safeMkdir(vfsDir)
      await safeMkdir(path.join(vfsDir, 'subdir'))
      await fs.writeFile(path.join(vfsDir, 'target.txt'), 'target content')
      await fs.writeFile(path.join(vfsDir, 'subdir', 'nested.txt'), 'nested')

      await fs.symlink('target.txt', path.join(vfsDir, 'link-to-file.txt'))
      await fs.symlink('subdir', path.join(vfsDir, 'link-to-dir'))

      const vfsTar = path.join(testDir, 'vfs.tar')
      await spawn('tar', ['cf', vfsTar, '-C', vfsDir, '.'], {
        env: { ...process.env, COPYFILE_DISABLE: '1' },
      })

      const tarListResult = await spawn('tar', ['tvf', vfsTar])
      expect(tarListResult.stdout).toContain('link-to-file.txt')
      expect(tarListResult.stdout).toContain('link-to-dir')

      const seaConfig = path.join(testDir, 'sea-config.json')
      await fs.writeFile(
        seaConfig,
        JSON.stringify({
          disableExperimentalSEAWarning: true,
          main: 'app.js',
          output: 'app.blob',
        }),
      )

      const seaBinary = path.join(testDir, 'app')
      await fs.copyFile(finalBinaryPath, seaBinary)
      await makeExecutable(seaBinary)

      await runBinject(
        seaBinary,
        'BOTH',
        { sea: 'sea-config.json', vfs: vfsTar },
        {
          machoSegmentName: MACHO_SEGMENT_NODE_SEA,
          sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
          testDir,
        },
      )

      const execResult = await spawn(seaBinary, [])
      expect(execResult.code).toBe(0)
      expect(execResult.stdout).toContain('LSTAT_IS_SYMLINK=true')
      expect(execResult.stdout).toContain('LSTAT_IS_FILE=false')
      expect(execResult.stdout).toContain('LSTAT_IS_DIRECTORY=false')
      expect(execResult.stdout).toContain('READLINK_TARGET=target.txt')
      expect(execResult.stdout).toContain('DIR_LSTAT_IS_SYMLINK=true')
      expect(execResult.stdout).toContain('DIR_LSTAT_IS_DIRECTORY=false')
      expect(execResult.stdout).toContain('DIR_READLINK_TARGET=subdir')
      expect(execResult.stdout).toContain('FILE_LSTAT_IS_SYMLINK=false')
      expect(execResult.stdout).toContain('FILE_LSTAT_IS_FILE=true')
    })

    it('should throw EINVAL when readlinkSync is called on non-symlink', async () => {
      const testDir = path.join(testTmpDir, 'vfs-readlink-einval')
      await safeMkdir(testDir)

      const appJs = path.join(testDir, 'app.js')
      await fs.writeFile(
        appJs,
        `
const fs = require('fs')

const results = []

try {
  fs.readlinkSync('/snapshot/regular.txt')
  results.push('REGULAR_FILE_SUCCESS')
} catch (e) {
  results.push('REGULAR_FILE_ERROR=' + e.code)
}

try {
  fs.readlinkSync('/snapshot/subdir')
  results.push('DIRECTORY_SUCCESS')
} catch (e) {
  results.push('DIRECTORY_ERROR=' + e.code)
}

try {
  fs.readlinkSync('/snapshot/nonexistent')
  results.push('NONEXISTENT_SUCCESS')
} catch (e) {
  results.push('NONEXISTENT_ERROR=' + e.code)
}

console.log(results.join('\\n'))
`,
      )

      const vfsDir = path.join(testDir, 'vfs-content')
      await safeMkdir(vfsDir)
      await safeMkdir(path.join(vfsDir, 'subdir'))
      await fs.writeFile(path.join(vfsDir, 'regular.txt'), 'regular content')
      await fs.writeFile(path.join(vfsDir, 'subdir', 'nested.txt'), 'nested')

      const vfsTar = path.join(testDir, 'vfs.tar')
      await spawn('tar', ['cf', vfsTar, '-C', vfsDir, '.'], {
        env: { ...process.env, COPYFILE_DISABLE: '1' },
      })

      const seaConfig = path.join(testDir, 'sea-config.json')
      await fs.writeFile(
        seaConfig,
        JSON.stringify({
          disableExperimentalSEAWarning: true,
          main: 'app.js',
          output: 'app.blob',
        }),
      )

      const seaBinary = path.join(testDir, 'app')
      await fs.copyFile(finalBinaryPath, seaBinary)
      await makeExecutable(seaBinary)

      await runBinject(
        seaBinary,
        'BOTH',
        { sea: 'sea-config.json', vfs: vfsTar },
        {
          machoSegmentName: MACHO_SEGMENT_NODE_SEA,
          sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
          testDir,
        },
      )

      const execResult = await spawn(seaBinary, [])
      expect(execResult.code).toBe(0)
      expect(execResult.stdout).toContain('REGULAR_FILE_ERROR=EINVAL')
      expect(execResult.stdout).toContain('DIRECTORY_ERROR=EINVAL')
      expect(execResult.stdout).toContain('NONEXISTENT_ERROR=ENOENT')
    })

    it('should support async fs.readlink() callback', async () => {
      const testDir = path.join(testTmpDir, 'vfs-async-readlink')
      await safeMkdir(testDir)

      const appJs = path.join(testDir, 'app.js')
      await fs.writeFile(
        appJs,
        `
const fs = require('fs')

const results = []

fs.readlink('/snapshot/link.txt', (err, target) => {
  if (err) {
    results.push('ASYNC_READLINK_ERROR=' + err.code)
  } else {
    results.push('ASYNC_READLINK_TARGET=' + target)
  }

  fs.readlink('/snapshot/regular.txt', (err2, target2) => {
    if (err2) {
      results.push('ASYNC_READLINK_EINVAL=' + err2.code)
    } else {
      results.push('ASYNC_READLINK_EINVAL_TARGET=' + target2)
    }
    console.log(results.join('\\n'))
  })
})
`,
      )

      const vfsDir = path.join(testDir, 'vfs-content')
      await safeMkdir(vfsDir)
      await fs.writeFile(path.join(vfsDir, 'regular.txt'), 'content')
      await fs.symlink('regular.txt', path.join(vfsDir, 'link.txt'))

      const vfsTar = path.join(testDir, 'vfs.tar')
      await spawn('tar', ['cf', vfsTar, '-C', vfsDir, '.'], {
        env: { ...process.env, COPYFILE_DISABLE: '1' },
      })

      const seaConfig = path.join(testDir, 'sea-config.json')
      await fs.writeFile(
        seaConfig,
        JSON.stringify({
          disableExperimentalSEAWarning: true,
          main: 'app.js',
          output: 'app.blob',
        }),
      )

      const seaBinary = path.join(testDir, 'app')
      await fs.copyFile(finalBinaryPath, seaBinary)
      await makeExecutable(seaBinary)

      await runBinject(
        seaBinary,
        'BOTH',
        { sea: 'sea-config.json', vfs: vfsTar },
        {
          machoSegmentName: MACHO_SEGMENT_NODE_SEA,
          sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
          testDir,
        },
      )

      const execResult = await spawn(seaBinary, [])
      expect(execResult.code).toBe(0)
      expect(execResult.stdout).toContain('ASYNC_READLINK_TARGET=regular.txt')
      expect(execResult.stdout).toContain('ASYNC_READLINK_EINVAL=EINVAL')
    })
  })
})
