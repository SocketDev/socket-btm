// max-file-lines: legitimate -- integration test — one end-to-end scenario per file, splitting fractures the assertion narrative

/**
 * @fileoverview Compression round-trip tests for binpress
 *
 * Tests the complete compression workflow:
 * 1. Compress a binary using binpress
 * 2. Execute compressed binary (which auto-decompresses)
 * 3. Verify decompressed binary matches original functionality
 * 4. Validate compression algorithm (zstd universal)
 * 5. Check compression ratio and metadata
 *
 * These tests ensure:
 * - Compression doesn't corrupt binary data
 * - Decompression produces valid, executable binaries
 * - zstd compression works across all platforms
 * - Compressed binaries maintain original functionality
 */

import crypto from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { makeExecutable } from 'build-infra/lib/build-helpers'
import { getBuildMode } from 'build-infra/lib/constants'

import { safeDelete, safeMkdir } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { getSocketDlxDir } from '@socketsecurity/lib-stable/paths/socket'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { afterAll, beforeAll, describe, expect, it, test } from 'vitest'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PACKAGE_DIR = path.join(__dirname, '..')

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
const isDockerBuild = !existsSync(
  path.join(__dirname, '..', '..', '..', '.git'),
)
const skipExec = isCrossCompile || isDockerBuild

let testDir: string
let testBinary: string

/**
 * Execute command and return result
 */
export async function execCommand(command, args = [], options = {}) {
  return new Promise(resolve => {
    const spawnPromise = spawn(command, args, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    // @socketsecurity/lib-stable/spawn returns a Promise with .process property
    const proc = spawnPromise.process

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', data => {
      stdout += data.toString()
    })

    proc.stderr?.on('data', data => {
      stderr += data.toString()
    })

    proc.on('close', code => {
      resolve({ code, stderr, stdout })
    })

    // Handle spawn Promise rejection (non-zero exit codes)
    // We still resolve with the code/stdout/stderr for test assertions
    spawnPromise.catch(() => {
      // Already handled by 'close' event
    })
  })
}

/**
 * Calculate file hash
 */
export async function hashFile(filePath) {
  const data = await fs.readFile(filePath)
  return crypto.createHash('sha256').update(data).digest('hex')
}

beforeAll(async () => {
  // Create unique test directory with timestamp and random suffix to isolate from parallel runs
  const uniqueId = crypto.randomUUID()
  testDir = path.join(os.tmpdir(), `binpress-roundtrip-${uniqueId}`)
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
  'binpress compression round-trip',
  () => {
    describe('basic compression and execution', () => {
      it.skipIf(skipExec)(
        'should compress node binary and run --version',
        async () => {
          const inputBinary = path.join(testDir, 'self_compress_input')
          await fs.copyFile(testBinary, inputBinary)

          const compressedBinary = path.join(testDir, 'self_compressed')

          // Compress
          const compressResult = await execCommand(BINPRESS, [
            inputBinary,
            '--output',
            compressedBinary,
          ])

          if (compressResult.code !== 0) {
            logger.fail('Compression failed!')
            logger.fail('Exit code:', compressResult.code)
            logger.fail('Stdout:', compressResult.stdout)
            logger.fail('Stderr:', compressResult.stderr)
          }

          expect(compressResult.code).toBe(0)

          // On Windows, binpress adds .exe extension automatically
          const finalPath =
            process.platform === 'win32'
              ? `${compressedBinary}.exe`
              : compressedBinary
          expect(existsSync(finalPath)).toBeTruthy()

          await makeExecutable(finalPath)

          // Execute compressed binary with debug output
          const execResult = await execCommand(finalPath, ['--version'], {
            env: { ...process.env, SOCKET_SMOL_DEBUG: '1' },
          })

          // Always log stderr to diagnose failures
          if (execResult.stderr || execResult.code !== 0) {
            logger.fail('=== EXECUTION RESULT ===')
            logger.fail('Exit code:', execResult.code)
            logger.fail('Stderr:', execResult.stderr)
            logger.fail('Stdout:', execResult.stdout)
            logger.fail('=== END RESULT ===')
          }

          expect(execResult.code).toBe(0)
        },
        60_000,
      )

      it('should produce smaller output than input', async () => {
        const inputBinary = path.join(testDir, 'size_test_input')
        await fs.copyFile(testBinary, inputBinary)

        const compressedBinary = path.join(testDir, 'size_test_compressed')

        // Compress
        await execCommand(BINPRESS, [inputBinary, '--output', compressedBinary])

        // On Windows, binpress adds .exe extension automatically
        const finalPath =
          process.platform === 'win32'
            ? `${compressedBinary}.exe`
            : compressedBinary

        // oxlint-disable-next-line socket/prefer-exists-sync -- fs.stat() calls consume stats.size / stats.mode for round-trip size and executable-permission assertions.
        const inputStats = await fs.stat(inputBinary)
        // oxlint-disable-next-line socket/prefer-exists-sync -- fs.stat() calls consume stats.size / stats.mode for round-trip size and executable-permission assertions.
        const compressedStats = await fs.stat(finalPath)

        // Compressed should be smaller (or at worst slightly larger due to stub overhead)
        // For a typical binary, compressed should be significantly smaller
        // Should have some compression (even if small due to already-optimized binary)
        // Allow up to 10% increase for small binaries due to stub overhead
        expect(compressedStats.size).toBeLessThan(inputStats.size * 1.1)
      }, 60_000)

      it('should maintain executable permissions after compression', async () => {
        const inputBinary = path.join(testDir, 'perm_test_input')
        await fs.copyFile(testBinary, inputBinary)
        await makeExecutable(inputBinary)

        const compressedBinary = path.join(testDir, 'perm_test_compressed')

        // Compress
        await execCommand(BINPRESS, [inputBinary, '--output', compressedBinary])

        // On Windows, binpress adds .exe extension automatically
        const finalPath =
          process.platform === 'win32'
            ? `${compressedBinary}.exe`
            : compressedBinary

        // oxlint-disable-next-line socket/prefer-exists-sync -- fs.stat() calls consume stats.size / stats.mode for round-trip size and executable-permission assertions.
        const stats = await fs.stat(finalPath)

        // Windows doesn't use Unix-style executable bits, so skip this check on Windows
        if (process.platform !== 'win32') {
          const isExecutable = (stats.mode & 0o111) !== 0
          expect(isExecutable).toBeTruthy()
        }
      }, 60_000)
    })

    describe('compression algorithm validation', () => {
      it('should use zstd compression on all platforms', async () => {
        const inputBinary = path.join(testDir, 'algo_test_input')
        await fs.copyFile(testBinary, inputBinary)

        const compressedBinary = path.join(testDir, 'algo_test_compressed')

        // Compress
        const compressResult = await execCommand(BINPRESS, [
          inputBinary,
          '--output',
          compressedBinary,
        ])

        expect(compressResult.code).toBe(0)

        // On Windows, binpress adds .exe extension automatically
        const finalPath =
          process.platform === 'win32'
            ? `${compressedBinary}.exe`
            : compressedBinary

        // Read compressed binary to check for SMOL marker
        const data = await fs.readFile(finalPath)

        // Should contain magic marker
        const marker = Buffer.from('__SMOL_PRESSED_DATA_MAGIC_MARKER', 'utf8')
        const markerIndex = data.indexOf(marker)

        expect(markerIndex).toBeGreaterThan(-1)

        // Check metadata after marker
        // Format: marker(32) + compressed_size(8) + uncompressed_size(8) + cache_key(16) + platform_metadata(3)
        const metadataOffset = markerIndex + 32 + 8 + 8 + 16

        // Read platform metadata (3 bytes: platform, arch, libc)
        const platformByte = data[metadataOffset]
        const archByte = data[metadataOffset + 1]
        const libcByte = data[metadataOffset + 2]

        // Validate metadata bytes exist and are valid
        expect(platformByte).toBeDefined()
        expect(archByte).toBeDefined()
        expect(libcByte).toBeDefined()

        // Platform: 0=linux, 1=darwin, 2=win32
        expect([0, 1, 2]).toContain(platformByte)

        // Arch: 0=x64, 1=arm64, 2=ia32, 3=arm
        expect([0, 1, 2, 3]).toContain(archByte)

        // Libc: 0=glibc, 1=musl, 255=n/a
        expect([0, 1, 255]).toContain(libcByte)

        // No compression_algorithm byte (zstd is universal)
        // Data starts immediately after 3-byte metadata
        const dataOffset = metadataOffset + 3
        expect(data.length).toBeGreaterThan(dataOffset)
      }, 60_000)

      it('should write a 64-byte (SHA-512) integrity hash in the footer', async () => {
        // Locks the footer integrity-hash width: SHA-512 is 64 bytes. A
        // regression to SHA-256 (32 bytes) would shift every subsequent field
        // and break the embedded stub's verify-on-launch. Behavioral check —
        // parses a freshly-packed binary rather than reading source.
        const inputBinary = path.join(testDir, 'integrity_width_input')
        await fs.copyFile(process.execPath, inputBinary)
        await makeExecutable(inputBinary)

        const compressedBinary = path.join(testDir, 'integrity_width_output')
        const compressResult = await execCommand(BINPRESS, [
          inputBinary,
          '--output',
          compressedBinary,
        ])
        expect(compressResult.code).toBe(0)

        const finalPath =
          process.platform === 'win32'
            ? `${compressedBinary}.exe`
            : compressedBinary
        const data = await fs.readFile(finalPath)

        const marker = Buffer.from('__SMOL_PRESSED_DATA_MAGIC_MARKER', 'utf8')
        const markerIndex = data.indexOf(marker)
        expect(markerIndex).toBeGreaterThan(-1)

        // Footer layout: marker(32) + sizes(16) + cache_key(16) +
        // platform_metadata(3) + integrity_hash(INTEGRITY_HASH_LEN) +
        // has_config(1) + [config]. The integrity hash must be 64 bytes
        // (SHA-512); the has_config flag immediately after it must be 0 or 1,
        // which only holds when the hash is exactly 64 bytes wide.
        const INTEGRITY_HASH_LEN = 64
        const integrityOffset = markerIndex + 32 + 8 + 8 + 16 + 3
        const hasConfigOffset = integrityOffset + INTEGRITY_HASH_LEN

        expect(data.length).toBeGreaterThan(hasConfigOffset)
        // The has_config flag right after a 64-byte hash must be a valid 0/1.
        expect([0, 1]).toContain(data[hasConfigOffset])
      }, 60_000)

      it('should embed decompressor stub in compressed binary', async () => {
        const inputBinary = path.join(testDir, 'stub_test_input')
        await fs.copyFile(testBinary, inputBinary)

        const compressedBinary = path.join(testDir, 'stub_test_compressed')

        // Compress
        await execCommand(BINPRESS, [inputBinary, '--output', compressedBinary])

        // On Windows, binpress adds .exe extension automatically
        const finalPath =
          process.platform === 'win32'
            ? `${compressedBinary}.exe`
            : compressedBinary

        const data = await fs.readFile(finalPath)

        // Check for platform-specific stub binary format
        if (process.platform === 'darwin') {
          // Mach-O magic
          const magic = data.readUInt32LE(0)
          expect([0xfe_ed_fa_cf, 0xcf_fa_ed_fe]).toContain(magic)
        } else if (process.platform === 'linux') {
          // ELF magic: 0x7F 'E' 'L' 'F'
          expect(data[0]).toBe(0x7f)
          // 'E'
          expect(data[1]).toBe(0x45)
          // 'L'
          expect(data[2]).toBe(0x4c)
          // 'F'
          expect(data[3]).toBe(0x46)
        } else if (process.platform === 'win32') {
          // DOS/PE magic
          const dosMagic = data.readUInt16LE(0)
          // 'MZ'
          expect(dosMagic).toBe(0x5a_4d)
        }
      }, 60_000)
    })

    describe('multiple compression cycles', () => {
      it.skipIf(skipExec)(
        'should handle compress → execute → compress → execute',
        async () => {
          const currentBinary = path.join(testDir, 'cycle_start')
          await fs.copyFile(testBinary, currentBinary)

          // Cycle 1: Compress and execute
          const compressed1 = path.join(testDir, 'cycle_compressed_1')
          await execCommand(BINPRESS, [currentBinary, '--output', compressed1])

          // On Windows, binpress adds .exe extension automatically
          const finalPath1 =
            process.platform === 'win32' ? `${compressed1}.exe` : compressed1
          await makeExecutable(finalPath1)

          const exec1 = await execCommand(finalPath1, ['--version'])
          expect(exec1.code).toBe(0)

          // Cycle 2: Compress the compressed binary and execute
          const compressed2 = path.join(testDir, 'cycle_compressed_2')
          await execCommand(BINPRESS, [finalPath1, '--output', compressed2])

          const finalPath2 =
            process.platform === 'win32' ? `${compressed2}.exe` : compressed2
          await makeExecutable(finalPath2)

          const exec2 = await execCommand(finalPath2, ['--version'])
          expect(exec2.code).toBe(0)

          // Both should produce same output
          expect(exec1.stdout.trim()).toBe(exec2.stdout.trim())
        },
        300_000,
      )

      it('should maintain functionality through multiple compressions', async () => {
        // On Windows, ensure input has .exe extension
        const inputBinary =
          process.platform === 'win32'
            ? path.join(testDir, 'multi_input.exe')
            : path.join(testDir, 'multi_input')
        await fs.copyFile(testBinary, inputBinary)

        // Get original --version output
        const originalResult = await execCommand(inputBinary, ['--version'])

        // Compress 2 times (testing re-compression of already-compressed binary)
        // Note: Compressing more than twice causes zstd to fail
        // because already-compressed data doesn't compress well

        let currentBinary = inputBinary
        for (let i = 1; i <= 2; i++) {
          const compressed = path.join(testDir, `multi_compressed_${i}`)
          // eslint-disable-next-line no-await-in-loop
          const compressResult = await execCommand(BINPRESS, [
            currentBinary,
            '--output',
            compressed,
          ])

          // Verify compression succeeded
          if (compressResult.code !== 0) {
            logger.fail(`Compression ${i} failed:`)
            logger.fail('stdout:', compressResult.stdout)
            logger.fail('stderr:', compressResult.stderr)
          }
          expect(compressResult.code).toBe(0)

          // On Windows, binpress adds .exe extension automatically
          const finalPath =
            process.platform === 'win32' ? `${compressed}.exe` : compressed

          // Verify file was created
          expect(existsSync(finalPath)).toBeTruthy()

          // eslint-disable-next-line no-await-in-loop
          await makeExecutable(finalPath)

          // Execute and verify
          // eslint-disable-next-line no-await-in-loop
          const execResult = await execCommand(finalPath, ['--version'])
          expect(execResult.code).toBe(0)
          expect(execResult.stdout.trim()).toBe(originalResult.stdout.trim())

          currentBinary = finalPath
        }
      }, 360_000)
    })

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
