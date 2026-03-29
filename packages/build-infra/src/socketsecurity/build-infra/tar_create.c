/**
 * tar_create.c - Create TAR archives from directories
 *
 * Creates POSIX ustar format TAR archives in memory.
 */

#include "socketsecurity/build-infra/tar_create.h"
#include "socketsecurity/build-infra/gzip_compress.h"
#include "socketsecurity/build-infra/file_io_common.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <stdint.h>
#include <errno.h>

#ifdef _WIN32
#include <windows.h>
#include <io.h>
#define PATH_SEP '\\'
#include "socketsecurity/build-infra/posix_compat.h"
#else
#include <unistd.h>
#include <dirent.h>
#define PATH_SEP '/'
#endif

/* TAR block size */
#define TAR_BLOCK_SIZE 512

/* Path buffer size for safe path construction */
#define MAX_PATH_LEN 4096

/* TAR buffer initial size (1 MB) */
#define TAR_INITIAL_BUFFER_SIZE (1024 * 1024)

/* TAR header offsets */
#define TAR_NAME_OFF     0
#define TAR_NAME_LEN     100
#define TAR_MODE_OFF     100
#define TAR_MODE_LEN     8
#define TAR_UID_OFF      108
#define TAR_UID_LEN      8
#define TAR_GID_OFF      116
#define TAR_GID_LEN      8
#define TAR_SIZE_OFF     124
#define TAR_SIZE_LEN     12
#define TAR_MTIME_OFF    136
#define TAR_MTIME_LEN    12
#define TAR_CHKSUM_OFF   148
#define TAR_CHKSUM_LEN   8
#define TAR_TYPEFLAG_OFF 156
#define TAR_LINKNAME_OFF 157
#define TAR_LINKNAME_LEN 100
#define TAR_MAGIC_OFF    257
#define TAR_MAGIC_LEN    6
#define TAR_VERSION_OFF  263
#define TAR_VERSION_LEN  2
#define TAR_UNAME_OFF    265
#define TAR_UNAME_LEN    32
#define TAR_GNAME_OFF    297
#define TAR_GNAME_LEN    32
#define TAR_DEVMAJOR_OFF 329
#define TAR_DEVMAJOR_LEN 8
#define TAR_DEVMINOR_OFF 337
#define TAR_DEVMINOR_LEN 8
#define TAR_PREFIX_OFF   345
#define TAR_PREFIX_LEN   155

/* TAR type flags */
#define TAR_TYPE_FILE    '0'
#define TAR_TYPE_DIR     '5'

/* Dynamic buffer for building TAR archive */
typedef struct {
    uint8_t *data;
    size_t size;
    size_t capacity;
} tar_buffer_t;

static int tar_buffer_init(tar_buffer_t *buf, size_t initial_capacity) {
    buf->data = malloc(initial_capacity);
    if (!buf->data) return TAR_ERROR_ALLOC;
    buf->size = 0;
    buf->capacity = initial_capacity;
    return TAR_OK;
}

static void tar_buffer_free(tar_buffer_t *buf) {
    free(buf->data);
    buf->data = NULL;
    buf->size = 0;
    buf->capacity = 0;
}

static int tar_buffer_grow(tar_buffer_t *buf, size_t needed) {
    /* Check for overflow in buf->size + needed */
    if (needed > SIZE_MAX - buf->size) {
        return TAR_ERROR_ALLOC;
    }

    size_t required_size = buf->size + needed;
    if (required_size <= buf->capacity) return TAR_OK;

    size_t new_capacity = buf->capacity;

    /* Double capacity until it's large enough, with overflow protection */
    if (new_capacity == 0) {
        new_capacity = TAR_BLOCK_SIZE;
    }

    while (new_capacity < required_size) {
        /* Check if doubling would overflow */
        if (new_capacity > SIZE_MAX / 2) {
            /* Can't double anymore, try exact size */
            new_capacity = required_size;
            break;
        }
        new_capacity *= 2;
    }

    uint8_t *new_data = realloc(buf->data, new_capacity);
    if (!new_data) return TAR_ERROR_ALLOC;

    buf->data = new_data;
    buf->capacity = new_capacity;
    return TAR_OK;
}

static int tar_buffer_append(tar_buffer_t *buf, const void *data, size_t len) {
    int rc = tar_buffer_grow(buf, len);
    if (rc != TAR_OK) return rc;

    memcpy(buf->data + buf->size, data, len);
    buf->size += len;
    return TAR_OK;
}

static int tar_buffer_pad_to_block(tar_buffer_t *buf) {
    size_t remainder = buf->size % TAR_BLOCK_SIZE;
    if (remainder == 0) return TAR_OK;

    size_t padding = TAR_BLOCK_SIZE - remainder;
    int rc = tar_buffer_grow(buf, padding);
    if (rc != TAR_OK) return rc;

    memset(buf->data + buf->size, 0, padding);
    buf->size += padding;
    return TAR_OK;
}

/* Calculate TAR header checksum */
static unsigned int tar_checksum(const uint8_t *header) {
    unsigned int sum = 0;
    for (int i = 0; i < TAR_BLOCK_SIZE; i++) {
        /* Treat checksum field as spaces during calculation */
        if (i >= TAR_CHKSUM_OFF && i < TAR_CHKSUM_OFF + TAR_CHKSUM_LEN) {
            sum += ' ';
        } else {
            sum += header[i];
        }
    }
    return sum;
}

/* Write octal value to TAR header field */
static void tar_write_octal(uint8_t *field, size_t len, unsigned long value) {
    /* Write octal with leading zeros, null-terminated */
    char format[16];
#ifdef _WIN32
    snprintf(format, sizeof(format), "%%0%Iuo", len - 1);  /* Windows MSVC uses %I for size_t */
#else
    snprintf(format, sizeof(format), "%%0%zuo", len - 1);  /* C99 standard %z for size_t */
#endif
    snprintf((char *)field, len, format, value);
}

/* Create TAR header for a file or directory */
static int tar_create_header(uint8_t *header, const char *name,
                             int is_dir, size_t file_size, time_t mtime, mode_t mode) {
    memset(header, 0, TAR_BLOCK_SIZE);

    /* Check name length */
    size_t name_len = strlen(name);
    if (name_len > TAR_NAME_LEN + TAR_PREFIX_LEN) {
        fprintf(stderr, "Error: Path too long for TAR: %s\n", name);
        return TAR_ERROR_PATH_TOO_LONG;
    }

    /* Handle long names using prefix field */
    if (name_len > TAR_NAME_LEN) {
        /* Find a good split point (at a path separator) */
        size_t split = name_len - TAR_NAME_LEN;
        while (split < name_len && name[split] != '/' && name[split] != '\\') {
            split++;
        }
        if (split >= name_len || split > TAR_PREFIX_LEN || (name_len - split - 1) > TAR_NAME_LEN) {
            fprintf(stderr, "Error: Cannot split path for TAR: %s\n", name);
            return TAR_ERROR_PATH_TOO_LONG;
        }

        /* Copy prefix (before separator) */
        memcpy(header + TAR_PREFIX_OFF, name, split);
        /* Copy name (after separator) */
        memcpy(header + TAR_NAME_OFF, name + split + 1, name_len - split - 1);
    } else {
        memcpy(header + TAR_NAME_OFF, name, name_len);
    }

    /* Mode: Use permissions from filesystem (mask out file type bits) */
    tar_write_octal(header + TAR_MODE_OFF, TAR_MODE_LEN, mode & 0777);

    /* UID/GID: 0 (root) */
    tar_write_octal(header + TAR_UID_OFF, TAR_UID_LEN, 0);
    tar_write_octal(header + TAR_GID_OFF, TAR_GID_LEN, 0);

    /* Size: 0 for directories */
    tar_write_octal(header + TAR_SIZE_OFF, TAR_SIZE_LEN, is_dir ? 0 : file_size);

    /* Modification time */
    tar_write_octal(header + TAR_MTIME_OFF, TAR_MTIME_LEN, (unsigned long)mtime);

    /* Type flag */
    header[TAR_TYPEFLAG_OFF] = is_dir ? TAR_TYPE_DIR : TAR_TYPE_FILE;

    /* Magic and version (POSIX ustar) */
    memcpy(header + TAR_MAGIC_OFF, "ustar", 5);
    header[TAR_MAGIC_OFF + 5] = '\0';
    header[TAR_VERSION_OFF] = '0';
    header[TAR_VERSION_OFF + 1] = '0';

    /* User/group names */
    snprintf((char *)(header + TAR_UNAME_OFF), TAR_UNAME_LEN, "root");
    snprintf((char *)(header + TAR_GNAME_OFF), TAR_GNAME_LEN, "root");

    /* Calculate and write checksum */
    unsigned int chksum = tar_checksum(header);
    snprintf((char *)(header + TAR_CHKSUM_OFF), TAR_CHKSUM_LEN, "%06o", chksum);
    header[TAR_CHKSUM_OFF + 6] = '\0';
    header[TAR_CHKSUM_OFF + 7] = ' ';

    return TAR_OK;
}

/* Normalize path separators to forward slashes */
static void normalize_path(char *path) {
    for (char *p = path; *p; p++) {
        if (*p == '\\') *p = '/';
    }
}

/* Add a file to the TAR buffer */
static int tar_add_file(tar_buffer_t *buf, const char *base_path,
                        const char *rel_path) {
    /* Build full path with length validation */
    size_t base_len = strlen(base_path);
    size_t rel_len = strlen(rel_path);
    if (base_len + rel_len + 2 > MAX_PATH_LEN) {
        fprintf(stderr, "Error: Path too long: %zu bytes (max %d): %s/%s\n",
                base_len + rel_len + 2, MAX_PATH_LEN, base_path, rel_path);
        return TAR_ERROR_PATH_TOO_LONG;
    }

    char full_path[MAX_PATH_LEN];
    snprintf(full_path, sizeof(full_path), "%s%c%s", base_path, PATH_SEP, rel_path);

    /* Get file info */
    struct stat st;
    if (stat(full_path, &st) != 0) {
        fprintf(stderr, "Error: Cannot stat file: %s (errno: %d - %s)\n",
                full_path, errno, strerror(errno));
        return TAR_ERROR_READ_FAILED;
    }

    /* Normalize relative path for TAR */
    char tar_path[MAX_PATH_LEN];
    snprintf(tar_path, sizeof(tar_path), "%s", rel_path);
    normalize_path(tar_path);

    /* Validate file size before casting to size_t */
    if (st.st_size < 0) {
        fprintf(stderr, "Error: Invalid file size (negative): %s\n", full_path);
        return TAR_ERROR_READ_FAILED;
    }
    if ((uint64_t)st.st_size > SIZE_MAX) {
        fprintf(stderr, "Error: File too large for TAR archive: %s (%lld bytes)\n",
                full_path, (long long)st.st_size);
        fprintf(stderr, "  SIZE_MAX on this platform: %zu\n", SIZE_MAX);
        return TAR_ERROR_READ_FAILED;
    }

    size_t file_size = (size_t)st.st_size;

    /* Create header */
    uint8_t header[TAR_BLOCK_SIZE];
    int rc = tar_create_header(header, tar_path, 0, file_size, st.st_mtime, st.st_mode);
    if (rc != TAR_OK) return rc;

    /* Append header */
    rc = tar_buffer_append(buf, header, TAR_BLOCK_SIZE);
    if (rc != TAR_OK) return rc;

    /* Read and append file content */
    FILE *fp = fopen(full_path, "rb");
    if (!fp) {
        fprintf(stderr, "Error: Cannot open file: %s (errno: %d - %s)\n",
                full_path, errno, strerror(errno));
        return TAR_ERROR_READ_FAILED;
    }

    rc = tar_buffer_grow(buf, file_size);
    if (rc != TAR_OK) {
        fclose(fp);
        return rc;
    }

    size_t bytes_read = fread(buf->data + buf->size, 1, file_size, fp);
    int fread_errno = ferror(fp) ? errno : 0;
    fclose(fp);

    if (bytes_read != file_size) {
        // Re-stat to detect if file changed (TOCTOU race detection)
        struct stat st_after;
        if (stat(full_path, &st_after) == 0 && st_after.st_size != st.st_size) {
            fprintf(stderr, "Error: File size changed during archiving: %s (was %lld bytes, now %lld bytes)\n",
                    full_path, (long long)st.st_size, (long long)st_after.st_size);
            fprintf(stderr, "  This indicates the file was modified while creating the TAR archive.\n");
        } else if (fread_errno != 0) {
            fprintf(stderr, "Error: Failed to read file: %s (errno: %d - %s)\n",
                    full_path, fread_errno, strerror(fread_errno));
        } else {
            fprintf(stderr, "Error: Failed to read file: %s (read %zu of %zu bytes)\n",
                    full_path, bytes_read, file_size);
        }
        return TAR_ERROR_READ_FAILED;
    }

    buf->size += bytes_read;

    /* Pad to block boundary */
    return tar_buffer_pad_to_block(buf);
}

/* Add a directory entry to the TAR buffer */
static int tar_add_directory_entry(tar_buffer_t *buf, const char *rel_path, time_t mtime, mode_t mode) {
    /* Normalize path and ensure trailing slash */
    char tar_path[MAX_PATH_LEN];
    snprintf(tar_path, sizeof(tar_path), "%s", rel_path);
    normalize_path(tar_path);

    size_t len = strlen(tar_path);
    if (len > 0 && tar_path[len - 1] != '/' && len <= sizeof(tar_path) - 3) {
        tar_path[len] = '/';
        tar_path[len + 1] = '\0';
    }

    /* Create header */
    uint8_t header[TAR_BLOCK_SIZE];
    int rc = tar_create_header(header, tar_path, 1, 0, mtime, mode);
    if (rc != TAR_OK) return rc;

    /* Append header */
    return tar_buffer_append(buf, header, TAR_BLOCK_SIZE);
}

#ifndef _WIN32
/* Recursively add directory contents to TAR buffer */
static int tar_add_directory_recursive(tar_buffer_t *buf, const char *base_path,
                                       const char *rel_path) {
    /* Validate path lengths before construction */
    size_t base_len = strlen(base_path);
    size_t rel_len = rel_path ? strlen(rel_path) : 0;
    if (base_len + rel_len + 2 > MAX_PATH_LEN) {
        fprintf(stderr, "Error: Directory path too long: %zu bytes (max %d): %s/%s\n",
                base_len + rel_len + 2, MAX_PATH_LEN, base_path, rel_path ? rel_path : "");
        return TAR_ERROR_PATH_TOO_LONG;
    }

    char full_path[MAX_PATH_LEN];
    if (rel_path && strlen(rel_path) > 0) {
        snprintf(full_path, sizeof(full_path), "%s%c%s", base_path, PATH_SEP, rel_path);
    } else {
        snprintf(full_path, sizeof(full_path), "%s", base_path);
    }

    DIR *dir = opendir(full_path);
    if (!dir) {
        fprintf(stderr, "Error: Cannot open directory: %s (errno: %d - %s)\n",
                full_path, errno, strerror(errno));
        return TAR_ERROR_NOT_DIRECTORY;
    }

    struct dirent *entry;
    int rc = TAR_OK;

    while ((entry = readdir(dir)) != NULL) {
        /* Skip . and .. */
        if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0) {
            continue;
        }

        /* Validate entry path lengths before construction */
        size_t entry_name_len = strlen(entry->d_name);
        if (rel_len > 0) {
            if (rel_len + entry_name_len + 2 > MAX_PATH_LEN) {
                fprintf(stderr, "Error: Entry relative path too long: %zu bytes (max %d): %s/%s\n",
                        rel_len + entry_name_len + 2, MAX_PATH_LEN, rel_path, entry->d_name);
                closedir(dir);
                return TAR_ERROR_PATH_TOO_LONG;
            }
        }

        /* Build relative path for this entry */
        char entry_rel_path[MAX_PATH_LEN];
        if (rel_path && strlen(rel_path) > 0) {
            snprintf(entry_rel_path, sizeof(entry_rel_path), "%s%c%s",
                     rel_path, PATH_SEP, entry->d_name);
        } else {
            snprintf(entry_rel_path, sizeof(entry_rel_path), "%s", entry->d_name);
        }

        /* Validate full entry path length */
        size_t entry_rel_len = strlen(entry_rel_path);
        if (base_len + entry_rel_len + 2 > MAX_PATH_LEN) {
            fprintf(stderr, "Error: Entry full path too long: %zu bytes (max %d): %s/%s\n",
                    base_len + entry_rel_len + 2, MAX_PATH_LEN, base_path, entry_rel_path);
            closedir(dir);
            return TAR_ERROR_PATH_TOO_LONG;
        }

        /* Build full path */
        char entry_full_path[MAX_PATH_LEN];
        snprintf(entry_full_path, sizeof(entry_full_path), "%s%c%s",
                 base_path, PATH_SEP, entry_rel_path);

        /* Get entry info */
        struct stat st;
        if (stat(entry_full_path, &st) != 0) {
            fprintf(stderr, "Warning: Cannot stat: %s (errno: %d - %s, skipping)\n",
                    entry_full_path, errno, strerror(errno));
            continue;
        }

        if (S_ISDIR(st.st_mode)) {
            /* Add directory entry */
            rc = tar_add_directory_entry(buf, entry_rel_path, st.st_mtime, st.st_mode);
            if (rc != TAR_OK) break;

            /* Recurse into directory */
            rc = tar_add_directory_recursive(buf, base_path, entry_rel_path);
            if (rc != TAR_OK) break;
        } else if (S_ISREG(st.st_mode)) {
            /* Add file */
            rc = tar_add_file(buf, base_path, entry_rel_path);
            if (rc != TAR_OK) break;
        }
        /* Skip other types (symlinks, devices, etc.) */
    }

    closedir(dir);
    return rc;
}
#else
/*
 * Windows stub - directory traversal not yet implemented
 *
 * Known limitations on Windows:
 * 1. VFS creation from directories is not supported
 *    - Requires implementation of FindFirstFile/FindNextFile directory iteration
 *    - Permissions mapping: Windows ACLs -> Unix permissions (0755/0644)
 *
 * 2. File permissions limitations:
 *    - Windows has no direct equivalent to Unix execute bit
 *    - chmod() is a no-op on Windows, so extracted files lose execute permissions
 *    - See: https://learn.microsoft.com/en-us/cpp/c-runtime-library/reference/chmod-wchmod
 *
 * 3. Symlink limitations:
 *    - Creating symlinks requires admin privileges on Windows
 *    - Fallback to file copying is implemented (see extraction_provider.js)
 *    - See: https://learn.microsoft.com/en-us/windows/win32/fileio/symbolic-links
 *
 * Current status: VFS creation only works on Unix/macOS
 *                VFS extraction works on all platforms (with limitations above)
 */
static int tar_add_directory_recursive(tar_buffer_t *buf, const char *base_path,
                                       const char *rel_path) {
    (void)buf;
    (void)base_path;
    (void)rel_path;
    fprintf(stderr,
            "Error: VFS creation from directories is not supported on Windows\n"
            "  This feature requires Unix/macOS for TAR archive creation.\n"
            "  See tar_create.c for Windows limitations and documentation links.\n");
    return TAR_ERROR_NOT_DIRECTORY;
}
#endif

int tar_create_from_directory(const char *dir_path,
                              uint8_t **output, size_t *output_size) {
    if (!dir_path || !output || !output_size) {
        return TAR_ERROR_ALLOC;
    }

    /* Verify it's a directory */
    struct stat st;
    if (stat(dir_path, &st) != 0) {
        fprintf(stderr, "Error: Cannot stat directory: %s (errno: %d - %s)\n",
                dir_path, errno, strerror(errno));
        return TAR_ERROR_NOT_DIRECTORY;
    }
    if (!S_ISDIR(st.st_mode)) {
        fprintf(stderr, "Error: Not a directory: %s\n", dir_path);
        return TAR_ERROR_NOT_DIRECTORY;
    }

    /* Initialize buffer (start with 1MB) */
    tar_buffer_t buf;
    int rc = tar_buffer_init(&buf, TAR_INITIAL_BUFFER_SIZE);
    if (rc != TAR_OK) return rc;

    printf("Creating TAR archive from: %s\n", dir_path);

    /* Recursively add directory contents */
    rc = tar_add_directory_recursive(&buf, dir_path, "");
    if (rc != TAR_OK) {
        tar_buffer_free(&buf);
        return rc;
    }

    /* Add two zero blocks to mark end of archive */
    uint8_t zero_block[TAR_BLOCK_SIZE] = {0};
    rc = tar_buffer_append(&buf, zero_block, TAR_BLOCK_SIZE);
    if (rc == TAR_OK) {
        rc = tar_buffer_append(&buf, zero_block, TAR_BLOCK_SIZE);
    }

    if (rc != TAR_OK) {
        tar_buffer_free(&buf);
        return rc;
    }

    printf("TAR archive created: %zu bytes\n", buf.size);

    *output = buf.data;
    *output_size = buf.size;
    return TAR_OK;
}

int tar_gz_create_from_directory(const char *dir_path,
                                 uint8_t **output, size_t *output_size,
                                 int level) {
    /* First create uncompressed TAR */
    uint8_t *tar_data = NULL;
    size_t tar_size = 0;

    int rc = tar_create_from_directory(dir_path, &tar_data, &tar_size);
    if (rc != TAR_OK) {
        return rc;
    }

    /* Compress with gzip */
    printf("Compressing TAR archive with gzip (level %d)...\n", level);

    uint8_t *gz_data = NULL;
    size_t gz_size = 0;

    rc = gzip_compress(tar_data, tar_size, &gz_data, &gz_size, level);
    free(tar_data);

    if (rc != GZIP_OK) {
        fprintf(stderr, "Error: gzip compression failed\n");
        return TAR_ERROR;
    }

    printf("Compressed: %zu bytes -> %zu bytes (%.1f%% reduction)\n",
           tar_size, gz_size, 100.0 * (1.0 - (double)gz_size / tar_size));

    *output = gz_data;
    *output_size = gz_size;
    return TAR_OK;
}
