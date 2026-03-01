/**
 * Smol Config Serializer Implementation
 *
 * Converts smol_update_config_t struct to 1192-byte config data in SMFG format.
 * NO JSON parsing - caller provides pre-parsed struct.
 */

#include "socketsecurity/binject/smol_config.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>

/**
 * Normalize promptDefault field ('y'/'yes'/'n'/'no' -> 'y'/'n').
 */
static char normalize_prompt_default(char value) {
    char lower = tolower((unsigned char)value);
    return (lower == 'y') ? 'y' : 'n';
}

/**
 * Write string to buffer with length prefix.
 */
static void write_string_field(uint8_t *buffer, size_t *offset, const char *value, size_t max_len, int use_16bit_length) {
    size_t len = value ? strlen(value) : 0;
    if (len > max_len) {
        fprintf(stderr, "Warning: String truncated (len=%zu, max=%zu)\n", len, max_len);
        len = max_len;
    }

    // Write length prefix.
    if (use_16bit_length) {
        buffer[*offset] = len & 0xFF;
        buffer[*offset + 1] = (len >> 8) & 0xFF;
        *offset += 2;
    } else {
        buffer[*offset] = len & 0xFF;
        *offset += 1;
    }

    // Write string data (pad with zeros).
    if (value && len > 0) {
        memcpy(buffer + *offset, value, len);
    }
    *offset += max_len;
}

/**
 * Initialize smol_update_config_t with default values.
 */
void smol_config_init(smol_update_config_t *config) {
    if (!config) return;

    config->binname = "";
    config->command = "self-update";
    config->url = "";
    config->tag = "";
    config->skip_env = "";
    config->fake_argv_env = "SMOL_FAKE_ARGV";
    config->prompt = false;
    config->prompt_default = 'n';
    config->interval = 86400000;        // 24 hours in ms
    config->notify_interval = 86400000; // 24 hours in ms
    config->node_version = "";          // Empty by default (will be filled by build system)
}

/**
 * Serialize smol config to SMFG format.
 */
uint8_t* serialize_smol_config(const smol_update_config_t *config) {
    // Validate input.
    if (!config) {
        fprintf(stderr, "Error: NULL config parameter\n");
        return NULL;
    }

    // Use defaults for NULL string pointers.
    const char *binname = config->binname ? config->binname : "";
    const char *command = config->command ? config->command : "self-update";
    const char *url = config->url ? config->url : "";
    const char *tag = config->tag ? config->tag : "";
    const char *skip_env = config->skip_env ? config->skip_env : "";
    const char *fake_argv_env = config->fake_argv_env ? config->fake_argv_env : "SMOL_FAKE_ARGV";
    const char *node_version = config->node_version ? config->node_version : "";

    // Validate field lengths.
    if (strlen(binname) > MAX_BINNAME_LEN) {
        fprintf(stderr, "Error: binname exceeds max length (%d)\n", MAX_BINNAME_LEN);
        return NULL;
    }
    if (strlen(command) > MAX_COMMAND_LEN) {
        fprintf(stderr, "Error: command exceeds max length (%d)\n", MAX_COMMAND_LEN);
        return NULL;
    }
    if (strlen(url) > MAX_URL_LEN) {
        fprintf(stderr, "Error: url exceeds max length (%d)\n", MAX_URL_LEN);
        return NULL;
    }
    if (strlen(tag) > MAX_TAG_LEN) {
        fprintf(stderr, "Error: tag exceeds max length (%d)\n", MAX_TAG_LEN);
        return NULL;
    }
    if (strlen(skip_env) > MAX_SKIP_ENV_LEN) {
        fprintf(stderr, "Error: skipEnv exceeds max length (%d)\n", MAX_SKIP_ENV_LEN);
        return NULL;
    }
    if (strlen(fake_argv_env) > MAX_FAKE_ARGV_ENV_LEN) {
        fprintf(stderr, "Error: fakeArgvEnv exceeds max length (%d)\n", MAX_FAKE_ARGV_ENV_LEN);
        return NULL;
    }
    if (strlen(node_version) > MAX_NODE_VERSION_LEN) {
        fprintf(stderr, "Error: nodeVersion exceeds max length (%d)\n", MAX_NODE_VERSION_LEN);
        return NULL;
    }

    // Validate URL format if provided.
    if (strlen(url) > 0 && strncmp(url, "http://", 7) != 0 && strncmp(url, "https://", 8) != 0) {
        fprintf(stderr, "Error: URL must start with http:// or https://\n");
        return NULL;
    }

    // Allocate buffer.
    uint8_t *buffer = calloc(1, SMOL_CONFIG_SIZE);
    if (!buffer) {
        fprintf(stderr, "Error: Cannot allocate memory for smol config\n");
        return NULL;
    }

    size_t offset = 0;

    // Header (8 bytes).
    buffer[offset++] = SMOL_CONFIG_MAGIC & 0xFF;
    buffer[offset++] = (SMOL_CONFIG_MAGIC >> 8) & 0xFF;
    buffer[offset++] = (SMOL_CONFIG_MAGIC >> 16) & 0xFF;
    buffer[offset++] = (SMOL_CONFIG_MAGIC >> 24) & 0xFF;
    buffer[offset++] = SMOL_CONFIG_VERSION & 0xFF;
    buffer[offset++] = (SMOL_CONFIG_VERSION >> 8) & 0xFF;
    buffer[offset++] = config->prompt ? 1 : 0;
    buffer[offset++] = (uint8_t)normalize_prompt_default(config->prompt_default);

    // Numeric values (16 bytes).
    // interval (8 bytes, little-endian).
    for (int i = 0; i < 8; i++) {
        buffer[offset++] = (config->interval >> (i * 8)) & 0xFF;
    }
    // notifyInterval (8 bytes, little-endian).
    for (int i = 0; i < 8; i++) {
        buffer[offset++] = (config->notify_interval >> (i * 8)) & 0xFF;
    }

    // Strings with length prefixes (1168 bytes).
    write_string_field(buffer, &offset, binname, MAX_BINNAME_LEN, 0);         // 128 bytes (1 + 127).
    write_string_field(buffer, &offset, command, MAX_COMMAND_LEN, 1);         // 256 bytes (2 + 254).
    write_string_field(buffer, &offset, url, MAX_URL_LEN, 1);                 // 512 bytes (2 + 510).
    write_string_field(buffer, &offset, tag, MAX_TAG_LEN, 0);                 // 128 bytes (1 + 127).
    write_string_field(buffer, &offset, skip_env, MAX_SKIP_ENV_LEN, 0);       // 64 bytes (1 + 63).
    write_string_field(buffer, &offset, fake_argv_env, MAX_FAKE_ARGV_ENV_LEN, 0); // 64 bytes (1 + 63).
    write_string_field(buffer, &offset, node_version, MAX_NODE_VERSION_LEN, 0);   // 16 bytes (1 + 15).

    // Verify total size.
    if (offset != SMOL_CONFIG_SIZE) {
        fprintf(stderr, "Error: Smol config size mismatch (expected %d, got %zu)\n", SMOL_CONFIG_SIZE, offset);
        free(buffer);
        return NULL;
    }

    printf("✓ Smol config serialized (%d bytes)\n", SMOL_CONFIG_SIZE);
    return buffer;
}
