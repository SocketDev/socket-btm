/**
 * Windows PE Binary Extractor CLI
 *
 * Command-line tool to extract compressed binaries without running them.
 * Extracts binpressed binaries to a specified output path.
 *
 * Usage:
 *   binflate <compressed_binary> [-o|--output <output_path>]
 *
 * If --output is not specified, extracts to current directory with original name.
 *
 * Binary format (same as self-extracting decompressor):
 *   [Decompressor stub code]
 *   [Optional: SMOL_SPEC line]
 *   [Magic marker: __SOCKETSEC_COMPRESSED_DATA_MAGIC_MARKER]
 *   [8-byte header: compressed size (uint64_t)]
 *   [8-byte header: uncompressed size (uint64_t)]
 *   [Compressed data]
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <windows.h>
#include <compressapi.h>
#include <io.h>

#include "compression_constants.h"
#include "marker_finder.h"

/**
 * Print usage information
 */
static void print_usage(const char *program) {
    printf("binflate - Extract compressed binaries\n\n");
    printf("Usage:\n");
    printf("  %s <compressed_binary> [-o|--output <output_path>]\n", program);
    printf("  %s --help\n\n", program);
    printf("Options:\n");
    printf("  -o, --output <path>  Output path (default: current directory)\n");
    printf("  --help               Show this help message\n\n");
    printf("Examples:\n");
    printf("  %s node-compressed.exe              # Extracts to .\\node.exe\n", program);
    printf("  %s node-compressed.exe -o C:\\tmp\\node.exe # Extracts to C:\\tmp\\node.exe\n", program);
}

/**
 * Find compressed data marker and return offset to size headers
 */
static LONGLONG find_compressed_data_offset(HANDLE hFile) {
    return find_marker_handle(hFile, MAGIC_MARKER_PART1, MAGIC_MARKER_PART2, MAGIC_MARKER_PART3, MAGIC_MARKER_LEN);
}

/**
 * Check if a binary is compressed (has magic marker)
 */
static int is_compressed_binary(const char *path) {
    HANDLE hFile = CreateFileA(path, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (hFile == INVALID_HANDLE_VALUE) {
        return 0;
    }

    LONGLONG offset = find_compressed_data_offset(hFile);
    CloseHandle(hFile);

    return (offset != -1) ? 1 : 0;
}

/**
 * Extract compressed binary to output path
 */
static int extract_binary(const char *input_path, const char *output_path) {
    int exit_code = 1;
    HANDLE hSource = INVALID_HANDLE_VALUE;
    HANDLE hDest = INVALID_HANDLE_VALUE;
    unsigned char *compressed_data = NULL;
    unsigned char *decompressed_data = NULL;
    DECOMPRESSOR_HANDLE hDecompressor = NULL;

    printf("Extracting compressed binary...\n");
    printf("  Input: %s\n", input_path);
    printf("  Output: %s\n", output_path);

    // Open input file
    hSource = CreateFileA(input_path, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (hSource == INVALID_HANDLE_VALUE) {
        fprintf(stderr, "Error: Failed to open input file: %lu\n", GetLastError());
        goto cleanup;
    }

    // Find compressed data offset
    LONGLONG data_offset = find_compressed_data_offset(hSource);
    if (data_offset == -1) {
        fprintf(stderr, "Error: Not a compressed binary (magic marker not found)\n");
        fprintf(stderr, "Hint: This tool only works with binaries compressed by binpress\n");
        goto cleanup;
    }

    // Seek to size headers
    LARGE_INTEGER seek_pos;
    seek_pos.QuadPart = data_offset;
    if (!SetFilePointerEx(hSource, seek_pos, NULL, FILE_BEGIN)) {
        fprintf(stderr, "Error: Failed to seek to compressed data: %lu\n", GetLastError());
        goto cleanup;
    }

    // Read sizes
    UINT64 compressed_size, uncompressed_size;
    DWORD bytes_read;
    if (!ReadFile(hSource, &compressed_size, sizeof(compressed_size), &bytes_read, NULL) ||
        bytes_read != sizeof(compressed_size)) {
        fprintf(stderr, "Error: Failed to read compressed size\n");
        goto cleanup;
    }
    if (!ReadFile(hSource, &uncompressed_size, sizeof(uncompressed_size), &bytes_read, NULL) ||
        bytes_read != sizeof(uncompressed_size)) {
        fprintf(stderr, "Error: Failed to read uncompressed size\n");
        goto cleanup;
    }

    // Validate sizes
    if (compressed_size == 0 || uncompressed_size == 0 ||
        compressed_size > 500 * 1024 * 1024 || uncompressed_size > 500 * 1024 * 1024) {
        fprintf(stderr, "Error: Invalid compressed/uncompressed sizes\n");
        goto cleanup;
    }

    printf("  Compressed size: %.2f MB\n", compressed_size / 1024.0 / 1024.0);
    printf("  Uncompressed size: %.2f MB\n", uncompressed_size / 1024.0 / 1024.0);

    // Allocate buffers
    compressed_data = malloc(compressed_size);
    decompressed_data = malloc(uncompressed_size);
    if (!compressed_data || !decompressed_data) {
        fprintf(stderr, "Error: Failed to allocate memory\n");
        goto cleanup;
    }

    // Read compressed data
    printf("  Reading compressed data...\n");
    SIZE_T total_read = 0;
    while (total_read < compressed_size) {
        DWORD to_read = (DWORD)min(compressed_size - total_read, 1024 * 1024);
        DWORD n;
        if (!ReadFile(hSource, compressed_data + total_read, to_read, &n, NULL) || n == 0) {
            fprintf(stderr, "Error: Failed to read compressed data\n");
            goto cleanup;
        }
        total_read += n;
    }

    // Decompress using Windows Compression API
    printf("  Decompressing...\n");
    if (!CreateDecompressor(COMPRESS_ALGORITHM_LZMS, NULL, &hDecompressor)) {
        fprintf(stderr, "Error: Failed to create decompressor: %lu\n", GetLastError());
        goto cleanup;
    }

    SIZE_T decompressed_bytes = 0;
    if (!Decompress(hDecompressor, compressed_data, compressed_size,
                    decompressed_data, uncompressed_size, &decompressed_bytes)) {
        fprintf(stderr, "Error: Decompression failed: %lu\n", GetLastError());
        goto cleanup;
    }

    if (decompressed_bytes != uncompressed_size) {
        fprintf(stderr, "Error: Decompression size mismatch (got %llu bytes, expected %llu)\n",
                (unsigned long long)decompressed_bytes, (unsigned long long)uncompressed_size);
        goto cleanup;
    }

    // Free compressed data (no longer needed)
    free(compressed_data);
    compressed_data = NULL;

    // Write to output file
    printf("  Writing to output...\n");
    hDest = CreateFileA(output_path, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (hDest == INVALID_HANDLE_VALUE) {
        fprintf(stderr, "Error: Failed to create output file: %lu\n", GetLastError());
        goto cleanup;
    }

    SIZE_T total_written = 0;
    while (total_written < uncompressed_size) {
        DWORD to_write = (DWORD)min(uncompressed_size - total_written, 1024 * 1024);
        DWORD n;
        if (!WriteFile(hDest, decompressed_data + total_written, to_write, &n, NULL) || n == 0) {
            fprintf(stderr, "Error: Failed to write output file: %lu\n", GetLastError());
            goto cleanup;
        }
        total_written += n;
    }

    printf("\n");
    printf("Extraction successful!\n");
    printf("  Output: %s (%.2f MB)\n", output_path, uncompressed_size / 1024.0 / 1024.0);
    exit_code = 0;

cleanup:
    if (hSource != INVALID_HANDLE_VALUE) CloseHandle(hSource);
    if (hDest != INVALID_HANDLE_VALUE) CloseHandle(hDest);
    if (hDecompressor) CloseDecompressor(hDecompressor);
    if (compressed_data) free(compressed_data);
    if (decompressed_data) free(decompressed_data);
    return exit_code;
}

/**
 * Get default output path (input basename without compression extension)
 */
static void get_default_output_path(const char *input_path, char *output_path, size_t size) {
    // Copy input path
    char temp[MAX_PATH];
    strncpy(temp, input_path, sizeof(temp) - 1);
    temp[sizeof(temp) - 1] = '\0';

    // Find last path separator
    char *base = strrchr(temp, '\\');
    if (!base) base = strrchr(temp, '/');
    if (base) {
        base++; // Skip separator
    } else {
        base = temp;
    }

    // Remove common compressed suffixes if present
    size_t len = strlen(base);
    if (len > 4 && (_stricmp(base + len - 4, ".bin") == 0 ||
                     _stricmp(base + len - 4, ".out") == 0)) {
        base[len - 4] = '\0';
    } else if (len > 11 && _stricmp(base + len - 11, "-compressed") == 0) {
        base[len - 11] = '\0';
    }

    // Ensure .exe extension
    if (len > 4 && _stricmp(base + strlen(base) - 4, ".exe") != 0) {
        snprintf(output_path, size, "%s.exe", base);
    } else {
        snprintf(output_path, size, "%s", base);
    }
}

int main(int argc, char *argv[]) {
    const char *input_path = NULL;
    const char *output_path = NULL;
    char default_output[MAX_PATH];

    // Parse arguments
    for (int i = 1; i < argc; i++) {
        if (_stricmp(argv[i], "--help") == 0 || _stricmp(argv[i], "-h") == 0) {
            print_usage(argv[0]);
            return 0;
        } else if (_stricmp(argv[i], "-o") == 0 || _stricmp(argv[i], "--output") == 0) {
            if (i + 1 < argc) {
                output_path = argv[++i];
            } else {
                fprintf(stderr, "Error: --output requires a path argument\n\n");
                print_usage(argv[0]);
                return 1;
            }
        } else if (!input_path) {
            input_path = argv[i];
        } else {
            fprintf(stderr, "Error: Unexpected argument: %s\n\n", argv[i]);
            print_usage(argv[0]);
            return 1;
        }
    }

    // Check if input was provided
    if (!input_path) {
        fprintf(stderr, "Error: No input file specified\n\n");
        print_usage(argv[0]);
        return 1;
    }

    // Check if input exists
    if (_access(input_path, 4) != 0) {
        fprintf(stderr, "Error: Cannot read input file: %s\n", input_path);
        return 1;
    }

    // Check if input is a compressed binary
    if (!is_compressed_binary(input_path)) {
        fprintf(stderr, "Error: Input file is not a compressed binary\n");
        fprintf(stderr, "Hint: This tool only works with binaries compressed by binpress\n");
        return 1;
    }

    // Determine output path
    if (!output_path) {
        get_default_output_path(input_path, default_output, sizeof(default_output));
        output_path = default_output;
    }

    // Check if output already exists
    if (_access(output_path, 0) == 0) {
        char response[10];
        printf("Warning: Output file '%s' already exists. Overwrite? (y/N): ", output_path);
        if (fgets(response, sizeof(response), stdin) == NULL ||
            (response[0] != 'y' && response[0] != 'Y')) {
            printf("Extraction cancelled.\n");
            return 0;
        }
    }

    // Extract
    return extract_binary(input_path, output_path);
}
