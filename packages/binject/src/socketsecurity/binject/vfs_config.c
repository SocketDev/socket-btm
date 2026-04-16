// ============================================================================
// vfs_config.c — SVFG config serialization implementation
// ============================================================================
//
// WHAT THIS FILE DOES
// Takes a vfs_config_t struct and packs it into a fixed 108-byte binary
// buffer in SVFG format: a 4-byte magic number, version, and two
// length-prefixed strings (mode and prefix).
//
// WHY IT EXISTS
// The VFS config must travel as raw bytes embedded in the executable.
// This serializer creates the exact byte layout the runtime reads back.
// ============================================================================

/**
 * VFS Config Serializer Implementation
 *
 * Converts vfs_config_t struct to 108-byte config data in SVFG format.
 */

#include "socketsecurity/binject/vfs_config.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/**
 * Write string to buffer with 2-byte length prefix.
 */
static void write_vfs_string_field(uint8_t *buffer, size_t *offset, const char *value, size_t max_len) {
    size_t len = value ? strlen(value) : 0;
    if (len > max_len) {
        fprintf(stderr, "Warning: VFS string truncated (len=%zu, max=%zu)\n", len, max_len);
        len = max_len;
    }

    // Write 2-byte length prefix (little-endian).
    buffer[*offset] = len & 0xFF;
    buffer[*offset + 1] = (len >> 8) & 0xFF;
    *offset += 2;

    // Write string data (pad with zeros).
    if (value && len > 0) {
        memcpy(buffer + *offset, value, len);
    }
    *offset += max_len;
}

/**
 * Initialize vfs_config_t with default values.
 */
void vfs_config_init(vfs_config_t *config) {
    if (!config) return;

    config->mode = "on-disk";
    config->prefix = "/snapshot";
}

/**
 * Serialize VFS config to SVFG format.
 */
uint8_t* serialize_vfs_config(const vfs_config_t *config) {
    // Validate input.
    if (!config) {
        fprintf(stderr, "Error: NULL VFS config parameter\n");
        return NULL;
    }

    // Use defaults for NULL string pointers.
    const char *mode = config->mode ? config->mode : "on-disk";
    const char *prefix = config->prefix ? config->prefix : "/snapshot";

    // Cache strlen results to avoid repeated scans.
    size_t mode_len = strlen(mode);
    size_t prefix_len = strlen(prefix);

    // Validate field lengths.
    if (mode_len > MAX_VFS_MODE_LEN) {
        fprintf(stderr, "Error: VFS mode exceeds max length (%d)\n", MAX_VFS_MODE_LEN);
        return NULL;
    }
    if (prefix_len > MAX_VFS_PREFIX_LEN) {
        fprintf(stderr, "Error: VFS prefix exceeds max length (%d)\n", MAX_VFS_PREFIX_LEN);
        return NULL;
    }

    // Validate prefix format.
    if (prefix_len > 0 && prefix[0] != '/') {
        fprintf(stderr, "Error: VFS prefix must start with '/' (got: %s)\n", prefix);
        return NULL;
    }

    // Allocate buffer.
    uint8_t *buffer = calloc(1, VFS_CFG_SIZE);
    if (!buffer) {
        fprintf(stderr, "Error: Cannot allocate memory for VFS config\n");
        return NULL;
    }

    size_t offset = 0;

    // Header (8 bytes).
    // Magic (4 bytes, little-endian).
    buffer[offset++] = VFS_CONFIG_MAGIC & 0xFF;
    buffer[offset++] = (VFS_CONFIG_MAGIC >> 8) & 0xFF;
    buffer[offset++] = (VFS_CONFIG_MAGIC >> 16) & 0xFF;
    buffer[offset++] = (VFS_CONFIG_MAGIC >> 24) & 0xFF;
    // Version (2 bytes, little-endian).
    buffer[offset++] = VFS_CONFIG_VERSION & 0xFF;
    buffer[offset++] = (VFS_CONFIG_VERSION >> 8) & 0xFF;
    // Padding (2 bytes).
    buffer[offset++] = 0;
    buffer[offset++] = 0;

    // Strings with 2-byte length prefixes (98 bytes total).
    write_vfs_string_field(buffer, &offset, mode, MAX_VFS_MODE_LEN);     // 2 + 32 = 34 bytes.
    write_vfs_string_field(buffer, &offset, prefix, MAX_VFS_PREFIX_LEN); // 2 + 64 = 66 bytes.

    // Verify total size.
    if (offset != VFS_CFG_SIZE) {
        fprintf(stderr, "Error: VFS config size mismatch (expected %d, got %zu)\n", VFS_CFG_SIZE, offset);
        free(buffer);
        return NULL;
    }

    printf("✓ VFS config serialized (%d bytes)\n", VFS_CFG_SIZE);
    return buffer;
}
