/**
 * @file VFS integration tests: fs shim enhancements (part B) —
 *   async access, async lstat, promises.stat/readdir, promises.access/realpath.
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
const testTmpDir = path.join(os.tmpdir(), 'socket-btm-vfs-fs-shim-b-tests')

describe.sequential.skipIf(skipTests)(
  'vFS — fs shim enhancements (part B)',
  () => {
    beforeAll(async () => {
      await safeMkdir(testTmpDir)
    })

    afterAll(async () => {
      await safeDelete(testTmpDir)
    })

    describe('vFS fs shim enhancements', () => {
      it('should support async fs.access() callback', async () => {
        const testDir = path.join(testTmpDir, 'vfs-async-access')
        await safeMkdir(testDir)

        const appJs = path.join(testDir, 'app.js')
        await fs.writeFile(
          appJs,
          `
const fs = require('fs')

const results = []

fs.access('/snapshot/test.txt', fs.constants.R_OK, (err) => {
  if (err) {
    results.push('ACCESS_EXIST_ERROR=' + err.code)
  } else {
    results.push('ACCESS_EXIST_OK=true')
  }

  fs.access('/snapshot/nonexistent.txt', fs.constants.R_OK, (err2) => {
    if (err2) {
      results.push('ACCESS_NOENT_ERROR=' + err2.code)
    } else {
      results.push('ACCESS_NOENT_OK=true')
    }
    console.log(results.join('\\n'))
  })
})
`,
        )

        const vfsDir = path.join(testDir, 'vfs-content')
        await safeMkdir(vfsDir)
        await fs.writeFile(path.join(vfsDir, 'test.txt'), 'content')

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
        expect(execResult.stdout).toContain('ACCESS_EXIST_OK=true')
        expect(execResult.stdout).toContain('ACCESS_NOENT_ERROR=ENOENT')
      })

      it('should support async fs.lstat() callback', async () => {
        const testDir = path.join(testTmpDir, 'vfs-async-lstat')
        await safeMkdir(testDir)

        const appJs = path.join(testDir, 'app.js')
        await fs.writeFile(
          appJs,
          `
const fs = require('fs')

const results = []

fs.lstat('/snapshot/test.txt', (err, stats) => {
  if (err) {
    results.push('LSTAT_ERROR=' + err.code)
  } else {
    results.push('LSTAT_IS_FILE=' + stats.isFile())
    results.push('LSTAT_IS_SYMLINK=' + stats.isSymbolicLink())
    results.push('LSTAT_SIZE=' + stats.size)
  }
  console.log(results.join('\\n'))
})
`,
        )

        const vfsDir = path.join(testDir, 'vfs-content')
        await safeMkdir(vfsDir)
        await fs.writeFile(path.join(vfsDir, 'test.txt'), 'hello')

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
        expect(execResult.stdout).toContain('LSTAT_IS_FILE=true')
        expect(execResult.stdout).toContain('LSTAT_IS_SYMLINK=false')
        expect(execResult.stdout).toContain('LSTAT_SIZE=5')
      })

      it('should support fs.promises.stat() and fs.promises.readdir()', async () => {
        const testDir = path.join(testTmpDir, 'vfs-promises-stat-readdir')
        await safeMkdir(testDir)

        const appJs = path.join(testDir, 'app.js')
        await fs.writeFile(
          appJs,
          `
const fs = require('fs').promises

async function test() {
  const results = []

  try {
    const stats = await fs.stat('/snapshot/test.txt')
    results.push('PROMISE_STAT_IS_FILE=' + stats.isFile())
    results.push('PROMISE_STAT_SIZE=' + stats.size)

    const entries = await fs.readdir('/snapshot')
    results.push('PROMISE_READDIR_COUNT=' + entries.length)
    results.push('PROMISE_READDIR_HAS_FILE=' + entries.includes('test.txt'))
  } catch (e) {
    results.push('PROMISE_ERROR=' + e.code)
  }

  console.log(results.join('\\n'))
}

test()
`,
        )

        const vfsDir = path.join(testDir, 'vfs-content')
        await safeMkdir(vfsDir)
        await fs.writeFile(path.join(vfsDir, 'test.txt'), 'hello world')
        await fs.writeFile(path.join(vfsDir, 'other.txt'), 'other')

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
        expect(execResult.stdout).toContain('PROMISE_STAT_IS_FILE=true')
        expect(execResult.stdout).toContain('PROMISE_STAT_SIZE=11')
        expect(execResult.stdout).toContain('PROMISE_READDIR_HAS_FILE=true')
      })

      it('should support fs.promises.access() and fs.promises.realpath()', async () => {
        const testDir = path.join(testTmpDir, 'vfs-promises-access-realpath')
        await safeMkdir(testDir)

        const appJs = path.join(testDir, 'app.js')
        await fs.writeFile(
          appJs,
          `
const fs = require('fs').promises
const { constants } = require('fs')

async function test() {
  const results = []

  try {
    await fs.access('/snapshot/test.txt', constants.R_OK)
    results.push('PROMISE_ACCESS_OK=true')
  } catch (e) {
    results.push('PROMISE_ACCESS_ERROR=' + e.code)
  }

  try {
    const real = await fs.realpath('/snapshot/test.txt')
    results.push('PROMISE_REALPATH=' + real)
  } catch (e) {
    results.push('PROMISE_REALPATH_ERROR=' + e.code)
  }

  try {
    await fs.access('/snapshot/nonexistent.txt', constants.R_OK)
    results.push('PROMISE_ACCESS_NOENT_OK=true')
  } catch (e) {
    results.push('PROMISE_ACCESS_NOENT_ERROR=' + e.code)
  }

  console.log(results.join('\\n'))
}

test()
`,
        )

        const vfsDir = path.join(testDir, 'vfs-content')
        await safeMkdir(vfsDir)
        await fs.writeFile(path.join(vfsDir, 'test.txt'), 'content')

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
        expect(execResult.stdout).toContain('PROMISE_ACCESS_OK=true')
        expect(execResult.stdout).toContain(
          'PROMISE_REALPATH=/snapshot/test.txt',
        )
        expect(execResult.stdout).toContain('PROMISE_ACCESS_NOENT_ERROR=ENOENT')
      })
    })
  },
)
