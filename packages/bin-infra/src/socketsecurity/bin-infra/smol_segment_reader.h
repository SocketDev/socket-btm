/**
 * @file smol_segment_reader.h
 * @brief Shared SMOL segment reading utilities.
 *
 * Provides common functions for reading SMOL segment metadata from binaries.
 * Used by stubs, decompressors, and binary inspection tools.
 */

#ifndef SMOL_SEGMENT_READER_H
#define SMOL_SEGMENT_READER_H

#include <stddef.h>
#include <stdint.h>
#include "socketsecurity/bin-infra/compression_constants.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * SMOL metadata read from binary.
 *
 * Contains all metadata fields from SMOL section:
 * - Sizes (compressed and uncompressed)
 * - Cache key (16 hex chars)
 * - Platform metadata (platform, arch, libc)
 * - Integrity hash (SHA-256 of compressed data)
 * - Offset to compressed data start
 */
typedef struct {
    uint64_t compressed_size;        /* Compressed data size in bytes. */
    uint64_t uncompressed_size;      /* Uncompressed data size in bytes. */
    char cache_key[17];              /* Cache key (16 hex chars + null). */
    uint8_t platform_metadata[PLATFORM_METADATA_LEN];  /* Platform metadata bytes. */
    uint8_t integrity_hash[INTEGRITY_HASH_LEN];  /* SHA-256 of compressed data. */
    int64_t data_offset;             /* Offset to compressed data start. */
} smol_metadata_t;

/**
 * Read SMOL metadata from file descriptor.
 *
 * Finds the magic marker, then reads:
 * - Compressed size (8 bytes)
 * - Uncompressed size (8 bytes)
 * - Cache key (16 bytes)
 * - Platform metadata (3 bytes)
 * - Integrity hash (32 bytes, SHA-256 of compressed data)
 * - has_update_config flag (1 byte)
 * - [optional: update_config_binary (1192 bytes)]
 *
 * After successful return, file descriptor is positioned at start of compressed data.
 *
 * @param fd File descriptor (must be open for reading, seekable)
 * @param metadata Output structure (caller-allocated)
 * @return 0 on success, -1 on error (with stderr message)
 */
int smol_read_metadata(int fd, smol_metadata_t *metadata);

#if defined(__APPLE__)
/**
 * Read SMOL metadata using optimized Mach-O header parsing.
 * This is much faster than scanning the entire file for the magic marker.
 * Falls back to smol_read_metadata() if Mach-O parsing fails.
 *
 * @param fd File descriptor (must be open for reading, seekable)
 * @param metadata Output structure (caller-allocated)
 * @return 0 on success, -1 on error (with stderr message)
 */
int smol_read_metadata_macho(int fd, smol_metadata_t *metadata);
#endif

#if defined(__linux__)
/**
 * Read SMOL metadata using optimized ELF PT_NOTE search.
 * This is much faster than scanning the entire file for the magic marker.
 * Falls back to smol_read_metadata() if PT_NOTE search fails.
 *
 * @param fd File descriptor (must be open for reading, seekable)
 * @param metadata Output structure (caller-allocated)
 * @return 0 on success, -1 on error (with stderr message)
 */
int smol_read_metadata_elf(int fd, smol_metadata_t *metadata);
#endif

#if defined(_WIN32)
/**
 * Read SMOL metadata using optimized PE header parsing.
 * This is much faster than scanning the entire file for the magic marker.
 * Falls back to smol_read_metadata() if PE parsing fails.
 *
 * @param fd File descriptor (must be open for reading, seekable)
 * @param metadata Output structure (caller-allocated)
 * @return 0 on success, -1 on error (with stderr message)
 */
int smol_read_metadata_pe(int fd, smol_metadata_t *metadata);
#endif

/**
 * Read SMOL metadata after marker position.
 *
 * Similar to smol_read_metadata() but assumes file descriptor is already
 * positioned immediately after the magic marker (at compressed_size field).
 * This is useful for platform-specific marker finding (e.g., PT_NOTE search).
 *
 * @param fd File descriptor positioned after marker
 * @param metadata Output structure (caller-allocated)
 * @return 0 on success, -1 on error (with stderr message)
 */
int smol_read_metadata_after_marker(int fd, smol_metadata_t *metadata);

/**
 * Validate SMOL metadata.
 *
 * Checks:
 * - Sizes are non-zero and within max_size limit
 * - Cache key is exactly 16 hex characters [0-9a-fA-F]
 *
 * @param metadata Metadata to validate
 * @param max_size Maximum allowed size in bytes (0 = no limit)
 * @return 0 if valid, -1 if invalid (with stderr message)
 */
int smol_validate_metadata(const smol_metadata_t *metadata, size_t max_size);

/**
 * Search for SMOL marker in memory buffer.
 *
 * Used by binject for compressed stub detection.
 * Searches for the runtime-constructed magic marker string.
 *
 * @param buffer Buffer to search
 * @param size Size of buffer in bytes
 * @param offset_out Output: offset to marker start (if found)
 * @return 0 if found, -1 if not found
 */
int smol_find_marker_in_buffer(const uint8_t *buffer, size_t size, size_t *offset_out);

/**
 * Extract Node.js version from SMOL binary using fast native parsing.
 *
 * This is much faster than the LIEF-based smol_extract_node_version() because
 * it uses platform-specific header parsing instead of full binary analysis.
 *
 * Works for:
 * - SMOL stubs (compressed binaries with PRESSED_DATA section)
 * - node-smol binaries (with SMFG config in PRESSED_DATA)
 *
 * Does NOT work for:
 * - Plain Node.js binaries (no SMOL sections)
 * - PE VS_VERSION_INFO extraction (use LIEF version for that)
 *
 * @param binary_path Path to binary file
 * @return Version string (e.g., "25.5.0"), or NULL if not found.
 *         Caller must free() the returned string.
 */
char* smol_extract_node_version_fast(const char *binary_path);

#ifdef __cplusplus
}
#endif

#endif /* SMOL_SEGMENT_READER_H */
