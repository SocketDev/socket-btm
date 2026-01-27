/**
 * stub_repack.h - Compressed stub repacking utilities
 *
 * Handles the complete workflow for injecting resources into compressed stubs:
 * 1. Inject into extracted binary
 * 2. Sign modified binary (macOS only)
 * 3. Re-compress using binpress
 * 4. Repack stub with new compressed data
 * 5. Sign repacked stub (macOS only)
 */

#ifndef STUB_REPACK_H
#define STUB_REPACK_H

#include <stddef.h>
#include <stdint.h>

/**
 * Ad-hoc codesign a binary (macOS only).
 * On non-macOS platforms, this is a no-op.
 *
 * @param binary_path Path to binary to sign
 * @return 0 on success, -1 on error
 */
int binject_codesign(const char *binary_path);

/**
 * Compress a binary using binpress.
 *
 * @param input_path Path to uncompressed binary
 * @param output_path Path to write compressed data
 * @param quality Compression quality ("lzfse" or "lzma")
 * @return 0 on success, -1 on error
 */
int binject_compress_binary(const char *input_path, const char *output_path, const char *quality);

/**
 * Calculate cache key from compressed data (SHA-512, first 16 hex chars).
 *
 * @param data Compressed data
 * @param size Size of compressed data
 * @param cache_key Output buffer for cache key (must be at least 17 bytes)
 * @return 0 on success, -1 on error
 */
int binject_calculate_cache_key(const uint8_t *data, size_t size, char *cache_key);

/**
 * Repack compressed stub with new compressed data.
 *
 * Replaces the compressed data portion of the stub while preserving the
 * stub executable code. Updates size headers and cache key.
 *
 * @param stub_path Path to original stub
 * @param compressed_data_path Path to new compressed data
 * @param output_path Path to write repacked stub
 * @param uncompressed_size Size of the uncompressed binary
 * @param update_config_binary Optional update config binary (1112 bytes) or NULL
 * @return 0 on success, -1 on error
 */
int binject_repack_stub(const char *stub_path, const char *compressed_data_path, const char *output_path, size_t uncompressed_size, const uint8_t *update_config_binary);

/**
 * Complete workflow: inject into compressed stub and repack.
 *
 * This is the high-level function that orchestrates the complete workflow:
 * 1. Extract/locate binary in cache
 * 2. Inject resource
 * 3. Sign modified binary
 * 4. Re-compress
 * 5. Repack stub
 * 6. Sign stub
 *
 * @param stub_path Path to compressed stub
 * @param extracted_path Path to extracted binary in cache
 * @param output_path Path to write final stub
 * @param update_config_binary Optional update config binary (1112 bytes) or NULL
 * @return 0 on success, -1 on error
 */
int binject_repack_workflow(const char *stub_path, const char *extracted_path, const char *output_path, const uint8_t *update_config_binary);

#endif /* STUB_REPACK_H */
