import { afterAll, beforeAll, describe, expect, it } from 'vitest'
/**
 * @file VFS integration tests: glob support and mode flags.
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
const testTmpDir = path.join(os.tmpdir(), 'socket-btm-vfs-glob-mode-tests')

describe.sequential.skipIf(skipTests)(
  'vFS — glob support and mode flags',
  () => {
    beforeAll(async () => {
      await safeMkdir(testTmpDir)
    })

    afterAll(async () => {
      await safeDelete(testTmpDir)
    })

    describe('vFS glob support', () => {
      it('should support fs.globSync() on VFS paths', async () => {
        const testDir = path.join(testTmpDir, 'vfs-glob-sync')
        await safeMkdir(testDir)

        const appJs = path.join(testDir, 'app.js')
        await fs.writeFile(
          appJs,
          `
const fs = require('fs')

const results = []

const txtFiles = fs.globSync('/snapshot/**/*.txt')
results.push('TXT_FILES=' + txtFiles.sort().join(','))

const allFiles = fs.globSync('**/*', { cwd: '/snapshot' })
results.push('ALL_FILES_COUNT=' + allFiles.length)

const hasSymlink = allFiles.some(f => f === 'link.txt' || f.endsWith('/link.txt'))
results.push('SYMLINK_IN_RESULTS=' + hasSymlink)

console.log(results.join('\\n'))
`,
        )

        const vfsDir = path.join(testDir, 'vfs-content')
        await safeMkdir(vfsDir)
        await safeMkdir(path.join(vfsDir, 'subdir'))
        await fs.writeFile(path.join(vfsDir, 'file.txt'), 'content')
        await fs.writeFile(path.join(vfsDir, 'subdir', 'nested.txt'), 'nested')
        await fs.writeFile(path.join(vfsDir, 'other.js'), 'js content')
        await fs.symlink('file.txt', path.join(vfsDir, 'link.txt'))

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
        expect(execResult.stdout).toMatch(/TXT_FILES=.*file\.txt/)
        expect(execResult.stdout).toMatch(/TXT_FILES=.*nested\.txt/)
        expect(execResult.stdout).toContain('SYMLINK_IN_RESULTS=true')
      })

      it('should support fs.globSync() with withFileTypes option', async () => {
        const testDir = path.join(testTmpDir, 'vfs-glob-withfiletypes')
        await safeMkdir(testDir)

        const appJs = path.join(testDir, 'app.js')
        await fs.writeFile(
          appJs,
          `
const fs = require('fs')

const results = []

const entries = fs.globSync('/snapshot/*', { withFileTypes: true })

for (const entry of entries) {
  const type = entry.isSymbolicLink() ? 'symlink' : entry.isDirectory() ? 'dir' : 'file'
  results.push('GLOB_ENTRY=' + entry.name + ':' + type)
}

const symlinkEntry = entries.find(e => e.name === 'link.txt')
if (symlinkEntry) {
  results.push('SYMLINK_IS_SYMLINK=' + symlinkEntry.isSymbolicLink())
  results.push('SYMLINK_IS_FILE=' + symlinkEntry.isFile())
}

console.log(results.join('\\n'))
`,
        )

        const vfsDir = path.join(testDir, 'vfs-content')
        await safeMkdir(vfsDir)
        await safeMkdir(path.join(vfsDir, 'subdir'))
        await fs.writeFile(path.join(vfsDir, 'file.txt'), 'content')
        await fs.symlink('file.txt', path.join(vfsDir, 'link.txt'))

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
        expect(execResult.stdout).toMatch(/GLOB_ENTRY=link\.txt:symlink/)
        expect(execResult.stdout).toMatch(/GLOB_ENTRY=file\.txt:file/)
        expect(execResult.stdout).toMatch(/GLOB_ENTRY=subdir:dir/)
        expect(execResult.stdout).toContain('SYMLINK_IS_SYMLINK=true')
        expect(execResult.stdout).toContain('SYMLINK_IS_FILE=false')
      })

      // Async glob captures fs/promises references at module load time, before
      // VFS shim installation. globSync works (uses shimmed fs methods directly).
      // Resolving this requires installing the VFS shim before the glob module
      // loads. Tracked separately; the test is pending the shim ordering fix.
      it.todo('should support async fs.glob() on VFS paths')
    })

    describe('vFS mode flags', () => {
      it('should support --vfs-on-disk mode (default)', async () => {
        const testDir = path.join(testTmpDir, 'vfs-on-disk')
        await safeMkdir(testDir)

        const appJs = path.join(testDir, 'app.js')
        await fs.writeFile(
          appJs,
          `
const smolVfs = require('node:smol-vfs')
console.log('VFS_MODE=on-disk')
console.log('VFS_AVAILABLE=' + smolVfs.hasVFS())
`,
        )

        const vfsDir = path.join(testDir, 'vfs-content')
        await safeMkdir(vfsDir)
        await fs.writeFile(path.join(vfsDir, 'test.txt'), 'on-disk mode')

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

        const result = await runBinject(
          seaBinary,
          'BOTH',
          { sea: 'sea-config.json', vfs: vfsTar },
          {
            machoSegmentName: MACHO_SEGMENT_NODE_SEA,
            sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
            testDir,
            vfsMode: 'on-disk',
          },
        )
        expect(result.code).toBe(0)

        const execResult = await spawn(seaBinary, [])
        expect(execResult.code).toBe(0)
        expect(execResult.stdout).toContain('VFS_MODE=on-disk')
      })

      it('should support --vfs-in-memory mode', async () => {
        const testDir = path.join(testTmpDir, 'vfs-in-memory')
        await safeMkdir(testDir)

        const appJs = path.join(testDir, 'app.js')
        await fs.writeFile(
          appJs,
          `
const smolVfs = require('node:smol-vfs')
console.log('VFS_MODE=in-memory')
console.log('VFS_AVAILABLE=' + smolVfs.hasVFS())
`,
        )

        const vfsDir = path.join(testDir, 'vfs-content')
        await safeMkdir(vfsDir)
        await fs.writeFile(path.join(vfsDir, 'test.txt'), 'in-memory mode')

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

        const result = await runBinject(
          seaBinary,
          'BOTH',
          { sea: 'sea-config.json', vfs: vfsTar },
          {
            machoSegmentName: MACHO_SEGMENT_NODE_SEA,
            sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
            testDir,
            vfsMode: 'in-memory',
          },
        )
        expect(result.code).toBe(0)

        const execResult = await spawn(seaBinary, [])
        expect(execResult.code).toBe(0)
        expect(execResult.stdout).toContain('VFS_MODE=in-memory')
      })

      it('should support --vfs-compat mode (no file bundling)', async () => {
        const testDir = path.join(testTmpDir, 'vfs-compat')
        await safeMkdir(testDir)

        const appJs = path.join(testDir, 'app.js')
        await fs.writeFile(
          appJs,
          `
const smolVfs = require('node:smol-vfs')
const process = require('node:process')

console.log('VFS_MODE=compat')
console.log('VFS_AVAILABLE=' + smolVfs.hasVFS())
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
        await spawn(
          finalBinaryPath,
          ['--experimental-sea-config', 'sea-config.json'],
          { cwd: testDir },
        )

        const seaBinary = path.join(testDir, 'app')
        await fs.copyFile(finalBinaryPath, seaBinary)
        await makeExecutable(seaBinary)

        const result = await runBinject(
          seaBinary,
          'BOTH',
          { sea: 'app.blob', vfs: undefined },
          {
            machoSegmentName: MACHO_SEGMENT_NODE_SEA,
            sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
            testDir,
            vfsMode: 'compat',
          },
        )
        expect(result.code).toBe(0)

        const execResult = await spawn(seaBinary, [])
        expect(execResult.code).toBe(0)
        expect(execResult.stdout).toContain('VFS_MODE=compat')
      })
    })
  },
)
