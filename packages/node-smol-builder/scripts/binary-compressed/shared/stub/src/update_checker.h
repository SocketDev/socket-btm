/**
 * Update Checker for Self-Extracting Stubs
 *
 * Checks GitHub releases for available updates using embedded libcurl.
 * Implements version comparison and release tag matching.
 *
 * Features:
 *   - HTTP GET requests via embedded libcurl with mbedTLS
 *   - GitHub releases API parsing
 *   - Semver-like version comparison
 *   - Glob pattern matching for release tags (e.g., "node-smol-*")
 *
 * Usage:
 *   update_checker_global_init();  // Call once at startup.
 *   update_check_result_t result;
 *   if (check_for_updates(&config, current_version, &result) == 0) {
 *       if (result.update_available) {
 *           printf("Update available: %s\n", result.latest_version);
 *       }
 *   }
 *   update_checker_global_cleanup();  // Call once at shutdown.
 */

#ifndef UPDATE_CHECKER_H
#define UPDATE_CHECKER_H

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>

#if defined(_WIN32)
#include <windows.h>
#define sleep_ms(ms) Sleep(ms)
#else
#include <unistd.h>
#define sleep_ms(ms) usleep((ms) * 1000)
#endif

#include "update_config.h"

/* Maximum response buffer size (256KB). */
#define UPDATE_CHECKER_MAX_RESPONSE_SIZE (256 * 1024)

/* Maximum version string length. */
#define UPDATE_CHECKER_MAX_VERSION_LEN 64

/* HTTP timeout in seconds. */
#define UPDATE_CHECKER_TIMEOUT_SECS 10

/* Retry configuration (matches socket-lib). */
#define UPDATE_CHECKER_RETRY_COUNT 2        /* Max retry attempts. */
#define UPDATE_CHECKER_RETRY_BASE_MS 5000   /* Initial delay (5 seconds). */
#define UPDATE_CHECKER_RETRY_BACKOFF 2      /* Exponential backoff factor. */

/**
 * Result of an update check.
 */
typedef struct {
    bool update_available;                              /* Whether an update is available. */
    char current_version[UPDATE_CHECKER_MAX_VERSION_LEN]; /* Current version string. */
    char latest_version[UPDATE_CHECKER_MAX_VERSION_LEN];  /* Latest version string. */
    char latest_tag[UPDATE_CHECKER_MAX_VERSION_LEN];      /* Full release tag name. */
} update_check_result_t;

/**
 * Compare two version strings (simplified semver comparison).
 * Returns: >0 if v1 > v2, <0 if v1 < v2, 0 if equal.
 *
 * Handles versions like:
 *   - "1.0.0", "2.1.3", "0.9.9"
 *   - "v1.0.0" (strips 'v' prefix)
 *   - Date-based versions like "2025-01-15"
 */
static int compare_versions(const char *v1, const char *v2) {
    if (!v1 || !v2) return 0;

    /* Skip 'v' prefix if present. */
    if (*v1 == 'v' || *v1 == 'V') v1++;
    if (*v2 == 'v' || *v2 == 'V') v2++;

    /* Parse as dot/dash-separated numeric components. */
    int c1[4] = {0, 0, 0, 0};
    int c2[4] = {0, 0, 0, 0};

    /* Try standard semver first. */
    int n1 = sscanf(v1, "%d.%d.%d.%d", &c1[0], &c1[1], &c1[2], &c1[3]);
    int n2 = sscanf(v2, "%d.%d.%d.%d", &c2[0], &c2[1], &c2[2], &c2[3]);

    /* If that fails, try date format (YYYY-MM-DD). */
    if (n1 < 2) {
        sscanf(v1, "%d-%d-%d", &c1[0], &c1[1], &c1[2]);
    }
    if (n2 < 2) {
        sscanf(v2, "%d-%d-%d", &c2[0], &c2[1], &c2[2]);
    }

    for (int i = 0; i < 4; i++) {
        if (c1[i] > c2[i]) return 1;
        if (c1[i] < c2[i]) return -1;
    }

    return 0;
}

/**
 * Simple glob pattern matching (picomatch-compatible subset).
 * Supports:
 *   - '*' matches zero or more characters
 *   - '?' matches exactly one character
 *   - Literal characters match themselves
 *
 * @param pattern Glob pattern to match against.
 * @param text Text to test.
 * @return true if text matches pattern, false otherwise.
 */
static bool glob_match(const char *pattern, const char *text) {
    if (!pattern || !text) return false;

    const char *p = pattern;
    const char *t = text;
    const char *star_p = NULL;
    const char *star_t = NULL;

    while (*t) {
        if (*p == '*') {
            /* Star: remember position and try to match zero characters. */
            star_p = p++;
            star_t = t;
        } else if (*p == '?' || *p == *t) {
            /* Match single character. */
            p++;
            t++;
        } else if (star_p) {
            /* Backtrack: try matching one more character with star. */
            p = star_p + 1;
            t = ++star_t;
        } else {
            /* No match. */
            return false;
        }
    }

    /* Skip trailing stars in pattern. */
    while (*p == '*') p++;

    return *p == '\0';
}

/**
 * Extract version from release tag using glob pattern.
 * If pattern contains '*', extracts the portion matched by the first '*'.
 * Otherwise returns the full tag.
 *
 * Examples:
 *   - pattern="node-smol-*", tag="node-smol-2025-01-15" -> "2025-01-15"
 *   - pattern="v*", tag="v1.0.0" -> "1.0.0"
 *   - pattern="" (empty), tag="1.0.0" -> "1.0.0"
 */
static void extract_version_from_tag(const char *tag, const char *pattern,
                                      char *version, size_t version_size) {
    if (!tag || !version || version_size == 0) return;

    /* If pattern is empty, return full tag as version. */
    if (!pattern || pattern[0] == '\0') {
        strncpy(version, tag, version_size - 1);
        version[version_size - 1] = '\0';
        return;
    }

    /* Find position of first '*' in pattern - that's where version starts. */
    const char *star = strchr(pattern, '*');
    if (star) {
        /* Calculate prefix length (part before the star). */
        size_t prefix_len = (size_t)(star - pattern);
        if (strncmp(tag, pattern, prefix_len) == 0) {
            tag += prefix_len;
        }
    }

    /* Copy remaining as version. */
    strncpy(version, tag, version_size - 1);
    version[version_size - 1] = '\0';
}

/**
 * Find a JSON string value by key in a JSON object.
 * Simple parser - assumes well-formed JSON.
 */
static const char* json_find_string(const char *json, const char *key,
                                     char *out, size_t out_size) {
    if (!json || !key || !out) return NULL;

    char search_key[128];
    snprintf(search_key, sizeof(search_key), "\"%s\"", key);

    const char *pos = strstr(json, search_key);
    if (!pos) return NULL;

    pos += strlen(search_key);

    /* Skip whitespace and colon. */
    while (*pos && (*pos == ' ' || *pos == '\t' || *pos == '\n' || *pos == '\r' || *pos == ':')) {
        pos++;
    }

    if (*pos != '"') return NULL;
    pos++;

    /* Extract string value. */
    size_t i = 0;
    while (*pos && *pos != '"' && i < out_size - 1) {
        if (*pos == '\\' && *(pos + 1)) {
            pos++;
        }
        out[i++] = *pos++;
    }
    out[i] = '\0';

    return pos;
}

/**
 * Compare two ISO 8601 timestamps (e.g., "2025-01-23T10:30:00Z").
 * Returns: >0 if t1 > t2, <0 if t1 < t2, 0 if equal.
 * Uses simple string comparison since ISO 8601 is lexicographically sortable.
 */
static int compare_timestamps(const char *t1, const char *t2) {
    if (!t1 || !t2) return 0;
    if (!t1[0]) return -1;
    if (!t2[0]) return 1;
    return strcmp(t1, t2);
}

/**
 * Parse GitHub releases response to find latest matching release.
 * Sorts by published_at to find the newest release (GitHub API order not guaranteed).
 * Returns 0 on success, -1 on error.
 */
static int parse_github_releases(const char *json, const char *pattern,
                                  char *latest_tag, size_t tag_size) {
    if (!json || !latest_tag) return -1;

    /* Find releases array (GitHub returns array of release objects). */
    const char *pos = json;

    /* Skip initial whitespace and array bracket. */
    while (*pos && (*pos == ' ' || *pos == '\t' || *pos == '\n' || *pos == '\r')) pos++;
    if (*pos != '[') return -1;
    pos++;

    /* Track best (newest) matching release. */
    char best_tag[UPDATE_CHECKER_MAX_VERSION_LEN] = {0};
    char best_published_at[32] = {0};

    /* Iterate through all releases to find newest matching one. */
    while (*pos) {
        /* Find start of object. */
        while (*pos && *pos != '{') pos++;
        if (!*pos) break;

        /* Find end of this object. */
        const char *obj_start = pos;
        int depth = 1;
        pos++;
        while (*pos && depth > 0) {
            if (*pos == '{') depth++;
            else if (*pos == '}') depth--;
            else if (*pos == '"') {
                /* Skip string content. */
                pos++;
                while (*pos && *pos != '"') {
                    if (*pos == '\\' && *(pos + 1)) pos++;
                    pos++;
                }
            }
            if (*pos) pos++;
        }

        /* Extract tag_name from this object. */
        char tag[UPDATE_CHECKER_MAX_VERSION_LEN];
        if (json_find_string(obj_start, "tag_name", tag, sizeof(tag))) {
            /* Check if tag matches pattern using glob matching. */
            if (!pattern || pattern[0] == '\0' || glob_match(pattern, tag)) {
                /* Skip releases with no assets (empty placeholder releases). */
                const char *assets_pos = strstr(obj_start, "\"assets\"");
                if (assets_pos && assets_pos < pos) {
                    /* Find the opening bracket of assets array. */
                    const char *arr_start = strchr(assets_pos, '[');
                    if (arr_start && arr_start < pos) {
                        /* Skip whitespace after '['. */
                        const char *check = arr_start + 1;
                        while (*check == ' ' || *check == '\t' || *check == '\n' || *check == '\r') {
                            check++;
                        }
                        /* If immediately followed by ']', assets array is empty. */
                        if (*check == ']') {
                            continue; /* Skip this release. */
                        }
                    }
                }

                /* Extract published_at timestamp. */
                char published_at[32] = {0};
                json_find_string(obj_start, "published_at", published_at, sizeof(published_at));

                /* Update best if this release is newer. */
                if (compare_timestamps(published_at, best_published_at) > 0) {
                    strncpy(best_tag, tag, sizeof(best_tag) - 1);
                    best_tag[sizeof(best_tag) - 1] = '\0';
                    strncpy(best_published_at, published_at, sizeof(best_published_at) - 1);
                    best_published_at[sizeof(best_published_at) - 1] = '\0';
                }
            }
        }
    }

    /* Return best match if found. */
    if (best_tag[0] != '\0') {
        strncpy(latest_tag, best_tag, tag_size - 1);
        latest_tag[tag_size - 1] = '\0';
        return 0;
    }

    return -1; /* No matching release found. */
}

/* Disable curl's strict type checking macros (causes issues with some compilers). */
#define CURL_DISABLE_TYPECHECK
#include <curl/curl.h>

/**
 * Write callback for libcurl - appends data to response buffer.
 */
typedef struct {
    char *buffer;
    size_t size;
    size_t capacity;
} curl_write_data_t;

static size_t update_write_callback(char *contents, size_t size, size_t nmemb, void *userp) {
    size_t realsize = size * nmemb;
    curl_write_data_t *data = (curl_write_data_t *)userp;

    if (data->size + realsize >= data->capacity) {
        return 0; /* Buffer full. */
    }

    memcpy(data->buffer + data->size, contents, realsize);
    data->size += realsize;
    data->buffer[data->size] = '\0';
    return realsize;
}

/**
 * Execute HTTP GET request using embedded libcurl.
 * Supports GitHub token authentication via GH_TOKEN or GITHUB_TOKEN env vars.
 * Returns 0 on success, -1 on error.
 */
static int execute_curl(const char *url, char *response, size_t response_size) {
    if (!url || !response || response_size == 0) return -1;

    /* Check for GitHub token (GH_TOKEN takes precedence). */
    const char *token = getenv("GH_TOKEN");
    if (!token || token[0] == '\0') {
        token = getenv("GITHUB_TOKEN");
    }

    /* Build full URL with query parameter. */
    char full_url[1024];
    int written = snprintf(full_url, sizeof(full_url), "%s?per_page=30", url);
    if (written < 0 || (size_t)written >= sizeof(full_url)) {
        return -1;
    }

    CURL *curl = curl_easy_init();
    if (!curl) {
        return -1;
    }

    /* Set up write callback. */
    curl_write_data_t write_data = { response, 0, response_size };

    /* Build headers. */
    struct curl_slist *headers = NULL;
    headers = curl_slist_append(headers, "Accept: application/vnd.github+json");
    headers = curl_slist_append(headers, "X-GitHub-Api-Version: 2022-11-28");
    headers = curl_slist_append(headers, "User-Agent: socket-stub-updater/1.0");

    if (token && token[0] != '\0') {
        char auth_header[512];
        snprintf(auth_header, sizeof(auth_header), "Authorization: Bearer %s", token);
        headers = curl_slist_append(headers, auth_header);
    }

    /* Configure curl. */
    curl_easy_setopt(curl, CURLOPT_URL, full_url);
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, update_write_callback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &write_data);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, (long)UPDATE_CHECKER_TIMEOUT_SECS);
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 1L);
    curl_easy_setopt(curl, CURLOPT_SSL_VERIFYHOST, 2L);

    /* Perform request. */
    CURLcode res = curl_easy_perform(curl);

    /* Check HTTP status code. */
    long http_code = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &http_code);

    /* Cleanup. */
    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);

    if (res != CURLE_OK || http_code != 200 || write_data.size == 0) {
        return -1;
    }

    return 0;
}

/**
 * Check for available updates using GitHub releases API.
 *
 * @param config Update configuration.
 * @param current_version Current installed version.
 * @param result Output result structure.
 * @return 0 on success, -1 on error.
 */
static int check_for_updates(const update_config_t *config,
                              const char *current_version,
                              update_check_result_t *result) {
    if (!config || !current_version || !result) return -1;

    /* Initialize result. */
    memset(result, 0, sizeof(*result));
    strncpy(result->current_version, current_version, UPDATE_CHECKER_MAX_VERSION_LEN - 1);

    /* Allocate response buffer. */
    char *response = malloc(UPDATE_CHECKER_MAX_RESPONSE_SIZE);
    if (!response) {
        return -1;
    }

    /* Execute curl request with retry logic (exponential backoff). */
    int ret = -1;
    int delay_ms = UPDATE_CHECKER_RETRY_BASE_MS;
    for (int attempt = 0; attempt <= UPDATE_CHECKER_RETRY_COUNT; attempt++) {
        if (attempt > 0) {
            /* Wait before retry with exponential backoff. */
            sleep_ms(delay_ms);
            delay_ms *= UPDATE_CHECKER_RETRY_BACKOFF;
        }
        ret = execute_curl(config->url, response, UPDATE_CHECKER_MAX_RESPONSE_SIZE);
        if (ret == 0) {
            break; /* Success. */
        }
    }
    if (ret != 0) {
        free(response);
        return -1;
    }

    /* Parse response to find latest matching release. */
    ret = parse_github_releases(response, config->tag,
                                result->latest_tag, sizeof(result->latest_tag));
    free(response);

    if (ret != 0) {
        return -1;
    }

    /* Extract version from tag. */
    extract_version_from_tag(result->latest_tag, config->tag,
                              result->latest_version, sizeof(result->latest_version));

    /* Compare versions. */
    result->update_available = (compare_versions(result->latest_version, current_version) > 0);

    return 0;
}

/**
 * Global initialization for update checker.
 * Must be called once at program startup.
 */
static void update_checker_global_init(void) {
    curl_global_init(CURL_GLOBAL_DEFAULT);
}

/**
 * Global cleanup for update checker.
 * Must be called once at program shutdown.
 */
static void update_checker_global_cleanup(void) {
    curl_global_cleanup();
}

#endif /* UPDATE_CHECKER_H */
