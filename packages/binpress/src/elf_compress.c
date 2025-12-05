/**
 * Linux ELF Binary Compressor
 *
 * Compresses ELF binaries using liblzma (LZMA compression).
 * Provides maximum compression for Linux binaries.
 *
 * Usage:
 *   ./socketsecurity_elf_compress input output [--quality=lzma]
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <lzma.h>
#include <sys/stat.h>
#include <errno.h>

typedef struct {
    const char *input_path;
    const char *output_path;
} compress_config;

/**
 * Parse command line arguments.
 */
static int parse_args(int argc, char *argv[], compress_config *config) {
    if (argc >= 2) {
        if (strcmp(argv[1], "--version") == 0 || strcmp(argv[1], "-v") == 0) {
            printf("binpress %s\n", VERSION);
            exit(0);
        }
        if (strcmp(argv[1], "--help") == 0 || strcmp(argv[1], "-h") == 0) {
            printf("Usage: %s <input> <output> [--quality=lzma]\n", argv[0]);
            printf("\nCompress ELF binaries using LZMA compression.\n");
            printf("\nArguments:\n");
            printf("  input   Path to input binary\n");
            printf("  output  Path to output compressed binary\n");
            printf("\nOptions:\n");
            printf("  --help, -h     Show this help message\n");
            printf("  --version, -v  Show version information\n");
            exit(0);
        }
    }

    if (argc < 3) {
        fprintf(stderr, "Usage: %s <input> <output> [--quality=lzma]\n", argv[0]);
        return -1;
    }

    config->input_path = argv[1];
    config->output_path = argv[2];

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

    // Parse arguments
    if (parse_args(argc, argv, &config) != 0) {
        return 1;
    }

    printf("Socket Binary Compression (Linux ELF)\n");
    printf("=====================================\n");
    printf("Input:      %s\n", config.input_path);
    printf("Output:     %s\n", config.output_path);
    printf("Algorithm:  LZMA (extreme)\n");
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
    printf("\nCompressing with LZMA...\n");
    size_t compressed_size;
    unsigned char *compressed_data = compress_data(input_data, input_size, &compressed_size);
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
