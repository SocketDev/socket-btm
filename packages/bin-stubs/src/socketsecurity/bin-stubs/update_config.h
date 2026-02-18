/**
 * Update Configuration for Self-Extracting Stubs
 *
 * Handles parsing and storage of update checking configuration.
 * Configuration can be passed via --update-config flag as JSON.
 *
 * Configuration options:
 *   - enabled: Whether update checking is enabled (default: true)
 *   - interval: How often to check for updates in ms (default: 86400000 = 24h)
 *   - notify_interval: How often to notify user in ms (default: 86400000 = 24h)
 *   - prompt: Whether to show interactive prompts (default: false)
 *   - prompt_default: Default answer for prompts: "y" or "n" (default: "n")
 *   - binname: Binary name for notification display (default: "")
 *   - command: Command/arguments displayed in notification (default: "self-update")
 *   - url: GitHub releases API URL pattern for version checking
 *   - tag: Release tag to match (supports glob patterns, e.g., "node-smol-*")
 *   - skip_env: Environment variable name to skip updates (default: "")
 *
 * Example JSON config:
 * {
 *   "enabled": true,
 *   "interval": 86400000,
 *   "notify_interval": 86400000,
 *   "prompt": false,
 *   "prompt_default": "n",
 *   "binname": "smol",
 *   "command": "self-update",
 *   "url": "https://api.github.com/repos/SocketDev/socket-btm/releases",
 *   "tag": "node-smol-*",
 *   "skip_env": "SMOL_SKIP_UPDATE_CHECK"
 * }
 */

#ifndef UPDATE_CONFIG_H
#define UPDATE_CONFIG_H

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>

/* Default values. */
#define UPDATE_CONFIG_DEFAULT_ENABLED true
#define UPDATE_CONFIG_DEFAULT_INTERVAL 86400000LL       /* 24 hours in ms. */
#define UPDATE_CONFIG_DEFAULT_NOTIFY_INTERVAL 86400000LL /* 24 hours in ms. */
#define UPDATE_CONFIG_DEFAULT_PROMPT false
#define UPDATE_CONFIG_DEFAULT_PROMPT_DEFAULT "n"
#define UPDATE_CONFIG_DEFAULT_BINNAME ""
#define UPDATE_CONFIG_DEFAULT_COMMAND "self-update"
#define UPDATE_CONFIG_DEFAULT_URL "https://api.github.com/repos/SocketDev/socket-btm/releases"
#define UPDATE_CONFIG_DEFAULT_TAG "node-smol-*"
#define UPDATE_CONFIG_DEFAULT_SKIP_ENV ""               /* Empty = no env var skip. */
#define UPDATE_CONFIG_DEFAULT_PATTERN "0.0.0"           /* Default version for update checks. */

/* Maximum string lengths. */
#define UPDATE_CONFIG_MAX_BINNAME_LEN 128
#define UPDATE_CONFIG_MAX_COMMAND_LEN 256
#define UPDATE_CONFIG_MAX_URL_LEN 512
#define UPDATE_CONFIG_MAX_TAG_LEN 128
#define UPDATE_CONFIG_MAX_SKIP_ENV_LEN 64
#define UPDATE_CONFIG_MAX_FAKE_ARGV_ENV_LEN 64

/**
 * Update configuration structure.
 */
typedef struct {
    bool enabled;                                        /* Whether update checking is enabled. */
    long long interval;                                  /* Check interval in milliseconds. */
    long long notify_interval;                           /* Notification interval in milliseconds. */
    bool prompt;                                         /* Whether to show interactive prompts. */
    char prompt_default;                                 /* Default prompt answer: 'y' or 'n'. */
    char binname[UPDATE_CONFIG_MAX_BINNAME_LEN];         /* Binary name for notification display. */
    char command[UPDATE_CONFIG_MAX_COMMAND_LEN];         /* Command/args for notification display. */
    char url[UPDATE_CONFIG_MAX_URL_LEN];                 /* GitHub releases API URL. */
    char tag[UPDATE_CONFIG_MAX_TAG_LEN];                 /* Release tag pattern for matching. */
    char skip_env[UPDATE_CONFIG_MAX_SKIP_ENV_LEN];       /* Env var name to skip updates. */
    char fake_argv_env[UPDATE_CONFIG_MAX_FAKE_ARGV_ENV_LEN]; /* Env var name for fake argv control. */
} update_config_t;

/**
 * Initialize update config with default values.
 */
static void update_config_init(update_config_t *config) {
    config->enabled = UPDATE_CONFIG_DEFAULT_ENABLED;
    config->interval = UPDATE_CONFIG_DEFAULT_INTERVAL;
    config->notify_interval = UPDATE_CONFIG_DEFAULT_NOTIFY_INTERVAL;
    config->prompt = UPDATE_CONFIG_DEFAULT_PROMPT;
    config->prompt_default = UPDATE_CONFIG_DEFAULT_PROMPT_DEFAULT[0];
    snprintf(config->binname, UPDATE_CONFIG_MAX_BINNAME_LEN, "%s", UPDATE_CONFIG_DEFAULT_BINNAME);
    snprintf(config->command, UPDATE_CONFIG_MAX_COMMAND_LEN, "%s", UPDATE_CONFIG_DEFAULT_COMMAND);
    snprintf(config->url, UPDATE_CONFIG_MAX_URL_LEN, "%s", UPDATE_CONFIG_DEFAULT_URL);
    snprintf(config->tag, UPDATE_CONFIG_MAX_TAG_LEN, "%s", UPDATE_CONFIG_DEFAULT_TAG);
    snprintf(config->skip_env, UPDATE_CONFIG_MAX_SKIP_ENV_LEN, "%s", UPDATE_CONFIG_DEFAULT_SKIP_ENV);
    snprintf(config->fake_argv_env, UPDATE_CONFIG_MAX_FAKE_ARGV_ENV_LEN, "SMOL_FAKE_ARGV");
}

/**
 * Skip whitespace in JSON string.
 */
static const char* json_skip_whitespace(const char *s) {
    while (*s && (*s == ' ' || *s == '\t' || *s == '\n' || *s == '\r')) {
        s++;
    }
    return s;
}

/**
 * Parse a JSON string value (assumes cursor is at opening quote).
 * Returns pointer to character after closing quote, or NULL on error.
 */
static const char* json_parse_string(const char *s, char *out, size_t out_size) {
    if (*s != '"') return NULL;
    s++;

    size_t i = 0;
    while (*s && *s != '"' && i < out_size - 1) {
        if (*s == '\\' && *(s + 1)) {
            s++;
            switch (*s) {
                case 'n': out[i++] = '\n'; break;
                case 't': out[i++] = '\t'; break;
                case 'r': out[i++] = '\r'; break;
                case '"': out[i++] = '"'; break;
                case '\\': out[i++] = '\\'; break;
                default: out[i++] = *s; break;
            }
        } else {
            out[i++] = *s;
        }
        s++;
    }
    out[i] = '\0';

    if (*s != '"') return NULL;
    return s + 1;
}

/**
 * Parse a JSON number value.
 * Returns pointer to character after number, or NULL on error.
 */
static const char* json_parse_number(const char *s, long long *out) {
    char *end;
    *out = strtoll(s, &end, 10);
    if (end == s) return NULL;
    return end;
}

/**
 * Parse a JSON boolean value.
 * Returns pointer to character after boolean, or NULL on error.
 */
static const char* json_parse_bool(const char *s, bool *out) {
    if (strncmp(s, "true", 4) == 0) {
        *out = true;
        return s + 4;
    }
    if (strncmp(s, "false", 5) == 0) {
        *out = false;
        return s + 5;
    }
    return NULL;
}

/**
 * Parse update config from JSON string.
 * Returns 0 on success, -1 on error.
 */
static int update_config_parse(update_config_t *config, const char *json) {
    if (!json || !config) return -1;

    /* Initialize with defaults. */
    update_config_init(config);

    const char *s = json_skip_whitespace(json);
    if (*s != '{') return -1;
    s++;

    while (*s) {
        s = json_skip_whitespace(s);
        if (*s == '}') break;
        if (*s == ',') { s++; continue; }

        /* Parse key. */
        char key[64];
        s = json_parse_string(s, key, sizeof(key));
        if (!s) return -1;

        s = json_skip_whitespace(s);
        if (*s != ':') return -1;
        s++;
        s = json_skip_whitespace(s);

        /* Parse value based on key. */
        if (strcmp(key, "enabled") == 0) {
            s = json_parse_bool(s, &config->enabled);
        } else if (strcmp(key, "interval") == 0) {
            s = json_parse_number(s, &config->interval);
        } else if (strcmp(key, "notify_interval") == 0) {
            s = json_parse_number(s, &config->notify_interval);
        } else if (strcmp(key, "prompt") == 0) {
            s = json_parse_bool(s, &config->prompt);
        } else if (strcmp(key, "prompt_default") == 0) {
            char val[8];
            s = json_parse_string(s, val, sizeof(val));
            if (s && (val[0] == 'y' || val[0] == 'Y')) {
                config->prompt_default = 'y';
            } else {
                config->prompt_default = 'n';
            }
        } else if (strcmp(key, "binname") == 0) {
            s = json_parse_string(s, config->binname, UPDATE_CONFIG_MAX_BINNAME_LEN);
        } else if (strcmp(key, "command") == 0) {
            s = json_parse_string(s, config->command, UPDATE_CONFIG_MAX_COMMAND_LEN);
        } else if (strcmp(key, "url") == 0) {
            s = json_parse_string(s, config->url, UPDATE_CONFIG_MAX_URL_LEN);
        } else if (strcmp(key, "tag") == 0) {
            s = json_parse_string(s, config->tag, UPDATE_CONFIG_MAX_TAG_LEN);
        } else if (strcmp(key, "skip_env") == 0) {
            s = json_parse_string(s, config->skip_env, UPDATE_CONFIG_MAX_SKIP_ENV_LEN);
        } else {
            /* Skip unknown key - find next comma or closing brace. */
            int depth = 0;
            bool in_string = false;
            while (*s) {
                if (!in_string) {
                    if (*s == '"') in_string = true;
                    else if (*s == '{' || *s == '[') depth++;
                    else if (*s == '}' || *s == ']') {
                        if (depth == 0) break;
                        depth--;
                    }
                    else if (*s == ',' && depth == 0) break;
                } else {
                    if (*s == '"' && *(s - 1) != '\\') in_string = false;
                }
                s++;
            }
        }

        if (!s) return -1;
    }

    return 0;
}

/**
 * Find --update-config argument in argv and parse it.
 * Returns 0 on success (config found and parsed or not found),
 * -1 on parse error.
 */
static int update_config_from_argv(update_config_t *config, int argc, char *argv[]) {
    update_config_init(config);

    for (int i = 1; i < argc; i++) {
        /* Check for --update-config=JSON format. */
        if (strncmp(argv[i], "--update-config=", 16) == 0) {
            return update_config_parse(config, argv[i] + 16);
        }
        /* Check for --update-config JSON format. */
        if (strcmp(argv[i], "--update-config") == 0 && i + 1 < argc) {
            return update_config_parse(config, argv[i + 1]);
        }
    }

    /* No config found, use defaults. */
    return 0;
}

/**
 * Check if a string is a falsy value ("0", "false", case-insensitive).
 */
static bool update_config_is_falsy(const char *value) {
    if (!value || value[0] == '\0') {
        return true;
    }
    if (strcmp(value, "0") == 0) {
        return true;
    }
    /* Case-insensitive check for "false". */
    if ((value[0] == 'f' || value[0] == 'F') &&
        (value[1] == 'a' || value[1] == 'A') &&
        (value[2] == 'l' || value[2] == 'L') &&
        (value[3] == 's' || value[3] == 'S') &&
        (value[4] == 'e' || value[4] == 'E') &&
        value[5] == '\0') {
        return true;
    }
    return false;
}

/**
 * Check if update checking should be skipped based on environment.
 * Uses the configurable skip_env from config if set.
 * Returns true if updates should be skipped.
 */
static bool update_config_should_skip(const update_config_t *config) {
    /* Skip if configured skip_env is set to a truthy value. */
    if (config && config->skip_env[0] != '\0') {
        const char *skip = getenv(config->skip_env);
        if (skip && !update_config_is_falsy(skip)) {
            return true;
        }
    }

    /* Skip if CI environment is detected. */
    if (getenv("CI") || getenv("CONTINUOUS_INTEGRATION")) {
        return true;
    }

    /* Skip if not a TTY (non-interactive). */
#if defined(_WIN32)
    /* On Windows, always allow for now. */
    return false;
#else
    if (!isatty(fileno(stderr))) {
        return true;
    }
#endif

    return false;
}

/**
 * Read string field from binary with length prefix.
 * Returns pointer to next field, or NULL on error.
 */
static const uint8_t* read_string_field(const uint8_t *data, char *out, size_t out_size, int use_16bit_length) {
    size_t len;

    if (use_16bit_length) {
        len = data[0] | (data[1] << 8);
        data += 2;
    } else {
        len = data[0];
        data += 1;
    }

    if (len >= out_size) {
        return NULL;
    }

    memcpy(out, data, len);
    out[len] = '\0';

    return data + (use_16bit_length ? (out_size - 2) : (out_size - 1));
}

/**
 * Deserialize SMFG binary format (1176 bytes) into update_config_t.
 * Returns 0 on success, -1 on error.
 *
 * Binary format:
 * - Magic (4 bytes): 0x534D4647 ("SMFG")
 * - Version (2 bytes): 1
 * - Flags (2 bytes): prompt, promptDefault
 * - Numeric values (16 bytes): interval, notifyInterval
 * - String fields (1152 bytes): binname, command, url, tag, skipEnv, fakeArgvEnv
 */
static int update_config_from_binary(update_config_t *config, const uint8_t *data, size_t size) {
    if (!config || !data || size != 1176) {
        return -1;
    }

    size_t offset = 0;

    /* Verify magic (4 bytes): 0x534D4647 ("SMFG"). */
    uint32_t magic = data[offset] | (data[offset+1] << 8) | (data[offset+2] << 16) | (data[offset+3] << 24);
    if (magic != 0x534D4647) {
        return -1;
    }
    offset += 4;

    /* Verify version (2 bytes): 1. */
    uint16_t version = data[offset] | (data[offset+1] << 8);
    if (version != 1) {
        return -1;
    }
    offset += 2;

    /* Read flags (2 bytes). */
    config->prompt = data[offset] != 0;
    offset++;
    config->prompt_default = (char)data[offset];
    offset++;

    /* Read numeric values (16 bytes). */
    config->interval = 0;
    for (int i = 0; i < 8; i++) {
        config->interval |= ((long long)data[offset + i]) << (i * 8);
    }
    offset += 8;

    config->notify_interval = 0;
    for (int i = 0; i < 8; i++) {
        config->notify_interval |= ((long long)data[offset + i]) << (i * 8);
    }
    offset += 8;

    /* Read string fields (1152 bytes). */
    const uint8_t *ptr = data + offset;

    ptr = read_string_field(ptr, config->binname, UPDATE_CONFIG_MAX_BINNAME_LEN, 0);
    if (!ptr) return -1;

    ptr = read_string_field(ptr, config->command, UPDATE_CONFIG_MAX_COMMAND_LEN, 1);
    if (!ptr) return -1;

    ptr = read_string_field(ptr, config->url, UPDATE_CONFIG_MAX_URL_LEN, 1);
    if (!ptr) return -1;

    ptr = read_string_field(ptr, config->tag, UPDATE_CONFIG_MAX_TAG_LEN, 0);
    if (!ptr) return -1;

    ptr = read_string_field(ptr, config->skip_env, UPDATE_CONFIG_MAX_SKIP_ENV_LEN, 0);
    if (!ptr) return -1;

    ptr = read_string_field(ptr, config->fake_argv_env, UPDATE_CONFIG_MAX_FAKE_ARGV_ENV_LEN, 0);
    if (!ptr) return -1;

    /* Update checking enabled if any config is present. */
    config->enabled = true;

    return 0;
}

#endif /* UPDATE_CONFIG_H */
