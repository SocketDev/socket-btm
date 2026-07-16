import { afterAll, beforeAll, describe, expect, it } from 'vitest'
/**
 * @file VFS integration tests: path traversal protection.
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
const testTmpDir = path.join(os.tmpdir(), 'socket-btm-vfs-traversal-tests')

describe.sequential.skipIf(skipTests)('vFS — path traversal protection', () => {
  beforeAll(async () => {
    await safeMkdir(testTmpDir)
  })

  afterAll(async () => {
    await safeDelete(testTmpDir)
  })

  describe('vFS path traversal protection', () => {
    it('should throw ENOENT for path traversal leaks via fs.readFileSync', async () => {
      const testDir = path.join(testTmpDir, 'vfs-traversal')
      await safeMkdir(testDir)

      const appJs = path.join(testDir, 'app.js')
      await fs.writeFile(
        appJs,
        `
const fs = require('fs')

const leakPaths = [
  '/snapshot/../etc/passwd',
  '/snapshot/../../etc/shadow',
  '/snapshot/../../../.ssh/id_rsa',
  '/snapshot/node_modules/../../etc/passwd',
  '/snapshot/a/../../../etc/hosts',
  '/snapshot/..',
  '/snapshot/../',
]

let blocked = 0
let leaked = 0

for (const attack of leakPaths) {
  try {
    const data = fs.readFileSync(attack, 'utf8')
    leaked++
    console.log('LEAKED:' + attack)
  } catch (e) {
    if (e.code === 'ENOENT') {
      blocked++
    } else {
      console.log('UNEXPECTED_ERROR:' + attack + ':' + e.code)
    }
  }
}

console.log('BLOCKED=' + blocked)
console.log('LEAKED=' + leaked)
console.log('TOTAL=' + leakPaths.length)

for (const attack of leakPaths) {
  if (fs.existsSync(attack)) {
    console.log('EXISTS_LEAKED:' + attack)
  }
}

const smolVfs = require('node:smol-vfs')
if (smolVfs.hasVFS()) {
  try {
    const content = smolVfs.readFileSync('/snapshot/test.txt', 'utf8')
    console.log('VFS_READ_OK=' + content)
  } catch (e) {
    console.log('VFS_READ_FAIL=' + e.code)
  }
}

console.log('TRAVERSAL_TEST_COMPLETE')
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
      await fs.writeFile(path.join(vfsDir, 'test.txt'), 'safe-content')

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

      expect(execResult.stdout).toContain('TRAVERSAL_TEST_COMPLETE')
      expect(execResult.stdout).toContain('LEAKED=0')
      expect(execResult.stdout).not.toContain('LEAKED:')
      expect(execResult.stdout).not.toContain('EXISTS_LEAKED:')
      expect(execResult.stdout).not.toContain('UNEXPECTED_ERROR:')
      expect(execResult.stdout).toContain('VFS_READ_OK=safe-content')
    })

    it('should block statSync traversal leaks', async () => {
      const testDir = path.join(testTmpDir, 'vfs-traversal-stat')
      await safeMkdir(testDir)

      const appJs = path.join(testDir, 'app.js')
      await fs.writeFile(
        appJs,
        `
const fs = require('fs')

const leakPaths = [
  '/snapshot/../etc/passwd',
  '/snapshot/../../etc',
  '/snapshot/../',
]

let blocked = 0
for (const attack of leakPaths) {
  try {
    fs.statSync(attack)
    console.log('STAT_LEAKED:' + attack)
  } catch (e) {
    if (e.code === 'ENOENT') {
      blocked++
    }
  }
}

for (const attack of leakPaths) {
  try {
    fs.lstatSync(attack)
    console.log('LSTAT_LEAKED:' + attack)
  } catch (e) {
    if (e.code === 'ENOENT') {
      blocked++
    }
  }
}

console.log('STAT_BLOCKED=' + blocked)
console.log('STAT_TEST_COMPLETE')
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
      await fs.writeFile(path.join(vfsDir, 'test.txt'), 'content')

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

      expect(execResult.stdout).toContain('STAT_TEST_COMPLETE')
      expect(execResult.stdout).not.toContain('STAT_LEAKED:')
      expect(execResult.stdout).not.toContain('LSTAT_LEAKED:')
    })
  })
})
