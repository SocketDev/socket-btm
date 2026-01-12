/**
 * @fileoverview Tests for binary metadata format validation
 *
 * Validates that compressed binaries use the correct 3-byte metadata format:
 * - Platform byte (0=linux, 1=darwin, 2=win32)
 * - Architecture byte (0=x64, 1=arm64, 2=ia32, 3=arm)
 * - Libc byte (0=glibc, 1=musl, 255=n/a)
 */

import { existsSync, promises as fs } from 'node:fs'
import { platform, arch } from 'node:os'

import { describe, it, expect, beforeAll } from 'vitest'

import {
  MAGIC_MARKER,
  HEADER_SIZES,
  PLATFORM_VALUES,
  ARCH_VALUES,
  LIBC_VALUES,
} from '../../scripts/binary-compressed/shared/constants.mjs'
import { getLatestFinalBinary } from '../paths.mjs'

describe('Metadata Format Validation', () => {
  let binaryPath
  let binaryData

  beforeAll(async () => {
    binaryPath = getLatestFinalBinary()
    if (!existsSync(binaryPath)) {
      throw new Error(`Binary not found: ${binaryPath}`)
    }
    binaryData = await fs.readFile(binaryPath)
  })

  it('should have magic marker in binary', () => {
    const markerIndex = binaryData.indexOf(MAGIC_MARKER)
    expect(markerIndex).toBeGreaterThan(-1)
  })

  it('should have exactly 3 bytes of platform metadata', async () => {
    const markerIndex = binaryData.indexOf(MAGIC_MARKER)
    expect(markerIndex).toBeGreaterThan(-1)

    // Metadata starts at: marker (32) + compressed_size (8) + uncompressed_size (8) + cache_key (16) = 64 bytes after marker
    const metadataOffset =
      markerIndex +
      HEADER_SIZES.MAGIC_MARKER +
      HEADER_SIZES.COMPRESSED_SIZE +
      HEADER_SIZES.UNCOMPRESSED_SIZE +
      HEADER_SIZES.CACHE_KEY

    // Should have exactly 3 bytes of metadata
    expect(HEADER_SIZES.PLATFORM_METADATA).toBe(3)

    // Read the 3 metadata bytes
    const platformByte = binaryData[metadataOffset]
    const archByte = binaryData[metadataOffset + 1]
    const libcByte = binaryData[metadataOffset + 2]

    // All bytes should be defined (not undefined)
    expect(platformByte).toBeDefined()
    expect(archByte).toBeDefined()
    expect(libcByte).toBeDefined()
  })

  it('should have valid platform byte value', async () => {
    const markerIndex = binaryData.indexOf(MAGIC_MARKER)
    // marker(32) + sizes(16) + cache_key(16)
    const metadataOffset = markerIndex + 64

    const platformByte = binaryData[metadataOffset]

    // Platform byte should be 0 (linux), 1 (darwin), or 2 (win32)
    expect(platformByte).toBeGreaterThanOrEqual(0)
    expect(platformByte).toBeLessThanOrEqual(2)

    // Validate it matches current platform
    const expectedPlatform = PLATFORM_VALUES[platform()]
    expect(platformByte).toBe(expectedPlatform)
  })

  it('should have valid architecture byte value', async () => {
    const markerIndex = binaryData.indexOf(MAGIC_MARKER)
    const metadataOffset = markerIndex + 64

    const archByte = binaryData[metadataOffset + 1]

    // Arch byte should be 0 (x64), 1 (arm64), 2 (ia32), or 3 (arm)
    expect(archByte).toBeGreaterThanOrEqual(0)
    expect(archByte).toBeLessThanOrEqual(3)

    // Validate it matches current architecture
    const expectedArch = ARCH_VALUES[arch()]
    expect(archByte).toBe(expectedArch)
  })

  it('should have valid libc byte value', async () => {
    const markerIndex = binaryData.indexOf(MAGIC_MARKER)
    const metadataOffset = markerIndex + 64

    const libcByte = binaryData[metadataOffset + 2]

    // Libc byte should be 0 (glibc), 1 (musl), or 255 (n/a)
    const validLibcValues = [0, 1, 255]
    expect(validLibcValues).toContain(libcByte)

    // On non-Linux platforms, libc should be 255 (n/a)
    if (platform() !== 'linux') {
      expect(libcByte).toBe(LIBC_VALUES.na)
    }
  })

  it('should not have compression_algorithm byte (old format)', async () => {
    const markerIndex = binaryData.indexOf(MAGIC_MARKER)
    const _metadataOffset = markerIndex + 64

    // In old format, compression_algorithm would be at offset + 3
    // In new format, compressed data starts at offset + 3
    // We verify PLATFORM_METADATA is exactly 3 (not 4 or 5)
    expect(HEADER_SIZES.PLATFORM_METADATA).toBe(3)
    // Old format was 5 bytes
    expect(HEADER_SIZES.PLATFORM_METADATA).not.toBe(5)
  })

  it('should have correct total metadata header size', () => {
    // Metadata header: compressed_size(8) + uncompressed_size(8) + cache_key(16) + platform_metadata(3) = 35 bytes
    const expectedSize =
      HEADER_SIZES.COMPRESSED_SIZE +
      HEADER_SIZES.UNCOMPRESSED_SIZE +
      HEADER_SIZES.CACHE_KEY +
      HEADER_SIZES.PLATFORM_METADATA

    expect(expectedSize).toBe(35)
  })

  it('should have correct total header size including marker', () => {
    // Total header: marker(32) + metadata(35) = 67 bytes
    const expectedTotalSize = HEADER_SIZES.MAGIC_MARKER + 35
    expect(expectedTotalSize).toBe(67)
  })
})
