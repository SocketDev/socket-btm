/**
 * @file smol_segment.h
 * @brief Shared SMOL segment utilities for binpress and binject.
 *
 * Provides common functions for:
 * - Building SMOL section data (marker + sizes + cache_key + compressed_data)
 * - Cache key calculation (SHA-512 on macOS, FNV-1a elsewhere)
 * - Ad-hoc code signing (macOS)
 */

#ifndef SMOL_SEGMENT_H
#define SMOL_SEGMENT_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Cache key length (16 hex characters). */
#define SMOL_CACHE_KEY_LEN 16

/* SMOL segment and section names. */
#define SMOL_SEGMENT_NAME "SMOL"
#define SMOL_SECTION_NAME "__PRESSED_DATA"

/**
 * SMOL section data structure.
 *
 * Layout:
 * - marker (32 bytes): Magic marker string
 * - compressed_size (8 bytes): uint64_t little-endian
 * - uncompressed_size (8 bytes): uint64_t little-endian
 * - cache_key (16 bytes): Hex string (not null-terminated in data)
 * - platform_metadata (3 bytes): platform, arch, libc
 * - has_update_config (1 byte): 0=no config, 1=has config
 * - update_config_binary (1112 bytes if has_update_config=1): Update config data
 * - data (variable): Compressed LZFSE data bytes
 *
 * Note: All platforms use LZFSE compression exclusively
 */
typedef struct {
    uint8_t *data;       /* Complete section data buffer. */
    size_t size;         /* Total size of section data. */
    char cache_key[17];  /* Null-terminated cache key (16 hex chars + null). */
} smol_section_t;

/**
 * Calculate cache key from data using SHA-512 (macOS) or FNV-1a (other).
 *
 * @param data Input data buffer.
 * @param size Size of input data.
 * @param cache_key Output buffer for cache key (must be at least 17 bytes).
 * @return 0 on success, -1 on error.
 */
int smol_calculate_cache_key(const uint8_t *data, size_t size, char *cache_key);

/**
 * Build SMOL section data from compressed data.
 *
 * Creates the complete section data buffer containing:
 * marker + compressed_size + uncompressed_size + cache_key + platform_metadata +
 * [update_config_flag + update_config_binary] + compressed_data
 *
 * @param compressed_data Compressed LZFSE data buffer.
 * @param compressed_size Size of compressed data.
 * @param uncompressed_size Original uncompressed size.
 * @param platform_byte Platform identifier (0=linux, 1=darwin, 2=win32).
 * @param arch_byte Architecture identifier (0=x64, 1=arm64).
 * @param libc_byte Libc identifier (0=glibc, 1=musl, 255=n/a for non-Linux).
 * @param update_config_binary Optional update config binary (1112 bytes) or NULL.
 * @param section Output structure (caller must free section->data).
 * @return 0 on success, -1 on error.
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
);

/**
 * Free SMOL section data.
 *
 * @param section Section structure to free.
 */
void smol_free_section(smol_section_t *section);

/**
 * Detect platform metadata at compile time.
 *
 * Detects platform, architecture, and libc based on compiler macros
 * (__APPLE__, __linux__, _WIN32, __arm64__, __aarch64__, etc.).
 *
 * Note: All platforms now use LZFSE compression exclusively.
 *
 * @param platform_byte Output: Platform identifier (0=linux, 1=darwin, 2=win32).
 * @param arch_byte Output: Architecture identifier (0=x64, 1=arm64).
 * @param libc_byte Output: Libc identifier (0=glibc, 1=musl, 255=n/a).
 */
void smol_detect_platform_metadata(
    uint8_t *platform_byte,
    uint8_t *arch_byte,
    uint8_t *libc_byte
);

/**
 * Ad-hoc code sign a binary (macOS only, no-op on other platforms).
 *
 * @param binary_path Path to binary to sign.
 * @return 0 on success, -1 on error.
 */
int smol_codesign(const char *binary_path);

/**
 * Verify code signature (macOS only, returns 0 on other platforms).
 *
 * @param binary_path Path to binary to verify.
 * @return 0 if valid or not macOS, -1 if invalid.
 */
int smol_codesign_verify(const char *binary_path);

#ifdef __cplusplus
}
#endif

#endif /* SMOL_SEGMENT_H */
