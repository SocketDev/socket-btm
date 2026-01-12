/**
 * test_lzfse.c
 *
 * Simple LZFSE round-trip test to catch miscompilation at build time.
 * Compresses test data, immediately decompresses it, and verifies result matches original.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifndef __APPLE__
#include <lzfse.h>
#else
#include <compression.h>
#endif

#define TEST_DATA_SIZE 1024

int main() {
    // Create test data with recognizable pattern
    unsigned char test_data[TEST_DATA_SIZE];
    for (size_t i = 0; i < TEST_DATA_SIZE; i++) {
        test_data[i] = (unsigned char)(i % 256);
    }

    fprintf(stderr, "[LZFSE TEST] Testing LZFSE compression/decompression...\n");
    fprintf(stderr, "[LZFSE TEST]   Test data size: %zu bytes\n", (size_t)TEST_DATA_SIZE);
    fprintf(stderr, "[LZFSE TEST]   First 16 bytes: ");
    for (int i = 0; i < 16; i++) {
        fprintf(stderr, "%02x ", test_data[i]);
    }
    fprintf(stderr, "\n");

#ifndef __APPLE__
    /* Linux/Windows: Use open-source lzfse library */

    // Compress
    size_t compressed_buffer_size = TEST_DATA_SIZE + 1024;
    unsigned char *compressed = malloc(compressed_buffer_size);
    if (!compressed) {
        fprintf(stderr, "[LZFSE TEST] ERROR: Failed to allocate compression buffer\n");
        return 1;
    }

    fprintf(stderr, "[LZFSE TEST]   Compressing...\n");
    size_t compressed_size = lzfse_encode_buffer(
        compressed, compressed_buffer_size,
        test_data, TEST_DATA_SIZE,
        NULL
    );

    if (compressed_size == 0 || compressed_size >= TEST_DATA_SIZE) {
        fprintf(stderr, "[LZFSE TEST] ERROR: Compression failed (returned %zu bytes)\n", compressed_size);
        free(compressed);
        return 1;
    }

    fprintf(stderr, "[LZFSE TEST]   Compressed size: %zu bytes (%.1f%%)\n",
            compressed_size, (compressed_size * 100.0) / TEST_DATA_SIZE);
    fprintf(stderr, "[LZFSE TEST]   First 16 bytes of compressed: ");
    for (size_t i = 0; i < 16 && i < compressed_size; i++) {
        fprintf(stderr, "%02x ", compressed[i]);
    }
    fprintf(stderr, "\n");

    // Decompress
    unsigned char *decompressed = malloc(TEST_DATA_SIZE);
    if (!decompressed) {
        fprintf(stderr, "[LZFSE TEST] ERROR: Failed to allocate decompression buffer\n");
        free(compressed);
        return 1;
    }

    fprintf(stderr, "[LZFSE TEST]   Decompressing...\n");
    size_t decompressed_size = lzfse_decode_buffer(
        decompressed, TEST_DATA_SIZE,
        compressed, compressed_size,
        NULL
    );

    if (decompressed_size != TEST_DATA_SIZE) {
        fprintf(stderr, "[LZFSE TEST] ERROR: Decompression failed (got %zu, expected %zu)\n",
                decompressed_size, (size_t)TEST_DATA_SIZE);
        free(compressed);
        free(decompressed);
        return 1;
    }

    fprintf(stderr, "[LZFSE TEST]   Decompressed size: %zu bytes\n", decompressed_size);
    fprintf(stderr, "[LZFSE TEST]   First 16 bytes of decompressed: ");
    for (int i = 0; i < 16; i++) {
        fprintf(stderr, "%02x ", decompressed[i]);
    }
    fprintf(stderr, "\n");

    // Verify
    if (memcmp(test_data, decompressed, TEST_DATA_SIZE) != 0) {
        fprintf(stderr, "[LZFSE TEST] ERROR: Decompressed data does NOT match original!\n");

        // Find first mismatch
        for (size_t i = 0; i < TEST_DATA_SIZE; i++) {
            if (test_data[i] != decompressed[i]) {
                fprintf(stderr, "[LZFSE TEST]   First mismatch at byte %zu: expected %02x, got %02x\n",
                        i, test_data[i], decompressed[i]);
                break;
            }
        }

        free(compressed);
        free(decompressed);
        return 1;
    }

    fprintf(stderr, "[LZFSE TEST] ✓ SUCCESS: Round-trip test passed!\n");
    fprintf(stderr, "[LZFSE TEST]   Decompressed data matches original exactly\n");

    free(compressed);
    free(decompressed);

#else
    /* macOS: Use Apple Compression framework */
    fprintf(stderr, "[LZFSE TEST] INFO: macOS uses native Compression framework, skipping test\n");
#endif

    return 0;
}
