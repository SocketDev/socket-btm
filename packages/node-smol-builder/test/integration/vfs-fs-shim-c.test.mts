/**
 * @file VFS integration tests: fs shim enhancements (part C) —
 *   existsSync, readdirSync withFileTypes, and EISDIR error.
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
const testTmpDir = path.join(os.tmpdir(), 'socket-btm-vfs-fs-shim-c-tests')

describe.sequential.skipIf(skipTests)(
  'vFS — fs shim enhancements (part C)',
  () => {
    beforeAll(async () => {
      await safeMkdir(testTmpDir)
    })

    afterAll(async () => {
      await safeDelete(testTmpDir)
    })

    describe('vFS fs shim enhancements', () => {
      it('should support fs.existsSync() on VFS paths', async () => {
        const testDir = path.join(testTmpDir, 'vfs-exists-sync')
        await safeMkdir(testDir)

        const appJs = path.join(testDir, 'app.js')
        await fs.writeFile(
          appJs,
          `
const fs = require('fs')

const results = []

results.push('EXISTS_FILE=' + fs.existsSync('/snapshot/test.txt'))
results.push('EXISTS_DIR=' + fs.existsSync('/snapshot/subdir'))
results.push('EXISTS_NOENT=' + fs.existsSync('/snapshot/nonexistent.txt'))

console.log(results.join('\\n'))
`,
        )

        const vfsDir = path.join(testDir, 'vfs-content')
        await safeMkdir(vfsDir)
        await safeMkdir(path.join(vfsDir, 'subdir'))
        await fs.writeFile(path.join(vfsDir, 'test.txt'), 'content')
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
        expect(execResult.stdout).toContain('EXISTS_FILE=true')
        expect(execResult.stdout).toContain('EXISTS_DIR=true')
        expect(execResult.stdout).toContain('EXISTS_NOENT=false')
      })

      it('should support fs.readdirSync() with withFileTypes option', async () => {
        const testDir = path.join(testTmpDir, 'vfs-readdir-filetypes')
        await safeMkdir(testDir)

        const appJs = path.join(testDir, 'app.js')
        await fs.writeFile(
          appJs,
          `
const fs = require('fs')

const results = []

const entries = fs.readdirSync('/snapshot', { withFileTypes: true })
for (const entry of entries) {
  results.push('ENTRY=' + entry.name + ':isFile=' + entry.isFile() + ':isDir=' + entry.isDirectory())
}

console.log(results.join('\\n'))
`,
        )

        const vfsDir = path.join(testDir, 'vfs-content')
        await safeMkdir(vfsDir)
        await safeMkdir(path.join(vfsDir, 'subdir'))
        await fs.writeFile(path.join(vfsDir, 'file.txt'), 'content')
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
        expect(execResult.stdout).toMatch(
          /ENTRY=file\.txt:isFile=true:isDir=false/,
        )
        expect(execResult.stdout).toMatch(
          /ENTRY=subdir:isFile=false:isDir=true/,
        )
      })

      it('should throw EISDIR when reading directory as file', async () => {
        const testDir = path.join(testTmpDir, 'vfs-eisdir')
        await safeMkdir(testDir)

        const appJs = path.join(testDir, 'app.js')
        await fs.writeFile(
          appJs,
          `
const fs = require('fs')

try {
  fs.readFileSync('/snapshot/subdir')
  console.log('READ_SUCCESS')
} catch (e) {
  console.log('READ_ERROR=' + e.code)
}
`,
        )

        const vfsDir = path.join(testDir, 'vfs-content')
        await safeMkdir(vfsDir)
        await safeMkdir(path.join(vfsDir, 'subdir'))
        await fs.writeFile(path.join(vfsDir, 'subdir', 'file.txt'), 'content')

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
        expect(execResult.stdout).toContain('READ_ERROR=EISDIR')
      })
    })
  },
)
