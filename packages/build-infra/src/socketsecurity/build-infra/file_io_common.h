/**
 * file_io_common.h
 *
 * Common file I/O utilities for binary tooling packages.
 * Cross-platform file operations with consistent error handling.
 */

#ifndef FILE_IO_COMMON_H
#define FILE_IO_COMMON_H

#include <stddef.h>
#include <stdint.h>

/* Error codes */
#define FILE_IO_OK 0
#define FILE_IO_ERROR -1
#define FILE_IO_ERROR_OPEN_FAILED -2
#define FILE_IO_ERROR_READ_FAILED -3
#define FILE_IO_ERROR_WRITE_FAILED -4
#define FILE_IO_ERROR_ALLOC_FAILED -5

/**
 * Read entire file into memory buffer.
 *
 * @param path File path to read
 * @param data Pointer to receive allocated buffer (caller must free)
 * @param size Pointer to receive file size
 * @return FILE_IO_OK on success, error code on failure
 */
int file_io_read(const char *path, uint8_t **data, size_t *size);

/**
 * Write buffer to file.
 *
 * @param path File path to write
 * @param data Buffer to write
 * @param size Size of buffer in bytes
 * @return FILE_IO_OK on success, error code on failure
 */
int file_io_write(const char *path, const uint8_t *data, size_t size);

/**
 * Copy file from source to destination.
 * Uses buffered I/O for efficiency with large files.
 *
 * @param source Source file path
 * @param dest Destination file path
 * @return FILE_IO_OK on success, error code on failure
 */
int file_io_copy(const char *source, const char *dest);

/**
 * Set close-on-exec flag (FD_CLOEXEC on POSIX, non-inheritable on Windows).
 * Prevents the file descriptor from being inherited by child processes.
 *
 * @param fd File descriptor to configure
 * @return FILE_IO_OK on success, FILE_IO_ERROR on failure
 */
int file_io_set_cloexec(int fd);

/**
 * Cross-platform mkstemp implementation.
 * Creates a unique temporary file from a template.
 *
 * On Unix, uses mkstemp() directly.
 * On Windows, uses _mktemp_s + _sopen_s for equivalent functionality.
 *
 * @param template Template path ending with "XXXXXX" (will be modified)
 * @return File descriptor on success, -1 on failure
 */
#ifdef _WIN32
#include <io.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <share.h>
#include <errno.h>

static inline int mkstemp_portable(char *template) {
    errno_t err = _mktemp_s(template, strlen(template) + 1);
    if (err != 0) {
        errno = err;
        return -1;
    }

    int fd;
    err = _sopen_s(&fd, template, _O_RDWR | _O_CREAT | _O_EXCL | _O_BINARY,
                   _SH_DENYNO, _S_IREAD | _S_IWRITE);
    if (err != 0) {
        errno = err;
        return -1;
    }
    return fd;
}

#define mkstemp mkstemp_portable
#endif

#endif /* FILE_IO_COMMON_H */
