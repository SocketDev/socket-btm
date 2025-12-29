/**
 * macOS Mach-O Binary Compressor
 *
 * Compresses Mach-O binaries using Apple Compression framework (LZFSE).
 * Updates node-compressed stubs by embedding compressed data in Mach-O segments.
 * Uses LIEF for proper Mach-O manipulation while preserving code signatures.
 *
 * Usage:
 *   binpress <input> --data-only [-o <output>]    # Create compressed data only
 *   binpress <input> -u <stub> [-o <output>]      # Update node-compressed stub
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#include <errno.h>

#ifdef __APPLE__
#include <compression.h>
#include <mach-o/loader.h>
#include <mach-o/fat.h>
#include "macho_compress_segment.h"
#endif

#ifndef VERSION
#define VERSION "dev"
#endif

/**
 * Configuration for binpress operation.
 */
typedef struct {
    const char *input_path;
    const char *stub_path;
    const char *output_path;
    const char *update_stub_path;
    int data_only;
    int show_help;
    int show_version;
} binpress_config;

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
    printf("  -h, --help           Show this help message\n");
    printf("  -v, --version        Show version information\n\n");
    printf("Examples:\n");
    printf("  %s node --data-only -o node.data        # Create compressed data only\n", program);
    printf("  %s node --data-only                     # Output to cwd\n", program);
    printf("  %s node -u node-compressed -o updated   # Update with new data\n", program);
    printf("  %s node -u node-compressed              # Update in-place\n\n", program);
    printf("Note: Input must be a plain binary. If input is already a node-compressed stub,\n");
    printf("      use -u/--update mode to replace its compressed data.\n");
}

/**
 * Parse command line arguments.
 */
static int parse_args(int argc, char *argv[], binpress_config *config) {
    memset(config, 0, sizeof(binpress_config));

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
        } else if (!config->input_path) {
            config->input_path = argv[i];
        } else {
            fprintf(stderr, "Error: Unexpected argument: %s\n", argv[i]);
            return -1;
        }
    }

    return 0;
}

/**
 * Validate configuration.
 */
static int validate_config(const binpress_config *config) {
    if (!config->input_path) {
        fprintf(stderr, "Error: No input file specified\n");
        return -1;
    }

    // Check if input exists.
    if (access(config->input_path, R_OK) != 0) {
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
        if (access(config->update_stub_path, R_OK) != 0) {
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
 * Get file size.
 */
static long get_file_size(const char *path) {
    struct stat st;
    if (stat(path, &st) != 0) {
        return -1;
    }
    return st.st_size;
}

/**
 * Read entire file into memory.
 */
static unsigned char *read_file(const char *path, size_t *size) {
    FILE *f = fopen(path, "rb");
    if (!f) {
        fprintf(stderr, "Error: Cannot open file '%s': %s\n", path, strerror(errno));
        return NULL;
    }

    fseek(f, 0, SEEK_END);
    *size = ftell(f);
    fseek(f, 0, SEEK_SET);

    unsigned char *data = malloc(*size);
    if (!data) {
        fprintf(stderr, "Error: Cannot allocate %zu bytes\n", *size);
        fclose(f);
        return NULL;
    }

    size_t read = fread(data, 1, *size, f);
    fclose(f);

    if (read != *size) {
        fprintf(stderr, "Error: Read %zu bytes, expected %zu bytes\n", read, *size);
        free(data);
        return NULL;
    }

    return data;
}

/**
 * Write data to file.
 */
static int write_file(const char *path, const unsigned char *data, size_t size) {
    FILE *f = fopen(path, "wb");
    if (!f) {
        fprintf(stderr, "Error: Cannot open output file '%s': %s\n", path, strerror(errno));
        return -1;
    }

    size_t written = fwrite(data, 1, size, f);
    fclose(f);

    if (written != size) {
        fprintf(stderr, "Error: Wrote %zu bytes, expected %zu bytes\n", written, size);
        return -1;
    }

    return 0;
}

#ifdef __APPLE__
/**
 * Compress data using Apple Compression framework (LZFSE).
 */
static unsigned char *compress_data(const unsigned char *input, size_t input_size,
                                    size_t *compressed_size) {
    size_t buffer_size = input_size + 65536;
    unsigned char *compressed = malloc(buffer_size);
    if (!compressed) {
        fprintf(stderr, "Error: Cannot allocate %zu bytes for compressed data\n", buffer_size);
        return NULL;
    }

    *compressed_size = compression_encode_buffer(
        compressed, buffer_size,
        input, input_size,
        NULL,
        COMPRESSION_LZFSE
    );

    if (*compressed_size == 0) {
        fprintf(stderr, "Error: Compression failed\n");
        free(compressed);
        return NULL;
    }

    // Shrink buffer to actual size.
    unsigned char *final = realloc(compressed, *compressed_size);
    if (!final) {
        return compressed;
    }

    return final;
}

/**
 * Check if a file is a Mach-O binary.
 */
static int is_macho_binary(const char *path) {
    FILE *f = fopen(path, "rb");
    if (!f) {
        return 0;
    }

    uint32_t magic;
    size_t read = fread(&magic, 1, sizeof(magic), f);
    fclose(f);

    if (read != sizeof(magic)) {
        return 0;
    }

    return (magic == MH_MAGIC_64 || magic == MH_CIGAM_64 ||
            magic == MH_MAGIC || magic == MH_CIGAM ||
            magic == FAT_MAGIC || magic == FAT_CIGAM ||
            magic == FAT_MAGIC_64 || magic == FAT_CIGAM_64);
}

/**
 * Process macOS binary using segment-based compression.
 *
 * Supports two modes:
 * 1. Data-only: Compress input → compressed data file
 * 2. Update: Compress input + replace data in existing stub → updated stub
 */
static int process_macos_binary(const binpress_config *config) {
    printf("Processing macOS Mach-O binary...\n");
    printf("  Input: %s\n", config->input_path);

    // Get input size.
    long input_size = get_file_size(config->input_path);
    if (input_size < 0) {
        fprintf(stderr, "Error: Cannot get input file size\n");
        return -1;
    }

    printf("  Input size: %.2f MB (%ld bytes)\n", input_size / 1024.0 / 1024.0, input_size);

    // Read input.
    printf("\nReading input binary...\n");
    size_t data_size;
    unsigned char *input_data = read_file(config->input_path, &data_size);
    if (!input_data) {
        return -1;
    }

    // Compress.
    printf("Compressing with LZFSE...\n");
    size_t compressed_size;
    unsigned char *compressed_data = compress_data(input_data, data_size, &compressed_size);
    free(input_data);

    if (!compressed_data) {
        return -1;
    }

    printf("  Compressed size: %.2f MB (%zu bytes)\n",
           compressed_size / 1024.0 / 1024.0, compressed_size);
    printf("  Compression ratio: %.1f%%\n", 100.0 * compressed_size / data_size);

    // Mode 1: Data-only - write compressed data and exit.
    if (config->data_only) {
        const char *output = config->output_path ? config->output_path : "compressed.data";
        printf("\nWriting compressed data to %s...\n", output);
        int result = write_file(output, compressed_data, compressed_size);
        free(compressed_data);

        if (result != 0) {
            return -1;
        }

        printf("\n✓ Compressed data created!\n");
        printf("  Output: %s\n", output);
        return 0;
    }

    // Mode 2: Update node-compressed stub.
    const char *stub_source = config->update_stub_path;
    const char *output = config->output_path ? config->output_path : config->update_stub_path;

    printf("  Node-compressed stub: %s\n", stub_source);
    printf("  Output: %s\n", output);

    // Write compressed data to temporary file.
    char tmp_path[] = "/tmp/binpress-XXXXXX";
    int tmp_fd = mkstemp(tmp_path);
    if (tmp_fd == -1) {
        fprintf(stderr, "Error: Cannot create temporary file: %s\n", strerror(errno));
        free(compressed_data);
        return -1;
    }

    ssize_t written = write(tmp_fd, compressed_data, compressed_size);
    close(tmp_fd);

    if (written != (ssize_t)compressed_size) {
        fprintf(stderr, "Error: Failed to write compressed data to temp file\n");
        unlink(tmp_path);
        free(compressed_data);
        return -1;
    }

    free(compressed_data);

    // Call segment embedding to update node-compressed stub.
    printf("\nUpdating node-compressed stub...\n");
    int result = binpress_segment_embed(
        stub_source,
        tmp_path,
        output,
        data_size
    );

    unlink(tmp_path);

    if (result != 0) {
        return -1;
    }

    printf("\n✓ Node-compressed stub updated!\n");
    printf("  Output: %s\n", output);
    return 0;
}
#endif

int main(int argc, char *argv[]) {
    binpress_config config;

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

#ifdef __APPLE__
    // Process file - data-only mode works with any file, update mode requires Mach-O.
    if (config.data_only || is_macho_binary(config.input_path)) {
        return process_macos_binary(&config);
    }

    fprintf(stderr, "Error: Input must be a Mach-O binary for update mode\n");
    return 1;
#endif

    fprintf(stderr, "Error: Unsupported platform\n");
    return 1;
}
