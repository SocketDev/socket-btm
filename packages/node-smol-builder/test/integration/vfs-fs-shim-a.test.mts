import { afterAll, beforeAll, describe, expect, it } from 'vitest'
/**
 * @file VFS integration tests: fs shim enhancements (part A) —
 *   async readFile, promises.readFile, async stat/readdir, EROFS errors,
 *   realpathSync.native, and captured fs references.
 *   Requires a built smol binary. Run `pnpm build --dev` first.
 */

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
const testTmpDir = path.join(os.tmpdir(), 'socket-btm-vfs-fs-shim-a-tests')

describe.sequential.skipIf(skipTests)(
  'vFS — fs shim enhancements (part A)',
  () => {
    beforeAll(async () => {
      await safeMkdir(testTmpDir)
    })

    afterAll(async () => {
      await safeDelete(testTmpDir)
    })

    describe('vFS fs shim enhancements', () => {
      it('should support async fs.readFile() callback', async () => {
        const testDir = path.join(testTmpDir, 'vfs-async-readfile')
        await safeMkdir(testDir)

        const appJs = path.join(testDir, 'app.js')
        await fs.writeFile(
          appJs,
          `
const fs = require('fs')

fs.readFile('/snapshot/test.txt', 'utf8', (err, data) => {
  if (err) {
    console.log('ASYNC_READFILE_ERROR=' + err.code)
  } else {
    console.log('ASYNC_READFILE_DATA=' + data)
  }
})
`,
        )

        const vfsDir = path.join(testDir, 'vfs-content')
        await safeMkdir(vfsDir)
        await fs.writeFile(path.join(vfsDir, 'test.txt'), 'async-test-content')

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
        expect(execResult.stdout).toContain(
          'ASYNC_READFILE_DATA=async-test-content',
        )
      })

      it('should support fs.promises.readFile()', async () => {
        const testDir = path.join(testTmpDir, 'vfs-promises-readfile')
        await safeMkdir(testDir)

        const appJs = path.join(testDir, 'app.js')
        await fs.writeFile(
          appJs,
          `
const fs = require('fs').promises

async function test() {
  try {
    const data = await fs.readFile('/snapshot/test.txt', 'utf8')
    console.log('PROMISE_READFILE_DATA=' + data)
  } catch (e) {
    console.log('PROMISE_READFILE_ERROR=' + e.code)
  }
}

test()
`,
        )

        const vfsDir = path.join(testDir, 'vfs-content')
        await safeMkdir(vfsDir)
        await fs.writeFile(
          path.join(vfsDir, 'test.txt'),
          'promise-test-content',
        )

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
        expect(execResult.stdout).toContain(
          'PROMISE_READFILE_DATA=promise-test-content',
        )
      })

      it('should support async fs.stat() and fs.readdir() callbacks', async () => {
        const testDir = path.join(testTmpDir, 'vfs-async-stat-readdir')
        await safeMkdir(testDir)

        const appJs = path.join(testDir, 'app.js')
        await fs.writeFile(
          appJs,
          `
const fs = require('fs')

let results = []

fs.stat('/snapshot/test.txt', (err, stats) => {
  if (err) {
    results.push('STAT_ERROR=' + err.code)
  } else {
    results.push('STAT_IS_FILE=' + stats.isFile())
    results.push('STAT_SIZE=' + stats.size)
  }

  fs.readdir('/snapshot', (err2, files) => {
    if (err2) {
      results.push('READDIR_ERROR=' + err2.code)
    } else {
      results.push('READDIR_FILES=' + files.join(','))
    }
    console.log(results.join('\\n'))
  })
})
`,
        )

        const vfsDir = path.join(testDir, 'vfs-content')
        await safeMkdir(vfsDir)
        await fs.writeFile(path.join(vfsDir, 'test.txt'), 'hello')
        await fs.writeFile(path.join(vfsDir, 'other.txt'), 'world')

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
        expect(execResult.stdout).toContain('STAT_IS_FILE=true')
        expect(execResult.stdout).toContain('STAT_SIZE=5')
        expect(execResult.stdout).toContain('READDIR_FILES=')
        expect(execResult.stdout).toMatch(/test\.txt/)
      })

      it('should throw EROFS for write operations on VFS paths', async () => {
        const testDir = path.join(testTmpDir, 'vfs-erofs')
        await safeMkdir(testDir)

        const appJs = path.join(testDir, 'app.js')
        await fs.writeFile(
          appJs,
          `
const fs = require('fs')

const results = []

try {
  fs.writeFileSync('/snapshot/test.txt', 'data')
  results.push('WRITE_SUCCESS')
} catch (e) {
  results.push('WRITE_ERROR=' + e.code)
}

try {
  fs.unlinkSync('/snapshot/test.txt')
  results.push('UNLINK_SUCCESS')
} catch (e) {
  results.push('UNLINK_ERROR=' + e.code)
}

try {
  fs.mkdirSync('/snapshot/newdir')
  results.push('MKDIR_SUCCESS')
} catch (e) {
  results.push('MKDIR_ERROR=' + e.code)
}

try {
  fs.renameSync('/snapshot/test.txt', '/snapshot/new.txt')
  results.push('RENAME_SUCCESS')
} catch (e) {
  results.push('RENAME_ERROR=' + e.code)
}

console.log(results.join('\\n'))
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
        expect(execResult.stdout).toContain('WRITE_ERROR=EROFS')
        expect(execResult.stdout).toContain('UNLINK_ERROR=EROFS')
        expect(execResult.stdout).toContain('MKDIR_ERROR=EROFS')
        expect(execResult.stdout).toContain('RENAME_ERROR=EROFS')
      })

      it('should support realpathSync.native on VFS paths', async () => {
        const testDir = path.join(testTmpDir, 'vfs-realpath-native')
        await safeMkdir(testDir)

        const appJs = path.join(testDir, 'app.js')
        await fs.writeFile(
          appJs,
          `
const fs = require('fs')

const results = []

try {
  const result = fs.realpathSync.native('/snapshot/test.txt')
  results.push('REALPATH_NATIVE=' + result)
} catch (e) {
  results.push('REALPATH_NATIVE_ERROR=' + e.code)
}

try {
  fs.realpathSync.native('/snapshot/nonexistent.txt')
  results.push('REALPATH_NATIVE_NOENT=no_error')
} catch (e) {
  results.push('REALPATH_NATIVE_NOENT=' + e.code)
}

console.log(results.join('\\n'))
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
        expect(execResult.stdout).toContain(
          'REALPATH_NATIVE=/snapshot/test.txt',
        )
        expect(execResult.stdout).toContain('REALPATH_NATIVE_NOENT=ENOENT')
      })

      it('should work with captured fs references (handler pattern)', async () => {
        const testDir = path.join(testTmpDir, 'vfs-captured-refs')
        await safeMkdir(testDir)

        const appJs = path.join(testDir, 'app.js')
        await fs.writeFile(
          appJs,
          `
const { readFileSync } = require('fs')

const fs = require('fs')
const capturedReadFileSync = fs.readFileSync

try {
  const data1 = readFileSync('/snapshot/test.txt', 'utf8')
  console.log('CAPTURED_DESTRUCTURED=' + data1)

  const data2 = capturedReadFileSync('/snapshot/test.txt', 'utf8')
  console.log('CAPTURED_METHOD=' + data2)
} catch (e) {
  console.log('CAPTURED_ERROR=' + e.message)
}
`,
        )

        const vfsDir = path.join(testDir, 'vfs-content')
        await safeMkdir(vfsDir)
        await fs.writeFile(path.join(vfsDir, 'test.txt'), 'captured-works')

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
        expect(execResult.stdout).toContain(
          'CAPTURED_DESTRUCTURED=captured-works',
        )
        expect(execResult.stdout).toContain('CAPTURED_METHOD=captured-works')
      })
    })
  },
)
