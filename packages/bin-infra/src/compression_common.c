/**
 * compression_common.c
 *
 * Platform-agnostic compression/decompression implementation.
 */

#include "compression_common.h"
#include <stdlib.h>
#include <string.h>

/* Platform-specific compression headers */
#ifdef __APPLE__
#include <compression.h>
#endif

#if defined(_WIN32)
#include <windows.h>
#include <compressapi.h>
#endif

/* LZMA is available on all platforms */
#include <lzma.h>

/* LZFSE library */
#ifdef __APPLE__
/* macOS: Use Apple Compression framework (native) */
#else
/* Linux/Windows: Use open-source lzfse library */
#include <lzfse.h>
#endif

/* Compress data using platform-specific compression */
int compress_buffer(const uint8_t *input, size_t input_size,
                   uint8_t **output, size_t *output_size) {
    if (!input || !output || !output_size || input_size == 0) {
        return COMPRESS_ERROR_INVALID_INPUT;
    }

#ifdef __APPLE__
    /* macOS: Use Apple Compression framework with LZFSE */
    size_t dst_size = compression_encode_scratch_buffer_size(COMPRESSION_LZFSE);
    if (dst_size < input_size + 4096) {
        dst_size = input_size + 4096;
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

    *output = realloc(dst_buffer, compressed_size);
    if (!*output) {
        *output = dst_buffer;
    }
    *output_size = compressed_size;

#elif defined(_WIN32)
    /* Windows: Use Compression API with LZMS */
    COMPRESSOR_HANDLE compressor = NULL;
    if (!CreateCompressor(COMPRESS_ALGORITHM_LZMS, NULL, &compressor)) {
        return COMPRESS_ERROR_COMPRESS_FAILED;
    }

    SIZE_T compressed_size = 0;
    if (!Compress(compressor, (PVOID)input, input_size, NULL, 0, &compressed_size)) {
        if (GetLastError() != ERROR_INSUFFICIENT_BUFFER) {
            CloseCompressor(compressor);
            return COMPRESS_ERROR_COMPRESS_FAILED;
        }
    }

    uint8_t *dst_buffer = malloc(compressed_size);
    if (!dst_buffer) {
        CloseCompressor(compressor);
        return COMPRESS_ERROR_ALLOC_FAILED;
    }

    if (!Compress(compressor, (PVOID)input, input_size, dst_buffer, compressed_size, &compressed_size)) {
        free(dst_buffer);
        CloseCompressor(compressor);
        return COMPRESS_ERROR_COMPRESS_FAILED;
    }

    CloseCompressor(compressor);
    *output = dst_buffer;
    *output_size = compressed_size;

#else
    /* Linux: Use LZMA */
    lzma_stream strm = LZMA_STREAM_INIT;
    lzma_ret ret = lzma_easy_encoder(&strm, 6, LZMA_CHECK_CRC64);
    if (ret != LZMA_OK) {
        return COMPRESS_ERROR_COMPRESS_FAILED;
    }

    size_t dst_size = lzma_stream_buffer_bound(input_size);
    uint8_t *dst_buffer = malloc(dst_size);
    if (!dst_buffer) {
        lzma_end(&strm);
        return COMPRESS_ERROR_ALLOC_FAILED;
    }

    strm.next_in = input;
    strm.avail_in = input_size;
    strm.next_out = dst_buffer;
    strm.avail_out = dst_size;

    ret = lzma_code(&strm, LZMA_FINISH);
    if (ret != LZMA_STREAM_END) {
        free(dst_buffer);
        lzma_end(&strm);
        return COMPRESS_ERROR_COMPRESS_FAILED;
    }

    size_t compressed_size = dst_size - strm.avail_out;
    lzma_end(&strm);

    *output = realloc(dst_buffer, compressed_size);
    if (!*output) {
        *output = dst_buffer;
    }
    *output_size = compressed_size;
#endif

    return COMPRESS_OK;
}

/* Decompress data using platform-specific decompression */
int decompress_buffer(const uint8_t *input, size_t input_size,
                     uint8_t **output, size_t *output_size) {
    if (!input || !output || !output_size || input_size == 0) {
        return COMPRESS_ERROR_INVALID_INPUT;
    }

#ifdef __APPLE__
    /* macOS: Try progressively larger buffers */
    size_t dst_size = input_size * 4;
    uint8_t *dst_buffer = NULL;

    for (int attempt = 0; attempt < 3; attempt++) {
        dst_buffer = realloc(dst_buffer, dst_size);
        if (!dst_buffer) {
            return COMPRESS_ERROR_ALLOC_FAILED;
        }

        size_t decompressed_size = compression_decode_buffer(
            dst_buffer, dst_size,
            input, input_size,
            NULL,
            COMPRESSION_LZFSE
        );

        if (decompressed_size > 0 && decompressed_size <= dst_size) {
            *output = realloc(dst_buffer, decompressed_size);
            if (!*output) {
                *output = dst_buffer;
            }
            *output_size = decompressed_size;
            return COMPRESS_OK;
        }

        dst_size *= 2;
    }

    free(dst_buffer);
    return COMPRESS_ERROR_DECOMPRESS_FAILED;

#elif defined(_WIN32)
    /* Windows: Use Decompression API */
    DECOMPRESSOR_HANDLE decompressor = NULL;
    if (!CreateDecompressor(COMPRESS_ALGORITHM_LZMS, NULL, &decompressor)) {
        return COMPRESS_ERROR_DECOMPRESS_FAILED;
    }

    SIZE_T decompressed_size = 0;
    if (!Decompress(decompressor, (PVOID)input, input_size, NULL, 0, &decompressed_size)) {
        if (GetLastError() != ERROR_INSUFFICIENT_BUFFER) {
            CloseDecompressor(decompressor);
            return COMPRESS_ERROR_DECOMPRESS_FAILED;
        }
    }

    uint8_t *dst_buffer = malloc(decompressed_size);
    if (!dst_buffer) {
        CloseDecompressor(decompressor);
        return COMPRESS_ERROR_ALLOC_FAILED;
    }

    if (!Decompress(decompressor, (PVOID)input, input_size, dst_buffer, decompressed_size, &decompressed_size)) {
        free(dst_buffer);
        CloseDecompressor(decompressor);
        return COMPRESS_ERROR_DECOMPRESS_FAILED;
    }

    CloseDecompressor(decompressor);
    *output = dst_buffer;
    *output_size = decompressed_size;

#else
    /* Linux: Use LZMA */
    lzma_stream strm = LZMA_STREAM_INIT;
    lzma_ret ret = lzma_stream_decoder(&strm, UINT64_MAX, LZMA_CONCATENATED);
    if (ret != LZMA_OK) {
        return COMPRESS_ERROR_DECOMPRESS_FAILED;
    }

    size_t dst_size = input_size * 4;
    uint8_t *dst_buffer = malloc(dst_size);
    if (!dst_buffer) {
        lzma_end(&strm);
        return COMPRESS_ERROR_ALLOC_FAILED;
    }

    strm.next_in = input;
    strm.avail_in = input_size;
    strm.next_out = dst_buffer;
    strm.avail_out = dst_size;

    while (ret == LZMA_OK) {
        ret = lzma_code(&strm, LZMA_FINISH);

        if (ret == LZMA_BUF_ERROR) {
            dst_size *= 2;
            uint8_t *new_buffer = realloc(dst_buffer, dst_size);
            if (!new_buffer) {
                free(dst_buffer);
                lzma_end(&strm);
                return COMPRESS_ERROR_ALLOC_FAILED;
            }
            dst_buffer = new_buffer;
            strm.next_out = dst_buffer + (dst_size / 2);
            strm.avail_out = dst_size / 2;
            ret = LZMA_OK;
        }
    }

    if (ret != LZMA_STREAM_END) {
        free(dst_buffer);
        lzma_end(&strm);
        return COMPRESS_ERROR_DECOMPRESS_FAILED;
    }

    size_t decompressed_size = dst_size - strm.avail_out;
    lzma_end(&strm);

    *output = realloc(dst_buffer, decompressed_size);
    if (!*output) {
        *output = dst_buffer;
    }
    *output_size = decompressed_size;
#endif

    return COMPRESS_OK;
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

#elif defined(_WIN32)
    /* Windows: Use Decompression API with LZMS */
    DECOMPRESSOR_HANDLE decompressor = NULL;
    if (!CreateDecompressor(COMPRESS_ALGORITHM_LZMS, NULL, &decompressor)) {
        return COMPRESS_ERROR_DECOMPRESS_FAILED;
    }

    SIZE_T decompressed_size = expected_size;
    if (!Decompress(decompressor, (PVOID)input, input_size, output, expected_size, &decompressed_size)) {
        CloseDecompressor(decompressor);
        return COMPRESS_ERROR_DECOMPRESS_FAILED;
    }

    CloseDecompressor(decompressor);

    if (decompressed_size != expected_size) {
        return COMPRESS_ERROR_DECOMPRESS_FAILED;
    }

#else
    /* Linux: Use LZMA with lzma_alone_decoder for .lzma format */
    lzma_stream strm = LZMA_STREAM_INIT;
    lzma_ret ret = lzma_alone_decoder(&strm, UINT64_MAX);
    if (ret != LZMA_OK) {
        return COMPRESS_ERROR_DECOMPRESS_FAILED;
    }

    strm.next_in = input;
    strm.avail_in = input_size;
    strm.next_out = output;
    strm.avail_out = expected_size;

    ret = lzma_code(&strm, LZMA_FINISH);
    lzma_end(&strm);

    if (ret != LZMA_STREAM_END || strm.total_out != expected_size) {
        return COMPRESS_ERROR_DECOMPRESS_FAILED;
    }
#endif

    return COMPRESS_OK;
}

/* Helper: Compress with LZFSE */
static int compress_lzfse(const uint8_t *input, size_t input_size,
                         uint8_t **output, size_t *output_size) {
#ifdef __APPLE__
    /* macOS: Use Apple Compression framework (native) */
    size_t dst_size = compression_encode_scratch_buffer_size(COMPRESSION_LZFSE);
    if (dst_size < input_size + 4096) {
        dst_size = input_size + 4096;
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

    *output = realloc(dst_buffer, compressed_size);
    if (!*output) {
        *output = dst_buffer;
    }
    *output_size = compressed_size;
    return COMPRESS_OK;
#else
    /* Linux/Windows: Use open-source lzfse library */
    size_t dst_size = input_size + 4096;
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

    *output = realloc(dst_buffer, compressed_size);
    if (!*output) {
        *output = dst_buffer;
    }
    *output_size = compressed_size;
    return COMPRESS_OK;
#endif
}

/* Helper: Compress with LZMA */
static int compress_lzma(const uint8_t *input, size_t input_size,
                        uint8_t **output, size_t *output_size) {
    lzma_stream strm = LZMA_STREAM_INIT;
    lzma_ret ret = lzma_easy_encoder(&strm, 6, LZMA_CHECK_CRC64);
    if (ret != LZMA_OK) {
        return COMPRESS_ERROR_COMPRESS_FAILED;
    }

    size_t dst_size = lzma_stream_buffer_bound(input_size);
    uint8_t *dst_buffer = malloc(dst_size);
    if (!dst_buffer) {
        lzma_end(&strm);
        return COMPRESS_ERROR_ALLOC_FAILED;
    }

    strm.next_in = input;
    strm.avail_in = input_size;
    strm.next_out = dst_buffer;
    strm.avail_out = dst_size;

    ret = lzma_code(&strm, LZMA_FINISH);
    if (ret != LZMA_STREAM_END) {
        free(dst_buffer);
        lzma_end(&strm);
        return COMPRESS_ERROR_COMPRESS_FAILED;
    }

    size_t compressed_size = dst_size - strm.avail_out;
    lzma_end(&strm);

    *output = realloc(dst_buffer, compressed_size);
    if (!*output) {
        *output = dst_buffer;
    }
    *output_size = compressed_size;
    return COMPRESS_OK;
}

/* Helper: Compress with LZMS */
static int compress_lzms(const uint8_t *input, size_t input_size,
                        uint8_t **output, size_t *output_size) {
#if defined(_WIN32)
    /* Windows: Use Compression API with LZMS */
    COMPRESSOR_HANDLE compressor = NULL;
    if (!CreateCompressor(COMPRESS_ALGORITHM_LZMS, NULL, &compressor)) {
        return COMPRESS_ERROR_COMPRESS_FAILED;
    }

    SIZE_T compressed_size = 0;
    if (!Compress(compressor, (PVOID)input, input_size, NULL, 0, &compressed_size)) {
        if (GetLastError() != ERROR_INSUFFICIENT_BUFFER) {
            CloseCompressor(compressor);
            return COMPRESS_ERROR_COMPRESS_FAILED;
        }
    }

    uint8_t *dst_buffer = malloc(compressed_size);
    if (!dst_buffer) {
        CloseCompressor(compressor);
        return COMPRESS_ERROR_ALLOC_FAILED;
    }

    if (!Compress(compressor, (PVOID)input, input_size, dst_buffer, compressed_size, &compressed_size)) {
        free(dst_buffer);
        CloseCompressor(compressor);
        return COMPRESS_ERROR_COMPRESS_FAILED;
    }

    CloseCompressor(compressor);
    *output = dst_buffer;
    *output_size = compressed_size;
    return COMPRESS_OK;
#else
    /* Non-Windows: Fall back to LZMA for PE compression */
    /* LZMS is Windows-specific, LZMA provides similar compression ratio */
    return compress_lzma(input, input_size, output, output_size);
#endif
}

/* Compress data using specific algorithm (cross-platform) */
int compress_buffer_with_algorithm(const uint8_t *input, size_t input_size,
                                   uint8_t **output, size_t *output_size,
                                   int algorithm) {
    if (!input || !output || !output_size || input_size == 0) {
        return COMPRESS_ERROR_INVALID_INPUT;
    }

    switch (algorithm) {
        case COMPRESS_ALGORITHM_LZFSE:
            return compress_lzfse(input, input_size, output, output_size);
        case COMPRESS_ALGORITHM_LZMA:
            return compress_lzma(input, input_size, output, output_size);
        case COMPRESS_ALGORITHM_LZMS:
            return compress_lzms(input, input_size, output, output_size);
        default:
            return COMPRESS_ERROR_UNSUPPORTED_ALGORITHM;
    }
}

/* Helper: Decompress with LZFSE */
static int decompress_lzfse(const uint8_t *input, size_t input_size,
                           uint8_t *output, size_t expected_size) {
#ifdef __APPLE__
    /* macOS: Use Apple Compression framework (native) */
    size_t decompressed_size = compression_decode_buffer(
        output, expected_size,
        input, input_size,
        NULL,
        COMPRESSION_LZFSE
    );

    if (decompressed_size != expected_size) {
        return COMPRESS_ERROR_DECOMPRESS_FAILED;
    }
    return COMPRESS_OK;
#else
    /* Linux/Windows: Use open-source lzfse library */
    size_t decompressed_size = lzfse_decode_buffer(
        output, expected_size,
        input, input_size,
        NULL
    );

    if (decompressed_size != expected_size) {
        return COMPRESS_ERROR_DECOMPRESS_FAILED;
    }
    return COMPRESS_OK;
#endif
}

/* Helper: Decompress with LZMA */
static int decompress_lzma(const uint8_t *input, size_t input_size,
                          uint8_t *output, size_t expected_size) {
    lzma_stream strm = LZMA_STREAM_INIT;
    lzma_ret ret = lzma_alone_decoder(&strm, UINT64_MAX);
    if (ret != LZMA_OK) {
        return COMPRESS_ERROR_DECOMPRESS_FAILED;
    }

    strm.next_in = input;
    strm.avail_in = input_size;
    strm.next_out = output;
    strm.avail_out = expected_size;

    ret = lzma_code(&strm, LZMA_FINISH);
    lzma_end(&strm);

    if (ret != LZMA_STREAM_END || strm.total_out != expected_size) {
        return COMPRESS_ERROR_DECOMPRESS_FAILED;
    }
    return COMPRESS_OK;
}

/* Helper: Decompress with LZMS */
static int decompress_lzms(const uint8_t *input, size_t input_size,
                          uint8_t *output, size_t expected_size) {
#if defined(_WIN32)
    /* Windows: Use Decompression API with LZMS */
    DECOMPRESSOR_HANDLE decompressor = NULL;
    if (!CreateDecompressor(COMPRESS_ALGORITHM_LZMS, NULL, &decompressor)) {
        return COMPRESS_ERROR_DECOMPRESS_FAILED;
    }

    SIZE_T decompressed_size = expected_size;
    if (!Decompress(decompressor, (PVOID)input, input_size, output, expected_size, &decompressed_size)) {
        CloseDecompressor(decompressor);
        return COMPRESS_ERROR_DECOMPRESS_FAILED;
    }

    CloseDecompressor(decompressor);

    if (decompressed_size != expected_size) {
        return COMPRESS_ERROR_DECOMPRESS_FAILED;
    }
    return COMPRESS_OK;
#else
    /* Non-Windows: Fall back to LZMA for PE decompression */
    /* If the data was compressed with LZMA fallback, this will work */
    return decompress_lzma(input, input_size, output, expected_size);
#endif
}

/* Decompress data using specific algorithm (cross-platform) */
int decompress_buffer_with_algorithm(const uint8_t *input, size_t input_size,
                                     uint8_t *output, size_t expected_size,
                                     int algorithm) {
    if (!input || !output || input_size == 0 || expected_size == 0) {
        return COMPRESS_ERROR_INVALID_INPUT;
    }

    switch (algorithm) {
        case COMPRESS_ALGORITHM_LZFSE:
            return decompress_lzfse(input, input_size, output, expected_size);
        case COMPRESS_ALGORITHM_LZMA:
            return decompress_lzma(input, input_size, output, expected_size);
        case COMPRESS_ALGORITHM_LZMS:
            return decompress_lzms(input, input_size, output, expected_size);
        default:
            return COMPRESS_ERROR_UNSUPPORTED_ALGORITHM;
    }
}
