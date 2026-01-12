/**
 * file_utils.h - Common file utilities for binpress
 */

#ifndef FILE_UTILS_H
#define FILE_UTILS_H

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Create parent directories for a file path.
 *
 * @param filepath Path to the file whose parent directories should be created
 * @return 0 on success, -1 on failure
 */
int create_parent_directories(const char *filepath);

/**
 * Ensure output path has .exe extension for PE binaries.
 *
 * Allocates a new string with .exe extension if not present.
 * Caller must free() the returned string.
 *
 * @param path Original path
 * @return Path with .exe extension (caller must free), or NULL on error
 */
char *ensure_exe_extension(const char *path);

/**
 * Set executable permissions on a file (cross-platform).
 *
 * On Unix: sets 0755 (rwxr-xr-x)
 * On Windows: sets _S_IREAD | _S_IWRITE | _S_IEXEC
 *
 * @param path Path to the file
 * @return 0 on success, -1 on failure
 */
int set_executable_permissions(const char *path);

/**
 * Check if a file exists and is readable (cross-platform).
 *
 * Uses stat() for portability across musl, glibc, Windows, and macOS.
 *
 * @param path Path to check
 * @return 1 if file exists, 0 if not
 */
int file_exists(const char *path);

/**
 * Check if a path is a directory (cross-platform).
 *
 * Uses stat() for portability across musl, glibc, Windows, and macOS.
 *
 * @param path Path to check
 * @return 1 if directory exists, 0 if not
 */
int is_directory(const char *path);

/**
 * Safe dirname() wrapper that handles musl/glibc differences.
 *
 * Returns a newly allocated string containing the directory component of path.
 * Works correctly on both glibc (which modifies input) and musl (which returns
 * pointer to static storage).
 *
 * Caller must free() the returned string.
 *
 * @param path Path to extract directory from
 * @return Allocated directory path string, or NULL on error
 */
char *safe_dirname(const char *path);

/**
 * Safe basename() wrapper that handles musl/glibc differences.
 *
 * Returns a newly allocated string containing the filename component of path.
 * Works correctly on both glibc (which modifies input) and musl (which returns
 * pointer to static storage).
 *
 * Caller must free() the returned string.
 *
 * @param path Path to extract filename from
 * @return Allocated filename string, or NULL on error
 */
char *safe_basename(const char *path);

#ifdef __cplusplus
}
#endif

#endif /* FILE_UTILS_H */
