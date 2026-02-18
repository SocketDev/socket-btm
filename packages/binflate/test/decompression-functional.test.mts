/**
 * @fileoverview Binflate decompression functional tests
 *
 * Tests the complete decompression workflow:
 * 1. Use binpress to compress a binary
 * 2. Use binflate to decompress it
 * 3. Verify decompressed binary matches original
 * 4. Test error handling for corrupt/invalid data
 * 5. Validate CLI flags and options
 *
 * These tests ensure:
 * - Decompression produces byte-identical output
 * - LZFSE decompression works correctly
 * - Error handling for corrupt data
 * - CLI flags work as documented
 * - Cross-platform compatibility
 *
 * CRITICAL: These are P0 tests - binflate ships with NO functional tests
 * without this file. The shell tests only validate binary structure.
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
const PACKAGES_DIR = path.join(PACKAGE_DIR, '..')
const BINPRESS_PACKAGE_DIR = path.join(PACKAGES_DIR, 'binpress')

// Determine build mode
const BUILD_MODE = getBuildMode()

// Get binflate binary path
const BINFLATE_NAME = process.platform === 'win32' ? 'binflate.exe' : 'binflate'
const BINFLATE = path.join(
  PACKAGE_DIR,
  'build',
  BUILD_MODE,
  'out',
  'Final',
  BINFLATE_NAME,
)

// Get binpress binary path (needed for creating test data)
const BINPRESS_NAME = process.platform === 'win32' ? 'binpress.exe' : 'binpress'
const BINPRESS = path.join(
  BINPRESS_PACKAGE_DIR,
  'build',
  BUILD_MODE,
  'out',
  'Final',
  BINPRESS_NAME,
)

let testDir: string

// Check if binaries exist (done at module load time for skipIf)
const binflateExists = existsSync(BINFLATE)
const binpressExists = existsSync(BINPRESS)

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
async function hashFile(filePath) {
  const data = await fs.readFile(filePath)
  return createHash('sha256').update(data).digest('hex')
}

/**
 * Create a test binary file with known content
 */
async function createTestBinary(filePath, size = 1024 * 10) {
  // Create binary with repeated pattern (compresses well)
  const pattern = Buffer.from('TESTDATA'.repeat(16))
  const chunks = Math.ceil(size / pattern.length)
  const data = Buffer.concat(Array(chunks).fill(pattern)).subarray(0, size)
  await fs.writeFile(filePath, data)
  await fs.chmod(filePath, 0o755)
}

beforeAll(async () => {
  if (!binflateExists) {
    console.warn(`⚠️  binflate not found at ${BINFLATE}`)
    console.warn('   Run: pnpm build in packages/binflate')
    return
  }

  if (!binpressExists) {
    console.warn(`⚠️  binpress not found at ${BINPRESS}`)
    console.warn('   Run: pnpm build in packages/binpress')
    console.warn('   binpress is required to create compressed test data')
    return
  }

  testDir = path.join(os.tmpdir(), `binflate-functional-${Date.now()}`)
  await safeMkdir(testDir)
})

afterAll(async () => {
  if (testDir) {
    await safeDelete(testDir)
  }
})

describe.skipIf(!binflateExists || !binpressExists)(
  'Binflate decompression functional tests',
  () => {
    describe('Basic decompression', () => {
      it('should decompress a compressed binary to identical output', async () => {
        // Use binflate itself as a real Mach-O test binary
        const originalBinary = BINFLATE

        // Compress with binpress (creates self-extracting binary)
        const compressedBinary = path.join(testDir, 'decompress_compressed')
        const compressResult = await execCommand(BINPRESS, [
          originalBinary,
          '-o',
          compressedBinary,
        ])
        expect(compressResult.code).toBe(0)
        expect(existsSync(compressedBinary)).toBe(true)

        // Decompress with binflate
        const decompressedBinary = path.join(testDir, 'decompress_output')
        const decompressResult = await execCommand(BINFLATE, [
          compressedBinary,
          '--output',
          decompressedBinary,
        ])

        expect(decompressResult.code).toBe(0)
        expect(existsSync(decompressedBinary)).toBe(true)

        // Verify byte-for-byte match
        const originalHash = await hashFile(originalBinary)
        const decompressedHash = await hashFile(decompressedBinary)
        expect(decompressedHash).toBe(originalHash)
      }, 60_000)

      it('should decompress binflate itself and run --version', async () => {
        // Compress binflate
        const compressedBinary = path.join(
          testDir,
          'self_decompress_compressed',
        )
        const compressResult = await execCommand(BINPRESS, [
          BINFLATE,
          '-o',
          compressedBinary,
        ])
        expect(compressResult.code).toBe(0)

        // Decompress it
        const decompressedBinary = path.join(testDir, 'self_decompress_output')
        const decompressResult = await execCommand(BINFLATE, [
          compressedBinary,
          '--output',
          decompressedBinary,
        ])
        expect(decompressResult.code).toBe(0)

        // Make executable and run
        await fs.chmod(decompressedBinary, 0o755)
        const execResult = await execCommand(decompressedBinary, ['--version'])

        expect(execResult.code).toBe(0)
        expect(execResult.stdout).toContain('binflate')
      }, 60_000)

      it('should maintain file permissions after decompression', async () => {
        // Use binflate as test binary (already executable)
        const originalBinary = BINFLATE

        // Compress
        const compressedBinary = path.join(testDir, 'perm_compressed')
        await execCommand(BINPRESS, [originalBinary, '-o', compressedBinary])

        // Decompress
        const decompressedBinary = path.join(testDir, 'perm_decompressed')
        await execCommand(BINFLATE, [
          compressedBinary,
          '--output',
          decompressedBinary,
        ])

        const stats = await fs.stat(decompressedBinary)
        const isExecutable = (stats.mode & 0o111) !== 0

        expect(isExecutable).toBe(true)
      }, 60_000)
    })

    describe('LZFSE decompression validation', () => {
      it('should successfully decompress LZFSE-compressed data', async () => {
        // Use binflate as real Mach-O binary
        const originalBinary = BINFLATE

        // Compress with binpress (uses LZFSE)
        const compressedBinary = path.join(testDir, 'lzfse_compressed')
        await execCommand(BINPRESS, [originalBinary, '-o', compressedBinary])

        // Verify compressed binary has SMOL marker
        const compressedData = await fs.readFile(compressedBinary)
        const marker = Buffer.from('__SMOL_PRESSED_DATA_MAGIC_MARKER', 'utf-8')
        const markerIndex = compressedData.indexOf(marker)
        expect(markerIndex).toBeGreaterThan(-1)

        // Decompress
        const decompressedBinary = path.join(testDir, 'lzfse_decompressed')
        const result = await execCommand(BINFLATE, [
          compressedBinary,
          '--output',
          decompressedBinary,
        ])

        expect(result.code).toBe(0)

        // Verify integrity
        const originalHash = await hashFile(originalBinary)
        const decompressedHash = await hashFile(decompressedBinary)
        expect(decompressedHash).toBe(originalHash)
      }, 60_000)

      it('should handle large binaries (1MB+)', async () => {
        // Use binpress as large Mach-O binary
        const originalBinary = BINPRESS

        // Compress
        const compressedBinary = path.join(testDir, 'large_compressed')
        await execCommand(BINPRESS, [originalBinary, '-o', compressedBinary])

        // Decompress
        const decompressedBinary = path.join(testDir, 'large_decompressed')
        const result = await execCommand(BINFLATE, [
          compressedBinary,
          '--output',
          decompressedBinary,
        ])

        expect(result.code).toBe(0)

        // Verify integrity
        const originalHash = await hashFile(originalBinary)
        const decompressedHash = await hashFile(decompressedBinary)
        expect(decompressedHash).toBe(originalHash)
      }, 120_000)
    })

    describe('CLI flags and options', () => {
      it('should support --output flag', async () => {
        const originalBinary = BINFLATE

        const compressedBinary = path.join(testDir, 'output_flag_compressed')
        await execCommand(BINPRESS, [originalBinary, '-o', compressedBinary])

        // Test --output flag
        const outputPath = path.join(testDir, 'output_flag_custom')
        const result = await execCommand(BINFLATE, [
          compressedBinary,
          '--output',
          outputPath,
        ])

        expect(result.code).toBe(0)
        expect(existsSync(outputPath)).toBe(true)
      }, 60_000)

      it('should support -o short flag', async () => {
        const originalBinary = BINFLATE

        const compressedBinary = path.join(testDir, 'short_flag_compressed')
        await execCommand(BINPRESS, [originalBinary, '-o', compressedBinary])

        // Test -o flag
        const outputPath = path.join(testDir, 'short_flag_custom')
        const result = await execCommand(BINFLATE, [
          compressedBinary,
          '-o',
          outputPath,
        ])

        expect(result.code).toBe(0)
        expect(existsSync(outputPath)).toBe(true)
      }, 60_000)

      it('should display --version', async () => {
        const result = await execCommand(BINFLATE, ['--version'])

        expect(result.code).toBe(0)
        expect(result.stdout).toContain('binflate')
      })

      it('should display --help', async () => {
        const result = await execCommand(BINFLATE, ['--help'])

        expect(result.code).toBe(0)
        expect(result.stdout).toContain('binflate')
        expect(result.stdout).toContain('Usage')
      })
    })

    describe('Error handling', () => {
      it('should fail gracefully on non-existent file', async () => {
        const nonExistentPath = path.join(testDir, 'does_not_exist')
        const outputPath = path.join(testDir, 'error_output')

        const result = await execCommand(BINFLATE, [
          nonExistentPath,
          '--output',
          outputPath,
        ])

        expect(result.code).not.toBe(0)
        expect(existsSync(outputPath)).toBe(false)
      }, 60_000)

      it('should fail gracefully on non-compressed binary', async () => {
        // Create a regular binary without compression
        const regularBinary = path.join(testDir, 'not_compressed')
        await createTestBinary(regularBinary)

        const outputPath = path.join(testDir, 'error_regular_output')

        const result = await execCommand(BINFLATE, [
          regularBinary,
          '--output',
          outputPath,
        ])

        // Should fail because binary is not compressed
        expect(result.code).not.toBe(0)
      }, 60_000)

      it('should fail gracefully on corrupt compressed data', async () => {
        // Use binflate as test binary
        const originalBinary = BINFLATE

        const compressedBinary = path.join(testDir, 'corrupt_compressed')
        await execCommand(BINPRESS, [originalBinary, '-o', compressedBinary])

        // Corrupt the compressed data by truncating significantly
        // Truncate to less than the header size to ensure it fails
        const data = await fs.readFile(compressedBinary)
        const corruptData = data.subarray(0, Math.floor(data.length * 0.5))
        await fs.writeFile(compressedBinary, corruptData)

        // Try to decompress corrupt data
        const outputPath = path.join(testDir, 'corrupt_output')
        const result = await execCommand(BINFLATE, [
          compressedBinary,
          '--output',
          outputPath,
        ])

        // Should fail due to corrupt data
        expect(result.code).not.toBe(0)
      }, 60_000)

      it('should support optional output path with auto-detection', async () => {
        // Use binflate as test binary
        const originalBinary = BINFLATE

        const compressedBinary = path.join(testDir, 'auto_detect_compressed')
        await execCommand(BINPRESS, [originalBinary, '-o', compressedBinary])

        // First extraction without -o should succeed (no file exists yet)
        const cwd = testDir
        const result1 = await execCommand(BINFLATE, [compressedBinary], { cwd })
        expect(result1.code).toBe(0)

        // Second extraction should prompt for overwrite
        // We answer 'n' to cancel, which should exit with code 0
        const result2 = await execCommand(BINFLATE, [compressedBinary], {
          cwd,
          input: 'n\n',
        })

        expect(result2.code).toBe(0)
        expect(result2.stdout).toContain('Extraction cancelled')
      }, 60_000)

      it('should reject .data files with helpful error (P0 regression test)', async () => {
        // Use binflate as test binary
        const originalBinary = BINFLATE

        // Create .data file using binpress -d flag
        const dataFile = path.join(testDir, 'reject_data_file.data')
        const compressResult = await execCommand(BINPRESS, [
          originalBinary,
          '-d',
          dataFile,
        ])
        expect(compressResult.code).toBe(0)
        expect(existsSync(dataFile)).toBe(true)

        // Try to decompress .data file - should fail gracefully, NOT hang
        const outputPath = path.join(testDir, 'data_file_output')
        const result = await execCommand(BINFLATE, [
          dataFile,
          '--output',
          outputPath,
        ])

        // Should fail with error, not hang
        expect(result.code).not.toBe(0)
        expect(result.stderr).toContain('not a compressed binary')
        expect(existsSync(outputPath)).toBe(false)
        // Short timeout - should fail quickly, not hang
      }, 10_000)
    })

    describe('Cross-platform compatibility', () => {
      it('should decompress binaries on current platform', async () => {
        // Use binflate as test binary
        const originalBinary = BINFLATE

        // Compress
        const compressedBinary = path.join(testDir, 'platform_compressed')
        await execCommand(BINPRESS, [originalBinary, '-o', compressedBinary])

        // Decompress
        const decompressedBinary = path.join(testDir, 'platform_decompressed')
        const result = await execCommand(BINFLATE, [
          compressedBinary,
          '--output',
          decompressedBinary,
        ])

        expect(result.code).toBe(0)

        // Verify platform-specific details
        const stats = await fs.stat(decompressedBinary)
        expect(stats.size).toBeGreaterThan(0)

        // Verify hash match
        const originalHash = await hashFile(originalBinary)
        const decompressedHash = await hashFile(decompressedBinary)
        expect(decompressedHash).toBe(originalHash)
      }, 60_000)
    })
  },
)
