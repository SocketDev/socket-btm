/**
 * stub_repack.c - Compressed stub repacking implementation.
 *
 * Uses built-in compression from compression_common.h instead of external tools.
 * Uses shared SMOL segment utilities from smol_segment.h.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <sys/stat.h>
#include "stub_repack.h"
#include "binject.h"
#include "buffer_constants.h"
#include "compression_common.h"
#include "smol_segment.h"
#include "smol_repack_lief.h"
#include "binary_format.h"
#include "file_utils.h"

#if defined(__APPLE__) || defined(__linux__)
#include <unistd.h>
#include <sys/wait.h>
#endif

/**
 * Ad-hoc codesign a binary (macOS only).
 * Wrapper around shared smol_codesign with additional validation.
 */
int binject_codesign(const char *binary_path) {
#ifdef __APPLE__
    /* Validate binary_path to prevent issues. */
    if (!binary_path || strlen(binary_path) == 0) {
        fprintf(stderr, "Error: Binary path is empty\n");
        return -1;
    }

    /* Verify file exists and is a regular file. */
    struct stat st;
    if (stat(binary_path, &st) != 0) {
        fprintf(stderr, "Error: Binary not found: %s\n", binary_path);
        return -1;
    }

    if (!S_ISREG(st.st_mode)) {
        fprintf(stderr, "Error: Binary path is not a regular file\n");
        return -1;
    }

    printf("Ad-hoc signing: %s\n", binary_path);

    /* Check if already signed. */
    if (smol_codesign_verify(binary_path) == 0) {
        printf("  Binary already signed, skipping\n");
        return 0;
    }

    /* Sign with ad-hoc signature using shared utility. */
    if (smol_codesign(binary_path) != 0) {
        fprintf(stderr, "Error: codesign failed\n");
        return -1;
    }

    printf("  Binary signed successfully\n");
    return 0;
#else
    /* Non-macOS: no-op. */
    (void)binary_path;
    return 0;
#endif
}

/**
 * Compress a binary file using built-in compression.
 * Uses platform-specific compression from compression_common.h.
 */
int binject_compress_binary(const char *input_path, const char *output_path, const char *quality) {
    printf("Compressing binary (built-in)...\n");
    printf("  Input: %s\n", input_path);
    printf("  Output: %s\n", output_path);
    printf("  Quality: %s\n", quality);
    (void)quality;  /* Quality parameter reserved for future use. */

#if defined(__APPLE__) || defined(__linux__) || defined(_WIN32)
    /* Read input file. */
    FILE *fp = fopen(input_path, "rb");
    if (!fp) {
        fprintf(stderr, "Error: Cannot open input file: %s\n", input_path);
        return -1;
    }

    fseek(fp, 0, SEEK_END);
    long file_size = ftell(fp);
    if (file_size <= 0) {
        fclose(fp);
        fprintf(stderr, "Error: Invalid input file size\n");
        return -1;
    }
    fseek(fp, 0, SEEK_SET);

    uint8_t *input_data = malloc((size_t)file_size);
    if (!input_data) {
        fclose(fp);
        fprintf(stderr, "Error: Out of memory allocating %ld bytes\n", file_size);
        return -1;
    }

    if (fread(input_data, 1, (size_t)file_size, fp) != (size_t)file_size) {
        free(input_data);
        fclose(fp);
        fprintf(stderr, "Error: Failed to read input file\n");
        return -1;
    }
    fclose(fp);

    printf("  Input size: %ld bytes\n", file_size);

    /* Compress using built-in compression. */
    uint8_t *compressed_data = NULL;
    size_t compressed_size = 0;

    int result = compress_buffer(input_data, (size_t)file_size, &compressed_data, &compressed_size);
    free(input_data);

    if (result != COMPRESS_OK) {
        fprintf(stderr, "Error: Compression failed (error %d)\n", result);
        return -1;
    }

    printf("  Compressed size: %zu bytes (%.1f%% ratio)\n",
           compressed_size, 100.0 * compressed_size / file_size);

    /* Create parent directories if needed. */
    if (create_parent_directories(output_path) != 0) {
        free(compressed_data);
        fprintf(stderr, "Error: Failed to create parent directories for output path: %s\n", output_path);
        return -1;
    }

    /* Write compressed data to output file. */
    fp = fopen(output_path, "wb");
    if (!fp) {
        free(compressed_data);
        fprintf(stderr, "Error: Cannot create output file: %s\n", output_path);
        return -1;
    }

    if (fwrite(compressed_data, 1, compressed_size, fp) != compressed_size) {
        free(compressed_data);
        fclose(fp);
        fprintf(stderr, "Error: Failed to write compressed data\n");
        return -1;
    }

    fclose(fp);
    free(compressed_data);

    printf("  Compression complete\n");
    return 0;
#else
    fprintf(stderr, "Error: Binary compression not supported on this platform\n");
    return -1;
#endif
}

/**
 * Calculate cache key from compressed data.
 * Wrapper around shared smol_calculate_cache_key.
 */
int binject_calculate_cache_key(const uint8_t *data, size_t size, char *cache_key) {
    return smol_calculate_cache_key(data, size, cache_key);
}

/**
 * Repack compressed stub with new compressed data using LIEF.
 * This properly updates the Mach-O structure when the SMOL segment content changes.
 * Uses shared smol_build_section_data for consistent section format.
 */
int binject_repack_stub(const char *stub_path, const char *compressed_data_path, const char *output_path, size_t uncompressed_size) {
    printf("Repacking stub with new compressed data...\n");
    printf("  Stub: %s\n", stub_path);
    printf("  Compressed data: %s\n", compressed_data_path);
    printf("  Output: %s\n", output_path);
    printf("  Uncompressed size: %zu bytes\n", uncompressed_size);

    /* Read compressed data file. */
    FILE *data_fp = fopen(compressed_data_path, "rb");
    if (!data_fp) {
        fprintf(stderr, "Error: Cannot open compressed data: %s\n", compressed_data_path);
        return -1;
    }

    if (fseek(data_fp, 0, SEEK_END) != 0) {
        fclose(data_fp);
        fprintf(stderr, "Error: Cannot seek to end of compressed data file\n");
        return -1;
    }

    long file_size = ftell(data_fp);
    if (file_size < 0) {
        fclose(data_fp);
        fprintf(stderr, "Error: Cannot determine compressed data file size\n");
        return -1;
    }
    size_t compressed_size = (size_t)file_size;

    if (fseek(data_fp, 0, SEEK_SET) != 0) {
        fclose(data_fp);
        fprintf(stderr, "Error: Cannot seek to beginning of compressed data file\n");
        return -1;
    }

    uint8_t *compressed_data = malloc(compressed_size);
    if (!compressed_data) {
        fclose(data_fp);
        fprintf(stderr, "Error: Out of memory\n");
        return -1;
    }

    if (fread(compressed_data, 1, compressed_size, data_fp) != compressed_size) {
        free(compressed_data);
        fclose(data_fp);
        fprintf(stderr, "Error: Failed to read compressed data\n");
        return -1;
    }
    fclose(data_fp);

    /* Detect platform metadata for repacked binary using shared helper. */
    uint8_t platform_byte;
    uint8_t arch_byte;
    uint8_t libc_byte;

    smol_detect_platform_metadata(&platform_byte, &arch_byte, &libc_byte);

    /* Build section data using shared utility. */
    smol_section_t section;
    if (smol_build_section_data(compressed_data, compressed_size, uncompressed_size,
                                 platform_byte, arch_byte, libc_byte, &section) != 0) {
        free(compressed_data);
        fprintf(stderr, "Error: Failed to build section data\n");
        return -1;
    }

    free(compressed_data);

    printf("  Cache key: %s\n", section.cache_key);
    printf("  Compressed size: %zu\n", compressed_size);

    /* Detect binary format and use appropriate LIEF repack function. */
    binject_format_t binject_format = binject_detect_format(stub_path);

    /* Convert binject format to binary format for switch statement */
    binary_format_t format;
    switch (binject_format) {
        case BINJECT_FORMAT_MACHO:
            format = BINARY_FORMAT_MACHO;
            break;
        case BINJECT_FORMAT_ELF:
            format = BINARY_FORMAT_ELF;
            break;
        case BINJECT_FORMAT_PE:
            format = BINARY_FORMAT_PE;
            break;
        default:
            format = BINARY_FORMAT_UNKNOWN;
            break;
    }

    int result = -1;

    switch (format) {
        case BINARY_FORMAT_MACHO:
            result = binject_macho_repack_smol(stub_path, section.data, section.size, output_path);
            break;

        case BINARY_FORMAT_ELF:
            result = smol_repack_lief_elf(stub_path, section.data, section.size, output_path);
            break;

        case BINARY_FORMAT_PE:
            result = smol_repack_lief_pe(stub_path, section.data, section.size, output_path);
            break;

        case BINARY_FORMAT_UNKNOWN:
        default:
            fprintf(stderr, "Error: Unsupported binary format for stub repacking\n");
            smol_free_section(&section);
            return -1;
    }

    smol_free_section(&section);

    if (result != 0) {
        fprintf(stderr, "Error: Failed to repack compressed stub\n");
        return -1;
    }

    printf("  Stub repacked successfully\n");
    return 0;
}

/**
 * Complete workflow: inject into compressed stub and repack.
 */
int binject_repack_workflow(const char *stub_path, const char *extracted_path, const char *output_path) {
    printf("\nStarting compressed stub repack workflow...\n");

    /* Step 1: Sign modified extracted binary (already injected) */
    printf("\nStep 1: Signing modified extracted binary...\n");
    if (binject_codesign(extracted_path) != 0) {
        fprintf(stderr, "Error: Failed to sign modified binary\n");
        return BINJECT_ERROR_WRITE_FAILED;
    }

    /* Step 2: Re-compress the modified binary */
    printf("\nStep 2: Re-compressing modified binary...\n");
    char temp_compressed[TEMP_PATH_BUFFER_SIZE];
    int written = snprintf(temp_compressed, sizeof(temp_compressed), "%s.compressed", extracted_path);
    if (written < 0 || (size_t)written >= sizeof(temp_compressed)) {
        fprintf(stderr, "Error: Temporary path too long\n");
        return -1;
    }

    const char *quality = "lzfse";  /* Use LZFSE for macOS (fast) */
    if (binject_compress_binary(extracted_path, temp_compressed, quality) != 0) {
        fprintf(stderr, "Error: Failed to compress modified binary\n");
        return -1;
    }

    /* Step 3: Repack stub with new compressed data */
    printf("\nStep 3: Repacking stub with new compressed data...\n");

    /* Get actual size of the modified extracted binary */
    struct stat st;
    if (stat(extracted_path, &st) != 0) {
        fprintf(stderr, "Error: Cannot stat extracted binary\n");
        remove(temp_compressed);
        return -1;
    }
    size_t uncompressed_size = st.st_size;

    if (binject_repack_stub(stub_path, temp_compressed, output_path, uncompressed_size) != 0) {
        fprintf(stderr, "Error: Failed to repack stub\n");
        remove(temp_compressed);
        return -1;
    }

    /* Clean up temporary compressed file */
    remove(temp_compressed);

    /* Step 4: Sign the repacked stub */
    printf("\nStep 4: Signing repacked stub...\n");
    if (binject_codesign(output_path) != 0) {
        fprintf(stderr, "Error: Failed to sign repacked stub\n");
        return BINJECT_ERROR_WRITE_FAILED;
    }

    printf("\n✓ Compressed stub repack workflow complete!\n");
    printf("  Output: %s\n", output_path);

    return 0;
}
