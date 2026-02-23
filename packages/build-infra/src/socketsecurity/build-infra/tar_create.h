/**
 * tar_create.h - Create TAR archives from directories
 *
 * Creates POSIX ustar format TAR archives in memory.
 */

#ifndef TAR_CREATE_H
#define TAR_CREATE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Return codes */
#define TAR_OK 0
#define TAR_ERROR -1
#define TAR_ERROR_ALLOC -2
#define TAR_ERROR_PATH_TOO_LONG -3
#define TAR_ERROR_READ_FAILED -4
#define TAR_ERROR_NOT_DIRECTORY -5

/**
 * Create a TAR archive from a directory.
 *
 * @param dir_path      Path to the directory to archive
 * @param output        Pointer to receive allocated output buffer (caller must free)
 * @param output_size   Pointer to receive size of TAR archive
 * @return              TAR_OK on success, error code on failure
 *
 * The archive contains files with paths relative to dir_path.
 * For example, if dir_path is "/foo/bar" and contains "baz/file.txt",
 * the archive will contain "baz/file.txt" (not "/foo/bar/baz/file.txt").
 */
int tar_create_from_directory(const char *dir_path,
                              uint8_t **output, size_t *output_size);

/**
 * Create a gzipped TAR archive (.tar.gz) from a directory.
 *
 * @param dir_path      Path to the directory to archive
 * @param output        Pointer to receive allocated output buffer (caller must free)
 * @param output_size   Pointer to receive size of compressed archive
 * @param level         Compression level (1=fastest, 6=default, 9=best)
 * @return              TAR_OK on success, error code on failure
 */
int tar_gz_create_from_directory(const char *dir_path,
                                 uint8_t **output, size_t *output_size,
                                 int level);

#ifdef __cplusplus
}
#endif

#endif /* TAR_CREATE_H */
