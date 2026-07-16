// ============================================================================
// vfs_utils.c — VFS archive creation and source detection implementation
// ============================================================================
//
// WHAT THIS FILE DOES
// Implements VFS helper functions: detects source type (directory vs. tar
// vs. tar.gz), creates compressed tar.gz archives from directories, compresses
// plain .tar files, and resolves relative paths. The bottom of the file has
// Windows stubs since VFS creation requires Unix APIs.
//
// WHY IT EXISTS
// Building VFS archives involves filesystem operations, tar creation, and
// gzip compression — all done in C using embedded implementations (no
// shelling out to external tools). This keeps the build fast and portable.
// ============================================================================

/**
 * VFS Utilities Implementation
 *
 * Note: VFS functionality uses embedded tar/gzip implementations and Unix-specific
 * path resolution. Windows stubs are provided at the end of this file.
 */

#ifndef _WIN32

#define _POSIX_C_SOURCE 200809L
#ifdef __APPLE__
#define _DARWIN_C_SOURCE  /* Required for mkstemps() on macOS */
#endif

#include "socketsecurity/binject/vfs_utils.h"
#include "socketsecurity/build-infra/file_io_common.h"
#include "socketsecurity/build-infra/tmpdir_common.h"
#include "socketsecurity/build-infra/tar_create.h"
#include "socketsecurity/build-infra/gzip_compress.h"
#include <errno.h>
#include <fcntl.h>
#include <libgen.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#include <inttypes.h>

/* VFS archive size limits */
#define VFS_MAX_SIZE_BYTES (1024 * 1024 * 1024)  /* 1GB hard limit */
#define VFS_WARN_SIZE_BYTES (100 * 1024 * 1024)  /* 100MB warning threshold */

/* Helper macro to check VFS archive size and warn/error as needed.
 * Returns 1 if size exceeds max (caller should handle error), 0 if OK. */
static inline int vfs_check_size(size_t size, uint8_t *data_to_free) {
    if (size > VFS_MAX_SIZE_BYTES) {
        fprintf(stderr, "Error: VFS archive too large (%zu MB, max 1GB)\n", size / (1024 * 1024));
        if (data_to_free) free(data_to_free);
        return 1;
    }
    if (size > VFS_WARN_SIZE_BYTES) {
        fprintf(stderr, "Warning: VFS archive is large (%zu MB), may impact binary size and startup time\n",
                size / (1024 * 1024));
    }
    return 0;
}

/**
 * Detect VFS source type.
 */
vfs_source_type_t detect_vfs_source_type(const char *path) {
    if (!path) {
        fprintf(stderr, "Error: VFS source path is NULL\n");
        return VFS_SOURCE_ERROR;
    }

    struct stat st;
    if (stat(path, &st) != 0) {
        // Source doesn't exist - return NOT_FOUND so caller can skip VFS gracefully.
        return VFS_SOURCE_NOT_FOUND;
    }

    if (S_ISDIR(st.st_mode)) {
        return VFS_SOURCE_DIR;
    }

    if (S_ISREG(st.st_mode)) {
        size_t len = strlen(path);

        // Check for .tar.gz extension.
        if (len > 7 && strcmp(path + len - 7, ".tar.gz") == 0) {
            return VFS_SOURCE_TAR_GZ;
        }

        // Check for .tar extension.
        if (len > 4 && strcmp(path + len - 4, ".tar") == 0) {
            return VFS_SOURCE_TAR;
        }

        fprintf(stderr, "Error: VFS source must be .tar, .tar.gz, or directory: %s\n", path);
        return VFS_SOURCE_ERROR;
    }

    fprintf(stderr, "Error: Invalid VFS source type: %s\n", path);
    return VFS_SOURCE_ERROR;
}

/**
 * Create TAR.GZ from directory using embedded tar/gzip implementation.
 */
char* create_vfs_archive_from_dir(const char *dir_path) {
    if (!dir_path) {
        fprintf(stderr, "Error: Directory path is NULL\n");
        return NULL;
    }

    printf("Creating VFS archive from directory (gzip level 9)...\n");

    // Create tar.gz in memory using embedded implementation.
    uint8_t *tar_gz_data = NULL;
    size_t tar_gz_size = 0;
    int rc = tar_gz_create_from_directory(dir_path, &tar_gz_data, &tar_gz_size, 9);
    if (rc != TAR_OK) {
        fprintf(stderr, "Error: Failed to create tar.gz archive from directory\n");
        return NULL;
    }

    // Check size limits before writing to disk.
    if (vfs_check_size(tar_gz_size, tar_gz_data)) {
        return NULL;
    }

    // Create temp file with .tar.gz suffix using mkstemps().
    // Use get_tmpdir() to respect TMPDIR/TMP/TEMP environment variables.
    const char *tmpdir = get_tmpdir(NULL);
    char *archive_path = NULL;
    char template[512];
    snprintf(template, sizeof(template), "%s/binject-vfs-XXXXXX.tar.gz", tmpdir);

    // Use mkstemps() to create temp file with suffix (available on Linux, BSD, macOS).
    // The '7' is the length of ".tar.gz" suffix.
    int fd = mkstemps(template, 7);
    if (fd == -1) {
        fprintf(stderr, "Error: Failed to create temp file: %s\n", strerror(errno));
        free(tar_gz_data);
        return NULL;
    }

    // Template is modified in-place by mkstemps() with the final filename.
    // No need to rename - file already has the correct name atomically.
    archive_path = strdup(template);
    if (!archive_path) {
        fprintf(stderr, "Error: Cannot allocate memory\n");
        close(fd);
        unlink(template);
        free(tar_gz_data);
        return NULL;
    }

    // Write tar.gz data to temp file.
    ssize_t written = write_eintr(fd, tar_gz_data, tar_gz_size);

    // Validate write completed successfully before cleanup.
    if (written != (ssize_t)tar_gz_size) {
        fprintf(stderr, "Error: Failed to write tar.gz data to file\n");
        close(fd);
        unlink(archive_path);
        free(archive_path);
        free(tar_gz_data);
        return NULL;
    }

    // Note: Explicit fsync removed to avoid blocking indefinitely.
    // The close() below is sufficient - it flushes buffers to kernel,
    // and the kernel will sync to disk asynchronously.

    // Check close() for errors (can report buffered write failures).
    if (close(fd) != 0) {
        fprintf(stderr, "Error: Failed to close temp file: %s\n", strerror(errno));
        unlink(archive_path);
        free(archive_path);
        free(tar_gz_data);
        return NULL;
    }

    free(tar_gz_data);

    // No rename needed - mkstemps() created file with correct name atomically.

    printf("Created VFS archive (%zu bytes)\n", tar_gz_size);
    return archive_path;
}

/**
 * Compress .tar file to .tar.gz using embedded gzip implementation.
 */
char* compress_tar_archive(const char *tar_path) {
    if (!tar_path) {
        fprintf(stderr, "Error: TAR path is NULL\n");
        return NULL;
    }

    printf("Compressing VFS archive (gzip level 9)...\n");

    // Read input .tar file into memory.
    FILE *f = fopen(tar_path, "rb");
    if (!f) {
        fprintf(stderr, "Error: Cannot open tar file: %s\n", strerror(errno));
        return NULL;
    }

    if (fseek(f, 0, SEEK_END) != 0) {
        fclose(f);
        fprintf(stderr, "Error: Cannot seek to end of tar file: %s\n", strerror(errno));
        return NULL;
    }
    off_t file_size = ftello(f);
    if (file_size < 0) {
        fclose(f);
        fprintf(stderr, "Error: Cannot determine tar file size\n");
        return NULL;
    }
    size_t tar_size = (size_t)file_size;
    if (fseek(f, 0, SEEK_SET) != 0) {
        fclose(f);
        fprintf(stderr, "Error: Cannot seek to start of tar file: %s\n", strerror(errno));
        return NULL;
    }

    uint8_t *tar_data = malloc(tar_size);
    if (!tar_data) {
        fclose(f);
        fprintf(stderr, "Error: Cannot allocate memory for tar data\n");
        return NULL;
    }

    if (fread(tar_data, 1, tar_size, f) != tar_size) {
        fclose(f);
        free(tar_data);
        fprintf(stderr, "Error: Failed to read tar file\n");
        return NULL;
    }
    fclose(f);

    // Compress with gzip using embedded implementation.
    uint8_t *gz_data = NULL;
    size_t gz_size = 0;
    int rc = gzip_compress(tar_data, tar_size, &gz_data, &gz_size, 9);
    free(tar_data);

    if (rc != GZIP_OK) {
        fprintf(stderr, "Error: gzip compression failed\n");
        return NULL;
    }

    // Check size limits before writing to disk.
    if (vfs_check_size(gz_size, gz_data)) {
        return NULL;
    }

    // Create temp file for compressed archive with .tar.gz suffix using mkstemps().
    // Use get_tmpdir() to respect TMPDIR/TMP/TEMP environment variables.
    const char *tmpdir = get_tmpdir(NULL);
    char *compressed_path = NULL;
    char template[512];
    snprintf(template, sizeof(template), "%s/binject-vfs-XXXXXX.tar.gz", tmpdir);

    // Use mkstemps() to create temp file with suffix (available on Linux, BSD, macOS).
    // The '7' is the length of ".tar.gz" suffix.
    int fd = mkstemps(template, 7);
    if (fd == -1) {
        fprintf(stderr, "Error: Failed to create temp file: %s\n", strerror(errno));
        free(gz_data);
        return NULL;
    }

    // Template is modified in-place by mkstemps() with the final filename.
    // No need to rename - file already has the correct name atomically.
    compressed_path = strdup(template);
    if (!compressed_path) {
        fprintf(stderr, "Error: Cannot allocate memory\n");
        close(fd);
        unlink(template);
        free(gz_data);
        return NULL;
    }

    // Write compressed data to temp file.
    ssize_t written = write_eintr(fd, gz_data, gz_size);

    // Validate write completed successfully before cleanup.
    if (written != (ssize_t)gz_size) {
        fprintf(stderr, "Error: Failed to write compressed data to file\n");
        close(fd);
        unlink(compressed_path);
        free(compressed_path);
        free(gz_data);
        return NULL;
    }

    // Note: Explicit fsync removed to avoid blocking indefinitely.
    // The close() below is sufficient for build tooling.

    // Check close() for errors (can report buffered write failures).
    if (close(fd) != 0) {
        fprintf(stderr, "Error: Failed to close temp file: %s\n", strerror(errno));
        unlink(compressed_path);
        free(compressed_path);
        free(gz_data);
        return NULL;
    }

    free(gz_data);

    // No rename needed - mkstemps() created file with correct name atomically.

    printf("Compressed VFS archive (%zu bytes)\n", gz_size);
    return compressed_path;
}

/**
 * Resolve relative path.
 *
 * IMPORTANT: This function is UNIX-ONLY. Uses POSIX dirname() from <libgen.h>
 * and assumes Unix path separators (/). The entire vfs_utils.c file is guarded
 * with #ifndef _WIN32 (line 8) and has Windows stubs at the end.
 *
 * Do NOT use on Windows without complete rewrite to use platform-specific
 * path handling (_splitpath_s, PathRemoveFileSpec, etc.).
 */
char* resolve_relative_path(const char *base_path, const char *source_path) {
    if (!base_path || !source_path) {
        fprintf(stderr, "Error: NULL path provided\n");
        return NULL;
    }

    // If source is absolute, return copy.
    if (source_path[0] == '/') {
        char *result = strdup(source_path);
        if (!result) {
            fprintf(stderr, "Error: Cannot allocate memory\n");
        }
        return result;
    }

    // Get directory of base_path (POSIX dirname() - Unix only).
    char *base_copy = strdup(base_path);
    if (!base_copy) {
        fprintf(stderr, "Error: Cannot allocate memory\n");
        return NULL;
    }

    char *base_dir = dirname(base_copy);

    // Allocate buffer for result.
    size_t result_len = strlen(base_dir) + strlen(source_path) + 2;  // +2 for '/' and '\0'.
    char *result = malloc(result_len);
    if (!result) {
        fprintf(stderr, "Error: Cannot allocate memory\n");
        free(base_copy);
        return NULL;
    }

    // Build resolved path.
    snprintf(result, result_len, "%s/%s", base_dir, source_path);

    free(base_copy);
    return result;
}

/**
 * Get file size.
 */
off_t get_file_size(const char *path) {
    if (!path) {
        return -1;
    }

    struct stat st;
    if (stat(path, &st) != 0) {
        return -1;
    }

    if (!S_ISREG(st.st_mode)) {
        return -1;
    }

    return st.st_size;
}

#else /* _WIN32 */

/**
 * Windows stubs for VFS utilities.
 * VFS functionality requires Unix APIs (fork, exec, tar, gzip) not available on Windows.
 */

#include "socketsecurity/binject/vfs_utils.h"
#include <stdio.h>
#include <sys/stat.h>
#include <inttypes.h>

vfs_source_type_t detect_vfs_source_type(const char *path) {
    (void)path;
    fprintf(stderr, "Error: VFS utilities are not supported on Windows\n");
    return VFS_SOURCE_ERROR;
}

char* create_vfs_archive_from_dir(const char *dir_path) {
    (void)dir_path;
    fprintf(stderr, "Error: VFS archive creation is not supported on Windows\n");
    return NULL;
}

char* compress_tar_archive(const char *tar_path) {
    (void)tar_path;
    fprintf(stderr, "Error: TAR compression is not supported on Windows\n");
    return NULL;
}

char* resolve_relative_path(const char *base_path, const char *source_path) {
    (void)base_path;
    (void)source_path;
    fprintf(stderr, "Error: Path resolution is not supported on Windows\n");
    return NULL;
}

off_t get_file_size(const char *path) {
    if (!path) {
        return -1;
    }

    struct stat st;
    if (stat(path, &st) != 0) {
        return -1;
    }

    if (!(st.st_mode & _S_IFREG)) {
        return -1;
    }

    return st.st_size;
}

#endif /* _WIN32 */
