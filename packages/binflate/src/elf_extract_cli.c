/**
 * Linux ELF Binary Extractor CLI
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
#include <unistd.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <errno.h>
#include <lzma.h>
#include <libgen.h>

#include "compression_constants.h"
#include "marker_finder.h"

/**
 * Print usage information
 */
static void print_usage(const char *program) {
    printf("binflate - Extract compressed binaries\n\n");
    printf("Usage:\n");
    printf("  %s <compressed_binary> [-o|--output <output_path>]\n", program);
    printf("  %s --help\n");
    printf("  %s --version\n\n", program);
    printf("Options:\n");
    printf("  -o, --output <path>  Output path (default: current directory)\n");
    printf("  -h, --help           Show this help message\n");
    printf("  -v, --version        Show version information\n\n");
    printf("Examples:\n");
    printf("  %s node-compressed              # Extracts to ./node\n", program);
    printf("  %s node-compressed -o /tmp/node # Extracts to /tmp/node\n", program);
}

/**
 * Find compressed data marker and return offset to size headers
 */
static long find_compressed_data_offset(int fd) {
    return find_marker(fd, MAGIC_MARKER_PART1, MAGIC_MARKER_PART2, MAGIC_MARKER_PART3, MAGIC_MARKER_LEN);
}

/**
 * Check if a binary is compressed (has magic marker)
 */
static int is_compressed_binary(const char *path) {
    int fd = open(path, O_RDONLY);
    if (fd == -1) {
        return 0;
    }

    long offset = find_compressed_data_offset(fd);
    close(fd);

    return (offset != -1) ? 1 : 0;
}

/**
 * Extract compressed binary to output path
 */
static int extract_binary(const char *input_path, const char *output_path) {
    int exit_code = 1;
    int source_fd = -1;
    int dest_fd = -1;
    unsigned char *compressed_data = NULL;
    unsigned char *decompressed_data = NULL;

    printf("Extracting compressed binary...\n");
    printf("  Input: %s\n", input_path);
    printf("  Output: %s\n", output_path);

    // Open input file
    source_fd = open(input_path, O_RDONLY);
    if (source_fd == -1) {
        fprintf(stderr, "Error: Failed to open input file: %s\n", strerror(errno));
        goto cleanup;
    }

    // Find compressed data offset
    long data_offset = find_compressed_data_offset(source_fd);
    if (data_offset == -1) {
        fprintf(stderr, "Error: Not a compressed binary (magic marker not found)\n");
        fprintf(stderr, "Hint: This tool only works with binaries compressed by binpress\n");
        goto cleanup;
    }

    // Seek to size headers
    if (lseek(source_fd, data_offset, SEEK_SET) == -1) {
        fprintf(stderr, "Error: Failed to seek to compressed data: %s\n", strerror(errno));
        goto cleanup;
    }

    // Read sizes
    uint64_t compressed_size, uncompressed_size;
    if (read(source_fd, &compressed_size, sizeof(compressed_size)) != sizeof(compressed_size)) {
        fprintf(stderr, "Error: Failed to read compressed size\n");
        goto cleanup;
    }
    if (read(source_fd, &uncompressed_size, sizeof(uncompressed_size)) != sizeof(uncompressed_size)) {
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
    ssize_t total_read = 0;
    while (total_read < (ssize_t)compressed_size) {
        ssize_t n = read(source_fd, compressed_data + total_read, compressed_size - total_read);
        if (n <= 0) {
            fprintf(stderr, "Error: Failed to read compressed data\n");
            goto cleanup;
        }
        total_read += n;
    }

    // Decompress using LZMA
    printf("  Decompressing...\n");
    lzma_stream strm = LZMA_STREAM_INIT;
    lzma_ret ret = lzma_alone_decoder(&strm, UINT64_MAX);
    if (ret != LZMA_OK) {
        fprintf(stderr, "Error: Failed to initialize LZMA decoder\n");
        goto cleanup;
    }

    strm.next_in = compressed_data;
    strm.avail_in = compressed_size;
    strm.next_out = decompressed_data;
    strm.avail_out = uncompressed_size;

    ret = lzma_code(&strm, LZMA_FINISH);
    lzma_end(&strm);

    if (ret != LZMA_STREAM_END || strm.total_out != uncompressed_size) {
        fprintf(stderr, "Error: Decompression failed (got %llu bytes, expected %llu)\n",
                (unsigned long long)strm.total_out, (unsigned long long)uncompressed_size);
        goto cleanup;
    }

    // Free compressed data (no longer needed)
    free(compressed_data);
    compressed_data = NULL;

    // Write to output file
    printf("  Writing to output...\n");
    dest_fd = open(output_path, O_WRONLY | O_CREAT | O_TRUNC, 0755);
    if (dest_fd == -1) {
        fprintf(stderr, "Error: Failed to create output file: %s\n", strerror(errno));
        goto cleanup;
    }

    ssize_t total_written = 0;
    while (total_written < (ssize_t)uncompressed_size) {
        ssize_t n = write(dest_fd, decompressed_data + total_written,
                         uncompressed_size - total_written);
        if (n <= 0) {
            fprintf(stderr, "Error: Failed to write output file: %s\n", strerror(errno));
            goto cleanup;
        }
        total_written += n;
    }

    printf("\n✓ Extraction successful!\n");
    printf("  Output: %s (%.2f MB)\n", output_path, uncompressed_size / 1024.0 / 1024.0);
    exit_code = 0;

cleanup:
    if (source_fd != -1) close(source_fd);
    if (dest_fd != -1) close(dest_fd);
    if (compressed_data) free(compressed_data);
    if (decompressed_data) free(decompressed_data);
    return exit_code;
}

/**
 * Get default output path (input basename without compression extension)
 */
static void get_default_output_path(const char *input_path, char *output_path, size_t size) {
    // Copy input path
    char *temp = strdup(input_path);
    if (!temp) {
        snprintf(output_path, size, "extracted_binary");
        return;
    }

    // Get basename
    char *base = basename(temp);

    // Remove common compressed suffixes if present
    size_t len = strlen(base);
    if (len > 4 && (strcmp(base + len - 4, ".bin") == 0 ||
                     strcmp(base + len - 4, ".out") == 0)) {
        base[len - 4] = '\0';
    } else if (len > 11 && strcmp(base + len - 11, "-compressed") == 0) {
        base[len - 11] = '\0';
    }

    snprintf(output_path, size, "%s", base);
    free(temp);
}

int main(int argc, char *argv[]) {
    const char *input_path = NULL;
    const char *output_path = NULL;
    char default_output[1024];

    // Parse arguments
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--version") == 0 || strcmp(argv[i], "-v") == 0) {
            printf("binflate %s\n", VERSION);
            return 0;
        } else if (strcmp(argv[i], "--help") == 0 || strcmp(argv[i], "-h") == 0) {
            print_usage(argv[0]);
            return 0;
        } else if (strcmp(argv[i], "-o") == 0 || strcmp(argv[i], "--output") == 0) {
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
    if (access(input_path, R_OK) != 0) {
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
    if (access(output_path, F_OK) == 0) {
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
