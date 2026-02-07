/**
 * file_io_common.c
 *
 * Implementation of common file I/O utilities.
 */

#include "socketsecurity/build-infra/file_io_common.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#include <io.h>
#include <windows.h>
#else
#include <fcntl.h>
#include <unistd.h>
#endif

/**
 * Read entire file into memory buffer.
 */
int file_io_read(const char *path, uint8_t **data, size_t *size) {
    if (!path || !data || !size) {
        fprintf(stderr, "Error: Invalid arguments to file_io_read\n");
        return FILE_IO_ERROR;
    }

    FILE *fp = fopen(path, "rb");
    if (!fp) {
        fprintf(stderr, "Error: Cannot open file: %s\n", path);
        return FILE_IO_ERROR_OPEN_FAILED;
    }

    /* Get file size */
    if (fseek(fp, 0, SEEK_END) != 0) {
        int saved_errno = errno;
        fprintf(stderr, "Error: Cannot seek to end of file: %s (errno: %d - %s)\n",
                path, saved_errno, strerror(saved_errno));
        fclose(fp);
        return FILE_IO_ERROR_READ_FAILED;
    }

    off_t file_size = ftello(fp);
    if (file_size < 0) {
        int saved_errno = errno;
        fprintf(stderr, "Error: Cannot get file size: %s (errno: %d - %s)\n",
                path, saved_errno, strerror(saved_errno));
        fprintf(stderr, "  File may be > 2GB and ftello() doesn't support large files\n");
        fclose(fp);
        return FILE_IO_ERROR_READ_FAILED;
    }

    if (fseek(fp, 0, SEEK_SET) != 0) {
        int saved_errno = errno;
        fprintf(stderr, "Error: Cannot seek to start: %s (errno: %d - %s)\n",
                path, saved_errno, strerror(saved_errno));
        fclose(fp);
        return FILE_IO_ERROR_READ_FAILED;
    }

    /* Allocate buffer */
    *size = (size_t)file_size;
    *data = (uint8_t *)malloc(*size);
    if (!*data) {
        fprintf(stderr, "Error: Cannot allocate %zu bytes\n", *size);
        fclose(fp);
        return FILE_IO_ERROR_ALLOC_FAILED;
    }

    /* Read file */
    size_t bytes_read = fread(*data, 1, *size, fp);
    fclose(fp);

    if (bytes_read != *size) {
        fprintf(stderr, "Error: Read %zu bytes, expected %zu\n", bytes_read, *size);
        free(*data);
        *data = NULL;
        return FILE_IO_ERROR_READ_FAILED;
    }

    return FILE_IO_OK;
}

/**
 * Write buffer to file.
 */
int file_io_write(const char *path, const uint8_t *data, size_t size) {
    if (!path || !data || size == 0) {
        fprintf(stderr, "Error: Invalid arguments to file_io_write\n");
        return FILE_IO_ERROR;
    }

    FILE *fp = fopen(path, "wb");
    if (!fp) {
        fprintf(stderr, "Error: Cannot write file: %s\n", path);
        return FILE_IO_ERROR_OPEN_FAILED;
    }

    size_t written = fwrite(data, 1, size, fp);

    // Check fclose() error - can report buffered write failures (e.g., disk full, I/O errors).
    if (fclose(fp) != 0) {
        fprintf(stderr, "Error: Failed to close file (data may not be flushed): %s\n", strerror(errno));
        // Attempt to remove incomplete file on write failure.
        remove(path);
        return FILE_IO_ERROR_WRITE_FAILED;
    }

    if (written != size) {
        fprintf(stderr, "Error: Wrote %zu bytes, expected %zu\n", written, size);
        // File already closed, just remove it.
        remove(path);
        return FILE_IO_ERROR_WRITE_FAILED;
    }

    return FILE_IO_OK;
}

/**
 * Copy file from source to destination.
 */
int file_io_copy(const char *source, const char *dest) {
    if (!source || !dest) {
        fprintf(stderr, "Error: Invalid arguments to file_io_copy\n");
        return FILE_IO_ERROR;
    }

    FILE *in_file = fopen(source, "rb");
    if (!in_file) {
        fprintf(stderr, "Error: Failed to open input file: %s\n", source);
        return FILE_IO_ERROR_OPEN_FAILED;
    }

    FILE *out_file = fopen(dest, "wb");
    if (!out_file) {
        fprintf(stderr, "Error: Failed to create output file: %s\n", dest);
        fclose(in_file);
        return FILE_IO_ERROR_OPEN_FAILED;
    }

    /* Copy file contents in chunks */
    char buffer[8192];
    size_t bytes_read;
    int result = FILE_IO_OK;

    while ((bytes_read = fread(buffer, 1, sizeof(buffer), in_file)) > 0) {
        if (fwrite(buffer, 1, bytes_read, out_file) != bytes_read) {
            fprintf(stderr, "Error: Failed to write output file: %s\n", strerror(errno));
            result = FILE_IO_ERROR_WRITE_FAILED;
            break;
        }
    }

    /* Check for read errors (not just EOF) */
    if (ferror(in_file)) {
        fprintf(stderr, "Error: Failed to read input file: %s\n", source);
        result = FILE_IO_ERROR_READ_FAILED;
    }

    /* Check fclose errors */
    if (fclose(in_file) != 0 && result == FILE_IO_OK) {
        fprintf(stderr, "Error: Failed to close input file: %s\n", strerror(errno));
        result = FILE_IO_ERROR;
    }
    if (fclose(out_file) != 0 && result == FILE_IO_OK) {
        fprintf(stderr, "Error: Failed to close output file: %s\n", strerror(errno));
        result = FILE_IO_ERROR_WRITE_FAILED;
    }

    /* Remove output file on failure */
    if (result != FILE_IO_OK) {
        remove(dest);
    }

    return result;
}

/**
 * Set close-on-exec flag (cross-platform).
 */
int file_io_set_cloexec(int fd) {
    if (fd < 0) {
        return FILE_IO_ERROR;
    }

#ifdef _WIN32
    /* Windows: Convert file descriptor to HANDLE and clear inherit flag */
    HANDLE handle = (HANDLE)_get_osfhandle(fd);
    if (handle == INVALID_HANDLE_VALUE) {
        return FILE_IO_ERROR;
    }
    if (!SetHandleInformation(handle, HANDLE_FLAG_INHERIT, 0)) {
        return FILE_IO_ERROR;
    }
#else
    /* POSIX: Set FD_CLOEXEC flag */
    int flags = fcntl(fd, F_GETFD);
    if (flags == -1) {
        return FILE_IO_ERROR;
    }
    if (fcntl(fd, F_SETFD, flags | FD_CLOEXEC) == -1) {
        return FILE_IO_ERROR;
    }
#endif

    return FILE_IO_OK;
}
