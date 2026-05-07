// ============================================================================
// test_zstd.c — Build-time ZSTD compression round-trip test
// ============================================================================
//
// WHAT THIS FILE DOES
// Creates a 1KB test buffer, compresses it with ZSTD, decompresses it,
// and verifies the output matches the original byte-for-byte. Exits with
// code 0 on success, 1 on failure.
//
// WHY IT EXISTS
// ZSTD can be miscompiled on some platforms (especially cross-compiled
// musl builds). This test runs immediately after building the ZSTD
// library to catch any compression/decompression bugs before they cause
// silent data corruption in production binaries.
// ============================================================================

/**
 * test_zstd.c
 *
 * Simple ZSTD round-trip test to catch miscompilation at build time.
 * Compresses test data, immediately decompresses it, and verifies result matches original.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <zstd.h>

#define TEST_DATA_SIZE 1024

int main() {
    // Create test data with recognizable pattern
    unsigned char test_data[TEST_DATA_SIZE];
    for (size_t i = 0; i < TEST_DATA_SIZE; i++) {
        test_data[i] = (unsigned char)(i % 256);
    }

    fprintf(stderr, "[ZSTD TEST] Testing ZSTD compression/decompression...\n");
    fprintf(stderr, "[ZSTD TEST]   Test data size: %zu bytes\n", (size_t)TEST_DATA_SIZE);
    fprintf(stderr, "[ZSTD TEST]   First 16 bytes: ");
    for (int i = 0; i < 16; i++) {
        fprintf(stderr, "%02x ", test_data[i]);
    }
    fprintf(stderr, "\n");

    // Compress
    size_t compressed_buffer_size = ZSTD_compressBound(TEST_DATA_SIZE);
    unsigned char *compressed = malloc(compressed_buffer_size);
    if (!compressed) {
        fprintf(stderr, "[ZSTD TEST] ERROR: Failed to allocate compression buffer\n");
        return 1;
    }

    fprintf(stderr, "[ZSTD TEST]   Compressing...\n");
    size_t compressed_size = ZSTD_compress(
        compressed, compressed_buffer_size,
        test_data, TEST_DATA_SIZE,
        3
    );

    if (ZSTD_isError(compressed_size)) {
        fprintf(stderr, "[ZSTD TEST] ERROR: Compression failed: %s\n",
                ZSTD_getErrorName(compressed_size));
        free(compressed);
        return 1;
    }

    if (compressed_size == 0 || compressed_size >= TEST_DATA_SIZE) {
        fprintf(stderr, "[ZSTD TEST] ERROR: Compression returned unexpected size (%zu bytes)\n", compressed_size);
        free(compressed);
        return 1;
    }

    fprintf(stderr, "[ZSTD TEST]   Compressed size: %zu bytes (%.1f%%)\n",
            compressed_size, (compressed_size * 100.0) / TEST_DATA_SIZE);
    fprintf(stderr, "[ZSTD TEST]   First 16 bytes of compressed: ");
    for (size_t i = 0; i < 16 && i < compressed_size; i++) {
        fprintf(stderr, "%02x ", compressed[i]);
    }
    fprintf(stderr, "\n");

    // Decompress
    unsigned char *decompressed = malloc(TEST_DATA_SIZE);
    if (!decompressed) {
        fprintf(stderr, "[ZSTD TEST] ERROR: Failed to allocate decompression buffer\n");
        free(compressed);
        return 1;
    }

    fprintf(stderr, "[ZSTD TEST]   Decompressing...\n");
    size_t decompressed_size = ZSTD_decompress(
        decompressed, TEST_DATA_SIZE,
        compressed, compressed_size
    );

    if (ZSTD_isError(decompressed_size)) {
        fprintf(stderr, "[ZSTD TEST] ERROR: Decompression failed: %s\n",
                ZSTD_getErrorName(decompressed_size));
        free(compressed);
        free(decompressed);
        return 1;
    }

    if (decompressed_size != TEST_DATA_SIZE) {
        fprintf(stderr, "[ZSTD TEST] ERROR: Decompression size mismatch (got %zu, expected %zu)\n",
                decompressed_size, (size_t)TEST_DATA_SIZE);
        free(compressed);
        free(decompressed);
        return 1;
    }

    fprintf(stderr, "[ZSTD TEST]   Decompressed size: %zu bytes\n", decompressed_size);
    fprintf(stderr, "[ZSTD TEST]   First 16 bytes of decompressed: ");
    for (int i = 0; i < 16; i++) {
        fprintf(stderr, "%02x ", decompressed[i]);
    }
    fprintf(stderr, "\n");

    // Verify
    if (memcmp(test_data, decompressed, TEST_DATA_SIZE) != 0) {
        fprintf(stderr, "[ZSTD TEST] ERROR: Decompressed data does NOT match original!\n");

        // Find first mismatch
        for (size_t i = 0; i < TEST_DATA_SIZE; i++) {
            if (test_data[i] != decompressed[i]) {
                fprintf(stderr, "[ZSTD TEST]   First mismatch at byte %zu: expected %02x, got %02x\n",
                        i, test_data[i], decompressed[i]);
                break;
            }
        }

        free(compressed);
        free(decompressed);
        return 1;
    }

    fprintf(stderr, "[ZSTD TEST] [OK] SUCCESS: Round-trip test passed!\n");
    fprintf(stderr, "[ZSTD TEST]   Decompressed data matches original exactly\n");

    free(compressed);
    free(decompressed);

    return 0;
}
