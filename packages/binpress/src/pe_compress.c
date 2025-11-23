/**
 * Windows PE Binary Compressor
 *
 * Compresses PE/PE32+ binaries using Windows Compression API.
 * Updates node-compressed stubs by combining stub + compressed data.
 * Supports: LZMS (best), XPRESS, XPRESS_HUFF
 *
 * Usage:
 *   binpress <input> --data-only [-o <output>]    # Create compressed data only
 *   binpress <input> -u <stub> [-o <output>]      # Update node-compressed stub
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <windows.h>
#include <compressapi.h>

#ifndef VERSION
#define VERSION "dev"
#endif

typedef struct {
    const char *input_path;
    const char *stub_path;
    const char *output_path;
    const char *update_stub_path;
    DWORD algorithm;
    const char *algorithm_name;
    int data_only;
    int show_help;
    int show_version;
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
        fprintf(stderr, "⚠ Unknown quality '%s', defaulting to LZMS\n", quality);
        *name = "LZMS";
        return COMPRESS_ALGORITHM_LZMS;
    }
}

/**
 * Print usage information.
 */
static void print_usage(const char *program) {
    printf("binpress - Create compressed node-compressed stubs\n\n");
    printf("Usage:\n");
    printf("  %s <input> --data-only [-o <output>]          # Create compressed data only\n", program);
    printf("  %s <input> -u <stub> [-o <output>]            # Update node-compressed stub\n", program);
    printf("  %s --help\n", program);
    printf("  %s --version\n\n", program);
    printf("Arguments:\n");
    printf("  input                Path to plain binary to compress\n\n");
    printf("Options:\n");
    printf("  -o, --output PATH    Output path (optional, defaults based on mode)\n");
    printf("  --data-only          Create compressed data file only\n");
    printf("  -u, --update PATH    Update existing node-compressed stub with new compressed data\n");
    printf("  --quality=ALGO       Compression algorithm (lzms, xpress, xpress_huff, default: lzms)\n");
    printf("  -h, --help           Show this help message\n");
    printf("  -v, --version        Show version information\n\n");
    printf("Examples:\n");
    printf("  %s node.exe --data-only -o node.data                # Create compressed data only\n", program);
    printf("  %s node.exe --data-only                             # Output to cwd\n", program);
    printf("  %s node.exe -u node-compressed.exe -o updated.exe   # Update with new data\n", program);
    printf("  %s node.exe -u node-compressed.exe                  # Update in-place\n\n", program);
    printf("Note: Input must be a plain binary. If input is already a node-compressed stub,\n");
    printf("      use -u/--update mode to replace its compressed data.\n");
}

/**
 * Parse command line arguments.
 */
static int parse_args(int argc, char *argv[], compress_config *config) {
    memset(config, 0, sizeof(compress_config));

    const char *quality = NULL;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--version") == 0 || strcmp(argv[i], "-v") == 0) {
            config->show_version = 1;
            return 0;
        } else if (strcmp(argv[i], "--help") == 0 || strcmp(argv[i], "-h") == 0) {
            config->show_help = 1;
            return 0;
        } else if (strcmp(argv[i], "-o") == 0 || strcmp(argv[i], "--output") == 0) {
            if (i + 1 < argc) {
                config->output_path = argv[++i];
            } else {
                fprintf(stderr, "Error: --output requires a path argument\n");
                return -1;
            }
        } else if (strcmp(argv[i], "-u") == 0 || strcmp(argv[i], "--update") == 0) {
            if (i + 1 < argc) {
                config->update_stub_path = argv[++i];
            } else {
                fprintf(stderr, "Error: --update requires a path argument\n");
                return -1;
            }
        } else if (strcmp(argv[i], "--data-only") == 0) {
            config->data_only = 1;
        } else if (strncmp(argv[i], "--quality=", 10) == 0) {
            quality = argv[i] + 10;
        } else if (!config->input_path) {
            config->input_path = argv[i];
        } else {
            fprintf(stderr, "Error: Unexpected argument: %s\n", argv[i]);
            return -1;
        }
    }

    config->algorithm = parse_algorithm(quality, &config->algorithm_name);
    return 0;
}

/**
 * Validate configuration.
 */
static int validate_config(const compress_config *config) {
    if (!config->input_path) {
        fprintf(stderr, "Error: No input file specified\n");
        return -1;
    }

    // Check if input exists.
    if (GetFileAttributesA(config->input_path) == INVALID_FILE_ATTRIBUTES) {
        fprintf(stderr, "Error: Cannot read input file: %s\n", config->input_path);
        return -1;
    }

    // Validate mode combinations.
    if (config->update_stub_path && config->data_only) {
        fprintf(stderr, "Error: --update and --data-only are mutually exclusive\n");
        return -1;
    }

    // Determine mode and validate requirements.
    if (config->update_stub_path) {
        // Update mode.
        if (GetFileAttributesA(config->update_stub_path) == INVALID_FILE_ATTRIBUTES) {
            fprintf(stderr, "Error: Cannot read stub file for update: %s\n", config->update_stub_path);
            return -1;
        }
    } else if (config->data_only) {
        // Data-only mode (output optional).
    } else {
        // No valid mode specified.
        fprintf(stderr, "Error: Must specify either --data-only or -u/--update\n");
        return -1;
    }

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

    // Parse arguments.
    if (parse_args(argc, argv, &config) != 0) {
        print_usage(argv[0]);
        return 1;
    }

    // Handle version and help.
    if (config.show_version) {
        printf("binpress %s\n", VERSION);
        return 0;
    }

    if (config.show_help) {
        print_usage(argv[0]);
        return 0;
    }

    // Validate configuration.
    if (validate_config(&config) != 0) {
        fprintf(stderr, "\n");
        print_usage(argv[0]);
        return 1;
    }

    printf("Processing Windows PE binary...\n");
    printf("  Input: %s\n", config.input_path);

    // Read input file.
    printf("\nReading input binary...\n");
    size_t input_size;
    unsigned char *input_data = read_file(config.input_path, &input_size);
    if (!input_data) {
        return 1;
    }
    printf("  Input size: %.2f MB (%zu bytes)\n", input_size / 1024.0 / 1024.0, input_size);

    // Compress.
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

    printf("  Compressed size: %.2f MB (%zu bytes)\n",
           compressed_size / 1024.0 / 1024.0, compressed_size);
    printf("  Compression ratio: %.1f%%\n", 100.0 * compressed_size / input_size);

    // Mode 1: Data-only - write compressed data and exit.
    if (config.data_only) {
        const char *output = config.output_path ? config.output_path : "compressed.data";
        printf("\nWriting compressed data to %s...\n", output);
        int result = write_file(output, compressed_data, compressed_size);
        free(compressed_data);

        if (result != 0) {
            return 1;
        }

        printf("\n✓ Compressed data created!\n");
        printf("  Output: %s\n", output);
        return 0;
    }

    // Mode 2: Update node-compressed stub.
    const char *stub_source = config.update_stub_path;
    const char *output = config.output_path ? config.output_path : config.update_stub_path;

    printf("  Node-compressed stub: %s\n", stub_source);
    printf("  Output: %s\n", output);

    printf("\nUpdating node-compressed stub...\n");

    // Read stub.
    size_t stub_size;
    unsigned char *stub_data = read_file(stub_source, &stub_size);
    if (!stub_data) {
        free(compressed_data);
        return 1;
    }

    // Create concatenated output: stub + compressed data.
    size_t total_size = stub_size + compressed_size;
    unsigned char *output_data = malloc(total_size);
    if (!output_data) {
        fprintf(stderr, "Error: Cannot allocate %zu bytes for output\n", total_size);
        free(stub_data);
        free(compressed_data);
        return 1;
    }

    memcpy(output_data, stub_data, stub_size);
    memcpy(output_data + stub_size, compressed_data, compressed_size);

    free(stub_data);
    free(compressed_data);

    // Write node-compressed stub.
    int result = write_file(output, output_data, total_size);
    free(output_data);

    if (result != 0) {
        return 1;
    }

    printf("\n✓ Node-compressed stub updated!\n");
    printf("  Output: %s\n", output);
    printf("  Total size: %.2f MB\n", total_size / 1024.0 / 1024.0);
    printf("  Reduction: %.1f%%\n", 100.0 * (1.0 - (double)total_size / input_size));

    return 0;
}
