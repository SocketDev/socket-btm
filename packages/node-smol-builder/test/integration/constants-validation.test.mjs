/**
 * @fileoverview Tests for header size constant validation
 *
 * Validates that JavaScript constants in constants.mjs match C constants
 * in compression_constants.h.
 *
 * Tests verify:
 * - HEADER_SIZES values match expected byte counts
 * - METADATA_HEADER_SIZE calculation is correct
 * - TOTAL_HEADER_SIZE_WITHOUT_UPDATE_CONFIG calculation is correct
 * - Platform/arch/libc value mappings are consistent
 */

import { describe, it, expect } from 'vitest'

import {
  MAGIC_MARKER,
  HEADER_SIZES,
  PLATFORM_VALUES,
  ARCH_VALUES,
  LIBC_VALUES,
  METADATA_HEADER_SIZE,
  TOTAL_HEADER_SIZE_WITHOUT_UPDATE_CONFIG,
} from '../../scripts/binary-compressed/shared/constants.mjs'

describe('Header Size Constant Validation', () => {
  it('should have correct MAGIC_MARKER length', () => {
    // Magic marker must be exactly 32 bytes
    expect(MAGIC_MARKER.length).toBe(32)
    expect(MAGIC_MARKER).toBe('__SMOL_PRESSED_DATA_MAGIC_MARKER')
  })

  it('should have correct HEADER_SIZES.MAGIC_MARKER', () => {
    expect(HEADER_SIZES.MAGIC_MARKER).toBe(32)
  })

  it('should have correct HEADER_SIZES.COMPRESSED_SIZE', () => {
    // uint64_t = 8 bytes
    expect(HEADER_SIZES.COMPRESSED_SIZE).toBe(8)
  })

  it('should have correct HEADER_SIZES.UNCOMPRESSED_SIZE', () => {
    // uint64_t = 8 bytes
    expect(HEADER_SIZES.UNCOMPRESSED_SIZE).toBe(8)
  })

  it('should have correct HEADER_SIZES.CACHE_KEY', () => {
    // SHA-512 first 16 hex chars = 16 bytes
    expect(HEADER_SIZES.CACHE_KEY).toBe(16)
  })

  it('should have correct HEADER_SIZES.PLATFORM_METADATA', () => {
    // Platform (1) + Arch (1) + Libc (1) = 3 bytes
    expect(HEADER_SIZES.PLATFORM_METADATA).toBe(3)
  })

  it('should calculate METADATA_HEADER_SIZE correctly', () => {
    // compressed_size (8) + uncompressed_size (8) + cache_key (16) + platform_metadata (3) + update_config_flag (1) = 36 bytes
    const expectedSize =
      HEADER_SIZES.COMPRESSED_SIZE +
      HEADER_SIZES.UNCOMPRESSED_SIZE +
      HEADER_SIZES.CACHE_KEY +
      HEADER_SIZES.PLATFORM_METADATA +
      HEADER_SIZES.UPDATE_CONFIG_FLAG

    expect(expectedSize).toBe(36)
    expect(METADATA_HEADER_SIZE).toBe(36)
    expect(METADATA_HEADER_SIZE).toBe(expectedSize)
  })

  it('should calculate TOTAL_HEADER_SIZE_WITHOUT_UPDATE_CONFIG correctly', () => {
    // marker (32) + metadata (36) = 68 bytes
    const expectedTotalSize = HEADER_SIZES.MAGIC_MARKER + METADATA_HEADER_SIZE

    expect(expectedTotalSize).toBe(68)
    expect(TOTAL_HEADER_SIZE_WITHOUT_UPDATE_CONFIG).toBe(68)
    expect(TOTAL_HEADER_SIZE_WITHOUT_UPDATE_CONFIG).toBe(expectedTotalSize)
  })

  it('should have valid PLATFORM_VALUES mappings', () => {
    // Platform values: 0=linux, 1=darwin, 2=win32
    expect(PLATFORM_VALUES.linux).toBe(0)
    expect(PLATFORM_VALUES.darwin).toBe(1)
    expect(PLATFORM_VALUES.win32).toBe(2)

    // Should have exactly 3 platforms
    expect(Object.keys(PLATFORM_VALUES)).toHaveLength(3)
  })

  it('should have valid ARCH_VALUES mappings', () => {
    // Arch values: 0=x64, 1=arm64, 2=ia32, 3=arm
    expect(ARCH_VALUES.x64).toBe(0)
    expect(ARCH_VALUES.arm64).toBe(1)
    expect(ARCH_VALUES.ia32).toBe(2)
    expect(ARCH_VALUES.arm).toBe(3)

    // Should have exactly 4 architectures
    expect(Object.keys(ARCH_VALUES)).toHaveLength(4)
  })

  it('should have valid LIBC_VALUES mappings', () => {
    // Libc values: 0=glibc, 1=musl, 255=n/a
    expect(LIBC_VALUES.glibc).toBe(0)
    expect(LIBC_VALUES.musl).toBe(1)
    expect(LIBC_VALUES.na).toBe(255)

    // Should have exactly 3 libc types
    expect(Object.keys(LIBC_VALUES)).toHaveLength(3)
  })

  it('should have no duplicate values in PLATFORM_VALUES', () => {
    const values = Object.values(PLATFORM_VALUES)
    const uniqueValues = new Set(values)
    expect(uniqueValues.size).toBe(values.length)
  })

  it('should have no duplicate values in ARCH_VALUES', () => {
    const values = Object.values(ARCH_VALUES)
    const uniqueValues = new Set(values)
    expect(uniqueValues.size).toBe(values.length)
  })

  it('should have no duplicate values in LIBC_VALUES', () => {
    const values = Object.values(LIBC_VALUES)
    const uniqueValues = new Set(values)
    expect(uniqueValues.size).toBe(values.length)
  })

  it('should have platform values within valid byte range', () => {
    for (const value of Object.values(PLATFORM_VALUES)) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(255)
    }
  })

  it('should have arch values within valid byte range', () => {
    for (const value of Object.values(ARCH_VALUES)) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(255)
    }
  })

  it('should have libc values within valid byte range', () => {
    for (const value of Object.values(LIBC_VALUES)) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(255)
    }
  })
})
