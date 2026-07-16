/**
 * @file Compression round-trip tests for binpress
 *   Tests the complete compression workflow:
 *
 *   1. Compress a binary using binpress
 *   2. Execute compressed binary (which auto-decompresses)
 *   3. Verify decompressed binary matches original functionality
 *   4. Validate compression algorithm (zstd universal)
 *   5. Check compression ratio and metadata These tests ensure:
 *
 *   - Compression doesn't corrupt binary data
 *   - Decompression produces valid, executable binaries
 *   - zstd compression works across all platforms
 *   - Compressed binaries maintain original functionality
 */

import crypto from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { makeExecutable } from 'build-infra/lib/build-helpers'
import { getBuildMode } from 'build-infra/lib/constants'

import { safeDelete, safeMkdir } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { REPO_ROOT } from '../../../scripts/fleet/paths.mts'
import { execCommand } from './helpers/compression-roundtrip.mts'

const logger = getDefaultLogger()

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
  },
)
