import { afterAll, beforeAll, describe, expect, it } from 'vitest'
/**
 * @file VFS integration tests: SEA fuse injection, TAR archive creation,
 *   and SEA + VFS dual resource injection.
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
import { runBinject, SMOL_VFS_BLOB } from '../helpers/binject.mts'
import { getLatestFinalBinary } from '../paths.mts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const finalBinaryPath = getLatestFinalBinary()
const skipTests = !finalBinaryPath || !existsSync(finalBinaryPath)
const testTmpDir = path.join(os.tmpdir(), 'socket-btm-vfs-sea-tar-tests')

describe.sequential.skipIf(skipTests)(
  'vFS — SEA fuse, TAR archive creation, dual injection',
  () => {
    beforeAll(async () => {
      await safeMkdir(testTmpDir)
    })

    afterAll(async () => {
      await safeDelete(testTmpDir)
    })

    describe('sEA fuse injection', () => {
      it('should support NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 sentinel', async () => {
        const testDir = path.join(testTmpDir, 'sea-fuse')
        await safeMkdir(testDir)

        const appJs = path.join(testDir, 'app.js')
        await fs.writeFile(appJs, `console.log('SEA fuse works');`)

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

        const injectResult = await runBinject(
          seaBinary,
          'NODE_SEA_BLOB',
          'sea-config.json',
          {
            machoSegmentName: MACHO_SEGMENT_NODE_SEA,
            sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
            testDir,
          },
        )
        expect(injectResult.code).toBe(0)

        const execResult = await spawn(seaBinary, [])
        expect(execResult.code).toBe(0)
        expect(execResult.stdout).toContain('SEA fuse works')
      })
    })

    describe('vFS TAR archive creation', () => {
      it('should create uncompressed TAR archive', async () => {
        const testDir = path.join(testTmpDir, 'tar-uncompressed')
        await safeMkdir(testDir)

        const vfsDir = path.join(testDir, 'vfs-content')
        await safeMkdir(vfsDir)
        await fs.writeFile(path.join(vfsDir, 'hello.txt'), 'Hello VFS')
        await fs.writeFile(path.join(vfsDir, 'data.json'), '{"test":true}')

        await safeMkdir(path.join(vfsDir, 'subdir'))
        await fs.writeFile(path.join(vfsDir, 'subdir', 'nested.txt'), 'Nested')

        const tarPath = path.join(testDir, 'vfs.tar')
        const tarResult = await spawn(
          'tar',
          ['cf', tarPath, '-C', vfsDir, '.'],
          {
            cwd: testDir,
          },
        )
        expect(tarResult.code).toBe(0)
        expect(existsSync(tarPath)).toBeTruthy()

        const listResult = await spawn('tar', ['tf', tarPath])
        expect(listResult.stdout).toContain('hello.txt')
        expect(listResult.stdout).toContain('data.json')
        expect(listResult.stdout).toContain('subdir/nested.txt')
      })

      it('should create compressed TAR.GZ archive', async () => {
        const testDir = path.join(testTmpDir, 'tar-compressed')
        await safeMkdir(testDir)

        const vfsDir = path.join(testDir, 'vfs-content')
        await safeMkdir(vfsDir)
        await fs.writeFile(path.join(vfsDir, 'large.txt'), 'X'.repeat(10_000))

        const tarGzPath = path.join(testDir, 'vfs.tar.gz')
        const tarResult = await spawn(
          'tar',
          ['czf', tarGzPath, '-C', vfsDir, '.'],
          { cwd: testDir },
        )
        expect(tarResult.code).toBe(0)
        expect(existsSync(tarGzPath)).toBeTruthy()

        const tarSize =
          // oxlint-disable-next-line socket/prefer-exists-sync -- file tests the VFS surface itself; fs.stat()/fs.access()/fs.statSync() calls verify VFS metadata fidelity (size/mode) AND appear inside test-fixture JS source executed by the SEA binary.
          (await fs.stat(path.join(testDir, '../tar-uncompressed/vfs.tar')))
            .size || 10_000
        // oxlint-disable-next-line socket/prefer-exists-sync -- file tests the VFS surface itself; fs.stat()/fs.access()/fs.statSync() calls verify VFS metadata fidelity (size/mode) AND appear inside test-fixture JS source executed by the SEA binary.
        const tarGzSize = (await fs.stat(tarGzPath)).size
        expect(tarGzSize).toBeLessThan(tarSize)
      })
    })

    describe('vFS + SEA dual resource injection', () => {
      it(`should inject both NODE_SEA_BLOB and ${SMOL_VFS_BLOB}`, async () => {
        const testDir = path.join(testTmpDir, 'dual-injection')
        await safeMkdir(testDir)

        const appJs = path.join(testDir, 'app.js')
        await fs.writeFile(
          appJs,
          `
const fs = require('fs')
const path = require('path')

const smolVfs = require('node:smol-vfs')

if (smolVfs.hasVFS()) {
  console.log('VFS_AVAILABLE')
  console.log('VFS_INITIALIZED')
  console.log('VFS_SIZE=' + smolVfs.size())
} else {
  console.log('VFS_NOT_AVAILABLE')
}
`,
        )

        const seaConfig = path.join(testDir, 'sea-config.json')
        await fs.writeFile(
          seaConfig,
          JSON.stringify({
            disableExperimentalSEAWarning: true,
            main: 'app.js',
            output: 'app.blob',
          }),
        )

        const vfsDir = path.join(testDir, 'vfs-content')
        await safeMkdir(vfsDir)
        await fs.writeFile(path.join(vfsDir, 'test.txt'), 'VFS file content')

        const vfsTar = path.join(testDir, 'vfs.tar')
        await spawn('tar', ['cf', vfsTar, '-C', vfsDir, '.'], {
          env: { ...process.env, COPYFILE_DISABLE: '1' },
        })

        const seaBinary = path.join(testDir, 'app')
        await fs.copyFile(finalBinaryPath, seaBinary)
        await makeExecutable(seaBinary)

        const injectResult = await runBinject(
          seaBinary,
          'BOTH',
          { sea: 'sea-config.json', vfs: vfsTar },
          {
            machoSegmentName: MACHO_SEGMENT_NODE_SEA,
            sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
            testDir,
          },
        )
        expect(injectResult.code).toBe(0)

        const execResult = await spawn(seaBinary, [])
        expect(execResult.code).toBe(0)
        expect(execResult.stdout).toContain('VFS_AVAILABLE')
        expect(execResult.stdout).toContain('VFS_INITIALIZED')
        expect(execResult.stdout).toContain('VFS_SIZE=')
      })
    })
  },
)
