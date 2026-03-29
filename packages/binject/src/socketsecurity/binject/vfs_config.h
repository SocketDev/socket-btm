/**
 * VFS Config Serializer
 *
 * Serializes VFS config from sea-config.json to SVFG format.
 * SVFG format: 108-byte config data with magic "SVFG" (0x53564647).
 */

#ifndef VFS_CONFIG_H
#define VFS_CONFIG_H

#include <stdint.h>

// SVFG magic: 0x53564647 ("SVFG" - Smol VFS conFiG).
#define VFS_CONFIG_MAGIC 0x53564647
#define VFS_CONFIG_VERSION 1
#define VFS_CFG_SIZE 108  // Header (8) + mode (2+32) + prefix (2+64) = 108 bytes

// Field size limits.
#define MAX_VFS_MODE_LEN 32
#define MAX_VFS_PREFIX_LEN 64

/**
 * VFS configuration struct.
 *
 * Parsed from sea-config.json "smol.vfs" section.
 * All string fields must be null-terminated and within size limits.
 */
typedef struct {
    const char *mode;    // VFS mode: "on-disk", "in-memory", "compat" (max 32 chars)
    const char *prefix;  // VFS path prefix, e.g., "/snapshot" (max 64 chars)
} vfs_config_t;

/**
 * Initialize vfs_config_t with default values.
 *
 * @param config - Config struct to initialize (must not be NULL).
 */
void vfs_config_init(vfs_config_t *config);

/**
 * Serialize VFS config to SVFG format.
 *
 * Converts vfs_config_t struct to 108-byte config data.
 * SVFG format:
 *   Header (8 bytes): magic (4), version (2), padding (2)
 *   Strings (100 bytes): mode, prefix (each with 2-byte length prefix)
 *
 * @param config - VFS config struct (must not be NULL).
 * @return 108-byte config data, or NULL on error. Caller must free().
 */
uint8_t* serialize_vfs_config(const vfs_config_t *config);

#endif // VFS_CONFIG_H
