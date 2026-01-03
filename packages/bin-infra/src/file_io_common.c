/**
 * file_io_common.c
 *
 * Implementation of common file I/O utilities.
 */

#include "file_io_common.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

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
        fprintf(stderr, "Error: Cannot seek in file: %s\n", path);
        fclose(fp);
        return FILE_IO_ERROR_READ_FAILED;
    }

    long file_size = ftell(fp);
    if (file_size < 0) {
        fprintf(stderr, "Error: Cannot get file size: %s\n", path);
        fclose(fp);
        return FILE_IO_ERROR_READ_FAILED;
    }

    if (fseek(fp, 0, SEEK_SET) != 0) {
        fprintf(stderr, "Error: Cannot seek to start: %s\n", path);
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
    fclose(fp);

    if (written != size) {
        fprintf(stderr, "Error: Wrote %zu bytes, expected %zu\n", written, size);
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
            fprintf(stderr, "Error: Failed to write output file\n");
            result = FILE_IO_ERROR_WRITE_FAILED;
            break;
        }
    }

    fclose(in_file);
    fclose(out_file);

    /* Remove output file on failure */
    if (result != FILE_IO_OK) {
        remove(dest);
    }

    return result;
}
