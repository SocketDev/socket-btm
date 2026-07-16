import { afterAll, beforeAll, describe, expect, it } from 'vitest'
/**
 * @file VFS integration tests: TAR format support, extraction path validation,
 *   directory extraction with smolVfs.mountSync(), and file permissions.
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
const testTmpDir = path.join(os.tmpdir(), 'socket-btm-vfs-tar-format-tests')

describe.sequential.skipIf(skipTests)(
  'vFS — TAR format, path validation, mountSync, permissions',
  () => {
    beforeAll(async () => {
      await safeMkdir(testTmpDir)
    })

    afterAll(async () => {
      await safeDelete(testTmpDir)
    })

    describe('vFS TAR format support', () => {
      it('should support .tar (uncompressed) format', async () => {
        const testDir = path.join(testTmpDir, 'tar-format')
        await safeMkdir(testDir)

        const appJs = path.join(testDir, 'app.js')
        await fs.writeFile(
          appJs,
          `
const smolVfs = require('node:smol-vfs')
if (smolVfs.hasVFS()) {
  console.log('TAR_FORMAT=success')
  console.log('VFS_SIZE=' + smolVfs.size())
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
        await fs.writeFile(path.join(vfsDir, 'test.txt'), 'TAR format test')

        const vfsTar = path.join(testDir, 'vfs.tar')
        await spawn('tar', ['cf', vfsTar, '-C', vfsDir, '.'], {
          env: { ...process.env, COPYFILE_DISABLE: '1' },
        })

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
        expect(execResult.stdout).toContain('TAR_FORMAT=success')
      })

      it('should support .tgz (gzip-compressed TAR) format', async () => {
        const testDir = path.join(testTmpDir, 'tgz-format')
        await safeMkdir(testDir)

        const appJs = path.join(testDir, 'app.js')
        await fs.writeFile(
          appJs,
          `
const smolVfs = require('node:smol-vfs')
if (smolVfs.hasVFS()) {
  console.log('TGZ_FORMAT=success')
  console.log('VFS_SIZE=' + smolVfs.size())
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
        await fs.writeFile(path.join(vfsDir, 'test.txt'), 'TGZ format test')

        const vfsTgz = path.join(testDir, 'vfs.tgz')
        await spawn('tar', ['czf', vfsTgz, '-C', vfsDir, '.'], {
          env: { ...process.env, COPYFILE_DISABLE: '1' },
        })

        const seaBinary = path.join(testDir, 'app')
        await fs.copyFile(finalBinaryPath, seaBinary)
        await makeExecutable(seaBinary)

        await runBinject(
          seaBinary,
          'BOTH',
          { sea: 'sea-config.json', vfs: vfsTgz },
          {
            machoSegmentName: MACHO_SEGMENT_NODE_SEA,
            sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
            testDir,
          },
        )

        const execResult = await spawn(seaBinary, [])
        expect(execResult.code).toBe(0)
        expect(execResult.stdout).toContain('TGZ_FORMAT=success')
      })

      it('should support PAX extended headers for long filenames', async () => {
        const testDir = path.join(testTmpDir, 'tar-pax')
        await safeMkdir(testDir)

        const vfsDir = path.join(testDir, 'vfs-content')
        await safeMkdir(vfsDir)
        const longName = `${'a'.repeat(150)}.txt`
        await fs.writeFile(path.join(vfsDir, longName), 'Long name content')

        const tarPath = path.join(testDir, 'vfs.tar')
        await spawn('tar', ['cf', tarPath, '--format=posix', '-C', vfsDir, '.'])

        expect(existsSync(tarPath)).toBeTruthy()

        const listResult = await spawn('tar', ['tf', tarPath])
        expect(listResult.stdout).toContain(longName)
      })
    })

    describe('directory extraction with smolVfs.mountSync()', () => {
      it('should recursively extract directories using mountSync()', async () => {
        const testDir = path.join(testTmpDir, 'mount-directory')
        await safeMkdir(testDir)

        const appJs = path.join(testDir, 'app.js')
        await fs.writeFile(
          appJs,
          `
const fs = require('fs')
const path = require('path')
const smolVfs = require('node:smol-vfs')

if (smolVfs.hasVFS() && typeof smolVfs.mountSync === 'function') {
  try {
    const dir1 = smolVfs.mountSync('/snapshot/node_modules/test-package')
    console.log('DIR1_PATH=' + dir1)

    const dir1Exists = fs.existsSync(dir1)
    console.log('DIR1_EXISTS=' + dir1Exists)

    const dir2 = smolVfs.mountSync('/snapshot/node_modules/test-package/')
    console.log('DIR2_PATH=' + dir2)
    console.log('PATHS_MATCH=' + (dir1 === dir2))

    const indexPath = path.join(dir1, 'index.js')
    const nestedPath = path.join(dir1, 'subdir', 'nested.js')

    console.log('INDEX_EXISTS=' + fs.existsSync(indexPath))
    console.log('NESTED_EXISTS=' + fs.existsSync(nestedPath))

    const indexContent = fs.readFileSync(indexPath, 'utf8')
    console.log('INDEX_CONTENT=' + indexContent.trim())

    const nestedContent = fs.readFileSync(nestedPath, 'utf8')
    console.log('NESTED_CONTENT=' + nestedContent.trim())

    const dir3 = smolVfs.mountSync('\\\\snapshot\\\\node_modules\\\\test-package')
    console.log('BACKSLASH_PATHS_MATCH=' + (dir1 === dir3))

    const dir4 = smolVfs.mountSync('\\\\snapshot\\\\node_modules\\\\test-package\\\\')
    console.log('BACKSLASH_TRAILING_PATHS_MATCH=' + (dir1 === dir4))

    console.log('MOUNT_DIRECTORY_SUCCESS')
  } catch (e) {
    console.log('MOUNT_ERROR=' + e.message)
  }
} else {
  console.log('NO_SMOL_MOUNT_API')
}
`,
        )

        const vfsDir = path.join(testDir, 'vfs-content')
        const pkgDir = path.join(vfsDir, 'node_modules', 'test-package')
        await safeMkdir(pkgDir)
        await safeMkdir(path.join(pkgDir, 'subdir'))

        await fs.writeFile(
          path.join(pkgDir, 'index.js'),
          'module.exports = "hello"',
        )
        await fs.writeFile(
          path.join(pkgDir, 'package.json'),
          '{"name":"test-package"}',
        )
        await fs.writeFile(
          path.join(pkgDir, 'subdir', 'nested.js'),
          'module.exports = "nested"',
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
        expect(execResult.stdout).toContain('MOUNT_DIRECTORY_SUCCESS')
        expect(execResult.stdout).toContain('DIR1_EXISTS=true')
        expect(execResult.stdout).toContain('PATHS_MATCH=true')
        expect(execResult.stdout).toContain('INDEX_EXISTS=true')
        expect(execResult.stdout).toContain('NESTED_EXISTS=true')
        expect(execResult.stdout).toContain(
          'INDEX_CONTENT=module.exports = "hello"',
        )
        expect(execResult.stdout).toContain(
          'NESTED_CONTENT=module.exports = "nested"',
        )
        expect(execResult.stdout).toContain('BACKSLASH_PATHS_MATCH=true')
        expect(execResult.stdout).toContain(
          'BACKSLASH_TRAILING_PATHS_MATCH=true',
        )
      })
    })

    describe('vFS file permissions', () => {
      it('should preserve executable permissions (0755) when extracting from VFS', async () => {
        const testDir = path.join(testTmpDir, 'vfs-permissions')
        await safeMkdir(testDir)

        const appJs = path.join(testDir, 'app.js')
        await fs.writeFile(
          appJs,
          `
const fs = require('fs')
const path = require('path')
const smolVfs = require('node:smol-vfs')

if (smolVfs.hasVFS() && typeof smolVfs.mountSync === 'function') {
  try {
    const dir = smolVfs.mountSync('/snapshot/bin')
    console.log('DIR=' + dir)

    const pythonPath = path.join(dir, 'python')
    const stats = fs.statSync(pythonPath)
    const mode = (stats.mode & 0o777).toString(8)
    console.log('PYTHON_MODE=' + mode)
    console.log('PYTHON_EXECUTABLE=' + ((stats.mode & 0o100) !== 0))

    const configPath = path.join(dir, 'config.txt')
    const configStats = fs.statSync(configPath)
    const configMode = (configStats.mode & 0o777).toString(8)
    console.log('CONFIG_MODE=' + configMode)

    console.log('PERMISSIONS_TEST_SUCCESS')
  } catch (e) {
    console.log('PERMISSIONS_ERROR=' + e.message)
  }
} else {
  console.log('NO_SMOL_MOUNT_API')
}
`,
        )

        const vfsDir = path.join(testDir, 'vfs-content')
        const binDir = path.join(vfsDir, 'bin')
        await safeMkdir(binDir)

        const pythonPath = path.join(binDir, 'python')
        await fs.writeFile(pythonPath, '#!/usr/bin/env python3\nprint("hello")')
        await makeExecutable(pythonPath)

        const configPath = path.join(binDir, 'config.txt')
        await fs.writeFile(configPath, 'key=value')
        await fs.chmod(configPath, 0o644)

        const vfsTar = path.join(testDir, 'vfs.tar')
        await spawn('tar', ['cf', vfsTar, '-C', vfsDir, '.'], {
          env: { ...process.env, COPYFILE_DISABLE: '1' },
        })

        const tarListResult = await spawn('tar', ['tvf', vfsTar])
        expect(tarListResult.stdout).toContain('rwxr-xr-x')
        expect(tarListResult.stdout).toContain('python')
        expect(tarListResult.stdout).toContain('rw-r--r--')
        expect(tarListResult.stdout).toContain('config.txt')

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
        expect(execResult.stdout).toContain('PERMISSIONS_TEST_SUCCESS')
        expect(execResult.stdout).toContain('PYTHON_MODE=755')
        expect(execResult.stdout).toContain('PYTHON_EXECUTABLE=true')
        expect(execResult.stdout).toContain('CONFIG_MODE=644')
      })
    })
  },
)
