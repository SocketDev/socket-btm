/**
 * Update Metadata Reader/Writer for Self-Extracting Stubs
 *
 * Handles reading and updating .dlx-metadata.json for update checking.
 * Provides the bridge between the cache system and update notification.
 *
 * Features:
 *   - Read update_check timestamps from metadata
 *   - Check if update check interval has passed
 *   - Update metadata with new check/notification timestamps
 */

#ifndef UPDATE_METADATA_H
#define UPDATE_METADATA_H

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>
#include <time.h>

#include "update_config.h"

/* Maximum metadata file size (64KB). */
#define UPDATE_METADATA_MAX_SIZE (64 * 1024)

/**
 * Update metadata read from .dlx-metadata.json.
 */
typedef struct {
    long long last_check;           /* Timestamp of last update check (ms). */
    long long last_notification;    /* Timestamp of last user notification (ms). */
    char latest_known[64];          /* Latest known version string. */
} update_metadata_t;

/**
 * Get current timestamp in milliseconds.
 */
static long long update_get_current_time_ms(void) {
    time_t now = time(NULL);
    return (long long)now * 1000;
}

/**
 * Skip whitespace in JSON string.
 */
static const char* update_json_skip_ws(const char *s) {
    while (*s && (*s == ' ' || *s == '\t' || *s == '\n' || *s == '\r')) {
        s++;
    }
    return s;
}

/**
 * Find a JSON key and return pointer to its value.
 */
static const char* update_json_find_key(const char *json, const char *key) {
    char search[128];
    snprintf(search, sizeof(search), "\"%s\"", key);

    const char *pos = strstr(json, search);
    if (!pos) return NULL;

    pos += strlen(search);
    pos = update_json_skip_ws(pos);

    if (*pos != ':') return NULL;
    pos++;

    return update_json_skip_ws(pos);
}

/**
 * Parse a JSON number value.
 */
static long long update_json_parse_number(const char *s) {
    char *end;
    long long value = strtoll(s, &end, 10);
    return (end == s) ? 0 : value;
}

/**
 * Parse a JSON string value into buffer.
 */
static int update_json_parse_string(const char *s, char *out, size_t out_size) {
    if (*s != '"') return -1;
    s++;

    size_t i = 0;
    while (*s && *s != '"' && i < out_size - 1) {
        if (*s == '\\' && *(s + 1)) {
            s++;
        }
        out[i++] = *s++;
    }
    out[i] = '\0';

    return (*s == '"') ? 0 : -1;
}

/**
 * Read update metadata from .dlx-metadata.json file.
 * Returns 0 on success, -1 on error.
 */
static int update_read_metadata(const char *metadata_path, update_metadata_t *meta) {
    if (!metadata_path || !meta) return -1;

    /* Initialize with defaults. */
    memset(meta, 0, sizeof(*meta));

    FILE *f = fopen(metadata_path, "rb");
    if (!f) {
        fprintf(stderr, "Error: Cannot open metadata file: %s (errno: %d - %s)\n",
                metadata_path, errno, strerror(errno));
        return -1;
    }

    /* Read entire file. */
    char *content = malloc(UPDATE_METADATA_MAX_SIZE);
    if (!content) {
        fclose(f);
        return -1;
    }

    size_t len = fread(content, 1, UPDATE_METADATA_MAX_SIZE - 1, f);
    content[len] = '\0';
    fclose(f);

    /* Find update_check object. */
    const char *update_check = strstr(content, "\"update_check\"");
    if (!update_check) {
        free(content);
        return 0; /* No update_check section, use defaults. */
    }

    /* Find the object start. */
    const char *obj_start = strchr(update_check, '{');
    if (!obj_start) {
        free(content);
        return 0;
    }

    /* Parse last_check. */
    const char *val = update_json_find_key(obj_start, "last_check");
    if (val) {
        meta->last_check = update_json_parse_number(val);
    }

    /* Parse last_notification. */
    val = update_json_find_key(obj_start, "last_notification");
    if (val) {
        meta->last_notification = update_json_parse_number(val);
    }

    /* Parse latest_known. */
    val = update_json_find_key(obj_start, "latest_known");
    if (val) {
        update_json_parse_string(val, meta->latest_known, sizeof(meta->latest_known));
    }

    free(content);
    return 0;
}

/**
 * Update .dlx-metadata.json with new update_check values.
 * Reads existing file, updates values, rewrites file atomically.
 * Returns 0 on success, -1 on error.
 */
static int update_write_metadata(const char *metadata_path, const update_metadata_t *meta) {
    if (!metadata_path || !meta) return -1;

    /* Read existing file. */
    FILE *f = fopen(metadata_path, "rb");
    if (!f) {
        fprintf(stderr, "Error: Cannot open metadata file: %s (errno: %d - %s)\n",
                metadata_path, errno, strerror(errno));
        return -1;
    }

    char *content = malloc(UPDATE_METADATA_MAX_SIZE);
    if (!content) {
        fclose(f);
        return -1;
    }

    size_t len = fread(content, 1, UPDATE_METADATA_MAX_SIZE - 1, f);
    content[len] = '\0';
    fclose(f);

    /* Allocate buffer for new content. */
    char *new_content = malloc(UPDATE_METADATA_MAX_SIZE);
    if (!new_content) {
        free(content);
        return -1;
    }

    size_t new_len = 0;

    /* Find update_check object boundaries. */
    char *update_check = strstr(content, "\"update_check\"");
    if (!update_check) {
        /* No update_check section - need to add one before closing brace. */
        char *closing_brace = strrchr(content, '}');
        if (!closing_brace) {
            free(content);
            free(new_content);
            return -1;
        }

        /* Copy everything except the closing brace. */
        size_t prefix_len = (size_t)(closing_brace - content);
        memcpy(new_content, content, prefix_len);
        new_len = prefix_len;

        /* Check if we need a comma. */
        char *last_content = closing_brace - 1;
        while (last_content > content && (*last_content == ' ' || *last_content == '\t' ||
               *last_content == '\n' || *last_content == '\r')) {
            last_content--;
        }
        if (*last_content != ',' && *last_content != '{') {
            new_content[new_len++] = ',';
        }

        /* Append update_check section. */
        int n = snprintf(new_content + new_len, UPDATE_METADATA_MAX_SIZE - new_len,
                        "\n  \"update_check\": {\n"
                        "    \"last_check\": %lld,\n"
                        "    \"last_notification\": %lld,\n"
                        "    \"latest_known\": \"%s\"\n"
                        "  }\n}\n",
                        meta->last_check, meta->last_notification, meta->latest_known);
        if (n < 0 || (size_t)n >= UPDATE_METADATA_MAX_SIZE - new_len) {
            free(content);
            free(new_content);
            return -1;
        }
        new_len += n;
    } else {
        /* Find the update_check object. */
        char *obj_start = strchr(update_check, '{');
        if (!obj_start) {
            free(content);
            free(new_content);
            return -1;
        }

        /* Find matching closing brace. */
        char *obj_end = obj_start + 1;
        int depth = 1;
        while (*obj_end && depth > 0) {
            if (*obj_end == '{') depth++;
            else if (*obj_end == '}') depth--;
            else if (*obj_end == '"') {
                obj_end++;
                while (*obj_end && *obj_end != '"') {
                    if (*obj_end == '\\' && *(obj_end + 1)) obj_end++;
                    obj_end++;
                }
            }
            if (*obj_end) obj_end++;
        }

        /* Build new content: prefix + new update_check + suffix. */
        size_t prefix_len = (size_t)(obj_start - content);
        memcpy(new_content, content, prefix_len);
        new_len = prefix_len;

        /* Append new update_check object. */
        int n = snprintf(new_content + new_len, UPDATE_METADATA_MAX_SIZE - new_len,
                        "{\n"
                        "    \"last_check\": %lld,\n"
                        "    \"last_notification\": %lld,\n"
                        "    \"latest_known\": \"%s\"\n"
                        "  }",
                        meta->last_check, meta->last_notification, meta->latest_known);
        if (n < 0 || (size_t)n >= UPDATE_METADATA_MAX_SIZE - new_len) {
            free(content);
            free(new_content);
            return -1;
        }
        new_len += n;

        /* Append suffix (after update_check object). */
        size_t suffix_len = strlen(obj_end);
        if (new_len + suffix_len >= UPDATE_METADATA_MAX_SIZE) {
            free(content);
            free(new_content);
            return -1;
        }
        memcpy(new_content + new_len, obj_end, suffix_len);
        new_len += suffix_len;
    }

    /* Write atomically using cross-platform helper with detailed error logging. */
#if defined(__has_include)
#  if __has_include("socketsecurity/build-infra/file_utils.h")
    extern int write_file_atomically(const char *path, const unsigned char *data, size_t size, int mode);
    int result = write_file_atomically(metadata_path, (const unsigned char *)new_content, new_len, 0644);
#  else
    /* Fallback if file_utils.h not available - write directly with fsync. */
    f = fopen(metadata_path, "wb");
    int result = -1;
    if (f) {
        if (fwrite(new_content, 1, new_len, f) == new_len) {
            /* Sync to disk before close (use helper if available). */
#    if __has_include("socketsecurity/build-infra/file_io_common.h")
            extern int file_io_sync(FILE *fp);
            if (file_io_sync(f) == 0) {
                result = (fclose(f) == 0) ? 0 : -1;
            } else {
                fclose(f);
            }
#    else
            /* Double-fallback: inline fsync if no helpers available. */
#      ifndef _WIN32
            if (fsync(fileno(f)) == 0) {
                result = (fclose(f) == 0) ? 0 : -1;
            } else {
                fclose(f);
            }
#      else
            /* Windows: no fsync available in minimal environment. */
            result = (fclose(f) == 0) ? 0 : -1;
#      endif
#    endif
        } else {
            fclose(f);
        }
    }
#  endif
#else
    /* No __has_include - try forward declaration. */
    extern int write_file_atomically(const char *path, const unsigned char *data, size_t size, int mode);
    int result = write_file_atomically(metadata_path, (const unsigned char *)new_content, new_len, 0644);
#endif

    free(content);
    free(new_content);

    if (result == -1) {
        fprintf(stderr, "Error: Failed to write metadata file: %s\n", metadata_path);
        return -1;
    }

    return 0;
}

/**
 * Check if update check is needed based on interval.
 */
static bool update_should_check(const update_config_t *config, const update_metadata_t *meta) {
    if (!config || !meta) return false;
    if (!config->enabled) return false;

    long long now = update_get_current_time_ms();
    long long elapsed = now - meta->last_check;

    return elapsed >= config->interval;
}

/**
 * Check if notification is needed based on notify_interval.
 */
static bool update_should_notify(const update_config_t *config, const update_metadata_t *meta) {
    if (!config || !meta) return false;
    if (!config->enabled) return false;

    long long now = update_get_current_time_ms();
    long long elapsed = now - meta->last_notification;

    return elapsed >= config->notify_interval;
}

/**
 * Build metadata file path from cache directory and cache key.
 */
static int update_get_metadata_path(const char *base_dir, const char *cache_key,
                                     char *path, size_t path_size) {
    if (!base_dir || !cache_key || !path) return -1;

#if defined(_WIN32)
    int written = snprintf(path, path_size, "%s\\%s\\.dlx-metadata.json", base_dir, cache_key);
#else
    int written = snprintf(path, path_size, "%s/%s/.dlx-metadata.json", base_dir, cache_key);
#endif

    if (written < 0 || (size_t)written >= path_size) {
        return -1;
    }

    return 0;
}

#endif /* UPDATE_METADATA_H */
