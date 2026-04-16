/**
 * compression_common.c
 *
 * Platform-agnostic compression/decompression implementation using zstd.
 */

#include "socketsecurity/bin-infra/compression_common.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <zstd.h>

/* Compress data using zstd compression (level 3) */
int compress_buffer(const uint8_t *input, size_t input_size,
                   uint8_t **output, size_t *output_size) {
    if (!input || !output || !output_size || input_size == 0) {
        return COMPRESS_ERROR_INVALID_INPUT;
    }

    size_t bound = ZSTD_compressBound(input_size);
    *output = malloc(bound);
    if (!*output) {
        return COMPRESS_ERROR_ALLOC_FAILED;
    }

    size_t result = ZSTD_compress(*output, bound, input, input_size, 3);
    if (ZSTD_isError(result)) {
        free(*output);
        *output = NULL;
        return COMPRESS_ERROR_COMPRESS_FAILED;
    }

    /* Shrink buffer to actual compressed size. */
    void *shrunk = realloc(*output, result);
    if (shrunk) *output = shrunk;

    *output_size = result;
    return COMPRESS_OK;
}

/* Decompress data using zstd decompression (unknown output size) */
int decompress_buffer(const uint8_t *input, size_t input_size,
                     uint8_t **output, size_t *output_size) {
    if (!input || !output || !output_size || input_size == 0) {
        return COMPRESS_ERROR_INVALID_INPUT;
    }

    unsigned long long frame_size = ZSTD_getFrameContentSize(input, input_size);
    if (frame_size == ZSTD_CONTENTSIZE_UNKNOWN || frame_size == ZSTD_CONTENTSIZE_ERROR) {
        fprintf(stderr, "Error: Cannot determine zstd frame content size\n");
        return COMPRESS_ERROR_DECOMPRESS_FAILED;
    }

    if (frame_size > MAX_DECOMPRESSED_SIZE) {
        fprintf(stderr, "Error: Decompressed size would exceed safety limit (%lu bytes)\n",
                (unsigned long)MAX_DECOMPRESSED_SIZE);
        return COMPRESS_ERROR_SIZE_LIMIT_EXCEEDED;
    }

    size_t dst_size = (size_t)frame_size;
    uint8_t *dst_buffer = malloc(dst_size);
    if (!dst_buffer) {
        return COMPRESS_ERROR_ALLOC_FAILED;
    }

    size_t result = ZSTD_decompress(dst_buffer, dst_size, input, input_size);
    if (ZSTD_isError(result)) {
        free(dst_buffer);
        return COMPRESS_ERROR_DECOMPRESS_FAILED;
    }

    if (result != dst_size) {
        free(dst_buffer);
        return COMPRESS_ERROR_DECOMPRESS_FAILED;
    }

    *output = dst_buffer;
    *output_size = result;
    return COMPRESS_OK;
}

/* Decompress data into pre-allocated buffer with known size */
int decompress_buffer_sized(const uint8_t *input, size_t input_size,
                            uint8_t *output, size_t expected_size) {
    if (!input || !output || input_size == 0 || expected_size == 0) {
        return COMPRESS_ERROR_INVALID_INPUT;
    }

    size_t result = ZSTD_decompress(output, expected_size, input, input_size);
    if (ZSTD_isError(result)) {
        return COMPRESS_ERROR_DECOMPRESS_FAILED;
    }

    if (result != expected_size) {
        return COMPRESS_ERROR_DECOMPRESS_FAILED;
    }

    return COMPRESS_OK;
}
