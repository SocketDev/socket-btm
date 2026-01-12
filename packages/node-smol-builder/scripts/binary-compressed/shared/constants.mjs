/**
 * @fileoverview Shared constants for compressed binary format.
 * These constants MUST match the C++ definitions in:
 * packages/bin-infra/src/compression_constants.h
 */

/**
 * Magic marker to identify the start of compressed data in self-extracting binaries.
 * The marker is 32 bytes long and must match EXACTLY with the C++ stub code.
 *
 * C++ equivalent (split to prevent self-reference):
 *   MAGIC_MARKER_PART1 = "__SMOL"
 *   MAGIC_MARKER_PART2 = "_PRESSED_DATA"
 *   MAGIC_MARKER_PART3 = "_MAGIC_MARKER"
 *   MAGIC_MARKER_LEN = 32
 *
 * @type {string}
 */
export const MAGIC_MARKER = '__SMOL_PRESSED_DATA_MAGIC_MARKER'

/**
 * Binary format structure:
 * - Magic marker (32 bytes)
 * - Compressed size (8 bytes, uint64_t little-endian)
 * - Uncompressed size (8 bytes, uint64_t little-endian)
 * - Cache key (16 bytes, hex string)
 * - Platform metadata (3 bytes):
 *   - platform (1 byte): 0=linux, 1=darwin, 2=win32
 *   - arch (1 byte): 0=x64, 1=arm64, 2=ia32, 3=arm
 *   - libc (1 byte): 0=glibc, 1=musl, 255=n/a (for non-Linux)
 * - Compressed data (variable length)
 *
 * Note: All platforms now use LZFSE compression exclusively
 */
export const HEADER_SIZES = {
  CACHE_KEY: 16,
  COMPRESSED_SIZE: 8,
  MAGIC_MARKER: 32,
  PLATFORM_METADATA: 3,
  UNCOMPRESSED_SIZE: 8,
}

/**
 * Platform metadata byte values.
 */
export const PLATFORM_VALUES = {
  darwin: 1,
  linux: 0,
  win32: 2,
}

export const ARCH_VALUES = {
  arm: 3,
  arm64: 1,
  ia32: 2,
  x64: 0,
}

export const LIBC_VALUES = {
  glibc: 0,
  musl: 1,
  na: 255,
}

/**
 * Compression algorithm byte values.
 */
export const COMPRESSION_VALUES = {
  lzfse: 0,
  lzma: 1,
  lzms: 2,
}

/**
 * Metadata header size (excluding magic marker and compressed data).
 * compressed_size (8) + uncompressed_size (8) + cache_key (16) + platform_metadata (3) = 35 bytes
 */
export const METADATA_HEADER_SIZE =
  HEADER_SIZES.COMPRESSED_SIZE +
  HEADER_SIZES.UNCOMPRESSED_SIZE +
  HEADER_SIZES.CACHE_KEY +
  HEADER_SIZES.PLATFORM_METADATA

/**
 * Total header size (excluding compressed data).
 * marker (32) + metadata (35) = 67 bytes
 */
export const TOTAL_HEADER_SIZE =
  HEADER_SIZES.MAGIC_MARKER + METADATA_HEADER_SIZE
