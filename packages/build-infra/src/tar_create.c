/**
 * tar_create.c - Create TAR archives from directories
 *
 * Creates POSIX ustar format TAR archives in memory.
 */

#include "tar_create.h"
#include "gzip_compress.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <dirent.h>
#include <time.h>

#ifdef _WIN32
#include <windows.h>
#define PATH_SEP '\\'
#else
#include <unistd.h>
#define PATH_SEP '/'
#endif

/* TAR block size */
#define TAR_BLOCK_SIZE 512

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
    if (buf->size + needed <= buf->capacity) return TAR_OK;

    size_t new_capacity = buf->capacity * 2;
    while (new_capacity < buf->size + needed) {
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
    snprintf(format, sizeof(format), "%%0%zuo", len - 1);
    snprintf((char *)field, len, format, value);
}

/* Create TAR header for a file or directory */
static int tar_create_header(uint8_t *header, const char *name,
                             int is_dir, size_t file_size, time_t mtime) {
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
        if (split >= name_len || (name_len - split - 1) > TAR_NAME_LEN) {
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

    /* Mode: 0755 for dirs, 0644 for files */
    tar_write_octal(header + TAR_MODE_OFF, TAR_MODE_LEN, is_dir ? 0755 : 0644);

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
    strncpy((char *)(header + TAR_UNAME_OFF), "root", TAR_UNAME_LEN);
    strncpy((char *)(header + TAR_GNAME_OFF), "root", TAR_GNAME_LEN);

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
    /* Build full path */
    char full_path[4096];
    snprintf(full_path, sizeof(full_path), "%s%c%s", base_path, PATH_SEP, rel_path);

    /* Get file info */
    struct stat st;
    if (stat(full_path, &st) != 0) {
        fprintf(stderr, "Error: Cannot stat file: %s\n", full_path);
        return TAR_ERROR_READ_FAILED;
    }

    /* Normalize relative path for TAR */
    char tar_path[4096];
    strncpy(tar_path, rel_path, sizeof(tar_path) - 1);
    tar_path[sizeof(tar_path) - 1] = '\0';
    normalize_path(tar_path);

    /* Create header */
    uint8_t header[TAR_BLOCK_SIZE];
    int rc = tar_create_header(header, tar_path, 0, st.st_size, st.st_mtime);
    if (rc != TAR_OK) return rc;

    /* Append header */
    rc = tar_buffer_append(buf, header, TAR_BLOCK_SIZE);
    if (rc != TAR_OK) return rc;

    /* Read and append file content */
    FILE *fp = fopen(full_path, "rb");
    if (!fp) {
        fprintf(stderr, "Error: Cannot open file: %s\n", full_path);
        return TAR_ERROR_READ_FAILED;
    }

    rc = tar_buffer_grow(buf, st.st_size);
    if (rc != TAR_OK) {
        fclose(fp);
        return rc;
    }

    size_t bytes_read = fread(buf->data + buf->size, 1, st.st_size, fp);
    fclose(fp);

    if (bytes_read != (size_t)st.st_size) {
        fprintf(stderr, "Error: Failed to read file: %s\n", full_path);
        return TAR_ERROR_READ_FAILED;
    }

    buf->size += bytes_read;

    /* Pad to block boundary */
    return tar_buffer_pad_to_block(buf);
}

/* Add a directory entry to the TAR buffer */
static int tar_add_directory_entry(tar_buffer_t *buf, const char *rel_path, time_t mtime) {
    /* Normalize path and ensure trailing slash */
    char tar_path[4096];
    strncpy(tar_path, rel_path, sizeof(tar_path) - 2);
    tar_path[sizeof(tar_path) - 2] = '\0';
    normalize_path(tar_path);

    size_t len = strlen(tar_path);
    if (len > 0 && tar_path[len - 1] != '/') {
        tar_path[len] = '/';
        tar_path[len + 1] = '\0';
    }

    /* Create header */
    uint8_t header[TAR_BLOCK_SIZE];
    int rc = tar_create_header(header, tar_path, 1, 0, mtime);
    if (rc != TAR_OK) return rc;

    /* Append header */
    return tar_buffer_append(buf, header, TAR_BLOCK_SIZE);
}

/* Recursively add directory contents to TAR buffer */
static int tar_add_directory_recursive(tar_buffer_t *buf, const char *base_path,
                                       const char *rel_path) {
    char full_path[4096];
    if (rel_path && strlen(rel_path) > 0) {
        snprintf(full_path, sizeof(full_path), "%s%c%s", base_path, PATH_SEP, rel_path);
    } else {
        strncpy(full_path, base_path, sizeof(full_path) - 1);
        full_path[sizeof(full_path) - 1] = '\0';
    }

    DIR *dir = opendir(full_path);
    if (!dir) {
        fprintf(stderr, "Error: Cannot open directory: %s\n", full_path);
        return TAR_ERROR_NOT_DIRECTORY;
    }

    struct dirent *entry;
    int rc = TAR_OK;

    while ((entry = readdir(dir)) != NULL) {
        /* Skip . and .. */
        if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0) {
            continue;
        }

        /* Build relative path for this entry */
        char entry_rel_path[4096];
        if (rel_path && strlen(rel_path) > 0) {
            snprintf(entry_rel_path, sizeof(entry_rel_path), "%s%c%s",
                     rel_path, PATH_SEP, entry->d_name);
        } else {
            strncpy(entry_rel_path, entry->d_name, sizeof(entry_rel_path) - 1);
            entry_rel_path[sizeof(entry_rel_path) - 1] = '\0';
        }

        /* Build full path */
        char entry_full_path[4096];
        snprintf(entry_full_path, sizeof(entry_full_path), "%s%c%s",
                 base_path, PATH_SEP, entry_rel_path);

        /* Get entry info */
        struct stat st;
        if (stat(entry_full_path, &st) != 0) {
            fprintf(stderr, "Warning: Cannot stat: %s (skipping)\n", entry_full_path);
            continue;
        }

        if (S_ISDIR(st.st_mode)) {
            /* Add directory entry */
            rc = tar_add_directory_entry(buf, entry_rel_path, st.st_mtime);
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

int tar_create_from_directory(const char *dir_path,
                              uint8_t **output, size_t *output_size) {
    if (!dir_path || !output || !output_size) {
        return TAR_ERROR_ALLOC;
    }

    /* Verify it's a directory */
    struct stat st;
    if (stat(dir_path, &st) != 0 || !S_ISDIR(st.st_mode)) {
        fprintf(stderr, "Error: Not a directory: %s\n", dir_path);
        return TAR_ERROR_NOT_DIRECTORY;
    }

    /* Initialize buffer (start with 1MB) */
    tar_buffer_t buf;
    int rc = tar_buffer_init(&buf, 1024 * 1024);
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
