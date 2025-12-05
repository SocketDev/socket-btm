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
 * - PART1: "__SOCKETSEC" (11 chars)
 * - PART2: "_COMPRESSED_DATA" (16 chars)
 * - PART3: "_MAGIC_MARKER" (13 chars)
 *
 * Format: MAGIC_MARKER_PART1 + MAGIC_MARKER_PART2 + MAGIC_MARKER_PART3
 * Result: "__SOCKETSEC_COMPRESSED_DATA_MAGIC_MARKER" (40 chars)
 */
#define MAGIC_MARKER_PART1 "__SOCKETSEC"
#define MAGIC_MARKER_PART2 "_COMPRESSED_DATA"
#define MAGIC_MARKER_PART3 "_MAGIC_MARKER"

/**
 * Total length of the magic marker string (in bytes).
 * Must match: strlen(MAGIC_MARKER_PART1) + strlen(MAGIC_MARKER_PART2) + strlen(MAGIC_MARKER_PART3)
 *
 * Calculation: 11 + 16 + 13 = 40 bytes
 */
#define MAGIC_MARKER_LEN 40

/**
 * Size header format (appears after magic marker):
 * - 8 bytes: compressed size (uint64_t, little-endian)
 * - 8 bytes: uncompressed size (uint64_t, little-endian)
 */
#define SIZE_HEADER_LEN 16

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
