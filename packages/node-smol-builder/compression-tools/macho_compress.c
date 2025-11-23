/**
 * macOS Mach-O Binary Compressor
 *
 * Compresses Mach-O binaries using Apple Compression framework.
 * Supports: LZFSE, LZMA, LZ4, ZLIB
 *
 * Usage:
 *   ./socketsecurity_macho_compress input output [--quality=lzfse|lzma|lz4|zlib]
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <compression.h>
#include <sys/stat.h>
#include <errno.h>

typedef struct {
    const char *input_path;
    const char *output_path;
    compression_algorithm algorithm;
    const char *algorithm_name;
} compress_config;

/**
 * Parse compression algorithm from quality string.
 */
static compression_algorithm parse_algorithm(const char *quality, const char **name) {
    if (quality == NULL || strcmp(quality, "lzfse") == 0) {
        *name = "LZFSE";
        return COMPRESSION_LZFSE;
    } else if (strcmp(quality, "lzma") == 0) {
        *name = "LZMA";
        return COMPRESSION_LZMA;
    } else if (strcmp(quality, "lz4") == 0) {
        *name = "LZ4";
        return COMPRESSION_LZ4;
    } else if (strcmp(quality, "zlib") == 0) {
        *name = "ZLIB";
        return COMPRESSION_ZLIB;
    } else {
        fprintf(stderr, "Warning: Unknown quality '%s', defaulting to LZFSE\n", quality);
        *name = "LZFSE";
        return COMPRESSION_LZFSE;
    }
}

/**
 * Parse command line arguments.
 */
static int parse_args(int argc, char *argv[], compress_config *config) {
    if (argc < 3) {
        fprintf(stderr, "Usage: %s <input> <output> [--quality=lzfse|lzma|lz4|zlib]\n", argv[0]);
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

/**
 * Compress data using Apple Compression framework.
 */
static unsigned char *compress_data(const unsigned char *input, size_t input_size,
                                    compression_algorithm algorithm,
                                    size_t *compressed_size) {
    // Allocate buffer for compressed data (worst case: original size + overhead)
    size_t buffer_size = input_size + 65536;
    unsigned char *compressed = malloc(buffer_size);
    if (!compressed) {
        fprintf(stderr, "Error: Cannot allocate %zu bytes for compressed data\n", buffer_size);
        return NULL;
    }

    // Compress
    *compressed_size = compression_encode_buffer(
        compressed, buffer_size,
        input, input_size,
        NULL,
        algorithm
    );

    if (*compressed_size == 0) {
        fprintf(stderr, "Error: Compression failed (returned 0 bytes)\n");
        free(compressed);
        return NULL;
    }

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

    printf("Socket Binary Compression (macOS Mach-O)\n");
    printf("=========================================\n");
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
