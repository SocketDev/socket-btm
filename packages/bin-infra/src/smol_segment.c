/**
 * @file smol_segment.c
 * @brief Shared SMOL segment utilities implementation.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "smol_segment.h"
#include "compression_constants.h"

#ifdef __APPLE__
#include <CommonCrypto/CommonDigest.h>
#include <unistd.h>
#include <sys/wait.h>
#endif

/**
 * Calculate cache key from data.
 * Uses SHA-512 on macOS (first 16 hex chars), FNV-1a elsewhere.
 */
int smol_calculate_cache_key(const uint8_t *data, size_t size, char *cache_key) {
    if (!data || !cache_key || size == 0) {
        return -1;
    }

#ifdef __APPLE__
    /* Use SHA-512, take first 16 hex chars. */
    unsigned char hash[CC_SHA512_DIGEST_LENGTH];
    CC_SHA512_CTX ctx;
    CC_SHA512_Init(&ctx);
    CC_SHA512_Update(&ctx, data, size);
    CC_SHA512_Final(hash, &ctx);

    /* Convert first 8 bytes to 16 hex chars. */
    for (int i = 0; i < SMOL_CACHE_KEY_LEN / 2; i++) {
        snprintf(cache_key + (i * 2), 3, "%02x", hash[i]);
    }
    cache_key[SMOL_CACHE_KEY_LEN] = '\0';
#else
    /* FNV-1a hash for non-macOS platforms. */
    uint64_t hash = 14695981039346656037ULL;
    for (size_t i = 0; i < size; i++) {
        hash ^= data[i];
        hash *= 1099511628211ULL;
    }
    snprintf(cache_key, 17, "%016llx", (unsigned long long)hash);
#endif

    return 0;
}

/**
 * Build SMOL section data from compressed data.
 */
int smol_build_section_data(
    const uint8_t *compressed_data,
    size_t compressed_size,
    size_t uncompressed_size,
    uint8_t platform_byte,
    uint8_t arch_byte,
    uint8_t libc_byte,
    smol_section_t *section
) {
    if (!compressed_data || !section || compressed_size == 0) {
        return -1;
    }

    /* Calculate cache key from compressed data. */
    if (smol_calculate_cache_key(compressed_data, compressed_size, section->cache_key) != 0) {
        return -1;
    }

    /* Build marker at runtime from constants to avoid false positives. */
    char marker[MAGIC_MARKER_LEN + 1];
    snprintf(marker, sizeof(marker), "%s%s%s",
             MAGIC_MARKER_PART1, MAGIC_MARKER_PART2, MAGIC_MARKER_PART3);

    /* Calculate total section size: marker + metadata header + data. */
    /* Check for integer overflow before calculation. */
    if (compressed_size > SIZE_MAX - MAGIC_MARKER_LEN - METADATA_HEADER_LEN) {
        fprintf(stderr, "Error: Compressed size too large (would overflow)\n");
        return -1;
    }
    section->size = MAGIC_MARKER_LEN + METADATA_HEADER_LEN + compressed_size;

    /* Allocate section data buffer. */
    section->data = (uint8_t *)malloc(section->size);
    if (!section->data) {
        fprintf(stderr, "Error: Failed to allocate section data (%zu bytes)\n", section->size);
        return -1;
    }

    size_t offset = 0;

    /* Write marker (32 bytes). */
    memcpy(section->data + offset, marker, MAGIC_MARKER_LEN);
    offset += MAGIC_MARKER_LEN;

    /*
     * Write compressed size (8 bytes, little-endian).
     *
     * NOTE: We use native endianness without explicit conversion because:
     * 1. All supported build systems are little-endian (Linux x86_64, macOS x86_64/arm64, Windows x64)
     * 2. Big-endian systems (SPARC, PowerPC) are not supported targets
     * 3. The reader (smol_segment_reader.c) also uses native endianness, so they match
     *
     * If big-endian support is needed in the future, use htole64()/le64toh() for conversion.
     */
    uint64_t compressed_size_le = compressed_size;
    memcpy(section->data + offset, &compressed_size_le, sizeof(uint64_t));
    offset += sizeof(uint64_t);

    /* Write uncompressed size (8 bytes, little-endian - see comment above). */
    uint64_t uncompressed_size_le = uncompressed_size;
    memcpy(section->data + offset, &uncompressed_size_le, sizeof(uint64_t));
    offset += sizeof(uint64_t);

    /* Write cache key (16 bytes, not null-terminated). */
    memcpy(section->data + offset, section->cache_key, SMOL_CACHE_KEY_LEN);
    offset += SMOL_CACHE_KEY_LEN;

    /* Write platform metadata (3 bytes: platform, arch, libc). */
    section->data[offset++] = platform_byte;
    section->data[offset++] = arch_byte;
    section->data[offset++] = libc_byte;

    /* Write compressed data. */
    memcpy(section->data + offset, compressed_data, compressed_size);

    return 0;
}

/**
 * Free SMOL section data.
 */
void smol_free_section(smol_section_t *section) {
    if (section && section->data) {
        free(section->data);
        section->data = NULL;
        section->size = 0;
    }
}

/**
 * Detect platform metadata at compile time.
 *
 * Uses compiler macros to determine platform, architecture, and libc.
 * Provides DRY implementation for all tools.
 *
 * Note: All platforms use LZFSE compression exclusively.
 */
void smol_detect_platform_metadata(
    uint8_t *platform_byte,
    uint8_t *arch_byte,
    uint8_t *libc_byte
) {
    /* Default values (Darwin arm64). */
    *platform_byte = PLATFORM_DARWIN;
    *arch_byte = ARCH_X64;
    *libc_byte = LIBC_NA;

    /* Detect platform. */
#ifdef __APPLE__
    *platform_byte = PLATFORM_DARWIN;
    *libc_byte = LIBC_NA;
#elif defined(__linux__)
    *platform_byte = PLATFORM_LINUX;

    /* Detect libc at compile time. */
#if defined(__GLIBC__)
    *libc_byte = LIBC_GLIBC;
#elif defined(__MUSL__)
    *libc_byte = LIBC_MUSL;
#else
    *libc_byte = LIBC_GLIBC;  /* Default to glibc. */
#endif

#elif defined(_WIN32)
    *platform_byte = PLATFORM_WIN32;
    *libc_byte = LIBC_NA;
#endif

    /* Detect architecture. */
#if defined(__arm64__) || defined(__aarch64__) || defined(_M_ARM64)
    *arch_byte = ARCH_ARM64;
#else
    *arch_byte = ARCH_X64;
#endif
}

/**
 * Ad-hoc code sign a binary (macOS only).
 */
int smol_codesign(const char *binary_path) {
#ifdef __APPLE__
    if (!binary_path || strlen(binary_path) == 0) {
        fprintf(stderr, "Error: Binary path is empty\n");
        return -1;
    }

    /* Check for path traversal. */
    if (strstr(binary_path, "..") != NULL) {
        fprintf(stderr, "Error: Path traversal detected in binary path\n");
        return -1;
    }

    pid_t pid = fork();
    if (pid == -1) {
        fprintf(stderr, "Error: Failed to fork for codesign\n");
        return -1;
    }

    if (pid == 0) {
        /* Child: sign binary with ad-hoc signature. */
        char *argv[] = {
            (char *)"codesign",
            (char *)"--sign",
            (char *)"-",
            (char *)"--force",
            (char *)binary_path,
            NULL
        };
        execvp("codesign", argv);
        /* If execvp returns, it failed. */
        _exit(1);
    }

    int status;
    waitpid(pid, &status, 0);

    if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) {
        fprintf(stderr, "Error: codesign failed\n");
        return -1;
    }

    return 0;
#else
    /* Non-macOS: no-op. */
    (void)binary_path;
    return 0;
#endif
}

/**
 * Verify code signature (macOS only).
 */
int smol_codesign_verify(const char *binary_path) {
#ifdef __APPLE__
    if (!binary_path || strlen(binary_path) == 0) {
        return -1;
    }

    pid_t pid = fork();
    if (pid == -1) {
        return -1;
    }

    if (pid == 0) {
        /* Child: verify signature. */
        char *argv[] = {
            (char *)"codesign",
            (char *)"--verify",
            (char *)binary_path,
            NULL
        };
        execvp("codesign", argv);
        _exit(1);
    }

    int status;
    waitpid(pid, &status, 0);

    if (WIFEXITED(status) && WEXITSTATUS(status) == 0) {
        return 0;
    }
    return -1;
#else
    (void)binary_path;
    return 0;
#endif
}
