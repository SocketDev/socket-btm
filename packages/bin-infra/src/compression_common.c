/**
 * compression_common.c
 *
 * Platform-agnostic compression/decompression implementation.
 */

#include "compression_common.h"
#include "buffer_constants.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* LZFSE compression library */
#ifdef __APPLE__
/* macOS: Use Apple Compression framework (native) */
#include <compression.h>
#else
/* Linux/Windows: Use open-source lzfse library */
#include <lzfse.h>
#endif

/* Compress data using LZFSE compression */
int compress_buffer(const uint8_t *input, size_t input_size,
                   uint8_t **output, size_t *output_size) {
    if (!input || !output || !output_size || input_size == 0) {
        return COMPRESS_ERROR_INVALID_INPUT;
    }

#ifdef __APPLE__
    /* macOS: Use Apple Compression framework with LZFSE */
    size_t dst_size = compression_encode_scratch_buffer_size(COMPRESSION_LZFSE);
    if (dst_size < input_size + COMPRESSION_BUFFER_OVERHEAD) {
        dst_size = input_size + COMPRESSION_BUFFER_OVERHEAD;
    }

    uint8_t *dst_buffer = malloc(dst_size);
    if (!dst_buffer) {
        return COMPRESS_ERROR_ALLOC_FAILED;
    }

    size_t compressed_size = compression_encode_buffer(
        dst_buffer, dst_size,
        input, input_size,
        NULL,
        COMPRESSION_LZFSE
    );

    if (compressed_size == 0 || compressed_size >= input_size) {
        free(dst_buffer);
        return COMPRESS_ERROR_COMPRESS_FAILED;
    }

    /* Shrink buffer to actual compressed size (optional optimization) */
    uint8_t *shrunk = realloc(dst_buffer, compressed_size);
    *output = shrunk ? shrunk : dst_buffer;
    *output_size = compressed_size;
#else
    /* Linux/Windows: Use open-source LZFSE library */
    size_t dst_size = input_size + COMPRESSION_BUFFER_OVERHEAD;
    uint8_t *dst_buffer = malloc(dst_size);
    if (!dst_buffer) {
        return COMPRESS_ERROR_ALLOC_FAILED;
    }

    size_t compressed_size = lzfse_encode_buffer(
        dst_buffer, dst_size,
        input, input_size,
        NULL
    );

    if (compressed_size == 0 || compressed_size >= input_size) {
        free(dst_buffer);
        return COMPRESS_ERROR_COMPRESS_FAILED;
    }

    /* Shrink buffer to actual compressed size (optional optimization) */
    uint8_t *shrunk = realloc(dst_buffer, compressed_size);
    *output = shrunk ? shrunk : dst_buffer;
    *output_size = compressed_size;
#endif

    return COMPRESS_OK;
}

/* Decompress data using LZFSE decompression */
int decompress_buffer(const uint8_t *input, size_t input_size,
                     uint8_t **output, size_t *output_size) {
    if (!input || !output || !output_size || input_size == 0) {
        return COMPRESS_ERROR_INVALID_INPUT;
    }

#ifdef __APPLE__
    /* macOS: Use Apple Compression framework - try progressively larger buffers */
    /* Check for overflow before multiplication */
    if (input_size > SIZE_MAX / 4) {
        fprintf(stderr, "Error: Input size too large for decompression buffer calculation\n");
        return COMPRESS_ERROR_SIZE_LIMIT_EXCEEDED;
    }
    size_t dst_size = input_size * 4;
    uint8_t *dst_buffer = NULL;

    for (int attempt = 0; attempt < 3; attempt++) {
        /* Check size limit before allocation to prevent DoS */
        if (dst_size > MAX_DECOMPRESSED_SIZE) {
            free(dst_buffer);
            fprintf(stderr, "Error: Decompressed size would exceed safety limit (%lu bytes)\n",
                    (unsigned long)MAX_DECOMPRESSED_SIZE);
            return COMPRESS_ERROR_SIZE_LIMIT_EXCEEDED;
        }

        uint8_t *new_buffer = realloc(dst_buffer, dst_size);
        if (!new_buffer) {
            free(dst_buffer);  /* Free previous allocation on realloc failure */
            return COMPRESS_ERROR_ALLOC_FAILED;
        }
        dst_buffer = new_buffer;

        size_t decompressed_size = compression_decode_buffer(
            dst_buffer, dst_size,
            input, input_size,
            NULL,
            COMPRESSION_LZFSE
        );

        if (decompressed_size > 0 && decompressed_size <= dst_size) {
            /* Shrink buffer to actual size (optional optimization) */
            uint8_t *shrunk = realloc(dst_buffer, decompressed_size);
            *output = shrunk ? shrunk : dst_buffer;
            *output_size = decompressed_size;
            return COMPRESS_OK;
        }

        dst_size *= 2;
    }

    free(dst_buffer);
    return COMPRESS_ERROR_DECOMPRESS_FAILED;
#else
    /* Linux/Windows: Use open-source LZFSE library - try progressively larger buffers */
    /* Check for overflow before multiplication */
    if (input_size > SIZE_MAX / 4) {
        fprintf(stderr, "Error: Input size too large for decompression buffer calculation\n");
        return COMPRESS_ERROR_SIZE_LIMIT_EXCEEDED;
    }
    size_t dst_size = input_size * 4;
    uint8_t *dst_buffer = NULL;

    for (int attempt = 0; attempt < 3; attempt++) {
        /* Check size limit before allocation to prevent DoS */
        if (dst_size > MAX_DECOMPRESSED_SIZE) {
            free(dst_buffer);
            fprintf(stderr, "Error: Decompressed size would exceed safety limit (%lu bytes)\n",
                    (unsigned long)MAX_DECOMPRESSED_SIZE);
            return COMPRESS_ERROR_SIZE_LIMIT_EXCEEDED;
        }

        uint8_t *new_buffer = realloc(dst_buffer, dst_size);
        if (!new_buffer) {
            free(dst_buffer);  /* Free previous allocation on realloc failure */
            return COMPRESS_ERROR_ALLOC_FAILED;
        }
        dst_buffer = new_buffer;

        size_t decompressed_size = lzfse_decode_buffer(
            dst_buffer, dst_size,
            input, input_size,
            NULL
        );

        if (decompressed_size > 0 && decompressed_size <= dst_size) {
            /* Shrink buffer to actual size (optional optimization) */
            uint8_t *shrunk = realloc(dst_buffer, decompressed_size);
            *output = shrunk ? shrunk : dst_buffer;
            *output_size = decompressed_size;
            return COMPRESS_OK;
        }

        dst_size *= 2;
    }

    free(dst_buffer);
    return COMPRESS_ERROR_DECOMPRESS_FAILED;
#endif
}

/* Decompress data into pre-allocated buffer with known size */
int decompress_buffer_sized(const uint8_t *input, size_t input_size,
                            uint8_t *output, size_t expected_size) {
    if (!input || !output || input_size == 0 || expected_size == 0) {
        return COMPRESS_ERROR_INVALID_INPUT;
    }

#ifdef __APPLE__
    /* macOS: Use Apple Compression framework with LZFSE */
    size_t decompressed_size = compression_decode_buffer(
        output, expected_size,
        input, input_size,
        NULL,
        COMPRESSION_LZFSE
    );

    if (decompressed_size != expected_size) {
        return COMPRESS_ERROR_DECOMPRESS_FAILED;
    }
#else
    /* Linux/Windows: Use open-source LZFSE library */
    size_t decompressed_size = lzfse_decode_buffer(
        output, expected_size,
        input, input_size,
        NULL
    );

    if (decompressed_size != expected_size) {
        return COMPRESS_ERROR_DECOMPRESS_FAILED;
    }
#endif

    return COMPRESS_OK;
}

/* Compress data using LZFSE (cross-platform) */
int compress_buffer_with_algorithm(const uint8_t *input, size_t input_size,
                                   uint8_t **output, size_t *output_size,
                                   int algorithm) {
    if (!input || !output || !output_size || input_size == 0) {
        return COMPRESS_ERROR_INVALID_INPUT;
    }

    if (algorithm != COMPRESS_ALGORITHM_LZFSE) {
        return COMPRESS_ERROR_UNSUPPORTED_ALGORITHM;
    }

    return compress_buffer(input, input_size, output, output_size);
}

/* Decompress data using LZFSE (cross-platform) */
int decompress_buffer_with_algorithm(const uint8_t *input, size_t input_size,
                                     uint8_t *output, size_t expected_size,
                                     int algorithm) {
    if (!input || !output || input_size == 0 || expected_size == 0) {
        return COMPRESS_ERROR_INVALID_INPUT;
    }

    if (algorithm != COMPRESS_ALGORITHM_LZFSE) {
        return COMPRESS_ERROR_UNSUPPORTED_ALGORITHM;
    }

    return decompress_buffer_sized(input, input_size, output, expected_size);
}
