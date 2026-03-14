/**
 * gzip_compress.c - Platform-abstracted gzip compression
 *
 * Uses Apple Compression framework (COMPRESSION_ZLIB) on macOS,
 * and libdeflate on Linux/Windows.
 */

#include "socketsecurity/build-infra/gzip_compress.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef __APPLE__
/* macOS: Use Apple Compression framework */
#include <compression.h>

/* Gzip header (10 bytes) and trailer (8 bytes) */
#define GZIP_HEADER_SIZE 10
#define GZIP_TRAILER_SIZE 8
#define GZIP_OVERHEAD (GZIP_HEADER_SIZE + GZIP_TRAILER_SIZE)

/* CRC32 for gzip trailer */
static uint32_t crc32_table[256];
static int crc32_table_initialized = 0;

static void init_crc32_table(void) {
    if (crc32_table_initialized) return;
    for (uint32_t i = 0; i < 256; i++) {
        uint32_t crc = i;
        for (int j = 0; j < 8; j++) {
            crc = (crc >> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
        }
        crc32_table[i] = crc;
    }
    crc32_table_initialized = 1;
}

static uint32_t compute_crc32(const uint8_t *data, size_t len) {
    init_crc32_table();
    uint32_t crc = 0xFFFFFFFF;
    for (size_t i = 0; i < len; i++) {
        crc = crc32_table[(crc ^ data[i]) & 0xFF] ^ (crc >> 8);
    }
    return crc ^ 0xFFFFFFFF;
}

size_t gzip_compress_bound(size_t input_size) {
    /* Conservative estimate: input + 12 bytes per 16KB block + overhead */
    return input_size + (input_size / 16384 + 1) * 12 + GZIP_OVERHEAD + 64;
}

int gzip_compress(const uint8_t *input, size_t input_size,
                  uint8_t **output, size_t *output_size, int level) {
    if (!input || !output || !output_size) {
        return GZIP_ERROR_INVALID_INPUT;
    }

    /* Map level to Apple's compression (only supports default) */
    (void)level;  /* Apple Compression doesn't support compression levels for ZLIB */

    /* Allocate output buffer */
    size_t max_size = gzip_compress_bound(input_size);
    uint8_t *out_buf = malloc(max_size);
    if (!out_buf) {
        return GZIP_ERROR_ALLOC;
    }

    /* Write gzip header */
    out_buf[0] = 0x1F;  /* Magic number */
    out_buf[1] = 0x8B;
    out_buf[2] = 0x08;  /* Compression method: deflate */
    out_buf[3] = 0x00;  /* Flags */
    out_buf[4] = 0x00;  /* Modification time (4 bytes) */
    out_buf[5] = 0x00;
    out_buf[6] = 0x00;
    out_buf[7] = 0x00;
    out_buf[8] = 0x00;  /* Extra flags */
    out_buf[9] = 0xFF;  /* OS: unknown */

    /* Compress using Apple Compression framework (raw deflate) */
    size_t compressed_size = compression_encode_buffer(
        out_buf + GZIP_HEADER_SIZE,
        max_size - GZIP_OVERHEAD,
        input,
        input_size,
        NULL,
        COMPRESSION_ZLIB  /* This produces raw deflate */
    );

    if (compressed_size == 0) {
        free(out_buf);
        return GZIP_ERROR;
    }

    /* Write gzip trailer: CRC32 + original size */
    size_t trailer_offset = GZIP_HEADER_SIZE + compressed_size;
    uint32_t crc = compute_crc32(input, input_size);
    uint32_t orig_size = (uint32_t)(input_size & 0xFFFFFFFF);

    out_buf[trailer_offset + 0] = crc & 0xFF;
    out_buf[trailer_offset + 1] = (crc >> 8) & 0xFF;
    out_buf[trailer_offset + 2] = (crc >> 16) & 0xFF;
    out_buf[trailer_offset + 3] = (crc >> 24) & 0xFF;
    out_buf[trailer_offset + 4] = orig_size & 0xFF;
    out_buf[trailer_offset + 5] = (orig_size >> 8) & 0xFF;
    out_buf[trailer_offset + 6] = (orig_size >> 16) & 0xFF;
    out_buf[trailer_offset + 7] = (orig_size >> 24) & 0xFF;

    *output = out_buf;
    *output_size = trailer_offset + GZIP_TRAILER_SIZE;
    return GZIP_OK;
}

#else
/* Linux/Windows: Use libdeflate */
#include "libdeflate.h"

size_t gzip_compress_bound(size_t input_size) {
    return libdeflate_gzip_compress_bound(NULL, input_size);
}

int gzip_compress(const uint8_t *input, size_t input_size,
                  uint8_t **output, size_t *output_size, int level) {
    if (!input || !output || !output_size) {
        return GZIP_ERROR_INVALID_INPUT;
    }

    /* Clamp level to libdeflate's range (0-12) */
    if (level < 0) level = 0;
    if (level > 12) level = 12;

    /* Allocate compressor */
    struct libdeflate_compressor *compressor = libdeflate_alloc_compressor(level);
    if (!compressor) {
        return GZIP_ERROR_ALLOC;
    }

    /* Allocate output buffer */
    size_t max_size = libdeflate_gzip_compress_bound(compressor, input_size);
    uint8_t *out_buf = malloc(max_size);
    if (!out_buf) {
        libdeflate_free_compressor(compressor);
        return GZIP_ERROR_ALLOC;
    }

    /* Compress */
    size_t compressed_size = libdeflate_gzip_compress(
        compressor,
        input, input_size,
        out_buf, max_size
    );

    libdeflate_free_compressor(compressor);

    if (compressed_size == 0) {
        free(out_buf);
        return GZIP_ERROR;
    }

    /* Shrink buffer to actual size */
    uint8_t *shrunk = realloc(out_buf, compressed_size);
    *output = shrunk ? shrunk : out_buf;
    *output_size = compressed_size;
    return GZIP_OK;
}

#endif /* __APPLE__ */
