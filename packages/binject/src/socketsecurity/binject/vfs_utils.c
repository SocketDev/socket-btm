/**
 * VFS Utilities Implementation
 */

#define _POSIX_C_SOURCE 200809L

#include "socketsecurity/binject/vfs_utils.h"
#include "socketsecurity/build-infra/file_io_common.h"
#include <errno.h>
#include <fcntl.h>
#include <libgen.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

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
 * Create TAR.GZ from directory.
 */
char* create_vfs_archive_from_dir(const char *dir_path) {
    if (!dir_path) {
        fprintf(stderr, "Error: Directory path is NULL\n");
        return NULL;
    }

    // Create temp file for archive (without suffix, will rename).
    char template[] = "/tmp/binject-vfs-XXXXXX";
    int fd = mkstemp(template);
    if (fd == -1) {
        fprintf(stderr, "Error: Failed to create temp file: %s\n", strerror(errno));
        return NULL;
    }
    // Prevent file descriptor/handle leaks to child processes (cross-platform).
    file_io_set_cloexec(fd);
    close(fd);

    // Rename to add .tar.gz suffix.
    size_t template_len = strlen(template);
    char *archive_path = malloc(template_len + 8);  // +8 for ".tar.gz\0".
    if (!archive_path) {
        fprintf(stderr, "Error: Cannot allocate memory\n");
        unlink(template);
        return NULL;
    }
    snprintf(archive_path, template_len + 8, "%s.tar.gz", template);

    if (rename(template, archive_path) != 0) {
        fprintf(stderr, "Error: Failed to rename temp file: %s\n", strerror(errno));
        unlink(template);
        free(archive_path);
        return NULL;
    }

    // Create tar.gz archive using fork/execve (secure, no shell injection).
    printf("Creating VFS archive from directory (gzip level 9): %s\n", archive_path);

    pid_t pid = fork();
    if (pid == -1) {
        fprintf(stderr, "Error: fork() failed: %s\n", strerror(errno));
        unlink(archive_path);
        free(archive_path);
        return NULL;
    }

    if (pid == 0) {
        // Child process: execute tar with proper argument array (no shell).
        char *argv[] = {
            "tar",
            "-czf",
            archive_path,
            "-C",
            (char*)dir_path,
            ".",
            NULL
        };
        char *envp[] = {
            "GZIP=-9",
            NULL
        };
        execve("/usr/bin/tar", argv, envp);
        // If execve fails, try /bin/tar.
        execve("/bin/tar", argv, envp);
        fprintf(stderr, "Error: execve() failed: %s\n", strerror(errno));
        _exit(1);
    }

    // Parent process: wait for child.
    int status;
    if (waitpid(pid, &status, 0) == -1) {
        fprintf(stderr, "Error: waitpid() failed: %s\n", strerror(errno));
        unlink(archive_path);
        free(archive_path);
        return NULL;
    }

    if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) {
        fprintf(stderr, "Error: Failed to create VFS archive (exit code %d)\n",
                WIFEXITED(status) ? WEXITSTATUS(status) : -1);
        unlink(archive_path);
        free(archive_path);
        return NULL;
    }

    long size = get_file_size(archive_path);
    if (size < 0) {
        fprintf(stderr, "Error: Cannot determine archive size\n");
        unlink(archive_path);
        free(archive_path);
        return NULL;
    }

    printf("Created VFS archive (%ld bytes)\n", size);

    // Warn if archive is large.
    if (size > 100 * 1024 * 1024) {  // 100MB.
        fprintf(stderr, "Warning: VFS archive is large (%ld MB), may impact binary size and startup time\n",
                size / (1024 * 1024));
    }

    // Error if archive is too large.
    if (size > 1024 * 1024 * 1024) {  // 1GB.
        fprintf(stderr, "Error: VFS archive too large (%ld MB, max 1GB)\n", size / (1024 * 1024));
        unlink(archive_path);
        free(archive_path);
        return NULL;
    }

    return archive_path;
}

/**
 * Compress .tar file to .tar.gz.
 */
char* compress_tar_archive(const char *tar_path) {
    if (!tar_path) {
        fprintf(stderr, "Error: TAR path is NULL\n");
        return NULL;
    }

    // Create temp file for compressed archive (without suffix, will rename).
    char template[] = "/tmp/binject-vfs-XXXXXX";
    int fd = mkstemp(template);
    if (fd == -1) {
        fprintf(stderr, "Error: Failed to create temp file: %s\n", strerror(errno));
        return NULL;
    }
    // Prevent file descriptor/handle leaks to child processes (cross-platform).
    file_io_set_cloexec(fd);
    close(fd);

    // Rename to add .tar.gz suffix.
    size_t template_len = strlen(template);
    char *compressed_path = malloc(template_len + 8);  // +8 for ".tar.gz\0".
    if (!compressed_path) {
        fprintf(stderr, "Error: Cannot allocate memory\n");
        unlink(template);
        return NULL;
    }
    snprintf(compressed_path, template_len + 8, "%s.tar.gz", template);

    if (rename(template, compressed_path) != 0) {
        fprintf(stderr, "Error: Failed to rename temp file: %s\n", strerror(errno));
        unlink(template);
        free(compressed_path);
        return NULL;
    }

    // Compress with gzip using fork/execve (secure, no shell injection).
    printf("Compressing VFS archive (gzip level 9): %s\n", compressed_path);

    pid_t pid = fork();
    if (pid == -1) {
        fprintf(stderr, "Error: fork() failed: %s\n", strerror(errno));
        unlink(compressed_path);
        free(compressed_path);
        return NULL;
    }

    if (pid == 0) {
        // Child process: redirect stdout to compressed_path, then execute gzip.
        int out_fd = open(compressed_path, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0644);
        if (out_fd == -1) {
            fprintf(stderr, "Error: Cannot open output file: %s\n", strerror(errno));
            _exit(1);
        }

        if (dup2(out_fd, STDOUT_FILENO) == -1) {
            fprintf(stderr, "Error: dup2() failed: %s\n", strerror(errno));
            close(out_fd);
            _exit(1);
        }
        close(out_fd);

        // Execute gzip with proper argument array (no shell).
        char *argv[] = {
            "gzip",
            "-9",
            "-c",
            (char*)tar_path,
            NULL
        };
        execve("/usr/bin/gzip", argv, NULL);
        // If execve fails, try /bin/gzip.
        execve("/bin/gzip", argv, NULL);
        fprintf(stderr, "Error: execve() failed: %s\n", strerror(errno));
        _exit(1);
    }

    // Parent process: wait for child.
    int status;
    if (waitpid(pid, &status, 0) == -1) {
        fprintf(stderr, "Error: waitpid() failed: %s\n", strerror(errno));
        unlink(compressed_path);
        free(compressed_path);
        return NULL;
    }

    if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) {
        fprintf(stderr, "Error: Failed to compress VFS archive (exit code %d)\n",
                WIFEXITED(status) ? WEXITSTATUS(status) : -1);
        unlink(compressed_path);
        free(compressed_path);
        return NULL;
    }

    long size = get_file_size(compressed_path);
    if (size < 0) {
        fprintf(stderr, "Error: Cannot determine compressed archive size\n");
        unlink(compressed_path);
        free(compressed_path);
        return NULL;
    }

    printf("Compressed VFS archive (%ld bytes)\n", size);

    // Warn if archive is large.
    if (size > 100 * 1024 * 1024) {  // 100MB.
        fprintf(stderr, "Warning: VFS archive is large (%ld MB), may impact binary size and startup time\n",
                size / (1024 * 1024));
    }

    // Error if archive is too large.
    if (size > 1024 * 1024 * 1024) {  // 1GB.
        fprintf(stderr, "Error: VFS archive too large (%ld MB, max 1GB)\n", size / (1024 * 1024));
        unlink(compressed_path);
        free(compressed_path);
        return NULL;
    }

    return compressed_path;
}

/**
 * Resolve relative path.
 */
char* resolve_relative_path(const char *base_path, const char *source_path) {
    if (!base_path || !source_path) {
        fprintf(stderr, "Error: NULL path provided\n");
        return NULL;
    }

    // If source is absolute, return copy.
    if (source_path[0] == '/') {
        return strdup(source_path);
    }

    // Get directory of base_path.
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
long get_file_size(const char *path) {
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

    return (long)st.st_size;
}
