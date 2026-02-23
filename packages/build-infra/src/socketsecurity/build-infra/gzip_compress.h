/**
 * gzip_compress.h - Platform-abstracted gzip compression
 *
 * Uses Apple Compression framework (COMPRESSION_ZLIB) on macOS,
 * and libdeflate on Linux/Windows.
 */

#ifndef GZIP_COMPRESS_H
#define GZIP_COMPRESS_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Return codes */
#define GZIP_OK 0
#define GZIP_ERROR -1
#define GZIP_ERROR_ALLOC -2
#define GZIP_ERROR_INVALID_INPUT -3

/**
 * Compress data using gzip format.
 *
 * @param input         Input data buffer
 * @param input_size    Size of input data in bytes
 * @param output        Pointer to receive allocated output buffer (caller must free)
 * @param output_size   Pointer to receive size of compressed data
 * @param level         Compression level (1=fastest, 6=default, 9=best, 12=max for libdeflate)
 * @return              GZIP_OK on success, error code on failure
 */
int gzip_compress(const uint8_t *input, size_t input_size,
                  uint8_t **output, size_t *output_size, int level);

/**
 * Get the maximum compressed size for a given input size.
 * Useful for pre-allocating output buffers.
 *
 * @param input_size    Size of input data in bytes
 * @return              Maximum possible compressed size
 */
size_t gzip_compress_bound(size_t input_size);

#ifdef __cplusplus
}
#endif

#endif /* GZIP_COMPRESS_H */
