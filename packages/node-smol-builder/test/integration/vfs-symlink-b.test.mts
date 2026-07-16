/**
 * @file VFS integration tests: symlink support (part B) —
 *   promises.readlink, readdirSync withFileTypes detecting symlinks,
 *   and promises.lstat on symlinks.
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
const testTmpDir = path.join(os.tmpdir(), 'socket-btm-vfs-symlink-b-tests')

describe.sequential.skipIf(skipTests)('vFS — symlink support (B)', () => {
  beforeAll(async () => {
    await safeMkdir(testTmpDir)
  })

  afterAll(async () => {
    await safeDelete(testTmpDir)
  })

  describe('vFS symlink support', () => {
    it('should support fs.promises.readlink()', async () => {
      const testDir = path.join(testTmpDir, 'vfs-promise-readlink')
      await safeMkdir(testDir)

      const appJs = path.join(testDir, 'app.js')
      await fs.writeFile(
        appJs,
        `
const fs = require('fs').promises

async function test() {
  const results = []

  try {
    const target = await fs.readlink('/snapshot/link.txt')
    results.push('PROMISE_READLINK_TARGET=' + target)
  } catch (e) {
    results.push('PROMISE_READLINK_ERROR=' + e.code)
  }

  try {
    await fs.readlink('/snapshot/regular.txt')
    results.push('PROMISE_READLINK_EINVAL=no_error')
  } catch (e) {
    results.push('PROMISE_READLINK_EINVAL=' + e.code)
  }

  try {
    await fs.readlink('/snapshot/nonexistent')
    results.push('PROMISE_READLINK_ENOENT=no_error')
  } catch (e) {
    results.push('PROMISE_READLINK_ENOENT=' + e.code)
  }

  console.log(results.join('\\n'))
}

test()
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
      expect(execResult.stdout).toContain('PROMISE_READLINK_TARGET=regular.txt')
      expect(execResult.stdout).toContain('PROMISE_READLINK_EINVAL=EINVAL')
      expect(execResult.stdout).toContain('PROMISE_READLINK_ENOENT=ENOENT')
    })

    it('should support fs.readdirSync() with withFileTypes detecting symlinks', async () => {
      const testDir = path.join(testTmpDir, 'vfs-readdir-symlinks')
      await safeMkdir(testDir)

      const appJs = path.join(testDir, 'app.js')
      await fs.writeFile(
        appJs,
        `
const fs = require('fs')

const results = []

const entries = fs.readdirSync('/snapshot', { withFileTypes: true })
for (const entry of entries) {
  const type = entry.isSymbolicLink() ? 'symlink' : entry.isDirectory() ? 'dir' : 'file'
  results.push('ENTRY=' + entry.name + ':type=' + type)
}

fs.lstat('/snapshot/link.txt', (err, stats) => {
  if (err) {
    results.push('LSTAT_ERROR=' + err.code)
  } else {
    results.push('ASYNC_LSTAT_IS_SYMLINK=' + stats.isSymbolicLink())
  }
  console.log(results.join('\\n'))
})
`,
      )

      const vfsDir = path.join(testDir, 'vfs-content')
      await safeMkdir(vfsDir)
      await safeMkdir(path.join(vfsDir, 'subdir'))
      await fs.writeFile(path.join(vfsDir, 'regular.txt'), 'content')
      await fs.writeFile(path.join(vfsDir, 'subdir', 'nested.txt'), 'nested')
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
      expect(execResult.stdout).toMatch(/ENTRY=link\.txt:type=symlink/)
      expect(execResult.stdout).toMatch(/ENTRY=regular\.txt:type=file/)
      expect(execResult.stdout).toMatch(/ENTRY=subdir:type=dir/)
      expect(execResult.stdout).toContain('ASYNC_LSTAT_IS_SYMLINK=true')
    })

    it('should support fs.promises.lstat() on symlinks', async () => {
      const testDir = path.join(testTmpDir, 'vfs-promise-lstat')
      await safeMkdir(testDir)

      const appJs = path.join(testDir, 'app.js')
      await fs.writeFile(
        appJs,
        `
const fs = require('fs').promises

async function test() {
  const results = []

  try {
    const symlinkStats = await fs.lstat('/snapshot/link.txt')
    results.push('PROMISE_LSTAT_IS_SYMLINK=' + symlinkStats.isSymbolicLink())
    results.push('PROMISE_LSTAT_IS_FILE=' + symlinkStats.isFile())
  } catch (e) {
    results.push('PROMISE_LSTAT_ERROR=' + e.code)
  }

  try {
    const fileStats = await fs.lstat('/snapshot/regular.txt')
    results.push('PROMISE_FILE_LSTAT_IS_SYMLINK=' + fileStats.isSymbolicLink())
    results.push('PROMISE_FILE_LSTAT_IS_FILE=' + fileStats.isFile())
  } catch (e) {
    results.push('PROMISE_FILE_LSTAT_ERROR=' + e.code)
  }

  console.log(results.join('\\n'))
}

test()
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
      expect(execResult.stdout).toContain('PROMISE_LSTAT_IS_SYMLINK=true')
      expect(execResult.stdout).toContain('PROMISE_LSTAT_IS_FILE=false')
      expect(execResult.stdout).toContain('PROMISE_FILE_LSTAT_IS_SYMLINK=false')
      expect(execResult.stdout).toContain('PROMISE_FILE_LSTAT_IS_FILE=true')
    })
  })
})
