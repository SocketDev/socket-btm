/**
 * @file smol_segment.c
 * @brief Shared SMOL segment utilities implementation.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <limits.h>
#include "socketsecurity/bin-infra/smol_segment.h"
#include "socketsecurity/bin-infra/compression_constants.h"

#ifdef __APPLE__
#include <CommonCrypto/CommonDigest.h>
#include <unistd.h>
#include <sys/wait.h>
#elif defined(_WIN32)
#include <windows.h>
#include <bcrypt.h>
#else
#include <openssl/sha.h>
#endif

/* Compile-time check: This code requires little-endian architecture */
#if defined(__BYTE_ORDER__) && __BYTE_ORDER__ != __ORDER_LITTLE_ENDIAN__
#error "This code requires little-endian architecture. Big-endian platforms are not supported."
#endif

/**
 * Compute SHA-256 hash using platform-native crypto.
 */
int smol_compute_sha256(const uint8_t *data, size_t size, uint8_t *hash_out) {
    if (!data || !hash_out || size == 0) {
        return -1;
    }

#ifdef __APPLE__
    CC_SHA256(data, (CC_LONG)size, hash_out);
#elif defined(_WIN32)
    BCRYPT_ALG_HANDLE hAlg = NULL;
    BCRYPT_HASH_HANDLE hHash = NULL;
    int result = -1;

    if (BCryptOpenAlgorithmProvider(&hAlg, BCRYPT_SHA256_ALGORITHM, NULL, 0) != 0) {
        fprintf(stderr, "Error: BCryptOpenAlgorithmProvider failed\n");
        return -1;
    }

    if (BCryptCreateHash(hAlg, &hHash, NULL, 0, NULL, 0, 0) != 0) {
        fprintf(stderr, "Error: BCryptCreateHash failed\n");
        BCryptCloseAlgorithmProvider(hAlg, 0);
        return -1;
    }

    if (BCryptHashData(hHash, (PUCHAR)data, (ULONG)size, 0) == 0 &&
        BCryptFinishHash(hHash, hash_out, 32, 0) == 0) {
        result = 0;
    } else {
        fprintf(stderr, "Error: BCrypt SHA-256 hash computation failed\n");
    }

    BCryptDestroyHash(hHash);
    BCryptCloseAlgorithmProvider(hAlg, 0);
    return result;
#else
    SHA256(data, size, hash_out);
#endif

    return 0;
}

/**
 * Verify SHA-256 integrity hash of compressed data.
 */
int smol_verify_integrity(const uint8_t *data, size_t size, const uint8_t *expected_hash) {
    if (!data || !expected_hash || size == 0) {
        return -1;
    }

    uint8_t computed_hash[INTEGRITY_HASH_LEN];
    if (smol_compute_sha256(data, size, computed_hash) != 0) {
        return -1;
    }

    if (memcmp(computed_hash, expected_hash, INTEGRITY_HASH_LEN) != 0) {
        fprintf(stderr, "Error: Integrity verification failed — compressed data has been tampered with\n");
        fprintf(stderr, "  Expected: ");
        for (int i = 0; i < INTEGRITY_HASH_LEN; i++) {
            fprintf(stderr, "%02x", expected_hash[i]);
        }
        fprintf(stderr, "\n  Computed: ");
        for (int i = 0; i < INTEGRITY_HASH_LEN; i++) {
            fprintf(stderr, "%02x", computed_hash[i]);
        }
        fprintf(stderr, "\n");
        return -1;
    }

    return 0;
}

/**
 * Calculate cache key from integrity hash.
 * Uses first 8 bytes of SHA-256 hash as 16 hex chars.
 */
int smol_calculate_cache_key(const uint8_t *integrity_hash, size_t size, char *cache_key) {
    if (!integrity_hash || !cache_key || size == 0) {
        return -1;
    }

    /* Convert first 8 bytes of hash to 16 hex chars. */
    for (int i = 0; i < SMOL_CACHE_KEY_LEN / 2; i++) {
        int written = snprintf(cache_key + (i * 2), 3, "%02x", integrity_hash[i]);
        if (written < 0 || written >= 3) {
            fprintf(stderr, "Error: snprintf failed during cache key generation\n");
            return -1;
        }
    }
    cache_key[SMOL_CACHE_KEY_LEN] = '\0';

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
    const uint8_t *update_config_binary,
    smol_section_t *section
) {
    if (!compressed_data || !section || compressed_size == 0) {
        return -1;
    }

    /* Compute SHA-256 integrity hash of compressed data. */
    uint8_t integrity_hash[INTEGRITY_HASH_LEN];
    if (smol_compute_sha256(compressed_data, compressed_size, integrity_hash) != 0) {
        return -1;
    }

    /* Derive cache key from first 8 bytes of integrity hash. */
    if (smol_calculate_cache_key(integrity_hash, INTEGRITY_HASH_LEN, section->cache_key) != 0) {
        return -1;
    }

    /* Build marker at runtime from constants to avoid false positives. */
    char marker[MAGIC_MARKER_LEN + 1];
    snprintf(marker, sizeof(marker), "%s%s%s",
             MAGIC_MARKER_PART1, MAGIC_MARKER_PART2, MAGIC_MARKER_PART3);

    /* Calculate total section size: marker + metadata header + [smol_config] + data. */
    /* Check for integer overflow before calculation. */
    size_t smol_config_size = update_config_binary ? SMOL_CONFIG_BINARY_LEN : 0;
    if (compressed_size > SIZE_MAX - MAGIC_MARKER_LEN - METADATA_HEADER_LEN - smol_config_size) {
        fprintf(stderr, "Error: Compressed size too large (would overflow)\n");
        return -1;
    }
    section->size = MAGIC_MARKER_LEN + METADATA_HEADER_LEN + smol_config_size + compressed_size;

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

    /* Write integrity hash (32 bytes: SHA-256 of compressed data). */
    memcpy(section->data + offset, integrity_hash, INTEGRITY_HASH_LEN);
    offset += INTEGRITY_HASH_LEN;

    /* Write smol config flag and binary (if provided). */
    if (update_config_binary) {
        section->data[offset++] = 1;  /* has_smol_config = 1 */
        memcpy(section->data + offset, update_config_binary, SMOL_CONFIG_BINARY_LEN);
        offset += SMOL_CONFIG_BINARY_LEN;
    } else {
        section->data[offset++] = 0;  /* has_smol_config = 0 */
    }

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
 */
void smol_detect_platform_metadata(
    uint8_t *platform_byte,
    uint8_t *arch_byte,
    uint8_t *libc_byte
) {
    /* Default values. */
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

    /* Validate codesign is available before forking. */
    if (access("/usr/bin/codesign", X_OK) != 0) {
        fprintf(stderr, "Error: codesign not found at /usr/bin/codesign (required on macOS)\n");
        fprintf(stderr, "  errno: %d (%s)\n", errno, strerror(errno));
        fprintf(stderr, "  This may indicate:\n");
        fprintf(stderr, "    - Running on non-macOS system (unexpected)\n");
        fprintf(stderr, "    - Restricted environment without codesign access\n");
        fprintf(stderr, "    - Corrupted system installation\n");
        return -1;
    }

    pid_t pid = fork();
    if (pid == -1) {
        fprintf(stderr, "Error: Failed to fork for codesign\n");
        return -1;
    }

    if (pid == 0) {
        /* Child: sign binary with ad-hoc signature. */
        /* Use absolute path for reliability in sandboxed environments. */
        char *argv[] = {
            (char *)"/usr/bin/codesign",
            (char *)"--sign",
            (char *)"-",
            (char *)"--force",
            (char *)binary_path,
            NULL
        };
        execv("/usr/bin/codesign", argv);
        /* If execv returns, it failed - use exit code 127 to distinguish from codesign failure. */
        _exit(127);
    }

    int status;
    pid_t result;
    /* Retry waitpid on EINTR (interrupted by signal) */
    do {
        result = waitpid(pid, &status, 0);
    } while (result == -1 && errno == EINTR);

    if (result == -1) {
        fprintf(stderr, "Error: waitpid failed: %s\n", strerror(errno));
        return -1;
    }

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
        fprintf(stderr, "Error: Binary path is empty\n");
        return -1;
    }

    pid_t pid = fork();
    if (pid == -1) {
        fprintf(stderr, "Error: Failed to fork for codesign verify: %s\n", strerror(errno));
        return -1;
    }

    if (pid == 0) {
        /* Child: verify signature with absolute path for reliability. */
        char *argv[] = {
            (char *)"/usr/bin/codesign",
            (char *)"--verify",
            (char *)binary_path,
            NULL
        };
        execv("/usr/bin/codesign", argv);
        /* If execv returns, it failed - use exit code 127 to distinguish from codesign failure. */
        _exit(127);
    }

    int status;
    pid_t result;
    /* Retry waitpid on EINTR (interrupted by signal) */
    do {
        result = waitpid(pid, &status, 0);
    } while (result == -1 && errno == EINTR);

    if (result == -1) {
        fprintf(stderr, "Error: waitpid failed for codesign verify: %s\n", strerror(errno));
        return -1;
    }

    if (WIFEXITED(status) && WEXITSTATUS(status) == 0) {
        return 0;
    }
    return -1;
#else
    (void)binary_path;
    return 0;
#endif
}

/**
 * Sign a PE executable with Authenticode (Windows only, no-op on other platforms).
 *
 * Uses signtool from the Windows SDK. Signing is non-fatal because it requires
 * a valid certificate to be installed — the binary is still functional unsigned.
 */
int pe_codesign(const char *binary_path) {
#ifdef _WIN32
    if (!binary_path || strlen(binary_path) == 0) {
        fprintf(stderr, "Warning: PE signing skipped — binary path is empty\n");
        return 0;
    }

    /* Check for path traversal. */
    if (strstr(binary_path, "..") != NULL) {
        fprintf(stderr, "Warning: PE signing skipped — path traversal detected\n");
        return 0;
    }

    /* Reject paths with shell metacharacters to prevent injection via system(). */
    for (const char *p = binary_path; *p; p++) {
        if (*p == '`' || *p == '$' || *p == '|' || *p == '&' ||
            *p == ';' || *p == '\'' || *p == '"' || *p == '(' ||
            *p == ')' || *p == '<' || *p == '>' || *p == '\n') {
            fprintf(stderr, "Warning: PE signing skipped — path contains shell metacharacters\n");
            return 0;
        }
    }

    char cmd[PATH_MAX + 128];
    int written = snprintf(cmd, sizeof(cmd),
        "signtool sign /a /fd sha256 /tr http://timestamp.digicert.com /td sha256 \"%s\"",
        binary_path);
    if (written < 0 || (size_t)written >= sizeof(cmd)) {
        fprintf(stderr, "Warning: PE signing skipped — path too long\n");
        return 0;
    }

    int rc = system(cmd);
    if (rc != 0) {
        fprintf(stderr, "Warning: PE code signing failed (rc=%d). "
                "This is expected if no signing certificate is installed.\n", rc);
    }

    return 0;
#else
    (void)binary_path;
    return 0;
#endif
}
