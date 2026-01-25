/**
 * @fileoverview Integration tests for final binary extraction to ~/.socket/_dlx/
 *
 * Tests:
 * - Final binary decompression on first run
 * - Cache directory creation at ~/.socket/_dlx/<cache_key>/
 * - Cache hit detection on subsequent runs
 * - Metadata file generation and validation
 * - Cross-platform cache key calculation (SHA-512)
 *
 * Validates dlxBinary caching pattern compatibility:
 //github.com/SocketDev/socket-lib/blob/v5.0.0/src/dlx/cache.ts#L16
 * - generateCacheKey: https:
 //github.com/SocketDev/socket-lib/blob/v5.0.0/src/dlx/binary.ts#L49-L130
 * - DlxMetadata schema: https:
 *
 * Note: These tests require the final production binary at build/out/Final/node/.
 * Run with: pnpm build --dev or pnpm build --prod
 */

import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { homedir, platform, tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { nodeVersionRaw } from 'build-infra/lib/constants'
import { describe, expect, it, beforeAll, afterAll } from 'vitest'

import { safeDelete } from '@socketsecurity/lib/fs'
import { spawn } from '@socketsecurity/lib/spawn'

import {
  HEADER_SIZES,
  MAGIC_MARKER,
  METADATA_HEADER_SIZE,
  TOTAL_HEADER_SIZE_WITHOUT_UPDATE_CONFIG,
} from '../../scripts/binary-compressed/shared/constants.mjs'
import { getLatestFinalBinary } from '../paths.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Get the latest Final binary from build/{dev,prod}/out/Final/node/
const compressedBinaryPath = getLatestFinalBinary()

// Skip all tests if no final binary is available
const skipTests = !compressedBinaryPath || !existsSync(compressedBinaryPath)

// Cache directory (matches dlx_cache_common.h)
const DLX_DIR = path.join(homedir(), '.socket', '_dlx')

// Test tmp directory
const testTmpDir = path.join(tmpdir(), 'socket-btm-compression-tests')

// Magic marker buffer for tests
const magicMarker = Buffer.from(MAGIC_MARKER, 'utf-8')

/**
 * Extract compressed data portion from self-extracting binary.
 * The decompressor calculates cache keys from compressed data only,
 * not from the entire binary (decompressor stub + data).
 * @param {Buffer} binaryData - Full self-extracting binary buffer
 * @returns {Buffer} Compressed data portion after magic marker and size headers
 */
function extractCompressedData(binaryData) {
  const markerIndex = binaryData.indexOf(magicMarker)

  if (markerIndex === -1) {
    throw new Error('Magic marker not found in compressed binary')
  }

  // Compressed data starts after: marker (32 bytes) + compressed_size (8 bytes) + uncompressed_size (8 bytes) + cache_key (16 bytes) + platform_metadata (3 bytes) = 67 bytes total.
  const dataOffset = markerIndex + TOTAL_HEADER_SIZE_WITHOUT_UPDATE_CONFIG
  return binaryData.subarray(dataOffset)
}

describe.skipIf(skipTests)('Final binary extraction to ~/.socket/_dlx/', () => {
  let testCacheDir

  beforeAll(async () => {
    await fs.mkdir(testTmpDir, { recursive: true })
  })

  afterAll(async () => {
    await safeDelete(testTmpDir)
    // Cleanup test cache directory if created
    if (testCacheDir && existsSync(testCacheDir)) {
      await safeDelete(testCacheDir)
    }
  })

  describe('Cache directory structure', () => {
    it('should extract to ~/.socket/_dlx/<cache_key>/ on first run', async () => {
      // Calculate expected cache key (SHA-512 of compressed data only, first 16 chars)
      // The decompressor calculates cache key from compressed data portion only,
      // not from the entire self-extracting binary (decompressor stub + data).
      // This ensures cache keys are content-addressable and stable across decompressor updates.
      const binaryData = await fs.readFile(compressedBinaryPath)
      const compressedData = extractCompressedData(binaryData)

      // Calculate cache key from compressed data only (matches decompressor's dlx_calculate_cache_key)
      const hash = createHash('sha512').update(compressedData).digest('hex')
      const cacheKey = hash.slice(0, 16)

      testCacheDir = path.join(DLX_DIR, cacheKey)

      // Clean up any existing cache
      if (existsSync(testCacheDir)) {
        await safeDelete(testCacheDir)
      }

      // Execute compressed binary
      // 30s for first decompression
      const execResult = await spawn(compressedBinaryPath, ['--version'], {
        timeout: 30_000,
      })

      expect(execResult.code).toBe(0)
      expect(execResult.stdout).toMatch(/^v24\.\d+\.\d+/)

      // Verify cache directory was created
      expect(existsSync(testCacheDir)).toBe(true)

      // Verify cache contains extracted binary.
      // Note: The decompressor extracts as "node" or "node.exe" on Windows.
      const expectedBinaryName = platform() === 'win32' ? 'node.exe' : 'node'

      const cachedBinaryPath = path.join(testCacheDir, expectedBinaryName)
      expect(existsSync(cachedBinaryPath)).toBe(true)

      // Verify binary is executable
      const stats = await fs.stat(cachedBinaryPath)
      expect(stats.mode & 0o100).not.toBe(0)
    })

    it('should create .dlx-metadata.json in cache directory', async () => {
      const metadataPath = path.join(testCacheDir, '.dlx-metadata.json')
      expect(existsSync(metadataPath)).toBe(true)

      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'))

      // Verify core DlxMetadata fields.
      expect(metadata.version).toBe('1.0.0')
      expect(metadata.cache_key).toBeTruthy()
      expect(metadata.cache_key).toMatch(/^[\da-f]{16}$/)
      expect(typeof metadata.timestamp).toBe('number')
      expect(metadata.timestamp).toBeGreaterThan(0)
      expect(metadata.integrity).toBeTruthy()
      expect(metadata.integrity).toMatch(/^sha512-[A-Za-z0-9+/]+=*$/)
      expect(metadata.size).toBeGreaterThan(0)
      expect(metadata.source).toBeDefined()
      expect(metadata.source.type).toBe('extract')
      expect(metadata.source.path).toBeTruthy()

      // Verify deprecated fields are not present.
      expect(metadata.checksum).toBeUndefined()
      expect(metadata.checksum_algorithm).toBeUndefined()
      expect(metadata.platform).toBeUndefined()
      expect(metadata.arch).toBeUndefined()
      expect(metadata.extra).toBeUndefined()
    })

    it('should use cached binary on subsequent runs', async () => {
      if (!testCacheDir || !existsSync(testCacheDir)) {
        // Skip if cache not created in previous test
        return
      }

      // Get cache metadata before second run
      const metadataPath = path.join(testCacheDir, '.dlx-metadata.json')
      const metadataBefore = JSON.parse(await fs.readFile(metadataPath, 'utf8'))
      const timestampBefore = metadataBefore.timestamp

      // Second run (should use cache, not recreate)
      const execResult = await spawn(compressedBinaryPath, ['--version'], {
        timeout: 5000,
      })

      expect(execResult.code).toBe(0)
      expect(execResult.stdout).toMatch(/^v24\.\d+\.\d+/)

      // Verify cache was reused (timestamp unchanged)
      const metadataAfter = JSON.parse(await fs.readFile(metadataPath, 'utf8'))
      expect(metadataAfter.timestamp).toBe(timestampBefore)
    })

    it('should use LZFSE compression (verified via successful decompression)', async () => {
      // All platforms use LZFSE compression exclusively.
      // This is implicitly verified by successful extraction - if compression
      // algorithm doesn't match, decompression would fail.
      if (!testCacheDir || !existsSync(testCacheDir)) {
        return
      }

      const expectedBinaryName = platform() === 'win32' ? 'node.exe' : 'node'
      const cachedBinaryPath = path.join(testCacheDir, expectedBinaryName)

      // If we got here and the binary exists, LZFSE decompression worked.
      expect(existsSync(cachedBinaryPath)).toBe(true)
    })

    it('should have correct byte offset for compressed data', async () => {
      const binaryData = await fs.readFile(compressedBinaryPath)
      const markerIndex = binaryData.indexOf(magicMarker)

      expect(markerIndex).toBeGreaterThan(-1)

      // Verify TOTAL_HEADER_SIZE_WITHOUT_UPDATE_CONFIG is exactly 67 bytes
      expect(TOTAL_HEADER_SIZE_WITHOUT_UPDATE_CONFIG).toBe(67)

      // Data should start at marker + 67 bytes (not 69 bytes from old format)
      const dataOffset = markerIndex + TOTAL_HEADER_SIZE_WITHOUT_UPDATE_CONFIG
      expect(dataOffset).toBe(markerIndex + 67)

      // Verify data exists at this offset
      expect(binaryData.length).toBeGreaterThan(dataOffset)
    })

    it('should validate metadata header size calculation', () => {
      // Metadata header = compressed_size(8) + uncompressed_size(8) + cache_key(16) + platform_metadata(3)
      const calculatedSize =
        HEADER_SIZES.COMPRESSED_SIZE +
        HEADER_SIZES.UNCOMPRESSED_SIZE +
        HEADER_SIZES.CACHE_KEY +
        HEADER_SIZES.PLATFORM_METADATA

      // Not 37 from old format
      expect(calculatedSize).toBe(35)
      expect(METADATA_HEADER_SIZE).toBe(35)
    })

    it('should validate total header size calculation', () => {
      // Total header = marker(32) + metadata(35)
      const calculatedTotal = HEADER_SIZES.MAGIC_MARKER + METADATA_HEADER_SIZE
      // Not 69 from old format
      expect(calculatedTotal).toBe(67)
      expect(TOTAL_HEADER_SIZE_WITHOUT_UPDATE_CONFIG).toBe(67)
    })

    it('should have compressed size smaller than uncompressed', async () => {
      if (!testCacheDir || !existsSync(testCacheDir)) {
        return
      }

      // Read the compressed binary and extract the header to get compressed size.
      const binaryData = await fs.readFile(compressedBinaryPath)
      const markerIndex = binaryData.indexOf(magicMarker)
      expect(markerIndex).toBeGreaterThan(-1)

      // Compressed size is 8 bytes after marker.
      const compressedSizeOffset = markerIndex + HEADER_SIZES.MAGIC_MARKER
      const compressedSize = binaryData.readBigUInt64LE(compressedSizeOffset)

      // Uncompressed size is next 8 bytes.
      const uncompressedSizeOffset =
        compressedSizeOffset + HEADER_SIZES.COMPRESSED_SIZE
      const uncompressedSize = binaryData.readBigUInt64LE(
        uncompressedSizeOffset,
      )

      // Compressed should be smaller than uncompressed.
      expect(compressedSize).toBeLessThan(uncompressedSize)
    })

    it('should have proper byte alignment for compressed data', async () => {
      const binaryData = await fs.readFile(compressedBinaryPath)
      const markerIndex = binaryData.indexOf(magicMarker)

      expect(markerIndex).toBeGreaterThan(-1)

      // Calculate all offsets
      const compressedSizeOffset = markerIndex + HEADER_SIZES.MAGIC_MARKER
      const uncompressedSizeOffset =
        compressedSizeOffset + HEADER_SIZES.COMPRESSED_SIZE
      const cacheKeyOffset =
        uncompressedSizeOffset + HEADER_SIZES.UNCOMPRESSED_SIZE
      const metadataOffset = cacheKeyOffset + HEADER_SIZES.CACHE_KEY
      const dataOffset = metadataOffset + HEADER_SIZES.PLATFORM_METADATA

      // Verify all offsets are valid
      expect(compressedSizeOffset).toBe(markerIndex + 32)
      expect(uncompressedSizeOffset).toBe(markerIndex + 40)
      expect(cacheKeyOffset).toBe(markerIndex + 48)
      expect(metadataOffset).toBe(markerIndex + 64)
      expect(dataOffset).toBe(markerIndex + 67)

      // Verify total header size calculation
      expect(dataOffset).toBe(
        markerIndex + TOTAL_HEADER_SIZE_WITHOUT_UPDATE_CONFIG,
      )

      // Verify each component has correct size
      const actualMetadataHeaderSize =
        HEADER_SIZES.COMPRESSED_SIZE +
        HEADER_SIZES.UNCOMPRESSED_SIZE +
        HEADER_SIZES.CACHE_KEY +
        HEADER_SIZES.PLATFORM_METADATA
      expect(actualMetadataHeaderSize).toBe(METADATA_HEADER_SIZE)
      expect(actualMetadataHeaderSize).toBe(35)

      const actualTotalHeaderSize =
        HEADER_SIZES.MAGIC_MARKER + actualMetadataHeaderSize
      expect(actualTotalHeaderSize).toBe(
        TOTAL_HEADER_SIZE_WITHOUT_UPDATE_CONFIG,
      )
      expect(actualTotalHeaderSize).toBe(67)
    })

    it('should have sequential byte layout without gaps', async () => {
      const binaryData = await fs.readFile(compressedBinaryPath)
      const markerIndex = binaryData.indexOf(magicMarker)

      // Read all header components sequentially
      let offset = markerIndex

      // Magic marker (32 bytes)
      const marker = binaryData.subarray(offset, offset + 32)
      expect(marker.toString('utf-8')).toBe(MAGIC_MARKER)
      offset += 32

      // Compressed size (8 bytes, uint64_t)
      const compressedSize = binaryData.readBigUInt64LE(offset)
      expect(compressedSize).toBeGreaterThan(0n)
      offset += 8

      // Uncompressed size (8 bytes, uint64_t)
      const uncompressedSize = binaryData.readBigUInt64LE(offset)
      expect(uncompressedSize).toBeGreaterThan(0n)
      offset += 8

      // Cache key (16 bytes, hex string)
      const cacheKey = binaryData
        .subarray(offset, offset + 16)
        .toString('utf-8')
      expect(cacheKey).toMatch(/^[\da-f]{16}$/)
      offset += 16

      // Platform metadata (3 bytes)
      const platformByte = binaryData[offset]
      const archByte = binaryData[offset + 1]
      const libcByte = binaryData[offset + 2]
      expect(platformByte).toBeDefined()
      expect(archByte).toBeDefined()
      expect(libcByte).toBeDefined()
      offset += 3

      // Verify we're at the compressed data offset
      expect(offset).toBe(markerIndex + TOTAL_HEADER_SIZE_WITHOUT_UPDATE_CONFIG)

      // Verify compressed data exists at this offset
      expect(binaryData.length).toBeGreaterThan(offset)
      const compressedData = binaryData.subarray(offset)
      expect(compressedData.length).toBeGreaterThan(0)
    })
  })

  describe('Stdout/Stdin pipe handling', () => {
    it('should output to stdout on first run (cache miss with extraction)', async () => {
      // Clear cache to force extraction
      if (testCacheDir && existsSync(testCacheDir)) {
        await safeDelete(testCacheDir)
      }

      // Run --version with piped output
      const result = await spawn(compressedBinaryPath, ['--version'], {
        stdio: 'pipe',
      })

      expect(result.code).toBe(0)
      expect(result.stdout).toContain(nodeVersionRaw)
    })

    it('should output to stdout on subsequent runs (cache hit)', async () => {
      // Run --version again (cache should exist from previous test)
      const result = await spawn(compressedBinaryPath, ['--version'], {
        stdio: 'pipe',
      })

      expect(result.code).toBe(0)
      expect(result.stdout).toContain(nodeVersionRaw)
    })
  })

  describe('Cache key calculation', () => {
    it('should match SHA-512 based cache key format (16 hex chars only)', async () => {
      if (!testCacheDir || !existsSync(testCacheDir)) {
        return
      }

      const metadataPath = path.join(testCacheDir, '.dlx-metadata.json')
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'))

      // Cache key format: <sha512-16chars> (NO platform/arch suffix)
      // Matches dlxBinary generateCacheKey behavior
      const cacheKeyPattern = /^[\da-f]{16}$/
      expect(metadata.cache_key).toMatch(cacheKeyPattern)

      // Verify cache directory name matches cache_key
      const cacheDirName = path.basename(testCacheDir)
      expect(cacheDirName).toBe(metadata.cache_key)
    })

    it('should be content-addressable (same binary = same cache key)', async () => {
      if (!testCacheDir || !existsSync(testCacheDir)) {
        return
      }

      // Recalculate cache key to verify it matches (hash compressed data only, not entire binary)
      const binaryData = await fs.readFile(compressedBinaryPath)
      const compressedData = extractCompressedData(binaryData)
      const hash = createHash('sha512').update(compressedData).digest('hex')
      const expectedCacheKey = hash.slice(0, 16)

      const cacheDirName = path.basename(testCacheDir)
      expect(cacheDirName).toBe(expectedCacheKey)
    })
  })

  describe('Cache cleanup and invalidation', () => {
    it('should handle missing cache directory gracefully', async () => {
      if (!testCacheDir || !existsSync(testCacheDir)) {
        return
      }

      // Delete cache directory
      await safeDelete(testCacheDir)

      // Binary should recreate cache
      const execResult = await spawn(compressedBinaryPath, ['--version'], {
        timeout: 30_000,
      })

      expect(execResult.code).toBe(0)
      expect(existsSync(testCacheDir)).toBe(true)
    })
  })
})
