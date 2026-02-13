/**
 * path_utils.h - Cross-platform path manipulation utilities
 *
 * Provides consistent path operations across POSIX and Windows platforms.
 */

#ifndef PATH_UTILS_H
#define PATH_UTILS_H

#include <stddef.h>

/* Ensure PATH_MAX is defined */
#ifndef PATH_MAX
#ifdef _WIN32
#define PATH_MAX 260  /* Windows MAX_PATH */
#else
#define PATH_MAX 4096  /* POSIX fallback */
#endif
#endif

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Resolve relative path to absolute path with fallback.
 *
 * Uses realpath() on POSIX, _fullpath() on Windows.
 * Falls back to original path if resolution fails (e.g., file doesn't exist yet).
 *
 * This function is critical for file operations where relative paths cause
 * fopen() or other syscalls to fail due to working directory context issues.
 *
 * @param path Input path (relative or absolute)
 * @param resolved_path Buffer for result (must be PATH_MAX bytes)
 * @return Pointer to resolved path (resolved_path on success, path on failure)
 *
 * @example
 *   char resolved[PATH_MAX];
 *   const char *abs_path = resolve_absolute_path("../foo/bar.txt", resolved);
 *   FILE *fp = fopen(abs_path, "rb");
 */
const char* resolve_absolute_path(const char *path, char *resolved_path);

/**
 * Check if path is absolute.
 *
 * Platform-specific detection:
 * - Unix: starts with /
 * - Windows: starts with C:\ or \\ (UNC paths)
 *
 * @param path Path to check
 * @return 1 if absolute, 0 if relative
 */
int is_absolute_path(const char *path);

/**
 * Join two path components with proper separator handling.
 *
 * Handles:
 * - Trailing slashes in base_path
 * - Leading slashes in component
 * - Windows vs Unix separators
 * - Buffer overflow protection
 *
 * @param result Buffer for result (must be PATH_MAX bytes)
 * @param base_path Base directory path
 * @param component Path component to append
 * @return 0 on success, -1 on overflow
 *
 * @example
 *   char full_path[PATH_MAX];
 *   path_join(full_path, "/home/user", "file.txt");
 *   // full_path = "/home/user/file.txt"
 */
int path_join(char *result, const char *base_path, const char *component);

/**
 * Normalize path separators for current platform.
 *
 * Converts:
 * - Forward slashes to backslashes on Windows
 * - Backslashes to forward slashes on Unix
 * - Removes redundant separators (//)
 *
 * @param path Path to normalize (modified in place)
 */
void normalize_path_separators(char *path);

#ifdef __cplusplus
}
#endif

#endif /* PATH_UTILS_H */
