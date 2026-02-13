/**
 * Smol Config Serializer
 *
 * Serializes smol config from sea-config.json to SMFG format.
 * SMFG format: 1176-byte config data with magic "SMFG" (0x534D4647).
 */

#ifndef SMOL_CONFIG_H
#define SMOL_CONFIG_H

#include <stdint.h>
#include <stdbool.h>

// SMFG magic: 0x534D4647 ("SMFG" - SMol conFiG).
#define SMOL_CONFIG_MAGIC 0x534D4647
#define SMOL_CONFIG_VERSION 1
#define SMOL_CONFIG_SIZE 1176

// Field size limits (must match update-config-binary.mjs).
#define MAX_BINNAME_LEN 127
#define MAX_COMMAND_LEN 254
#define MAX_URL_LEN 510
#define MAX_TAG_LEN 127
#define MAX_SKIP_ENV_LEN 63
#define MAX_FAKE_ARGV_ENV_LEN 63

/**
 * Smol update configuration struct.
 *
 * Parsed from sea-config.json "smol.update" section.
 * All string fields must be null-terminated and within size limits.
 */
typedef struct {
    // Update settings
    const char *binname;           // Binary name (max 127 chars)
    const char *command;           // Update command (max 254 chars, default "self-update")
    const char *url;               // Update URL (max 510 chars, must start with http:// or https://)
    const char *tag;               // Version tag pattern (max 127 chars)
    const char *skip_env;          // Environment variable to skip updates (max 63 chars)
    const char *fake_argv_env;     // Fake argv environment variable (max 63 chars, default "SMOL_FAKE_ARGV")

    // Prompt settings
    bool prompt;                   // Whether to prompt user before updating
    char prompt_default;           // Default response 'y' or 'n'

    // Intervals (milliseconds)
    int64_t interval;              // Check interval (default 86400000 = 24 hours)
    int64_t notify_interval;       // Notification interval (default 86400000 = 24 hours)
} smol_update_config_t;

/**
 * Initialize smol_update_config_t with default values.
 *
 * @param config - Config struct to initialize (must not be NULL).
 */
void smol_config_init(smol_update_config_t *config);

/**
 * Serialize smol config to SMFG format.
 *
 * Converts smol_update_config_t struct to 1176-byte config data.
 * SMFG format:
 *   Header (8 bytes): magic, version, flags
 *   Numeric (16 bytes): interval, notifyInterval
 *   Strings (1152 bytes): binname, command, url, tag, skipEnv, fakeArgvEnv
 *
 * @param config - Smol update config struct (must not be NULL).
 * @return 1176-byte config data, or NULL on error. Caller must free().
 */
uint8_t* serialize_smol_config(const smol_update_config_t *config);

#endif // SMOL_CONFIG_H
