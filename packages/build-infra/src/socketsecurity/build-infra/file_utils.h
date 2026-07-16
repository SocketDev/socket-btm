/**
 * file_utils.h - Common file utilities for binpress
 */

#ifndef FILE_UTILS_H
#define FILE_UTILS_H

#include <stddef.h>
#include <stdint.h>

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
 * Create a directory recursively (like mkdir -p).
 *
 * Creates all parent directories as needed, then creates the directory itself.
 * If the directory already exists, returns success (idempotent).
 *
 * @param dirpath Path to the directory to create
 * @return 0 on success, -1 on failure
 */
int mkdir_recursive(const char *dirpath);

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

/**
 * Check if a file has .tar.gz or .tgz extension.
 *
 * @param path Path to check
 * @return 1 if file has tar.gz extension, 0 otherwise
 */
int is_tar_gz_file(const char *path);

/**
 * Check if a file has .tar extension (uncompressed tar).
 *
 * @param path Path to check
 * @return 1 if file has .tar extension (but not .tar.gz), 0 otherwise
 */
int is_tar_file(const char *path);

/**
 * Check if data has gzip magic bytes (0x1F 0x8B).
 *
 * @param data Pointer to data buffer
 * @param size Size of data buffer
 * @return 1 if data starts with gzip magic bytes, 0 otherwise
 */
int is_gzip_data(const uint8_t *data, size_t size);

/**
 * Write data to a file atomically (cross-platform).
 *
 * Handles Windows (CreateFileA/WriteFile) and Unix (open/write) differences.
 * Logs detailed errors with platform-specific error codes to help diagnose
 * file write failures in production.
 *
 * On failure, automatically cleans up partial files.
 *
 * @param path Path to the file to write
 * @param data Data buffer to write
 * @param size Size of data in bytes
 * @param mode Unix permissions (e.g., 0755) - ignored on Windows
 * @return 0 on success, -1 on failure (with error logged to stderr)
 */
int write_file_atomically(const char *path, const unsigned char *data, size_t size, int mode);

#ifdef __cplusplus
}
#endif

#endif /* FILE_UTILS_H */
