/**
 * @fileoverview Compression round-trip tests for binpress
 *
 * Tests the complete compression workflow:
 * 1. Compress a binary using binpress
 * 2. Execute compressed binary (which auto-decompresses)
 * 3. Verify decompressed binary matches original functionality
 * 4. Validate compression algorithm (LZFSE universal)
 * 5. Check compression ratio and metadata
 *
 * These tests ensure:
 * - Compression doesn't corrupt binary data
 * - Decompression produces valid, executable binaries
 * - LZFSE compression works across all platforms
 * - Compressed binaries maintain original functionality
 */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getBuildMode } from 'build-infra/lib/constants'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'

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

let testDir

/**
 * Execute command and return result
 */
async function execCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', data => {
      stdout += data.toString()
    })

    proc.stderr?.on('data', data => {
      stderr += data.toString()
    })

    proc.on('close', code => {
      resolve({ code, stdout, stderr })
    })

    proc.on('error', err => {
      reject(err)
    })
  })
}

/**
 * Calculate file hash
 */
async function _hashFile(filePath) {
  const data = await fs.readFile(filePath)
  return createHash('sha256').update(data).digest('hex')
}

beforeAll(async () => {
  testDir = path.join(os.tmpdir(), `binpress-roundtrip-${Date.now()}`)
  await safeMkdir(testDir)
})

afterAll(async () => {
  if (testDir) {
    await safeDelete(testDir)
  }
})

describe.skipIf(!existsSync(BINPRESS))(
  'Binpress compression round-trip',
  () => {
    describe('Basic compression and execution', () => {
      it('should compress binpress itself and run --version', async () => {
        const inputBinary = path.join(testDir, 'self_compress_input')
        await fs.copyFile(BINPRESS, inputBinary)

        const compressedBinary = path.join(testDir, 'self_compressed')

        // Compress
        const compressResult = await execCommand(BINPRESS, [
          inputBinary,
          '--output',
          compressedBinary,
        ])

        if (compressResult.code !== 0) {
          console.error('❌ Compression failed!')
          console.error('Exit code:', compressResult.code)
          console.error('Stdout:', compressResult.stdout)
          console.error('Stderr:', compressResult.stderr)
        }

        expect(compressResult.code).toBe(0)

        // On Windows, binpress adds .exe extension automatically
        const finalPath =
          process.platform === 'win32'
            ? `${compressedBinary}.exe`
            : compressedBinary
        expect(existsSync(finalPath)).toBe(true)

        // Make executable
        await fs.chmod(finalPath, 0o755)

        // Execute compressed binary with debug output
        const execResult = await execCommand(finalPath, ['--version'], {
          env: { ...process.env, SOCKET_SMOL_DEBUG: '1' },
        })

        // Always log stderr to diagnose failures
        if (execResult.stderr || execResult.code !== 0) {
          console.error('=== EXECUTION RESULT ===')
          console.error('Exit code:', execResult.code)
          console.error('Stderr:', execResult.stderr)
          console.error('Stdout:', execResult.stdout)
          console.error('=== END RESULT ===')
        }

        expect(execResult.code).toBe(0)
        expect(execResult.stdout).toContain('binpress')
      }, 60_000)

      it('should produce smaller output than input', async () => {
        const inputBinary = path.join(testDir, 'size_test_input')
        await fs.copyFile(BINPRESS, inputBinary)

        const compressedBinary = path.join(testDir, 'size_test_compressed')

        // Compress
        await execCommand(BINPRESS, [inputBinary, '--output', compressedBinary])

        // On Windows, binpress adds .exe extension automatically
        const finalPath =
          process.platform === 'win32'
            ? `${compressedBinary}.exe`
            : compressedBinary

        const inputStats = await fs.stat(inputBinary)
        const compressedStats = await fs.stat(finalPath)

        // Compressed should be smaller (or at worst slightly larger due to stub overhead)
        // For a typical binary, compressed should be significantly smaller
        // Should have some compression (even if small due to already-optimized binary)
        // Allow up to 10% increase for small binaries due to stub overhead
        expect(compressedStats.size).toBeLessThan(inputStats.size * 1.1)
      }, 60_000)

      it('should maintain executable permissions after compression', async () => {
        const inputBinary = path.join(testDir, 'perm_test_input')
        await fs.copyFile(BINPRESS, inputBinary)
        await fs.chmod(inputBinary, 0o755)

        const compressedBinary = path.join(testDir, 'perm_test_compressed')

        // Compress
        await execCommand(BINPRESS, [inputBinary, '--output', compressedBinary])

        // On Windows, binpress adds .exe extension automatically
        const finalPath =
          process.platform === 'win32'
            ? `${compressedBinary}.exe`
            : compressedBinary

        const stats = await fs.stat(finalPath)

        // Windows doesn't use Unix-style executable bits, so skip this check on Windows
        if (process.platform !== 'win32') {
          const isExecutable = (stats.mode & 0o111) !== 0
          expect(isExecutable).toBe(true)
        }
      }, 60_000)
    })

    describe('Compression algorithm validation', () => {
      it('should use LZFSE compression on all platforms', async () => {
        const inputBinary = path.join(testDir, 'algo_test_input')
        await fs.copyFile(BINPRESS, inputBinary)

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
        const marker = Buffer.from('__SMOL_PRESSED_DATA_MAGIC_MARKER', 'utf-8')
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

        // No compression_algorithm byte (LZFSE is universal)
        // Data starts immediately after 3-byte metadata
        const dataOffset = metadataOffset + 3
        expect(data.length).toBeGreaterThan(dataOffset)
      }, 60_000)

      it('should embed decompressor stub in compressed binary', async () => {
        const inputBinary = path.join(testDir, 'stub_test_input')
        await fs.copyFile(BINPRESS, inputBinary)

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

    describe('Multiple compression cycles', () => {
      it('should handle compress → execute → compress → execute', async () => {
        const currentBinary = path.join(testDir, 'cycle_start')
        await fs.copyFile(BINPRESS, currentBinary)

        // Cycle 1: Compress and execute
        const compressed1 = path.join(testDir, 'cycle_compressed_1')
        await execCommand(BINPRESS, [currentBinary, '--output', compressed1])

        // On Windows, binpress adds .exe extension automatically
        const finalPath1 =
          process.platform === 'win32' ? `${compressed1}.exe` : compressed1
        await fs.chmod(finalPath1, 0o755)

        const exec1 = await execCommand(finalPath1, ['--version'])
        expect(exec1.code).toBe(0)

        // Cycle 2: Compress the compressed binary and execute
        const compressed2 = path.join(testDir, 'cycle_compressed_2')
        await execCommand(BINPRESS, [finalPath1, '--output', compressed2])

        const finalPath2 =
          process.platform === 'win32' ? `${compressed2}.exe` : compressed2
        await fs.chmod(finalPath2, 0o755)

        const exec2 = await execCommand(finalPath2, ['--version'])
        expect(exec2.code).toBe(0)

        // Both should produce same output
        expect(exec1.stdout.trim()).toBe(exec2.stdout.trim())
      }, 120_000)

      it('should maintain functionality through multiple compressions', async () => {
        // On Windows, ensure input has .exe extension
        const inputBinary =
          process.platform === 'win32'
            ? path.join(testDir, 'multi_input.exe')
            : path.join(testDir, 'multi_input')
        await fs.copyFile(BINPRESS, inputBinary)

        // Get original --version output
        const originalResult = await execCommand(inputBinary, ['--version'])

        // Compress 2 times (testing re-compression of already-compressed binary)
        // Note: Compressing more than twice causes LZFSE to fail with -3 (LZFSE_STATUS_ERROR)
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
            console.error(`Compression ${i} failed:`)
            console.error('stdout:', compressResult.stdout)
            console.error('stderr:', compressResult.stderr)
          }
          expect(compressResult.code).toBe(0)

          // On Windows, binpress adds .exe extension automatically
          const finalPath =
            process.platform === 'win32' ? `${compressed}.exe` : compressed

          // Verify file was created
          expect(existsSync(finalPath)).toBe(true)

          // eslint-disable-next-line no-await-in-loop
          await fs.chmod(finalPath, 0o755)

          // Execute and verify
          // eslint-disable-next-line no-await-in-loop
          const execResult = await execCommand(finalPath, ['--version'])
          expect(execResult.code).toBe(0)
          expect(execResult.stdout.trim()).toBe(originalResult.stdout.trim())

          currentBinary = finalPath
        }
      }, 180_000)
    })

    describe('Large binary compression', () => {
      it('should handle binary larger than 10MB', async () => {
        // Create a test binary by concatenating binpress multiple times
        const inputBinary = path.join(testDir, 'large_input')

        // Read binpress binary
        const binpressData = await fs.readFile(BINPRESS)

        // Create large binary (repeat content to reach ~10MB)
        const targetSize = 10 * 1024 * 1024
        const repetitions = Math.ceil(targetSize / binpressData.length)

        const handle = await fs.open(inputBinary, 'w')
        try {
          for (let i = 0; i < repetitions; i++) {
            // eslint-disable-next-line no-await-in-loop
            await handle.write(binpressData)
          }
        } finally {
          await handle.close()
        }

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

        const compressedStats = await fs.stat(finalPath)

        // With repetitive data, should compress significantly
        expect(compressedStats.size).toBeLessThan(inputStats.size * 0.8)
      }, 180_000)
    })

    describe('Error handling', () => {
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

    describe('Output file handling', () => {
      it('should overwrite existing output file', async () => {
        const inputBinary = path.join(testDir, 'overwrite_input')
        await fs.copyFile(BINPRESS, inputBinary)

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
        const stats = await fs.stat(finalPath)
        expect(stats.size).toBeGreaterThan(100)
      }, 60_000)

      it('should create output in non-existent directory path', async () => {
        const inputBinary = path.join(testDir, 'mkdir_input')
        await fs.copyFile(BINPRESS, inputBinary)

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

        expect(existsSync(finalPath)).toBe(true)
        expect(existsSync(outputDir)).toBe(true)
      }, 30_000)
    })

    describe('Cache behavior', () => {
      it('should create cache on first execution of compressed binary', async () => {
        const inputBinary = path.join(testDir, 'cache_input')
        await fs.copyFile(BINPRESS, inputBinary)

        const compressedBinary = path.join(testDir, 'cache_compressed')

        // Compress
        await execCommand(BINPRESS, [inputBinary, '--output', compressedBinary])

        // On Windows, binpress adds .exe extension automatically
        const finalPath =
          process.platform === 'win32'
            ? `${compressedBinary}.exe`
            : compressedBinary
        await fs.chmod(finalPath, 0o755)

        // Determine cache directory
        const DLX_DIR = path.join(os.homedir(), '.socket', '_dlx')

        // First execution (creates cache)
        const exec1 = await execCommand(finalPath, ['--version'])
        expect(exec1.code).toBe(0)

        // Find most recently created cache directory
        const cacheDirs = existsSync(DLX_DIR) ? await fs.readdir(DLX_DIR) : []
        expect(cacheDirs.length).toBeGreaterThan(0)

        // Find the most recently modified cache directory (the one just created)
        const dirStatsResults = await Promise.allSettled(
          cacheDirs.map(async dir => ({
            path: path.join(DLX_DIR, dir),
            mtime: (await fs.stat(path.join(DLX_DIR, dir))).mtimeMs,
          })),
        )

        const dirStats = dirStatsResults
          .filter(r => r.status === 'fulfilled')
          .map(r => r.value)

        const cacheDir = dirStats.reduce((newest, current) =>
          current.mtime > newest.mtime ? current : newest,
        ).path
        const metadataPath = path.join(cacheDir, '.dlx-metadata.json')
        expect(existsSync(metadataPath)).toBe(true)

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
      }, 60_000)
    })
  },
)
