/**
 * compression_common.h
 *
 * Platform-agnostic compression/decompression utilities for binary tooling.
 * Uses zstd compression on all platforms.
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
#define COMPRESS_ERROR_SIZE_LIMIT_EXCEEDED -6

/* Maximum decompressed size (512 MB) - prevents DoS from malicious compressed data */
#define MAX_DECOMPRESSED_SIZE (512UL * 1024UL * 1024UL)

/**
 * Compress data using zstd compression (level 3).
 *
 * @param input Input data buffer
 * @param input_size Size of input data in bytes
 * @param output Pointer to receive allocated output buffer (caller must free)
 * @param output_size Pointer to receive size of compressed data
 * @return COMPRESS_OK on success, error code on failure
 */
int compress_buffer(const uint8_t *input, size_t input_size,
                   uint8_t **output, size_t *output_size);

/**
 * Decompress data using zstd decompression (unknown output size).
 *
 * Uses ZSTD_getFrameContentSize() to determine the decompressed size
 * from the zstd frame header, then decompresses in a single pass.
 *
 * @param input Input compressed data buffer
 * @param input_size Size of compressed data in bytes
 * @param output Pointer to receive allocated output buffer (caller must free)
 * @param output_size Pointer to receive size of decompressed data
 * @return COMPRESS_OK on success, error code on failure
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
 * More efficient than decompress_buffer() since it avoids size detection.
 */
int decompress_buffer_sized(const uint8_t *input, size_t input_size,
                            uint8_t *output, size_t expected_size);

/**
 * Get a human-readable description for a compression error code.
 *
 * @param error_code The error code returned by compress/decompress functions
 * @return A static string describing the error
 */
static inline const char* compress_error_string(int error_code) {
    switch (error_code) {
        case COMPRESS_OK:
            return "OK";
        case COMPRESS_ERROR_INVALID_INPUT:
            return "INVALID_INPUT: null pointer or zero-size buffer";
        case COMPRESS_ERROR_ALLOC_FAILED:
            return "ALLOC_FAILED: memory allocation failed";
        case COMPRESS_ERROR_COMPRESS_FAILED:
            return "COMPRESS_FAILED: compression operation failed";
        case COMPRESS_ERROR_DECOMPRESS_FAILED:
            return "DECOMPRESS_FAILED: data may be corrupted or not zstd-compressed";
        case COMPRESS_ERROR_SIZE_LIMIT_EXCEEDED:
            return "SIZE_LIMIT_EXCEEDED: decompressed size exceeds 512 MB limit";
        default:
            return "UNKNOWN_ERROR";
    }
}

#endif /* COMPRESSION_COMMON_H */
