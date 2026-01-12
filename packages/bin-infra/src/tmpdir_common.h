/**
 * @file tmpdir_common.h
 * @brief Node.js-compatible temporary directory selection
 *
 * This header provides utilities to select temporary directories matching
 * Node.js os.tmpdir() behavior. Used by decompressor binaries for temp file creation.
 *
 * References:
 * - https://github.com/nodejs/node/blob/v24.12.0/lib/os.js (tmpdir function)
 * - https://github.com/nodejs/node/blob/main/deps/uv/src/unix/core.c (uv_os_tmpdir)
 */

#ifndef TMPDIR_COMMON_H
#define TMPDIR_COMMON_H

#include <stdlib.h>
#include <string.h>

/**
 * Get temporary directory path following Node.js os.tmpdir() behavior.
 *
 * Platform-specific priority order:
 * - Windows: TEMP → TMP → fallback (default: ".")
 * - Unix:    TMPDIR → TMP → TEMP → fallback (default: "/tmp")
 *
 * @param fallback Optional custom fallback directory. If NULL, uses Node.js defaults:
 *                 Windows: "." (current directory), Unix: "/tmp"
 * @return Pointer to tmpdir string. Never returns NULL.
 *
 * Example usage:
 *   const char *tmpdir = get_tmpdir(NULL);          // Node.js default behavior
 *   const char *tmpdir = get_tmpdir("/dev/shm");    // Custom fallback for tmpfs
 */
static inline const char* get_tmpdir(const char *fallback) {
#ifdef _WIN32
    // Windows: Try TEMP, then TMP, then fallback
    // Matches Node.js os.tmpdir() which checks process.env.TEMP || process.env.TMP
    const char *tmpdir = getenv("TEMP");
    if (tmpdir && tmpdir[0] != '\0') {
        return tmpdir;
    }
    tmpdir = getenv("TMP");
    if (tmpdir && tmpdir[0] != '\0') {
        return tmpdir;
    }
    return fallback ? fallback : ".";
#else
    // Unix: Try TMPDIR, TMP, TEMP, then fallback
    // Matches Node.js libuv uv_os_tmpdir() which checks TMPDIR, TMP, TEMP, TEMPDIR
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
    return fallback ? fallback : "/tmp";
#endif
}

#endif /* TMPDIR_COMMON_H */
