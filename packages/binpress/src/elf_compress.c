/**
 * Linux ELF Binary Compressor
 *
 * Compresses ELF binaries using liblzma (LZMA compression).
 * Updates node-compressed stubs by combining stub + compressed data.
 *
 * Usage:
 *   binpress <input> --data-only [-o <output>]    # Create compressed data only
 *   binpress <input> -u <stub> [-o <output>]      # Update node-compressed stub
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <lzma.h>
#include <sys/stat.h>
#include <errno.h>
#include <unistd.h>

#ifndef VERSION
#define VERSION "dev"
#endif

typedef struct {
    const char *input_path;
    const char *stub_path;
    const char *output_path;
    const char *update_stub_path;
    int data_only;
    int show_help;
    int show_version;
} compress_config;

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
static int parse_args(int argc, char *argv[], compress_config *config) {
    memset(config, 0, sizeof(compress_config));

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
static int validate_config(const compress_config *config) {
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
 * Read entire file into memory.
 */
static unsigned char *read_file(const char *path, size_t *size) {
    FILE *f = fopen(path, "rb");
    if (!f) {
        fprintf(stderr, "Error: Cannot open input file '%s': %s\n", path, strerror(errno));
        return NULL;
    }

    // Get file size
    fseek(f, 0, SEEK_END);
    *size = ftell(f);
    fseek(f, 0, SEEK_SET);

    // Allocate buffer
    unsigned char *data = malloc(*size);
    if (!data) {
        fprintf(stderr, "Error: Cannot allocate %zu bytes for input file\n", *size);
        fclose(f);
        return NULL;
    }

    // Read file
    size_t read_bytes = fread(data, 1, *size, f);
    fclose(f);

    if (read_bytes != *size) {
        fprintf(stderr, "Error: Read %zu bytes, expected %zu bytes\n", read_bytes, *size);
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

/**
 * Compress data using liblzma with extreme compression.
 */
static unsigned char *compress_data(const unsigned char *input, size_t input_size,
                                    size_t *compressed_size) {
    // Allocate buffer for compressed data
    size_t buffer_size = lzma_stream_buffer_bound(input_size);
    unsigned char *compressed = malloc(buffer_size);
    if (!compressed) {
        fprintf(stderr, "Error: Cannot allocate %zu bytes for compressed data\n", buffer_size);
        return NULL;
    }

    // Initialize LZMA stream
    lzma_stream strm = LZMA_STREAM_INIT;

    // Use extreme compression preset (9e = maximum compression)
    lzma_ret ret = lzma_easy_encoder(&strm, LZMA_PRESET_EXTREME, LZMA_CHECK_CRC64);
    if (ret != LZMA_OK) {
        fprintf(stderr, "Error: Failed to initialize LZMA encoder: %d\n", ret);
        free(compressed);
        return NULL;
    }

    // Setup input/output buffers
    strm.next_in = input;
    strm.avail_in = input_size;
    strm.next_out = compressed;
    strm.avail_out = buffer_size;

    // Compress
    ret = lzma_code(&strm, LZMA_FINISH);
    lzma_end(&strm);

    if (ret != LZMA_STREAM_END) {
        fprintf(stderr, "Error: LZMA compression failed: %d\n", ret);
        free(compressed);
        return NULL;
    }

    *compressed_size = strm.total_out;

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

    printf("Processing Linux ELF binary...\n");
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
    printf("\nCompressing with LZMA...\n");
    size_t compressed_size;
    unsigned char *compressed_data = compress_data(input_data, input_size, &compressed_size);
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

    // Make executable.
    chmod(output, 0755);

    printf("\n✓ Node-compressed stub updated!\n");
    printf("  Output: %s\n", output);
    printf("  Total size: %.2f MB\n", total_size / 1024.0 / 1024.0);
    printf("  Reduction: %.1f%%\n", 100.0 * (1.0 - (double)total_size / input_size));

    return 0;
}
