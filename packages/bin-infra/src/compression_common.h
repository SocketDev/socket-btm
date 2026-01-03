/**
 * compression_common.h
 *
 * Platform-agnostic compression/decompression utilities for binary tooling.
 * Supports macOS (LZFSE), Linux (LZMA), and Windows (LZMS).
 */

#ifndef COMPRESSION_COMMON_H
#define COMPRESSION_COMMON_H

#include <stdint.h>
#include <stddef.h>

/* Error codes */
#define COMPRESS_OK 0
#define COMPRESS_ERROR_INVALID_INPUT -1
#define COMPRESS_ERROR_ALLOC_FAILED -2
#define COMPRESS_ERROR_COMPRESS_FAILED -3
#define COMPRESS_ERROR_DECOMPRESS_FAILED -4
#define COMPRESS_ERROR_UNSUPPORTED_ALGORITHM -5

/* Compression algorithms (must match compression_constants.h) */
#define COMPRESS_ALGORITHM_LZFSE 0
#define COMPRESS_ALGORITHM_LZMA 1
#define COMPRESS_ALGORITHM_LZMS 2

/**
 * Compress data using platform-specific compression.
 *
 * @param input Input data buffer
 * @param input_size Size of input data in bytes
 * @param output Pointer to receive allocated output buffer (caller must free)
 * @param output_size Pointer to receive size of compressed data
 * @return COMPRESS_OK on success, error code on failure
 *
 * Platform-specific algorithms:
 * - macOS: LZFSE via Apple Compression framework
 * - Linux: LZMA via liblzma
 * - Windows: LZMS via Windows Compression API
 */
int compress_buffer(const uint8_t *input, size_t input_size,
                   uint8_t **output, size_t *output_size);

/**
 * Decompress data using platform-specific decompression.
 *
 * @param input Input compressed data buffer
 * @param input_size Size of compressed data in bytes
 * @param output Pointer to receive allocated output buffer (caller must free)
 * @param output_size Pointer to receive size of decompressed data
 * @return COMPRESS_OK on success, error code on failure
 *
 * Platform-specific algorithms:
 * - macOS: LZFSE via Apple Compression framework
 * - Linux: LZMA via liblzma
 * - Windows: LZMS via Windows Compression API
 */
int decompress_buffer(const uint8_t *input, size_t input_size,
                     uint8_t **output, size_t *output_size);

/**
 * Decompress data into pre-allocated buffer with known size.
 *
 * @param input Input compressed data buffer
 * @param input_size Size of compressed data in bytes
 * @param output Pre-allocated output buffer (must be at least expected_size bytes)
 * @param expected_size Expected size of decompressed data in bytes
 * @return COMPRESS_OK on success, error code on failure
 *
 * Use this when you know the exact decompressed size (from metadata).
 * More efficient than decompress_buffer() since it avoids progressive resizing.
 *
 * Platform-specific algorithms:
 * - macOS: LZFSE via Apple Compression framework
 * - Linux: LZMA via liblzma
 * - Windows: LZMS via Windows Compression API
 */
int decompress_buffer_sized(const uint8_t *input, size_t input_size,
                            uint8_t *output, size_t expected_size);

/**
 * Compress data using specific algorithm (cross-platform).
 *
 * @param input Input data buffer
 * @param input_size Size of input data in bytes
 * @param output Pointer to receive allocated output buffer (caller must free)
 * @param output_size Pointer to receive size of compressed data
 * @param algorithm Compression algorithm (COMPRESS_ALGORITHM_*)
 * @return COMPRESS_OK on success, error code on failure
 *
 * Supported algorithms on all platforms:
 * - COMPRESS_ALGORITHM_LZFSE: LZFSE compression (for Mach-O)
 * - COMPRESS_ALGORITHM_LZMA: LZMA compression (for ELF)
 * - COMPRESS_ALGORITHM_LZMS: LZMS compression (for PE, Windows only; falls back to LZMA on other platforms)
 */
int compress_buffer_with_algorithm(const uint8_t *input, size_t input_size,
                                   uint8_t **output, size_t *output_size,
                                   int algorithm);

/**
 * Decompress data using specific algorithm (cross-platform).
 *
 * @param input Input compressed data buffer
 * @param input_size Size of compressed data in bytes
 * @param output Pre-allocated output buffer
 * @param expected_size Expected size of decompressed data
 * @param algorithm Compression algorithm used (COMPRESS_ALGORITHM_*)
 * @return COMPRESS_OK on success, error code on failure
 *
 * Supported algorithms on all platforms:
 * - COMPRESS_ALGORITHM_LZFSE: LZFSE decompression
 * - COMPRESS_ALGORITHM_LZMA: LZMA decompression
 * - COMPRESS_ALGORITHM_LZMS: LZMS decompression (Windows only; uses LZMA fallback on other platforms)
 */
int decompress_buffer_with_algorithm(const uint8_t *input, size_t input_size,
                                     uint8_t *output, size_t expected_size,
                                     int algorithm);

#endif /* COMPRESSION_COMMON_H */
