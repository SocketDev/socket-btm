/**
 * Windows PE Binary Compressor
 *
 * Compresses PE/PE32+ binaries using Windows Compression API.
 * Supports: LZMS (best), XPRESS, XPRESS_HUFF
 *
 * Usage:
 *   socketsecurity_pe_compress.exe input output [--quality=lzms|xpress|xpress_huff]
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <windows.h>
#include <compressapi.h>

typedef struct {
    const char *input_path;
    const char *output_path;
    DWORD algorithm;
    const char *algorithm_name;
} compress_config;

/**
 * Parse compression algorithm from quality string.
 */
static DWORD parse_algorithm(const char *quality, const char **name) {
    if (quality == NULL || strcmp(quality, "lzms") == 0) {
        *name = "LZMS";
        return COMPRESS_ALGORITHM_LZMS;
    } else if (strcmp(quality, "xpress") == 0) {
        *name = "XPRESS";
        return COMPRESS_ALGORITHM_XPRESS;
    } else if (strcmp(quality, "xpress_huff") == 0) {
        *name = "XPRESS_HUFF";
        return COMPRESS_ALGORITHM_XPRESS_HUFF;
    } else {
        fprintf(stderr, "Warning: Unknown quality '%s', defaulting to LZMS\n", quality);
        *name = "LZMS";
        return COMPRESS_ALGORITHM_LZMS;
    }
}

/**
 * Parse command line arguments.
 */
static int parse_args(int argc, char *argv[], compress_config *config) {
    if (argc < 3) {
        fprintf(stderr, "Usage: %s <input> <output> [--quality=lzms|xpress|xpress_huff]\n", argv[0]);
        return -1;
    }

    config->input_path = argv[1];
    config->output_path = argv[2];

    const char *quality = NULL;
    if (argc >= 4 && strncmp(argv[3], "--quality=", 10) == 0) {
        quality = argv[3] + 10;
    }

    config->algorithm = parse_algorithm(quality, &config->algorithm_name);
    return 0;
}

/**
 * Read entire file into memory.
 */
static unsigned char *read_file(const char *path, size_t *size) {
    HANDLE hFile = CreateFileA(path, GENERIC_READ, FILE_SHARE_READ, NULL,
                               OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (hFile == INVALID_HANDLE_VALUE) {
        fprintf(stderr, "Error: Cannot open input file '%s': %lu\n", path, GetLastError());
        return NULL;
    }

    LARGE_INTEGER fileSize;
    if (!GetFileSizeEx(hFile, &fileSize)) {
        fprintf(stderr, "Error: Cannot get file size: %lu\n", GetLastError());
        CloseHandle(hFile);
        return NULL;
    }

    *size = (size_t)fileSize.QuadPart;
    unsigned char *data = malloc(*size);
    if (!data) {
        fprintf(stderr, "Error: Cannot allocate %zu bytes for input file\n", *size);
        CloseHandle(hFile);
        return NULL;
    }

    DWORD bytesRead;
    if (!ReadFile(hFile, data, (DWORD)*size, &bytesRead, NULL) || bytesRead != *size) {
        fprintf(stderr, "Error: Read %lu bytes, expected %zu bytes\n", bytesRead, *size);
        free(data);
        CloseHandle(hFile);
        return NULL;
    }

    CloseHandle(hFile);
    return data;
}

/**
 * Write data to file.
 */
static int write_file(const char *path, const unsigned char *data, size_t size) {
    HANDLE hFile = CreateFileA(path, GENERIC_WRITE, 0, NULL,
                               CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (hFile == INVALID_HANDLE_VALUE) {
        fprintf(stderr, "Error: Cannot open output file '%s': %lu\n", path, GetLastError());
        return -1;
    }

    DWORD bytesWritten;
    if (!WriteFile(hFile, data, (DWORD)size, &bytesWritten, NULL) || bytesWritten != size) {
        fprintf(stderr, "Error: Wrote %lu bytes, expected %zu bytes\n", bytesWritten, size);
        CloseHandle(hFile);
        return -1;
    }

    CloseHandle(hFile);
    return 0;
}

/**
 * Compress data using Windows Compression API.
 */
static unsigned char *compress_data(const unsigned char *input, size_t input_size,
                                    DWORD algorithm,
                                    size_t *compressed_size) {
    // Create compressor
    COMPRESSOR_HANDLE hCompressor = NULL;
    if (!CreateCompressor(algorithm, NULL, &hCompressor)) {
        fprintf(stderr, "Error: Failed to create compressor: %lu\n", GetLastError());
        return NULL;
    }

    // Query compressed size bound
    SIZE_T compressedBound;
    if (!Compress(hCompressor, (PVOID)input, input_size, NULL, 0, &compressedBound)) {
        DWORD error = GetLastError();
        if (error != ERROR_INSUFFICIENT_BUFFER) {
            fprintf(stderr, "Error: Failed to query compressed size: %lu\n", error);
            CloseCompressor(hCompressor);
            return NULL;
        }
    }

    // Allocate buffer
    unsigned char *compressed = malloc(compressedBound);
    if (!compressed) {
        fprintf(stderr, "Error: Cannot allocate %zu bytes for compressed data\n", (size_t)compressedBound);
        CloseCompressor(hCompressor);
        return NULL;
    }

    // Compress
    SIZE_T compressedSize;
    if (!Compress(hCompressor, (PVOID)input, input_size,
                  compressed, compressedBound, &compressedSize)) {
        fprintf(stderr, "Error: Compression failed: %lu\n", GetLastError());
        free(compressed);
        CloseCompressor(hCompressor);
        return NULL;
    }

    CloseCompressor(hCompressor);
    *compressed_size = (size_t)compressedSize;

    // Shrink buffer to actual compressed size
    unsigned char *final = realloc(compressed, *compressed_size);
    if (!final) {
        // realloc failed, but compressed buffer is still valid
        return compressed;
    }

    return final;
}

int main(int argc, char *argv[]) {
    compress_config config;

    // Parse arguments
    if (parse_args(argc, argv, &config) != 0) {
        return 1;
    }

    printf("Socket Binary Compression (Windows PE)\n");
    printf("======================================\n");
    printf("Input:      %s\n", config.input_path);
    printf("Output:     %s\n", config.output_path);
    printf("Algorithm:  %s\n", config.algorithm_name);
    printf("\n");

    // Read input file
    printf("Reading input file...\n");
    size_t input_size;
    unsigned char *input_data = read_file(config.input_path, &input_size);
    if (!input_data) {
        return 1;
    }
    printf("  Input size: %.2f MB (%zu bytes)\n", input_size / 1024.0 / 1024.0, input_size);

    // Compress
    printf("\nCompressing with %s...\n", config.algorithm_name);
    size_t compressed_size;
    unsigned char *compressed_data = compress_data(
        input_data, input_size,
        config.algorithm,
        &compressed_size
    );
    free(input_data);

    if (!compressed_data) {
        return 1;
    }

    printf("  Compressed size: %.2f MB (%zu bytes)\n", compressed_size / 1024.0 / 1024.0, compressed_size);
    printf("  Compression ratio: %.1f%%\n", 100.0 * compressed_size / input_size);

    // Check if compression actually saved space
    if (compressed_size >= input_size) {
        printf("  Warning: Compressed size (%zu bytes) >= original size (%zu bytes)\n",
               compressed_size, input_size);
        printf("  Skipping compression (would increase file size)\n");
        free(compressed_data);

        // Copy original file instead
        printf("\nCopying original file (no compression benefit)...\n");
        // Re-read the original file since we freed it
        unsigned char *original_data = read_file(config.input_path, &input_size);
        if (!original_data) {
            return 1;
        }
        int result = write_file(config.output_path, original_data, input_size);
        free(original_data);

        if (result != 0) {
            return 1;
        }

        printf("  Output: %s (uncompressed)\n", config.output_path);
        printf("\n✓ File copied (compression skipped)\n");
        return 0;
    }

    printf("  Space saved: %.2f MB (%.1f%%)\n",
           (input_size - compressed_size) / 1024.0 / 1024.0,
           100.0 * (1.0 - (double)compressed_size / input_size));

    // Write output
    printf("\nWriting compressed data...\n");
    int result = write_file(config.output_path, compressed_data, compressed_size);
    free(compressed_data);

    if (result != 0) {
        return 1;
    }

    printf("  Output: %s\n", config.output_path);
    printf("\n✓ Compression complete!\n");

    return 0;
}
