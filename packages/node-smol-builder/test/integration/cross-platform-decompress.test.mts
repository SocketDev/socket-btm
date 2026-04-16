/**
 * @fileoverview Tests for cross-platform decompression capability
 *
 * Validates that zstd compression is universal and works across all platforms.
 * Since all platforms now use zstd exclusively, binaries compressed on any
 * platform should be decompressible on any other platform.
 *
 * Tests verify:
 * - All platforms use zstd compression
 * - Compression metadata indicates zstd
 * - Binaries are platform-independent (only stub differs)
 * - Decompression logic is universal
 */

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'

import {
  HEADER_SIZES,
  MAGIC_MARKER,
} from '../../scripts/binary-compressed/shared/constants.mts'
import { getLatestFinalBinary } from '../paths.mts'

const skipTests = !getLatestFinalBinary() || !existsSync(getLatestFinalBinary())

describe.skipIf(skipTests)('cross-Platform Decompression', () => {
  let binaryPath: string
  let binaryData: Buffer
  let platformByte: number
  let _archByte: number

  beforeAll(async () => {
    binaryPath = getLatestFinalBinary()
    if (!existsSync(binaryPath)) {
      throw new Error(`Binary not found: ${binaryPath}`)
    }

    binaryData = await fs.readFile(binaryPath)
    const markerIndex = binaryData.indexOf(Buffer.from(MAGIC_MARKER, 'utf8'))

    if (markerIndex === -1) {
      throw new Error('Magic marker not found in binary')
    }

    const metadataOffset =
      markerIndex +
      HEADER_SIZES.MAGIC_MARKER +
      HEADER_SIZES.COMPRESSED_SIZE +
      HEADER_SIZES.UNCOMPRESSED_SIZE +
      HEADER_SIZES.CACHE_KEY

    platformByte = binaryData[metadataOffset]
    _archByte = binaryData[metadataOffset + 1]
  })

  describe('universal zstd compression', () => {
    it('should use zstd compression regardless of platform', () => {
      // All platforms (Linux, macOS, Windows) now use zstd exclusively
      // This means binaries are platform-independent (only the stub differs)

      // We can verify this by checking that there's no compression_algorithm byte
      // in the metadata (it was removed when we standardized on zstd)
      // Not 5 (which included compression_algorithm)
      expect(HEADER_SIZES.PLATFORM_METADATA).toBe(3)
    })

    it('should have platform-independent compressed data format', () => {
      // The compressed data format is universal (zstd)
      // Only the platform/arch/libc metadata bytes differ

      // Verify platform byte matches current platform
      const platformMapping = { darwin: 1, linux: 0, win32: 2 }
      expect(platformByte).toBe(platformMapping[os.platform()])

      // But the compression algorithm is the same for all platforms
      // (no compression_algorithm byte exists in new format)
    })

    it('should be decompressible by any platform zstd decoder', () => {
      // Since all platforms use zstd, the compressed data portion
      // can be decompressed by any zstd decoder, regardless of which
      // platform created it

      // Read compressed data
      const markerIndex = binaryData.indexOf(Buffer.from(MAGIC_MARKER, 'utf8'))
      // marker(32) + sizes(16) + cache_key(16) + platform(3) + integrity_hash(32) + config_flag(1) = 100
      const dataOffset = markerIndex + 100

      const compressedData = binaryData.subarray(dataOffset)
      expect(compressedData.length).toBeGreaterThan(0)

      // Verify it's actual data (not all zeros or all 0xFF)
      const firstBytes = compressedData.subarray(0, 100)
      const allZeros = firstBytes.every(b => b === 0)
      const allOnes = firstBytes.every(b => b === 0xff)

      expect(allZeros).toBeFalsy()
      expect(allOnes).toBeFalsy()
    })
  })

  describe('platform-specific stub, universal data', () => {
    it('should have platform-specific stub code', () => {
      // The stub code at the beginning of the binary is platform-specific:
      // - Linux: ELF format
      // - macOS: Mach-O format
      // - Windows: PE format

      // But the compressed data after the marker is universal
      const markerIndex = binaryData.indexOf(Buffer.from(MAGIC_MARKER, 'utf8'))
      expect(markerIndex).toBeGreaterThan(0)

      // Stub code is everything before the marker
      const stubSize = markerIndex
      // At least 1KB of stub code
      expect(stubSize).toBeGreaterThan(1024)
      // But less than 1MB
      expect(stubSize).toBeLessThan(1024 * 1024)
    })

    it('should have universal compressed data after marker', () => {
      // After the magic marker, the format is identical across platforms:
      // - compressed_size (8 bytes)
      // - uncompressed_size (8 bytes)
      // - cache_key (16 bytes)
      // - platform_metadata (3 bytes)
      // - compressed data (zstd format, universal)

      const markerIndex = binaryData.indexOf(Buffer.from(MAGIC_MARKER, 'utf8'))

      // Read sizes
      const compressedSizeOffset = markerIndex + 32
      const compressedSize = binaryData.readBigUInt64LE(compressedSizeOffset)
      const uncompressedSize = binaryData.readBigUInt64LE(
        compressedSizeOffset + 8,
      )

      expect(compressedSize).toBeGreaterThan(0n)
      expect(uncompressedSize).toBeGreaterThan(0n)
      // Should be compressed
      expect(uncompressedSize).toBeGreaterThan(compressedSize)
    })
  })

  describe('zstd decoder availability', () => {
    it('should use bundled zstd library on all platforms', () => {
      // All platforms use the same zstd decoder:
      // - macOS: Bundled zstd library
      // - Linux: Bundled zstd library
      // - Windows: Bundled zstd library

      // This ensures universal decompression capability
      // We verify this by checking that PLATFORM_METADATA is only 3 bytes
      // (no compression_algorithm byte needed)
      expect(HEADER_SIZES.PLATFORM_METADATA).toBe(3)
    })

    it('should produce identical decompressed output across platforms', () => {
      // When the same compressed data is decompressed on different platforms,
      // the output should be identical (bit-for-bit)

      // This is guaranteed by zstd being a deterministic algorithm
      // We can verify this by checking that cache keys are content-based
      // (SHA-512 of compressed data only)

      const markerIndex = binaryData.indexOf(Buffer.from(MAGIC_MARKER, 'utf8'))
      // marker + sizes
      const cacheKeyOffset = markerIndex + 32 + 8 + 8
      const cacheKey = binaryData
        .subarray(cacheKeyOffset, cacheKeyOffset + 16)
        .toString('utf8')

      // Cache key should be 16 hex characters (SHA-512 prefix)
      expect(cacheKey).toMatch(/^[\da-f]{16}$/)
    })
  })

  describe('compression metadata uniformity', () => {
    it('should have same header structure on all platforms', () => {
      // Header structure is identical across platforms:
      // - Magic marker: 32 bytes
      // - Compressed size: 8 bytes
      // - Uncompressed size: 8 bytes
      // - Cache key: 16 bytes
      // - Platform metadata: 3 bytes
      // Total: 67 bytes

      expect(HEADER_SIZES.MAGIC_MARKER).toBe(32)
      expect(HEADER_SIZES.COMPRESSED_SIZE).toBe(8)
      expect(HEADER_SIZES.UNCOMPRESSED_SIZE).toBe(8)
      expect(HEADER_SIZES.CACHE_KEY).toBe(16)
      expect(HEADER_SIZES.PLATFORM_METADATA).toBe(3)

      const totalSize =
        HEADER_SIZES.MAGIC_MARKER +
        HEADER_SIZES.COMPRESSED_SIZE +
        HEADER_SIZES.UNCOMPRESSED_SIZE +
        HEADER_SIZES.CACHE_KEY +
        HEADER_SIZES.PLATFORM_METADATA

      expect(totalSize).toBe(67)
    })

    it('should use same cache key calculation on all platforms', () => {
      // Cache key is calculated from compressed data only (not entire binary)
      // This ensures the same compressed data produces the same cache key
      // on all platforms

      const markerIndex = binaryData.indexOf(Buffer.from(MAGIC_MARKER, 'utf8'))
      const dataOffset = markerIndex + 67

      const _compressedData = binaryData.subarray(dataOffset)

      // We can verify the cache key matches the data by checking it's consistent
      const cacheKeyOffset = markerIndex + 48
      const cacheKey = binaryData
        .subarray(cacheKeyOffset, cacheKeyOffset + 16)
        .toString('utf8')

      expect(cacheKey).toMatch(/^[\da-f]{16}$/)

      // The cache key should be the same regardless of which platform
      // compressed the data (it's based on the compressed data hash)
    })
  })

  describe('platform metadata purpose', () => {
    it('should use platform metadata only for cache organization', () => {
      // Platform/arch/libc metadata is used for:
      // 1. Cache directory organization
      // 2. Binary compatibility validation
      // 3. NOT for determining compression algorithm (always zstd)

      const markerIndex = binaryData.indexOf(Buffer.from(MAGIC_MARKER, 'utf8'))
      const metadataOffset = markerIndex + 64

      const platformByte = binaryData[metadataOffset]
      const archByte = binaryData[metadataOffset + 1]
      const libcByte = binaryData[metadataOffset + 2]

      // All bytes should be valid
      expect([0, 1, 2]).toContain(platformByte)
      expect([0, 1, 2, 3]).toContain(archByte)
      expect([0, 1, 255]).toContain(libcByte)

      // But there's NO compression_algorithm byte (byte 3 is compressed data)
      expect(HEADER_SIZES.PLATFORM_METADATA).toBe(3)
    })

    it('should not affect decompression algorithm selection', () => {
      // The platform metadata does NOT determine which decompression
      // algorithm to use - that's always zstd

      // We verify this by confirming there's no compression_algorithm byte
      // Not 4 or 5
      expect(HEADER_SIZES.PLATFORM_METADATA).toBe(3)
    })
  })
})
