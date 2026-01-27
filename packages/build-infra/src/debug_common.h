/**
 * debug_common.h - Shared debug logging utilities
 *
 * Enables debug output when DEBUG environment variable is set to a truthy value.
 * A truthy value is any non-empty string that doesn't start with '0' or 'f'/'F' (false).
 *
 * Usage:
 *   #include "debug_common.h"
 *
 *   int main() {
 *       DEBUG_INIT();  // Call once at program start
 *       DEBUG_LOG("message %d\n", value);
 *       return 0;
 *   }
 *
 * Environment:
 *   DEBUG=1        -> debug enabled
 *   DEBUG=true     -> debug enabled
 *   DEBUG=yes      -> debug enabled
 *   DEBUG=0        -> debug disabled
 *   DEBUG=false    -> debug disabled
 *   DEBUG=         -> debug disabled (empty)
 *   (unset)        -> debug disabled
 */

#ifndef DEBUG_COMMON_H
#define DEBUG_COMMON_H

#include <stdio.h>
#include <stdlib.h>

// Global debug flag - each compilation unit gets its own copy
static int _debug_enabled = 0;

/**
 * Check if DEBUG env var is set to a truthy value.
 * Truthy: non-empty and doesn't start with '0' or 'f'/'F'
 */
static inline int _debug_env_is_truthy(void) {
    const char *debug_env = getenv("DEBUG");
    if (!debug_env || !debug_env[0]) {
        return 0;  // Not set or empty
    }
    // Check for falsy values: "0", "false", "FALSE"
    if (debug_env[0] == '0' || debug_env[0] == 'f' || debug_env[0] == 'F') {
        return 0;
    }
    return 1;
}

// Initialize debug mode from DEBUG environment variable
#define DEBUG_INIT() do { \
    _debug_enabled = _debug_env_is_truthy(); \
} while(0)

// Debug logging macro - writes to stderr (matches socket-lib debug behavior)
#define DEBUG_LOG(...) do { \
    if (_debug_enabled) { \
        fprintf(stderr, "[DEBUG] " __VA_ARGS__); \
        fflush(stderr); \
    } \
} while(0)

#endif /* DEBUG_COMMON_H */
