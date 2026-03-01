/**
 * debug_common.h - Shared debug logging utilities
 *
 * Based on npm's debug package - supports namespace filtering and wildcards.
 *
 * Usage:
 *   #include "socketsecurity/build-infra/debug_common.h"
 *
 *   int main() {
 *       DEBUG_INIT("smol:vfs");  // Specify namespace
 *       DEBUG_LOG("message %d\n", value);
 *       return 0;
 *   }
 *
 * Environment:
 *   DEBUG=smol:vfs          -> enables "smol:vfs" namespace
 *   DEBUG=smol:*            -> enables all "smol:" namespaces
 *   DEBUG=*                 -> enables all namespaces
 *   DEBUG=smol:vfs,binject  -> enables "smol:vfs" and "binject" namespaces
 *   DEBUG=*,-smol:vfs       -> enables all except "smol:vfs"
 *   DEBUG=1                 -> enables all
 *   DEBUG=0 or DEBUG=false  -> disables all
 *
 * Shared across: binject, binpress, binflate, node-smol-builder
 */

#ifndef DEBUG_COMMON_H
#define DEBUG_COMMON_H

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef __cplusplus
extern "C" {
#endif

// Global debug state - each compilation unit gets its own copy
static int _debug_enabled = 0;
static char _debug_namespace[256] = {0};

/**
 * Check if a pattern matches a namespace
 * Supports wildcards: "smol:*" matches "smol:vfs", "smol:binject", etc.
 */
static inline int _debug_matches_pattern(const char *pattern, const char *ns) {
    const char *star = strchr(pattern, '*');

    if (!star) {
        // Exact match
        return strcmp(pattern, ns) == 0;
    }

    // Wildcard match: compare prefix before '*'
    size_t prefix_len = star - pattern;
    return strncmp(pattern, ns, prefix_len) == 0;
}

/**
 * Check if namespace is enabled by DEBUG environment variable
 * Supports:
 * - Exact match: DEBUG=smol:vfs
 * - Wildcard: DEBUG=smol:* or DEBUG=*
 * - Multiple: DEBUG=smol:vfs,binject
 * - Negation: DEBUG=*,-smol:vfs (enable all except smol:vfs)
 */
static inline int _debug_is_enabled(const char *ns) {
    const char *debug_env = getenv("DEBUG");

    if (!debug_env || !debug_env[0]) {
        return 0;  // Not set or empty
    }

    // Treat "1", "true", "yes" as enable-all
    if (strcmp(debug_env, "1") == 0 ||
        strcmp(debug_env, "true") == 0 ||
        strcmp(debug_env, "TRUE") == 0 ||
        strcmp(debug_env, "yes") == 0 ||
        strcmp(debug_env, "YES") == 0) {
        return 1;
    }

    // Check for EXACT falsy values only
    if (strcmp(debug_env, "0") == 0 ||
        strcmp(debug_env, "false") == 0 ||
        strcmp(debug_env, "FALSE") == 0) {
        return 0;
    }

    /**
     * Parse comma-separated patterns
     * Uses thread-safe strtok_r (POSIX) / strtok_s (Windows)
     * WARNING: Not async-signal-safe - do not call from signal handlers
     */
    // Copy to temp buffer since strtok_r/strtok_s modifies the string
    char patterns[1024];
    snprintf(patterns, sizeof(patterns), "%s", debug_env);

    int enabled = 0;
    char *strtok_context = NULL;  // Context for thread-safe tokenization

#ifdef _WIN32
    char *pattern = strtok_s(patterns, ",", &strtok_context);
#else
    char *pattern = strtok_r(patterns, ",", &strtok_context);
#endif
    while (pattern) {
        // Trim leading spaces
        while (*pattern == ' ') pattern++;

        // Check for negation (-)
        if (pattern[0] == '-') {
            // Negation pattern: disable if it matches (last pattern wins)
            if (_debug_matches_pattern(pattern + 1, ns)) {
                enabled = 0;
            }
        } else {
            // Positive pattern: enable if it matches
            if (_debug_matches_pattern(pattern, ns)) {
                enabled = 1;
            }
        }

#ifdef _WIN32
        pattern = strtok_s(NULL, ",", &strtok_context);
#else
        pattern = strtok_r(NULL, ",", &strtok_context);
#endif
    }

    return enabled;
}

/**
 * Initialize debug mode for a specific namespace
 * Call once at program start
 */
#define DEBUG_INIT(ns) do { \
    snprintf(_debug_namespace, sizeof(_debug_namespace), "%s", ns); \
    _debug_enabled = _debug_is_enabled(ns); \
} while(0)

/**
 * Debug logging macro - writes to stderr with namespace prefix
 * Format: "[namespace] message"
 * Example: "[smol:vfs] Initialized with 42 entries"
 */
#define DEBUG_LOG(...) do { \
    if (_debug_enabled) { \
        fprintf(stderr, "[%s] ", _debug_namespace); \
        fprintf(stderr, __VA_ARGS__); \
        fflush(stderr); \
    } \
} while(0)

/**
 * Check if debug mode is currently enabled
 * Returns non-zero if enabled, 0 if disabled
 * Example: if (DEBUG_IS_ENABLED()) do_expensive_work();
 */
#define DEBUG_IS_ENABLED() (_debug_enabled)

#ifdef __cplusplus
}
#endif

#endif /* DEBUG_COMMON_H */
