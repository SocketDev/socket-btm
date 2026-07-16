import { afterAll, beforeAll, describe, expect, it } from 'vitest'
/**
 * @file VFS integration tests: extraction to ~/.socket/_dlx/ and path validation.
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
const testTmpDir = path.join(os.tmpdir(), 'socket-btm-vfs-extraction-tests')

describe.sequential.skipIf(skipTests)(
  'vFS — extraction to ~/.socket/_dlx/ and path validation',
  () => {
    const createdCacheDirs: string[] = []

    beforeAll(async () => {
      await safeMkdir(testTmpDir)
    })

    afterAll(async () => {
      await safeDelete(testTmpDir)

      const cleanupPromises = []
      for (let i = 0, { length } = createdCacheDirs; i < length; i += 1) {
        const cacheDir = createdCacheDirs[i]
        if (existsSync(cacheDir)) {
          cleanupPromises.push(safeDelete(cacheDir))
        }
      }
      await Promise.allSettled(cleanupPromises)
    })

    describe('vFS extraction to ~/.socket/_dlx/', () => {
      it('should extract VFS to cache directory on first run', async () => {
        const testDir = path.join(testTmpDir, 'vfs-extraction')
        await safeMkdir(testDir)

        const appJs = path.join(testDir, 'app.js')
        await fs.writeFile(
          appJs,
          `
const fs = require('fs')
const path = require('path')
const { createHash } = require('crypto')
const os = require('os')
const smolVfs = require('node:smol-vfs')

const DLX_DIR = path.join(os.homedir(), '.socket', '_dlx')

async function extractVFS() {
  if (!smolVfs.hasVFS()) {
    console.log('NO_VFS')
    return
  }

  const cfg = smolVfs.config()
  if (!cfg.available) {
    console.log('EMPTY_VFS')
    return
  }

  const files = smolVfs.listFiles()
  const contentHash = createHash('sha256')
  for (const file of files) {
    const content = smolVfs.readFileSync('/snapshot/' + file)
    contentHash.update(content)
  }
  const hash = contentHash.digest('hex').slice(0, 16)
  const cacheDir = path.join(DLX_DIR, hash)

  console.log('CACHE_DIR=' + cacheDir)

  if (fs.existsSync(cacheDir)) {
    console.log('CACHE_HIT')
    return
  }

  fs.mkdirSync(cacheDir, { recursive: true })

  let extracted = 0
  for (const file of files) {
    const content = smolVfs.readFileSync('/snapshot/' + file)
    const targetPath = path.join(cacheDir, file)
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    fs.writeFileSync(targetPath, content)
    extracted++
  }

  console.log('EXTRACTED=' + extracted)
}

extractVFS().catch(err => {
  console.error('ERROR=' + err.message)
  process.exit(1)
})
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
        await fs.writeFile(path.join(vfsDir, 'file1.txt'), 'Content 1')
        await fs.writeFile(path.join(vfsDir, 'file2.txt'), 'Content 2')
        await safeMkdir(path.join(vfsDir, 'subdir'))
        await fs.writeFile(
          path.join(vfsDir, 'subdir', 'file3.txt'),
          'Content 3',
        )

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

        const probeRun = await spawn(seaBinary, [])
        expect(probeRun.code).toBe(0)
        const probeMatch = probeRun.stdout.match(/CACHE_DIR=(.+)/)
        expect(probeMatch).toBeTruthy()
        const probeCacheDir = probeMatch![1]!.trim()
        if (existsSync(probeCacheDir)) {
          await safeDelete(probeCacheDir)
        }

        const firstRun = await spawn(seaBinary, [])
        expect(firstRun.code).toBe(0)
        expect(firstRun.stdout).toContain('CACHE_DIR=')
        expect(firstRun.stdout).toContain('EXTRACTED=3')

        const cacheDirMatch = firstRun.stdout.match(/CACHE_DIR=(.+)/)
        expect(cacheDirMatch).toBeTruthy()
        const cacheDir = cacheDirMatch[1].trim()
        createdCacheDirs.push(cacheDir)

        expect(existsSync(cacheDir)).toBeTruthy()
        expect(existsSync(path.join(cacheDir, 'file1.txt'))).toBeTruthy()
        expect(existsSync(path.join(cacheDir, 'file2.txt'))).toBeTruthy()
        expect(
          existsSync(path.join(cacheDir, 'subdir', 'file3.txt')),
        ).toBeTruthy()

        const content1 = await fs.readFile(
          path.join(cacheDir, 'file1.txt'),
          'utf8',
        )
        expect(content1).toBe('Content 1')

        const secondRun = await spawn(seaBinary, [])
        expect(secondRun.code).toBe(0)
        expect(secondRun.stdout).toContain('CACHE_HIT')
      })
    })

    describe('vFS extraction path validation', () => {
      it('should use SHA-256 hash (16 hex chars) for cache directory', async () => {
        const testDir = path.join(testTmpDir, 'vfs-hash-validation')
        await safeMkdir(testDir)

        const appJs = path.join(testDir, 'app.js')
        await fs.writeFile(
          appJs,
          `
const smolVfs = require('node:smol-vfs')
if (smolVfs.hasVFS()) {
  const { createHash } = require('crypto')
  const files = smolVfs.listFiles()
  const contentHash = createHash('sha256')
  for (const file of files) {
    const content = smolVfs.readFileSync('/snapshot/' + file)
    contentHash.update(content)
  }
  const fullHash = contentHash.digest('hex')
  const shortHash = fullHash.slice(0, 16)

  console.log('FULL_HASH_LENGTH=' + fullHash.length)
  console.log('SHORT_HASH_LENGTH=' + shortHash.length)
  console.log('SHORT_HASH=' + shortHash)

  const isHex = /^[0-9a-f]+$/.test(shortHash)
  console.log('IS_HEX=' + isHex)
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

        await spawn(
          finalBinaryPath,
          ['--experimental-sea-config', 'sea-config.json'],
          { cwd: testDir },
        )

        const vfsDir = path.join(testDir, 'vfs-content')
        await safeMkdir(vfsDir)
        await fs.writeFile(path.join(vfsDir, 'test.txt'), 'test')

        const vfsTar = path.join(testDir, 'vfs.tar')
        await spawn('tar', ['cf', vfsTar, '-C', vfsDir, '.'])

        const seaBinary = path.join(testDir, 'app')
        await fs.copyFile(finalBinaryPath, seaBinary)
        await makeExecutable(seaBinary)

        await runBinject(
          seaBinary,
          'BOTH',
          { sea: 'sea-config.json', vfs: vfsTar },
          { testDir },
        )

        const execResult = await spawn(seaBinary, [])
        expect(execResult.code).toBe(0)
        expect(execResult.stdout).toContain('FULL_HASH_LENGTH=64')
        expect(execResult.stdout).toContain('SHORT_HASH_LENGTH=16')
        expect(execResult.stdout).toContain('IS_HEX=true')

        const hashMatch = execResult.stdout.match(/SHORT_HASH=([\da-f]{16})/)
        expect(hashMatch).toBeTruthy()
      })

      it('should match compression extraction pattern structure', () => {
        const vfsPattern = /^[\da-f]{16}$/

        const compressionPattern =
          /^[\da-f]{16}-(linux|macos|windows)-(arm|arm64|ia32|x64)$/

        expect('a1b2c3d4e5f67890'.match(vfsPattern)).toBeTruthy()
        expect('a1b2c3d4e5f67890'.match(compressionPattern)).toBeFalsy()

        expect(
          'a1b2c3d4e5f67890-macos-arm64'.match(compressionPattern),
        ).toBeTruthy()
        expect('a1b2c3d4e5f67890-macos-arm64'.match(vfsPattern)).toBeFalsy()
      })
    })
  },
)
