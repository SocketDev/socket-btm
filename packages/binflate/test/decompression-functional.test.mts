import { afterAll, beforeAll, describe, expect, it } from 'vitest'
/**
 * @file Binflate decompression functional tests
 *   Tests the complete decompression workflow:
 *
 *   1. Use binpress to compress a binary
 *   2. Use binflate to decompress it
 *   3. Verify decompressed binary matches original
 *   4. Test error handling for corrupt/invalid data
 *   5. Validate CLI flags and options These tests ensure:
 *
 *   - Decompression produces byte-identical output
 *   - zstd decompression works correctly
 *   - Error handling for corrupt data
 *   - CLI flags work as documented
 *   - Cross-platform compatibility CRITICAL: These are P0 tests - binflate ships
 *     with NO functional tests without this file. The shell tests only validate
 *     binary structure.
 */

import crypto from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { makeExecutable } from 'build-infra/lib/build-helpers'
import { getBuildMode } from 'build-infra/lib/constants'
import { getCurrentPlatformArch } from 'build-infra/lib/platform-mappings'

import { safeDelete, safeMkdir } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  createTestBinary,
  execCommand,
  hashFile,
} from './helpers/decompression-functional.mts'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PACKAGE_DIR = path.join(__dirname, '..')
const PACKAGES_DIR = path.join(PACKAGE_DIR, '..')
const BINPRESS_PACKAGE_DIR = path.join(PACKAGES_DIR, 'binpress')

// Determine build mode + per-platform-arch layout.
const BUILD_MODE = getBuildMode()
// socket-lint: allow top-level-await -- vitest ESM test file, never bundled to CJS
const PLATFORM_ARCH = await getCurrentPlatformArch()

// Get binflate binary path
const BINFLATE_NAME = process.platform === 'win32' ? 'binflate.exe' : 'binflate'
const BINFLATE = path.join(
  PACKAGE_DIR,
  'build',
  BUILD_MODE,
  PLATFORM_ARCH,
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
  PLATFORM_ARCH,
  'out',
  'Final',
  BINPRESS_NAME,
)

let testDir: string
let testBinary: string

// Use Node.js binary as consistent test input (not BINFLATE/BINPRESS which may vary)
const NODE_BINARY = process.execPath

// Check if binaries exist (done at module load time for skipIf)
const binflateExists = existsSync(BINFLATE)
const binpressExists = existsSync(BINPRESS)

beforeAll(async () => {
  if (!binflateExists) {
    logger.warn(`binflate not found at ${BINFLATE}`)
    logger.warn('   Run: pnpm build in packages/binflate')
    return
  }

  if (!binpressExists) {
    logger.warn(`binpress not found at ${BINPRESS}`)
    logger.warn('   Run: pnpm build in packages/binpress')
    logger.warn('   binpress is required to create compressed test data')
    return
  }

  // Create unique test directory with timestamp and random suffix to isolate from parallel runs
  const uniqueId = crypto.randomUUID()
  testDir = path.join(os.tmpdir(), `binflate-functional-${uniqueId}`)
  await safeMkdir(testDir)

  // Copy Node.js binary as consistent test input (not BINFLATE/BINPRESS which may vary between builds)
  testBinary = path.join(testDir, 'test-node')
  await fs.copyFile(NODE_BINARY, testBinary)
  await makeExecutable(testBinary)
})

afterAll(async () => {
  if (testDir) {
    await safeDelete(testDir)
  }
})

describe.skipIf(!binflateExists || !binpressExists)(
  'binflate decompression functional tests',
  () => {
    describe('basic decompression', () => {
      it('should decompress a compressed binary to identical output', async () => {
        // Use consistent test binary (Node.js binary)
        const originalBinary = testBinary

        // Compress with binpress (creates self-extracting binary)
        const compressedBinary = path.join(testDir, 'decompress_compressed')
        const compressResult = await execCommand(BINPRESS, [
          originalBinary,
          '-o',
          compressedBinary,
        ])
        expect(compressResult.code).toBe(0)
        expect(existsSync(compressedBinary)).toBeTruthy()

        // Decompress with binflate
        const decompressedBinary = path.join(testDir, 'decompress_output')
        const decompressResult = await execCommand(BINFLATE, [
          compressedBinary,
          '--output',
          decompressedBinary,
        ])

        expect(decompressResult.code).toBe(0)
        expect(existsSync(decompressedBinary)).toBeTruthy()

        // Verify byte-for-byte match
        const originalHash = await hashFile(originalBinary)
        const decompressedHash = await hashFile(decompressedBinary)
        expect(decompressedHash).toBe(originalHash)
      }, 60_000)

      it('should decompress and run --version', async () => {
        // Compress test binary
        const compressedBinary = path.join(
          testDir,
          'self_decompress_compressed',
        )
        const compressResult = await execCommand(BINPRESS, [
          testBinary,
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
        await makeExecutable(decompressedBinary)
        const execResult = await execCommand(decompressedBinary, ['--version'])

        expect(execResult.code).toBe(0)
      }, 60_000)

      it('should maintain file permissions after decompression', async () => {
        // Use consistent test binary (already executable)
        const originalBinary = testBinary

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

        // oxlint-disable-next-line socket/prefer-exists-sync -- need stats.mode for executable-permission assertion.
        const stats = await fs.stat(decompressedBinary)
        const isExecutable = (stats.mode & 0o111) !== 0

        expect(isExecutable).toBeTruthy()
      }, 60_000)
    })

    describe('zstd decompression validation', () => {
      it('should successfully decompress zstd-compressed data', async () => {
        // Use consistent test binary
        const originalBinary = testBinary

        // Compress with binpress (uses zstd)
        const compressedBinary = path.join(testDir, 'zstd_compressed')
        await execCommand(BINPRESS, [originalBinary, '-o', compressedBinary])

        // Verify compressed binary has SMOL marker
        const compressedData = await fs.readFile(compressedBinary)
        const marker = Buffer.from('__SMOL_PRESSED_DATA_MAGIC_MARKER', 'utf8')
        const markerIndex = compressedData.indexOf(marker)
        expect(markerIndex).toBeGreaterThan(-1)

        // Decompress
        const decompressedBinary = path.join(testDir, 'zstd_decompressed')
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
        // Use consistent test binary (Node.js binary is large)
        const originalBinary = testBinary

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

    describe('cLI flags and options', () => {
      it('should support --output flag', async () => {
        const originalBinary = testBinary

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
        expect(existsSync(outputPath)).toBeTruthy()
      }, 60_000)

      it('should support -o short flag', async () => {
        const originalBinary = testBinary

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
        expect(existsSync(outputPath)).toBeTruthy()
      }, 60_000)

      it('should display --version', async () => {
        const result = await execCommand(BINFLATE, ['--version'])

        expect(result.code).toBe(0)
      })

      it('should display --help', async () => {
        const result = await execCommand(BINFLATE, ['--help'])

        expect(result.code).toBe(0)
        expect(result.stdout).toContain('Usage')
      })
    })

    describe('error handling', () => {
      it('should fail gracefully on non-existent file', async () => {
        const nonExistentPath = path.join(testDir, 'does_not_exist')
        const outputPath = path.join(testDir, 'error_output')

        const result = await execCommand(BINFLATE, [
          nonExistentPath,
          '--output',
          outputPath,
        ])

        expect(result.code).not.toBe(0)
        expect(existsSync(outputPath)).toBeFalsy()
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
        // Use consistent test binary
        const originalBinary = testBinary

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
        // Use consistent test binary
        const originalBinary = testBinary

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

      it('should extract .data files (data-only format) successfully (P0 regression test)', async () => {
        // Use consistent test binary
        const originalBinary = testBinary

        // Create .data file using binpress -d flag (data-only, no executable stub)
        const dataFile = path.join(testDir, 'extract_data_file.data')
        const compressResult = await execCommand(BINPRESS, [
          originalBinary,
          '-d',
          dataFile,
        ])
        expect(compressResult.code).toBe(0)
        expect(existsSync(dataFile)).toBeTruthy()

        // Extract .data file - should succeed
        const outputPath = path.join(testDir, 'data_file_output')
        const result = await execCommand(BINFLATE, [
          dataFile,
          '--output',
          outputPath,
        ])

        // Should succeed
        expect(result.code).toBe(0)
        expect(existsSync(outputPath)).toBeTruthy()

        // Verify extracted binary matches original
        const originalHash = await hashFile(originalBinary)
        const extractedHash = await hashFile(outputPath)
        expect(extractedHash).toBe(originalHash)
      }, 10_000)
    })

    describe('cross-platform compatibility', () => {
      it('should decompress binaries on current platform', async () => {
        // Use consistent test binary
        const originalBinary = testBinary

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
        // oxlint-disable-next-line socket/prefer-exists-sync -- need stats.size to verify decompressed payload is non-empty.
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
