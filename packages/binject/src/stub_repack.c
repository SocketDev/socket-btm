/**
 * stub_repack.c - Compressed stub repacking implementation
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <sys/stat.h>
#include "stub_repack.h"

#if defined(__APPLE__) || defined(__linux__)
#include <unistd.h>
#include <sys/wait.h>
#endif

/* SHA-512 for cache key calculation */
#ifdef __APPLE__
#include <CommonCrypto/CommonDigest.h>
#define SHA512_DIGEST_LENGTH CC_SHA512_DIGEST_LENGTH
#define SHA512_CTX CC_SHA512_CTX
#define SHA512_Init CC_SHA512_Init
#define SHA512_Update CC_SHA512_Update
#define SHA512_Final CC_SHA512_Final
#else
/* On Linux, we'll use a simpler hash for now or add openssl dependency */
/* For now, just create a deterministic cache key from data */
#include <stdint.h>
#define SHA512_DIGEST_LENGTH 64
#endif

/**
 * Ad-hoc codesign a binary (macOS only).
 */
int binject_codesign(const char *binary_path) {
#ifdef __APPLE__
    /* Validate binary_path to prevent issues */
    if (!binary_path || strlen(binary_path) == 0) {
        fprintf(stderr, "Error: Binary path is empty\n");
        return -1;
    }

    /* Check for path traversal */
    if (strstr(binary_path, "..") != NULL) {
        fprintf(stderr, "Error: Path traversal detected in binary path\n");
        return -1;
    }

    /* Verify file exists and is a regular file */
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

    /* First check if already signed */
    pid_t pid = fork();
    if (pid == -1) {
        fprintf(stderr, "Error: Failed to fork for codesign verification\n");
        return -1;
    }

    if (pid == 0) {
        /* Child: check if signed */
        char *argv[] = {"codesign", "--verify", (char*)binary_path, NULL};
        execvp("codesign", argv);
        /* If execvp returns, it failed - use _exit to avoid buffer flushing */
        _exit(1);
    }

    int status;
    waitpid(pid, &status, 0);

    if (WIFEXITED(status) && WEXITSTATUS(status) == 0) {
        /* Already signed, skip */
        printf("  Binary already signed, skipping\n");
        return 0;
    }

    /* Sign with ad-hoc signature */
    pid = fork();
    if (pid == -1) {
        fprintf(stderr, "Error: Failed to fork for codesign\n");
        return -1;
    }

    if (pid == 0) {
        /* Child: sign binary */
        char *argv[] = {"codesign", "--sign", "-", "--force", (char*)binary_path, NULL};
        execvp("codesign", argv);
        /* If execvp returns, it failed - use _exit to avoid buffer flushing */
        _exit(1);
    }

    waitpid(pid, &status, 0);

    if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) {
        fprintf(stderr, "Error: codesign failed\n");
        return -1;
    }

    printf("  Binary signed successfully\n");
    return 0;
#else
    /* Non-macOS: no-op */
    return 0;
#endif
}

/**
 * Compress a binary using binpress.
 */
int binject_compress_binary(const char *input_path, const char *output_path, const char *quality) {
    printf("Compressing binary using binpress...\n");
    printf("  Input: %s\n", input_path);
    printf("  Output: %s\n", output_path);
    printf("  Quality: %s\n", quality);

#if defined(__APPLE__) || defined(__linux__)
    /* Find binpress in known locations */
    const char *binpress_paths[] = {
        "../binpress/out/binpress",  /* Relative to binject */
        "../../binpress/out/binpress",
        "../../../binpress/out/binpress",
        "/usr/local/bin/binpress",
        NULL
    };

    const char *binpress = NULL;
    for (int i = 0; binpress_paths[i]; i++) {
        struct stat st;
        if (stat(binpress_paths[i], &st) == 0) {
            binpress = binpress_paths[i];
            break;
        }
    }

    if (!binpress) {
        fprintf(stderr, "Error: binpress not found. Build it first:\n");
        fprintf(stderr, "  cd packages/binpress && make all\n");
        return -1;
    }

    printf("  Using binpress: %s\n", binpress);

    pid_t pid = fork();
    if (pid == -1) {
        fprintf(stderr, "Error: Failed to fork for binpress\n");
        return -1;
    }

    if (pid == 0) {
        /* Child: run binpress */
        char quality_arg[64];
        int written = snprintf(quality_arg, sizeof(quality_arg), "--quality=%s", quality);
        if (written < 0 || (size_t)written >= sizeof(quality_arg)) {
            fprintf(stderr, "Error: Quality argument too long\n");
            _exit(1);
        }
        char *argv[] = {(char*)binpress, (char*)input_path, (char*)output_path, quality_arg, NULL};
        execv(binpress, argv);
        /* If execv returns, it failed - use _exit to avoid buffer flushing */
        _exit(1);
    }

    int status;
    waitpid(pid, &status, 0);

    if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) {
        fprintf(stderr, "Error: binpress failed\n");
        return -1;
    }

    printf("  Compression complete\n");
    return 0;
#else
    fprintf(stderr, "Error: Binary compression not supported on this platform\n");
    return -1;
#endif
}

/**
 * Calculate cache key from compressed data.
 */
int binject_calculate_cache_key(const uint8_t *data, size_t size, char *cache_key) {
#ifdef __APPLE__
    /* Use SHA-512, take first 16 hex chars */
    unsigned char hash[SHA512_DIGEST_LENGTH];
    SHA512_CTX ctx;
    SHA512_Init(&ctx);
    SHA512_Update(&ctx, data, size);
    SHA512_Final(hash, &ctx);

    /* Convert first 8 bytes to 16 hex chars */
    for (int i = 0; i < 8; i++) {
        snprintf(cache_key + (i * 2), 3, "%02x", hash[i]);
    }
    cache_key[16] = '\0';

    return 0;
#else
    /* Simple deterministic hash for non-macOS platforms */
    /* Use FNV-1a hash algorithm */
    uint64_t hash = 14695981039346656037ULL;
    for (size_t i = 0; i < size; i++) {
        hash ^= data[i];
        hash *= 1099511628211ULL;
    }

    /* Convert to 16 hex chars */
    snprintf(cache_key, 17, "%016llx", (unsigned long long)hash);
    return 0;
#endif
}

/**
 * Repack compressed stub with new compressed data.
 */
int binject_repack_stub(const char *stub_path, const char *compressed_data_path, const char *output_path, size_t uncompressed_size) {
    printf("Repacking stub with new compressed data...\n");
    printf("  Stub: %s\n", stub_path);
    printf("  Compressed data: %s\n", compressed_data_path);
    printf("  Output: %s\n", output_path);
    printf("  Uncompressed size: %zu bytes\n", uncompressed_size);

    /* Open original stub */
    FILE *stub_fp = fopen(stub_path, "rb");
    if (!stub_fp) {
        fprintf(stderr, "Error: Cannot open stub: %s\n", stub_path);
        return -1;
    }

    /* Find magic marker in stub */
    const char *marker = "__SMOL_PRESSED_DATA_MAGIC_MARKER";
    size_t marker_len = strlen(marker);
    size_t search_size = 64 * 1024;
    uint8_t *stub_buffer = malloc(search_size);
    if (!stub_buffer) {
        fclose(stub_fp);
        fprintf(stderr, "Error: Out of memory\n");
        return -1;
    }

    size_t stub_read = fread(stub_buffer, 1, search_size, stub_fp);
    fclose(stub_fp);

    /* Validate stub is large enough to contain marker */
    if (stub_read < marker_len) {
        free(stub_buffer);
        fprintf(stderr, "Error: Stub too small to contain marker\n");
        return -1;
    }

    size_t marker_offset = 0;
    int found = 0;
    for (size_t i = 0; i <= stub_read - marker_len; i++) {
        if (memcmp(stub_buffer + i, marker, marker_len) == 0) {
            marker_offset = i;
            found = 1;
            break;
        }
    }

    if (!found) {
        free(stub_buffer);
        fprintf(stderr, "Error: Magic marker not found in stub\n");
        return -1;
    }

    printf("  Found marker at offset: %zu\n", marker_offset);

    /* Read compressed data */
    FILE *data_fp = fopen(compressed_data_path, "rb");
    if (!data_fp) {
        free(stub_buffer);
        fprintf(stderr, "Error: Cannot open compressed data: %s\n", compressed_data_path);
        return -1;
    }

    /* Seek to end and check for errors */
    if (fseek(data_fp, 0, SEEK_END) != 0) {
        free(stub_buffer);
        fclose(data_fp);
        fprintf(stderr, "Error: Cannot seek to end of compressed data file\n");
        return -1;
    }

    long file_size = ftell(data_fp);
    if (file_size < 0) {
        free(stub_buffer);
        fclose(data_fp);
        fprintf(stderr, "Error: Cannot determine compressed data file size\n");
        return -1;
    }
    size_t compressed_size = (size_t)file_size;

    /* Seek back to beginning and check for errors */
    if (fseek(data_fp, 0, SEEK_SET) != 0) {
        free(stub_buffer);
        fclose(data_fp);
        fprintf(stderr, "Error: Cannot seek to beginning of compressed data file\n");
        return -1;
    }

    uint8_t *compressed_data = malloc(compressed_size);
    if (!compressed_data) {
        free(stub_buffer);
        fclose(data_fp);
        fprintf(stderr, "Error: Out of memory\n");
        return -1;
    }

    if (fread(compressed_data, 1, compressed_size, data_fp) != compressed_size) {
        free(stub_buffer);
        free(compressed_data);
        fclose(data_fp);
        fprintf(stderr, "Error: Failed to read compressed data\n");
        return -1;
    }
    fclose(data_fp);

    /* Calculate cache key */
    char cache_key[17];
    if (binject_calculate_cache_key(compressed_data, compressed_size, cache_key) != 0) {
        free(stub_buffer);
        free(compressed_data);
        fprintf(stderr, "Error: Failed to calculate cache key\n");
        return -1;
    }

    printf("  Cache key: %s\n", cache_key);

    /* Get old compressed size from original stub header (for logging) */
    size_t header_offset = marker_offset + marker_len;

    /* Validate header_offset didn't overflow and has enough space for 8-byte size */
    if (header_offset < marker_offset || header_offset + 8 > stub_read) {
        free(stub_buffer);
        free(compressed_data);
        fprintf(stderr, "Error: Invalid header offset (overflow or out of bounds)\n");
        return -1;
    }

    uint64_t old_compressed_size;
    memcpy(&old_compressed_size, stub_buffer + header_offset, 8);

    printf("  Original compressed size: %llu\n", (unsigned long long)old_compressed_size);
    printf("  New compressed size: %zu\n", compressed_size);

    /* Create new stub: stub_code + marker + sizes + cache_key + compressed_data */
    FILE *out_fp = fopen(output_path, "wb");
    if (!out_fp) {
        free(stub_buffer);
        free(compressed_data);
        fprintf(stderr, "Error: Cannot create output file: %s\n", output_path);
        return -1;
    }

    /* Write stub code up to marker */
    if (fwrite(stub_buffer, 1, marker_offset, out_fp) != marker_offset) {
        free(stub_buffer);
        free(compressed_data);
        fclose(out_fp);
        fprintf(stderr, "Error: Failed to write stub code\n");
        return -1;
    }

    /* Write marker */
    if (fwrite(marker, 1, marker_len, out_fp) != marker_len) {
        free(stub_buffer);
        free(compressed_data);
        fclose(out_fp);
        fprintf(stderr, "Error: Failed to write marker\n");
        return -1;
    }

    /* Write new sizes */
    uint64_t new_compressed_size = compressed_size;
    if (fwrite(&new_compressed_size, 1, 8, out_fp) != 8) {
        free(stub_buffer);
        free(compressed_data);
        fclose(out_fp);
        fprintf(stderr, "Error: Failed to write compressed size\n");
        return -1;
    }

    if (fwrite(&uncompressed_size, 1, 8, out_fp) != 8) {
        free(stub_buffer);
        free(compressed_data);
        fclose(out_fp);
        fprintf(stderr, "Error: Failed to write uncompressed size\n");
        return -1;
    }

    /* Write new cache key */
    if (fwrite(cache_key, 1, 16, out_fp) != 16) {
        free(stub_buffer);
        free(compressed_data);
        fclose(out_fp);
        fprintf(stderr, "Error: Failed to write cache key\n");
        return -1;
    }

    /* Write new compressed data */
    if (fwrite(compressed_data, 1, compressed_size, out_fp) != compressed_size) {
        free(stub_buffer);
        free(compressed_data);
        fclose(out_fp);
        fprintf(stderr, "Error: Failed to write compressed data\n");
        return -1;
    }

    fclose(out_fp);
    free(stub_buffer);
    free(compressed_data);

    /* Set executable permissions */
#ifndef _WIN32
    chmod(output_path, 0755);
#endif

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
        fprintf(stderr, "⚠ Failed to sign modified binary (continuing anyway)\n");
        /* Non-fatal - continue */
    }

    /* Step 2: Re-compress the modified binary */
    printf("\nStep 2: Re-compressing modified binary...\n");
    char temp_compressed[1024];
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
        fprintf(stderr, "⚠ Failed to sign repacked stub (continuing anyway)\n");
        /* Non-fatal - user can sign manually */
    }

    printf("\n✓ Compressed stub repack workflow complete!\n");
    printf("  Output: %s\n", output_path);

    return 0;
}
