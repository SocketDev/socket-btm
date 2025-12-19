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

#endif /* COMPRESSION_COMMON_H */
