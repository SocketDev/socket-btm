/**
 * @file tmpdir_common.h
 * @brief Node.js-compatible temporary directory selection for Unix/macOS
 *
 * This header provides utilities to select temporary directories matching
 * Node.js os.tmpdir() behavior. Used by decompressor binaries for temp file creation.
 *
 * Reference: https://github.com/nodejs/node/blob/v24.12.0/src/node_os.cc#L239-L260
 */

#ifndef TMPDIR_COMMON_H
#define TMPDIR_COMMON_H

#include <stdlib.h>
#include <string.h>

/**
 * Get temporary directory path following Node.js os.tmpdir() behavior.
 *
 * Priority order (Node.js v24.12.0 compatible):
 *   1. TMPDIR environment variable
 *   2. TMP environment variable
 *   3. TEMP environment variable
 *   4. System-specific fallback (provided by caller)
 *
 * @param fallback Default fallback directory if no env vars are set (e.g., "/tmp", "/dev/shm")
 * @return Pointer to tmpdir string (either from env var or fallback). Never returns NULL.
 *
 * Example usage:
 *   const char *tmpdir = get_tmpdir_nodejs("/tmp");
 *   snprintf(path, size, "%s/myfile-XXXXXX", tmpdir);
 */
static inline const char* get_tmpdir_nodejs(const char *fallback) {
    // Try environment variables in Node.js os.tmpdir() order.
    const char *tmpdir = getenv("TMPDIR");
    if (tmpdir && tmpdir[0] != '\0') {
        return tmpdir;
    }

    tmpdir = getenv("TMP");
    if (tmpdir && tmpdir[0] != '\0') {
        return tmpdir;
    }

    tmpdir = getenv("TEMP");
    if (tmpdir && tmpdir[0] != '\0') {
        return tmpdir;
    }

    // Return fallback (never NULL).
    return fallback;
}

#endif /* TMPDIR_COMMON_H */
