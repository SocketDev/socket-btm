/**
 * path_utils.c - Cross-platform path manipulation utilities
 */

#include "path_utils.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#include <windows.h>
#include <direct.h>
#else
#include <limits.h>
#include <unistd.h>
#endif

/**
 * Resolve relative path to absolute path with fallback.
 */
const char* resolve_absolute_path(const char *path, char *resolved_path) {
    if (!path || !resolved_path) {
        return path;
    }

#ifdef _WIN32
    /* Windows: use _fullpath() */
    if (_fullpath(resolved_path, path, PATH_MAX) != NULL) {
        return resolved_path;
    }
#else
    /* POSIX: use realpath() */
    if (realpath(path, resolved_path) != NULL) {
        return resolved_path;
    }
#endif

    /* If resolution fails, fall back to original path.
     * This handles cases where:
     * - Path doesn't exist yet (output files)
     * - Path is already absolute
     * - Permission denied on intermediate directories */
    return path;
}

/**
 * Check if path is absolute.
 */
int is_absolute_path(const char *path) {
    if (!path || !path[0]) {
        return 0;
    }

#ifdef _WIN32
    /* Windows absolute paths:
     * - Drive letter: C:\path or C:/path
     * - UNC path: \\server\share */
    if ((path[0] >= 'A' && path[0] <= 'Z') || (path[0] >= 'a' && path[0] <= 'z')) {
        if (path[1] == ':' && (path[2] == '\\' || path[2] == '/')) {
            return 1;
        }
    }
    if (path[0] == '\\' && path[1] == '\\') {
        return 1;  /* UNC path */
    }
    return 0;
#else
    /* POSIX: absolute paths start with / */
    return path[0] == '/';
#endif
}

/**
 * Join two path components with proper separator handling.
 */
int path_join(char *result, const char *base_path, const char *component) {
    if (!result || !base_path || !component) {
        return -1;
    }

#ifdef _WIN32
    const char sep = '\\';
#else
    const char sep = '/';
#endif

    size_t base_len = strlen(base_path);
    size_t comp_len = strlen(component);

    /* Check for overflow */
    if (base_len + comp_len + 2 > PATH_MAX) {
        return -1;
    }

    /* Copy base path */
    strcpy(result, base_path);

    /* Remove trailing separator from base if present */
    if (base_len > 0 && (result[base_len - 1] == '/' || result[base_len - 1] == '\\')) {
        result[base_len - 1] = '\0';
        base_len--;
    }

    /* Skip leading separator from component if present */
    const char *comp_start = component;
    if (comp_start[0] == '/' || comp_start[0] == '\\') {
        comp_start++;
    }

    /* Join with separator */
    if (base_len > 0 && comp_start[0] != '\0') {
        result[base_len] = sep;
        strcpy(result + base_len + 1, comp_start);
    } else if (comp_start[0] != '\0') {
        strcpy(result + base_len, comp_start);
    }

    return 0;
}

/**
 * Normalize path separators for current platform.
 */
void normalize_path_separators(char *path) {
    if (!path) {
        return;
    }

#ifdef _WIN32
    /* Windows: convert forward slashes to backslashes */
    char from = '/';
    char to = '\\';
#else
    /* POSIX: convert backslashes to forward slashes */
    char from = '\\';
    char to = '/';
#endif

    char *p = path;
    char *write = path;
    int prev_was_sep = 0;

    while (*p) {
        if (*p == from || *p == to) {
            /* Skip redundant separators */
            if (!prev_was_sep) {
                *write++ = to;
                prev_was_sep = 1;
            }
        } else {
            *write++ = *p;
            prev_was_sep = 0;
        }
        p++;
    }
    *write = '\0';
}
