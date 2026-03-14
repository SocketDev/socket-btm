/**
 * Cross-platform test helpers
 */

#ifndef TEST_HELPERS_H
#define TEST_HELPERS_H

#include <stdio.h>
#include <string.h>

#ifdef _WIN32
#include <windows.h>
#include "socketsecurity/build-infra/posix_compat.h"
#else
#include <unistd.h>
#endif

/* Get platform-appropriate temp directory */
static inline const char* get_temp_dir(void) {
#ifdef _WIN32
    static char temp_dir[MAX_PATH];
    static int initialized = 0;

    if (!initialized) {
        DWORD len = GetTempPathA(MAX_PATH, temp_dir);
        if (len > 0 && len < MAX_PATH) {
            /* Ensure trailing backslash */
            if (temp_dir[len-1] != '\\') {
                temp_dir[len] = '\\';
                temp_dir[len+1] = '\0';
            }
        } else {
            /* Use safe string copy with explicit size */
            const char *default_temp = "C:\\Windows\\Temp\\";
            size_t temp_len = strlen(default_temp);
            if (temp_len < MAX_PATH) {
                memcpy(temp_dir, default_temp, temp_len + 1);
            } else {
                /* Fallback - should never happen with this constant */
                temp_dir[0] = '\0';
            }
        }
        initialized = 1;
    }
    return temp_dir;
#else
    const char *tmp = getenv("TMPDIR");
    if (tmp && tmp[0] != '\0') return tmp;
    tmp = getenv("TMP");
    if (tmp && tmp[0] != '\0') return tmp;
    tmp = getenv("TEMP");
    if (tmp && tmp[0] != '\0') return tmp;
    return "/tmp/";
#endif
}

/* Build full temp path */
static inline void build_temp_path(char *buffer, size_t size, const char *filename) {
    snprintf(buffer, size, "%s%s", get_temp_dir(), filename);
}

#endif /* TEST_HELPERS_H */
