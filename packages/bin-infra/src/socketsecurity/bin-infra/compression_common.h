/**
 * compression_common.h
 *
 * Platform-agnostic compression/decompression utilities for binary tooling.
 * Uses LZFSE compression on all platforms.
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
#define COMPRESS_ERROR_SIZE_LIMIT_EXCEEDED -6

/* Compression algorithm */
#define COMPRESS_ALGORITHM_LZFSE 0

/* Maximum decompressed size (512 MB) - prevents DoS from malicious compressed data */
#define MAX_DECOMPRESSED_SIZE (512UL * 1024UL * 1024UL)

/**
 * Compress data using LZFSE compression.
 *
 * @param input Input data buffer
 * @param input_size Size of input data in bytes
 * @param output Pointer to receive allocated output buffer (caller must free)
 * @param output_size Pointer to receive size of compressed data
 * @return COMPRESS_OK on success, error code on failure
 *
 * Uses LZFSE compression on all platforms:
 * - macOS: Apple Compression framework (native)
 * - Linux/Windows: Open-source lzfse library
 */
int compress_buffer(const uint8_t *input, size_t input_size,
                   uint8_t **output, size_t *output_size);

/**
 * Decompress data using LZFSE decompression.
 *
 * @param input Input compressed data buffer
 * @param input_size Size of compressed data in bytes
 * @param output Pointer to receive allocated output buffer (caller must free)
 * @param output_size Pointer to receive size of decompressed data
 * @return COMPRESS_OK on success, error code on failure
 *
 * Uses LZFSE decompression on all platforms:
 * - macOS: Apple Compression framework (native)
 * - Linux/Windows: Open-source lzfse library
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
 * Uses LZFSE decompression on all platforms:
 * - macOS: Apple Compression framework (native)
 * - Linux/Windows: Open-source lzfse library
 */
int decompress_buffer_sized(const uint8_t *input, size_t input_size,
                            uint8_t *output, size_t expected_size);

/**
 * Compress data using LZFSE compression (cross-platform).
 *
 * @param input Input data buffer
 * @param input_size Size of input data in bytes
 * @param output Pointer to receive allocated output buffer (caller must free)
 * @param output_size Pointer to receive size of compressed data
 * @param algorithm Compression algorithm (must be COMPRESS_ALGORITHM_LZFSE)
 * @return COMPRESS_OK on success, error code on failure
 *
 * Uses LZFSE compression on all platforms:
 * - macOS: Apple Compression framework (native)
 * - Linux/Windows: Open-source lzfse library
 */
int compress_buffer_with_algorithm(const uint8_t *input, size_t input_size,
                                   uint8_t **output, size_t *output_size,
                                   int algorithm);

/**
 * Decompress data using LZFSE decompression (cross-platform).
 *
 * @param input Input compressed data buffer
 * @param input_size Size of compressed data in bytes
 * @param output Pre-allocated output buffer
 * @param expected_size Expected size of decompressed data
 * @param algorithm Compression algorithm used (must be COMPRESS_ALGORITHM_LZFSE)
 * @return COMPRESS_OK on success, error code on failure
 *
 * Uses LZFSE decompression on all platforms:
 * - macOS: Apple Compression framework (native)
 * - Linux/Windows: Open-source lzfse library
 */
int decompress_buffer_with_algorithm(const uint8_t *input, size_t input_size,
                                     uint8_t *output, size_t expected_size,
                                     int algorithm);

#endif /* COMPRESSION_COMMON_H */
