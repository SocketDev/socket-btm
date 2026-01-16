/**
 * @file compression_constants.h
 * @brief Shared compression constants for binpress (compression) and binflate (decompression)
 *
 * This header defines constants used by both the compression tools (binpress)
 * and decompression stubs (binflate) to ensure consistency across platforms.
 */

#ifndef COMPRESSION_CONSTANTS_H
#define COMPRESSION_CONSTANTS_H

/**
 * Magic marker to identify the start of compressed data in self-extracting binaries.
 *
 * The marker is split into three parts to prevent it from appearing in the
 * decompressor stub itself, which would cause false positives when searching
 * for the data boundary.
 *
 * Split pattern chosen to break at word boundaries:
 * - PART1: "__SMOL" (6 chars)
 * - PART2: "_PRESSED_DATA" (13 chars)
 * - PART3: "_MAGIC_MARKER" (13 chars)
 *
 * Format: MAGIC_MARKER_PART1 + MAGIC_MARKER_PART2 + MAGIC_MARKER_PART3
 * Result: "__SMOL_PRESSED_DATA_MAGIC_MARKER" (32 chars)
 */
#define MAGIC_MARKER_PART1 "__SMOL"
#define MAGIC_MARKER_PART2 "_PRESSED_DATA"
#define MAGIC_MARKER_PART3 "_MAGIC_MARKER"

/**
 * Total length of the magic marker string (in bytes).
 * Must match: strlen(MAGIC_MARKER_PART1) + strlen(MAGIC_MARKER_PART2) + strlen(MAGIC_MARKER_PART3)
 *
 * Calculation: 6 + 13 + 13 = 32 bytes
 */
#define MAGIC_MARKER_LEN 32

/**
 * Size header format (appears after magic marker):
 * - 8 bytes: compressed size (uint64_t, little-endian)
 * - 8 bytes: uncompressed size (uint64_t, little-endian)
 */
#define SIZE_HEADER_LEN 16

/**
 * Cache key length (hex string, not null-terminated in binary).
 */
#define CACHE_KEY_LEN 16

/**
 * Platform metadata format (appears after cache key):
 * - 1 byte: platform (0=linux, 1=darwin, 2=win32)
 * - 1 byte: arch (0=x64, 1=arm64, 2=ia32, 3=arm)
 * - 1 byte: libc (0=glibc, 1=musl, 255=n/a for non-Linux)
 *
 * Note: Compression algorithm removed - all platforms use LZFSE exclusively
 */
#define PLATFORM_METADATA_LEN 3

/**
 * Total metadata header size (appears after magic marker, before compressed data).
 * Calculation: SIZE_HEADER_LEN + CACHE_KEY_LEN + PLATFORM_METADATA_LEN
 * = 16 + 16 + 3 = 35 bytes
 */
#define METADATA_HEADER_LEN (SIZE_HEADER_LEN + CACHE_KEY_LEN + PLATFORM_METADATA_LEN)

/* Platform values. */
#define PLATFORM_LINUX 0
#define PLATFORM_DARWIN 1
#define PLATFORM_WIN32 2

/* Architecture values. */
#define ARCH_X64 0
#define ARCH_ARM64 1
#define ARCH_IA32 2
#define ARCH_ARM 3

/* Libc values (Linux only). */
#define LIBC_GLIBC 0
#define LIBC_MUSL 1
#define LIBC_NA 255

/**
 * Binflate marker to identify the embedded binflate tool in self-extracting binaries.
 *
 * Similar to the compressed data marker, this marker is split into three parts
 * to prevent it from appearing in the binary itself.
 *
 * Split pattern:
 * - PART1: "__SOCKETSEC_" (12 chars)
 * - PART2: "BINFLATE_" (9 chars)
 * - PART3: "MAGIC_MARKER" (12 chars)
 *
 * Format: BINFLATE_MARKER_PART1 + BINFLATE_MARKER_PART2 + BINFLATE_MARKER_PART3
 * Result: "__SOCKETSEC_BINFLATE_MAGIC_MARKER" (33 chars)
 */
#define BINFLATE_MARKER_PART1 "__SOCKETSEC_"
#define BINFLATE_MARKER_PART2 "BINFLATE_"
#define BINFLATE_MARKER_PART3 "MAGIC_MARKER"

/**
 * Total length of the binflate marker string (in bytes).
 * Must match: strlen(BINFLATE_MARKER_PART1) + strlen(BINFLATE_MARKER_PART2) + strlen(BINFLATE_MARKER_PART3)
 *
 * Calculation: 12 + 9 + 12 = 33 bytes
 */
#define BINFLATE_MARKER_LEN 33

#endif /* COMPRESSION_CONSTANTS_H */
