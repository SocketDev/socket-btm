/**
 * @file Compression round-trip edge-case tests for binpress (large binaries,
 *   error handling, output-path handling, cache behavior). Split out of
 *   compression-roundtrip.test.mts to keep both files under the file-size
 *   soft cap; shares the same BINPRESS/testBinary setup.
 */

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import crypto from 'node:crypto'

import { makeExecutable } from 'build-infra/lib/build-helpers'
import { getBuildMode } from 'build-infra/lib/constants'

import { safeDelete, safeMkdir } from '@socketsecurity/lib-stable/fs/safe'
import { getSocketDlxDir } from '@socketsecurity/lib-stable/paths/socket'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { REPO_ROOT } from '../../../scripts/fleet/paths.mts'
import { execCommand } from './helpers/compression-roundtrip.mts'

const PACKAGE_DIR = path.join(REPO_ROOT, 'packages', 'binpress')

// Determine build mode
const BUILD_MODE = getBuildMode()

// Get binpress binary path
const BINPRESS_NAME = process.platform === 'win32' ? 'binpress.exe' : 'binpress'
const BINPRESS = path.join(
  PACKAGE_DIR,
  'build',
  BUILD_MODE,
  'out',
  'Final',
  BINPRESS_NAME,
)

// Use Node.js binary as consistent test input (not BINPRESS itself which may vary)
const NODE_BINARY = process.execPath

// Skip execution tests when cross-compiling or in Docker glibc builds.
// Cross-compiled binaries can't run on the build host.
// Docker glibc builds may hit ETXTBSY due to overlay2 filesystem race conditions
// until stubs are rebuilt with execve retry logic.
const TARGET_ARCH = process.env['TARGET_ARCH']
const HOST_ARCH = process.arch === 'arm64' ? 'arm64' : 'x64'
const isCrossCompile = TARGET_ARCH !== undefined && TARGET_ARCH !== HOST_ARCH
const isDockerBuild = !existsSync(path.join(REPO_ROOT, '.git'))
const skipExec = isCrossCompile || isDockerBuild

let testDir: string
let testBinary: string

beforeAll(async () => {
  // Create unique test directory with timestamp and random suffix to isolate from parallel runs
  const uniqueId = crypto.randomUUID()
  testDir = path.join(os.tmpdir(), `binpress-roundtrip-edge-${uniqueId}`)
  await safeMkdir(testDir)

  // Copy Node.js binary as consistent test input (not BINPRESS which may vary between builds)
  testBinary = path.join(testDir, 'test-node')
  await fs.copyFile(NODE_BINARY, testBinary)
  await makeExecutable(testBinary)
})

afterAll(async () => {
  if (testDir) {
    await safeDelete(testDir)
  }
})

describe.skipIf(!existsSync(BINPRESS))(
  'binpress compression round-trip (edge cases)',
  () => {
    describe('large binary compression', () => {
      it('should handle binary larger than 10MB', async () => {
        // Create a test binary by concatenating node binary multiple times
        const inputBinary = path.join(testDir, 'large_input')

        // Read test binary
        const nodeData = await fs.readFile(testBinary)

        // Create large binary (repeat content to reach ~10MB)
        const targetSize = 10 * 1024 * 1024
        const repetitions = Math.ceil(targetSize / nodeData.length)

        const handle = await fs.open(inputBinary, 'w')
        try {
          for (let i = 0; i < repetitions; i++) {
            // eslint-disable-next-line no-await-in-loop
            await handle.write(nodeData)
          }
        } finally {
          await handle.close()
        }

        // oxlint-disable-next-line socket/prefer-exists-sync -- fs.stat() calls consume stats.size / stats.mode for round-trip size and executable-permission assertions.
        const inputStats = await fs.stat(inputBinary)
        expect(inputStats.size).toBeGreaterThan(targetSize)

        const compressedBinary = path.join(testDir, 'large_compressed')

        // Compress (may take a while)
        const compressResult = await execCommand(
          BINPRESS,
          [inputBinary, '--output', compressedBinary],
          { timeout: 120_000 },
        )

        expect(compressResult.code).toBe(0)

        // On Windows, binpress adds .exe extension automatically
        const finalPath =
          process.platform === 'win32'
            ? `${compressedBinary}.exe`
            : compressedBinary

        // oxlint-disable-next-line socket/prefer-exists-sync -- fs.stat() calls consume stats.size / stats.mode for round-trip size and executable-permission assertions.
        const compressedStats = await fs.stat(finalPath)

        // With repetitive data, should compress significantly
        expect(compressedStats.size).toBeLessThan(inputStats.size * 0.8)
      }, 180_000)
    })

    describe('error handling', () => {
      it('should fail gracefully with non-existent input', async () => {
        const nonExistent = path.join(testDir, 'does_not_exist')
        const output = path.join(testDir, 'error_output')

        const result = await execCommand(BINPRESS, [
          nonExistent,
          '--output',
          output,
        ])

        expect(result.code).not.toBe(0)
        expect(result.stderr).toBeTruthy()
        expect(result.stderr.toLowerCase()).toMatch(
          /not found|exist|no such|cannot find/,
        )
      }, 30_000)

      it('should reject invalid input file', async () => {
        const invalidInput = path.join(testDir, 'invalid.txt')
        await fs.writeFile(invalidInput, 'not a binary')

        const output = path.join(testDir, 'invalid_output')

        const result = await execCommand(BINPRESS, [
          invalidInput,
          '--output',
          output,
        ])

        // Text files are not valid binaries and should be rejected
        expect(result.code).not.toBe(0)
        expect(result.stderr).toBeTruthy()
        expect(result.stderr.toLowerCase()).toMatch(
          /invalid|binary|format|not a|cannot/,
        )
      }, 30_000)

      it('should reject empty file input', async () => {
        const emptyFile = path.join(testDir, 'empty')
        await fs.writeFile(emptyFile, Buffer.alloc(0))

        const output = path.join(testDir, 'empty_output')

        const result = await execCommand(BINPRESS, [
          emptyFile,
          '--output',
          output,
        ])

        // Empty files are not valid binaries and should be rejected
        expect(result.code).not.toBe(0)
        expect(result.stderr).toBeTruthy()
        expect(result.stderr.toLowerCase()).toMatch(
          /mach-o|binary|empty|size|invalid|cannot/,
        )
      }, 30_000)
    })

    describe('output file handling', () => {
      it('should overwrite existing output file', async () => {
        const inputBinary = path.join(testDir, 'overwrite_input')
        await fs.copyFile(testBinary, inputBinary)

        const output = path.join(testDir, 'overwrite_output')

        // Create existing file
        await fs.writeFile(output, 'existing content')

        // Compress (should overwrite)
        const result = await execCommand(BINPRESS, [
          inputBinary,
          '--output',
          output,
        ])

        expect(result.code).toBe(0)

        // On Windows, binpress adds .exe extension automatically
        const finalPath =
          process.platform === 'win32' ? `${output}.exe` : output

        // Output should be larger than "existing content"
        // oxlint-disable-next-line socket/prefer-exists-sync -- fs.stat() calls consume stats.size / stats.mode for round-trip size and executable-permission assertions.
        const stats = await fs.stat(finalPath)
        expect(stats.size).toBeGreaterThan(100)
      }, 60_000)

      it('should create output in non-existent directory path', async () => {
        const inputBinary = path.join(testDir, 'mkdir_input')
        await fs.copyFile(testBinary, inputBinary)

        const outputDir = path.join(testDir, 'new_dir')
        const output = path.join(outputDir, 'output')

        // binpress creates parent directories automatically
        const result = await execCommand(BINPRESS, [
          inputBinary,
          '--output',
          output,
        ])

        expect(result.code).toBe(0)

        // On Windows, binpress adds .exe extension automatically
        const finalPath =
          process.platform === 'win32' ? `${output}.exe` : output

        expect(existsSync(finalPath)).toBeTruthy()
        expect(existsSync(outputDir)).toBeTruthy()
      }, 30_000)
    })

    describe('cache behavior', () => {
      it.skipIf(skipExec)(
        'should create cache on first execution of compressed binary',
        async () => {
          const inputBinary = path.join(testDir, 'cache_input')
          await fs.copyFile(testBinary, inputBinary)

          const compressedBinary = path.join(testDir, 'cache_compressed')

          // Compress
          await execCommand(BINPRESS, [
            inputBinary,
            '--output',
            compressedBinary,
          ])

          // On Windows, binpress adds .exe extension automatically
          const finalPath =
            process.platform === 'win32'
              ? `${compressedBinary}.exe`
              : compressedBinary
          await makeExecutable(finalPath)

          // Determine cache directory
          const DLX_DIR = getSocketDlxDir()

          // Snapshot the cache state before the run so we can pinpoint
          // which dir was created or touched by this run. The
          // compressed binary's cache key is a hash of its content, so
          // re-running the same test re-uses an existing cache dir
          // (mtime doesn't change). To make the test deterministic
          // regardless of prior runs, identify the dir we care about
          // by snapshotting the state before, then either finding a
          // newly-created dir OR locating any pre-existing dir whose
          // metadata file reflects this binary.
          const beforeDirs = new Set<string>(
            existsSync(DLX_DIR) ? await fs.readdir(DLX_DIR) : [],
          )

          // First execution (creates cache or hits existing)
          const exec1 = await execCommand(finalPath, ['--version'])
          expect(exec1.code).toBe(0)

          const cacheDirs = existsSync(DLX_DIR) ? await fs.readdir(DLX_DIR) : []
          expect(cacheDirs.length).toBeGreaterThan(0)

          // Prefer a newly-created dir (with metadata); fall back to
          // scanning every existing dir whose .dlx-metadata.json was
          // touched after the run started. Older / aborted cache dirs
          // without metadata are skipped — the assertion downstream
          // requires metadata anyway.
          const newDirs = cacheDirs.filter(d => !beforeDirs.has(d))
          let cacheDir: string | undefined
          for (let i = 0, { length } = newDirs; i < length; i += 1) {
            const d = newDirs[i]
            if (d === undefined) {
              continue
            }
            if (existsSync(path.join(DLX_DIR, d, '.dlx-metadata.json'))) {
              cacheDir = path.join(DLX_DIR, d)
              break
            }
          }
          if (!cacheDir) {
            // Cache hit on a prior run's dir — the metadata file
            // already existed. Find the one whose mtime advanced
            // during the run window; restrict to dirs that have
            // metadata so we never end up at an aborted/legacy dir.
            let bestMtime = 0
            for (let i = 0, { length } = cacheDirs; i < length; i += 1) {
              const dir = cacheDirs[i]
              if (dir === undefined) {
                continue
              }
              const candidate = path.join(DLX_DIR, dir)
              const meta = path.join(candidate, '.dlx-metadata.json')
              if (!existsSync(meta)) {
                continue
              }
              try {
                // oxlint-disable-next-line socket/prefer-exists-sync -- fs.stat() calls consume stats.size / stats.mode for round-trip size and executable-permission assertions.
                const stat = await fs.stat(meta)
                if (stat.mtimeMs > bestMtime) {
                  bestMtime = stat.mtimeMs
                  cacheDir = candidate
                }
              } catch {
                // ignore
              }
            }
          }

          if (!cacheDir) {
            throw new Error('Could not locate the cache dir used by the run')
          }

          const metadataPath = path.join(cacheDir, '.dlx-metadata.json')
          expect(existsSync(metadataPath)).toBeTruthy()

          const metadataBefore = JSON.parse(
            await fs.readFile(metadataPath, 'utf8'),
          )
          const timestampBefore = metadataBefore.timestamp

          // Second execution (uses cache)
          const exec2 = await execCommand(finalPath, ['--version'])
          expect(exec2.code).toBe(0)

          // Verify cache was reused (timestamp unchanged)
          const metadataAfter = JSON.parse(
            await fs.readFile(metadataPath, 'utf8'),
          )
          expect(metadataAfter.timestamp).toBe(timestampBefore)
        },
        60_000,
      )
    })
  },
)
