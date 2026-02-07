/**
 * VFS Utilities for binject
 *
 * Helper functions for VFS source detection and archive creation.
 */

#ifndef VFS_UTILS_H
#define VFS_UTILS_H

#include <stdbool.h>
#include <sys/types.h>

/**
 * VFS source type enumeration.
 */
typedef enum {
    VFS_SOURCE_TAR_GZ = 0,    // .tar.gz archive (already compressed, use as-is).
    VFS_SOURCE_TAR = 1,       // .tar archive (needs compression with gzip level 9).
    VFS_SOURCE_DIR = 2,       // directory (needs archiving + compression).
    VFS_SOURCE_NOT_FOUND = 3, // source doesn't exist (skip VFS, not an error).
    VFS_SOURCE_ERROR = -1     // error (invalid file type).
} vfs_source_type_t;

/**
 * Detect VFS source type (.tar.gz, .tar, or directory).
 *
 * @param path - Path to source file or directory.
 * @return VFS source type, or VFS_SOURCE_ERROR on error.
 */
vfs_source_type_t detect_vfs_source_type(const char *path);

/**
 * Create TAR.GZ archive from directory.
 * Always uses gzip level 9 (maximum compression).
 *
 * @param dir_path - Directory to archive.
 * @return Path to temporary archive file, or NULL on error. Caller must free and unlink.
 */
char* create_vfs_archive_from_dir(const char *dir_path);

/**
 * Compress .tar file to .tar.gz with gzip level 9.
 *
 * @param tar_path - Path to .tar file.
 * @return Path to compressed file, or NULL on error. Caller must free and unlink.
 */
char* compress_tar_archive(const char *tar_path);

/**
 * Resolve relative path from a base file path.
 * If source_path is relative, resolves it relative to the directory containing base_path.
 * If source_path is absolute, returns a copy of it.
 *
 * @param base_path - Base file path (e.g., sea-config.json).
 * @param source_path - Source path to resolve (can be relative or absolute).
 * @return Resolved absolute path, or NULL on error. Caller must free.
 */
char* resolve_relative_path(const char *base_path, const char *source_path);

/**
 * Get file size in bytes.
 *
 * @param path - Path to file.
 * @return File size in bytes, or -1 on error.
 */
off_t get_file_size(const char *path);

#endif // VFS_UTILS_H
