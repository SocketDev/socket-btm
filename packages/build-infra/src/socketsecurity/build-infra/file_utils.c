/**
 * file_utils.c - Common file utilities for binpress
 */

#ifndef _WIN32
#define _GNU_SOURCE
#endif

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <errno.h>
#include <sys/stat.h>   /* For stat(), S_ISDIR, S_ISREG, mkdir(), chmod() */

#ifdef _WIN32
#include <windows.h>
#include <io.h>
#include <direct.h>
#else
#include <fcntl.h>      /* For O_CLOEXEC, O_NOFOLLOW, open() */
#include <unistd.h>     /* For write(), close() */
#include <strings.h>    /* For strcasecmp() on Unix */
#endif

#include "socketsecurity/build-infra/file_utils.h"
#include "socketsecurity/build-infra/file_io_common.h"
#include "socketsecurity/build-infra/debug_common.h"

// Helper macro: check if character is a path separator
#ifdef _WIN32
#define IS_PATH_SEP(c) ((c) == '/' || (c) == '\\')
#else
#define IS_PATH_SEP(c) ((c) == '/')
#endif

/**
 * Create a directory recursively (like mkdir -p).
 *
 * Creates all parent directories as needed, then creates the directory itself.
 * If the directory already exists, returns success (idempotent).
 *
 * @param dirpath Path to the directory to create
 * @return 0 on success, -1 on failure
 */
int mkdir_recursive(const char *dirpath) {
    if (!dirpath) {
        fprintf(stderr, "Error: mkdir_recursive called with NULL dirpath\n");
        fflush(stderr);
        return -1;
    }

    DEBUG_LOG("Creating directory recursively: %s\n", dirpath);

    // Check if directory already exists.
    struct stat st;
    if (stat(dirpath, &st) == 0) {
        if (S_ISDIR(st.st_mode)) {
            DEBUG_LOG("Directory already exists: %s\n", dirpath);
            return 0;
        } else {
            fprintf(stderr, "Error: Path exists but is not a directory: %s\n", dirpath);
            fflush(stderr);
            return -1;
        }
    }

    // Create parent directories first.
    if (create_parent_directories(dirpath) == -1) {
        return -1;
    }

    // Now create the directory itself.
    DEBUG_LOG("Creating directory: %s\n", dirpath);
#ifdef _WIN32
    if (_mkdir(dirpath) != 0) {
#else
    if (mkdir(dirpath, 0755) != 0) {
#endif
        if (errno != EEXIST) {
            fprintf(stderr, "Error: Failed to create directory '%s': %s (errno=%d)\n",
                    dirpath, strerror(errno), errno);
            fflush(stderr);
            return -1;
        }
    }

    DEBUG_LOG("Successfully created directory: %s\n", dirpath);
    return 0;
}

/**
 * Create parent directories for a file path.
 *
 * @param filepath Path to the file whose parent directories should be created
 * @return 0 on success, -1 on failure
 */
int create_parent_directories(const char *filepath) {
    if (!filepath) {
        fprintf(stderr, "Error: create_parent_directories called with NULL filepath\n");
        fflush(stderr);
        return -1;
    }

    DEBUG_LOG("Creating parent directories for: %s\n", filepath);

    // Use safe_dirname() to handle musl/glibc differences
    char *dir = safe_dirname(filepath);
    if (!dir) {
        fprintf(stderr, "Error: Failed to extract directory from path\n");
        fflush(stderr);
        return -1;
    }

    // Check for root directory cases (no parent to create)
    // POSIX: "." or "/"
    // Windows: "." or "/" or "\" or "C:" or "C:\" or "C:/"
    int is_root = (strcmp(dir, ".") == 0 || strcmp(dir, "/") == 0);
#ifdef _WIN32
    is_root = is_root || strcmp(dir, "\\") == 0;
    // Check for drive letter patterns: "C:" or "C:\" or "C:/"
    size_t dir_len_check = strlen(dir);
    if (dir_len_check == 2 && dir[1] == ':') {
        is_root = 1;  // "C:"
    } else if (dir_len_check == 3 && dir[1] == ':' && IS_PATH_SEP(dir[2])) {
        is_root = 1;  // "C:\" or "C:/"
    }
#endif
    if (is_root) {
        DEBUG_LOG("No parent directory to create (dir=%s)\n", dir);
        free(dir);
        return 0;  // No parent directory to create
    }

    DEBUG_LOG("Checking if directory exists: %s\n", dir);

    // Check if directory already exists
    struct stat st;
    if (stat(dir, &st) == 0) {
        if (S_ISDIR(st.st_mode)) {
            DEBUG_LOG("Directory already exists: %s\n", dir);
            free(dir);
            return 0;
        } else {
            fprintf(stderr, "Error: Path exists but is not a directory: %s\n", dir);
            fflush(stderr);
            free(dir);
            return -1;
        }
    }

    DEBUG_LOG("Directory does not exist, need to create: %s\n", dir);

    // Recursively create parent of this directory
    DEBUG_LOG("Recursively creating parent directories for: %s\n", dir);
    int result = create_parent_directories(dir);

    if (result != 0) {
        fprintf(stderr, "Error: Failed to create parent directories for: %s\n", dir);
        fflush(stderr);
        free(dir);
        return -1;
    }

    // Create this directory
    DEBUG_LOG("Creating directory: %s\n", dir);
    #ifdef _WIN32
    if (_mkdir(dir) != 0 && errno != EEXIST) {
    #else
    if (mkdir(dir, 0755) != 0 && errno != EEXIST) {
    #endif
        fprintf(stderr, "Error: Failed to create directory '%s': %s (errno=%d)\n",
                dir, strerror(errno), errno);
        fflush(stderr);
        free(dir);
        return -1;
    }

    DEBUG_LOG("Successfully created directory: %s\n", dir);

    free(dir);
    return 0;
}

/**
 * Ensure output path has .exe extension for PE binaries.
 *
 * Allocates a new string with .exe extension if not present.
 * Caller must free() the returned string.
 *
 * @param path Original path
 * @return Path with .exe extension (caller must free), or NULL on error
 */
char *ensure_exe_extension(const char *path) {
    if (!path) {
        return NULL;
    }

    size_t len = strlen(path);

    // Check if already has .exe extension (case-insensitive)
    if (len >= 4) {
        const char *ext = path + len - 4;
        if (strcasecmp(ext, ".exe") == 0) {
            // Already has .exe, return a copy
            return strdup(path);
        }
    }

    // Need to add .exe extension
    size_t new_len = len + 5;  // +4 for ".exe" +1 for null
    char *new_path = (char *)malloc(new_len);
    if (!new_path) {
        return NULL;
    }

    snprintf(new_path, new_len, "%s.exe", path);
    return new_path;
}

/**
 * Set executable permissions on a file (cross-platform).
 *
 * On Unix: sets 0755 (rwxr-xr-x)
 * On Windows: sets _S_IREAD | _S_IWRITE | _S_IEXEC
 *
 * @param path Path to the file
 * @return 0 on success, -1 on failure
 */
int set_executable_permissions(const char *path) {
    if (!path) {
        return -1;
    }

#ifdef _WIN32
    // Windows: use _chmod with _S_IEXEC flag
    if (_chmod(path, _S_IREAD | _S_IWRITE | _S_IEXEC) != 0) {
        return -1;
    }
#else
    // Unix: use chmod with 0755 (rwxr-xr-x)
    if (chmod(path, 0755) != 0) {
        return -1;
    }
#endif

    return 0;
}

/**
 * Check if a file exists (cross-platform).
 *
 * Uses stat() for portability across musl, glibc, Windows, and macOS.
 *
 * @param path Path to check
 * @return 1 if file exists, 0 if not
 */
int file_exists(const char *path) {
    if (!path) {
        return 0;
    }
    struct stat st;
    return stat(path, &st) == 0;
}

/**
 * Check if a path is a directory (cross-platform).
 *
 * Uses stat() for portability across musl, glibc, Windows, and macOS.
 *
 * @param path Path to check
 * @return 1 if directory exists, 0 if not
 */
int is_directory(const char *path) {
    if (!path) {
        return 0;
    }
    struct stat st;
    if (stat(path, &st) != 0) {
        return 0;
    }
    return S_ISDIR(st.st_mode);
}

/**
 * Safe dirname() implementation that avoids libc dirname().
 *
 * Returns a newly allocated string containing the directory component of path.
 * This implementation does NOT call the system dirname() to avoid musl/glibc
 * compatibility issues.
 *
 * WHY WE DON'T USE LIBC dirname():
 * musl's dirname() has problematic semantics that cause segfaults:
 * https://git.musl-libc.org/cgit/musl/tree/src/misc/dirname.c
 *
 *   char *dirname(char *s) {
 *       ...
 *       if (!s || !*s) return ".";           // Returns read-only string literal
 *       for (; s[i]=='/'; i--) if (!i) return "/";  // Returns read-only literal
 *       for (; s[i]!='/'; i--) if (!i) return ".";  // Returns read-only literal
 *       s[i+1] = 0;                          // MUTATES the input string
 *       return s;
 *   }
 *
 * Issues:
 * 1. Returns string literals ("." or "/") for edge cases - these are in
 *    read-only memory, so callers who modify the result will segfault.
 * 2. Mutates the input string (s[i+1] = 0) - passing a string literal as
 *    input will segfault.
 * 3. Mixed return semantics - sometimes returns modified input, sometimes
 *    returns static literal. Callers can't safely know which they got.
 *
 * glibc's dirname() has different but equally problematic behavior (uses
 * static buffer that gets overwritten on next call).
 *
 * Our implementation always returns a freshly allocated string and never
 * modifies the input, making it safe and predictable across all platforms.
 *
 * Behavior matches POSIX dirname():
 * - NULL or empty -> "."
 * - "/" or "///" -> "/"
 * - "/a" or "/a/" -> "/"
 * - "/a/b" or "/a/b/" -> "/a"
 * - "a" -> "."
 * - "a/b" or "a/b/" -> "a"
 *
 * On Windows, also handles backslashes and drive letters:
 * - "C:\a\b" -> "C:\a"
 * - "C:\" -> "C:\"
 * - "C:" -> "C:"
 *
 * Caller must free() the returned string.
 *
 * @param path Path to extract directory from
 * @return Allocated directory path string, or NULL on allocation error
 */
char *safe_dirname(const char *path) {
    // Handle NULL or empty string
    if (!path || !*path) {
        return strdup(".");
    }

    size_t len = strlen(path);

#ifdef _WIN32
    // Check for Windows drive letter at start (e.g., "C:" or "C:\")
    int has_drive = (len >= 2 && path[1] == ':');
    size_t drive_prefix_len = 0;
    if (has_drive) {
        // Drive letter takes 2 chars, optionally followed by separator
        drive_prefix_len = 2;
        if (len >= 3 && IS_PATH_SEP(path[2])) {
            drive_prefix_len = 3;  // Include the separator in root
        }
    }
#endif

    // Trim trailing path separators (but handle root specially)
    while (len > 1 && IS_PATH_SEP(path[len - 1])) {
#ifdef _WIN32
        // Don't trim past drive root (e.g., "C:\")
        if (has_drive && len <= drive_prefix_len) {
            break;
        }
#endif
        len--;
    }

    // Handle root path "/" or "\" (or "///" which became "/")
    if (len == 1 && IS_PATH_SEP(path[0])) {
        char root[2] = {path[0], '\0'};
        return strdup(root);
    }

#ifdef _WIN32
    // Handle Windows drive root "C:" or "C:\"
    if (has_drive && len <= drive_prefix_len) {
        char *result = (char *)malloc(len + 1);
        if (!result) return NULL;
        memcpy(result, path, len);
        result[len] = '\0';
        return result;
    }
#endif

    // Find the last path separator by scanning backwards from end
    size_t i = len;
    while (i > 0 && !IS_PATH_SEP(path[i - 1])) {
        i--;
    }

    // No separator found -> current directory
    if (i == 0) {
#ifdef _WIN32
        // But if we have a drive letter with no separator, return drive letter
        if (has_drive) {
            return strdup(path);  // Return "C:filename" as-is for dirname "C:"
        }
#endif
        return strdup(".");
    }

    // i now points to position after the last separator, so i-1 is the separator position
    // Trim consecutive separators (e.g., "///" -> single "/")
    size_t dir_len = i - 1;
    while (dir_len > 0 && IS_PATH_SEP(path[dir_len - 1])) {
#ifdef _WIN32
        // Don't trim past drive root
        if (has_drive && dir_len <= drive_prefix_len) {
            break;
        }
#endif
        dir_len--;
    }

    // Handle root directory case (all separators trimmed, or path like "/foo")
    if (dir_len == 0) {
        char root[2] = {path[i - 1], '\0'};  // Use the separator char we found
        return strdup(root);
    }

#ifdef _WIN32
    // Handle Windows drive root case
    if (has_drive && dir_len < drive_prefix_len) {
        dir_len = drive_prefix_len;
    }
#endif

    // Allocate and copy the directory part (without trailing separator)
    char *result = (char *)malloc(dir_len + 1);
    if (!result) {
        return NULL;
    }

    memcpy(result, path, dir_len);
    result[dir_len] = '\0';

    return result;
}

/**
 * Safe basename() implementation that avoids libc basename().
 *
 * Returns a newly allocated string containing the filename component of path.
 * This implementation does NOT call the system basename() to avoid musl/glibc
 * compatibility issues.
 *
 * WHY WE DON'T USE LIBC basename():
 * Similar issues to dirname() - see safe_dirname() comments for details.
 * Additionally, glibc has TWO incompatible basename() functions:
 * - <string.h> version: GNU extension, doesn't modify input
 * - <libgen.h> version: POSIX, may modify input and uses static storage
 * Which one you get depends on #define _GNU_SOURCE and include order.
 *
 * Our implementation always returns a freshly allocated string and never
 * modifies the input, making it safe and predictable across all platforms.
 *
 * Behavior matches POSIX basename():
 * - NULL or empty -> "."
 * - "/" or "///" -> "/"
 * - "/a" or "/a/" -> "a"
 * - "/a/b" or "/a/b/" -> "b"
 * - "a" -> "a"
 * - "a/b" or "a/b/" -> "b"
 *
 * On Windows, also handles backslashes:
 * - "C:\a\b" -> "b"
 * - "C:\" -> "\"
 *
 * Caller must free() the returned string.
 *
 * @param path Path to extract filename from
 * @return Allocated filename string, or NULL on allocation error
 */
char *safe_basename(const char *path) {
    // Handle NULL or empty string
    if (!path || !*path) {
        return strdup(".");
    }

    size_t len = strlen(path);

    // Trim trailing path separators
    while (len > 1 && IS_PATH_SEP(path[len - 1])) {
        len--;
    }

    // Handle root path "/" or "\" (or "///" which became "/")
    if (len == 1 && IS_PATH_SEP(path[0])) {
        char root[2] = {path[0], '\0'};
        return strdup(root);
    }

    // Find the start of the basename by scanning backwards for path separator
    size_t start = len;
    while (start > 0 && !IS_PATH_SEP(path[start - 1])) {
        start--;
    }

    // Calculate basename length
    size_t base_len = len - start;

    // Allocate and copy the basename
    char *result = (char *)malloc(base_len + 1);
    if (!result) {
        return NULL;
    }

    memcpy(result, path + start, base_len);
    result[base_len] = '\0';

    return result;
}

/**
 * Check if a file has .tar.gz or .tgz extension.
 *
 * @param path Path to check
 * @return 1 if file has tar.gz extension, 0 otherwise
 */
int is_tar_gz_file(const char *path) {
    if (!path) return 0;
    size_t len = strlen(path);
    if (len > 7 && strcasecmp(path + len - 7, ".tar.gz") == 0) return 1;
    if (len > 4 && strcasecmp(path + len - 4, ".tgz") == 0) return 1;
    return 0;
}

/**
 * Check if a file has .tar extension (uncompressed tar).
 *
 * @param path Path to check
 * @return 1 if file has .tar extension (but not .tar.gz), 0 otherwise
 */
int is_tar_file(const char *path) {
    if (!path) return 0;
    size_t len = strlen(path);
    /* Must end with .tar but NOT .tar.gz */
    if (len > 4 && strcasecmp(path + len - 4, ".tar") == 0) {
        /* Check it's not .tar.gz */
        if (len > 7 && strcasecmp(path + len - 7, ".tar.gz") == 0) return 0;
        return 1;
    }
    return 0;
}

/**
 * Check if data has gzip magic bytes (0x1F 0x8B).
 *
 * @param data Pointer to data buffer
 * @param size Size of data buffer
 * @return 1 if data starts with gzip magic bytes, 0 otherwise
 */
int is_gzip_data(const uint8_t *data, size_t size) {
    return size >= 2 && data[0] == 0x1F && data[1] == 0x8B;
}

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
int write_file_atomically(const char *path, const unsigned char *data, size_t size, int mode) {
    if (!path) {
        fprintf(stderr, "Error: write_file_atomically called with NULL path\n");
        fflush(stderr);
        return -1;
    }

    if (!data && size > 0) {
        fprintf(stderr, "Error: write_file_atomically called with NULL data but size > 0\n");
        fflush(stderr);
        return -1;
    }

    DEBUG_LOG("Writing %zu bytes to file: %s\n", size, path);

#ifdef _WIN32
    // Windows: Use CreateFileA + WriteFile
    HANDLE hFile = CreateFileA(path, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS,
                               FILE_ATTRIBUTE_NORMAL, NULL);
    if (hFile == INVALID_HANDLE_VALUE) {
        DWORD err = GetLastError();
        fprintf(stderr, "Error: Failed to create file '%s': Windows error %lu (0x%08lX)\n",
                path, (unsigned long)err, (unsigned long)err);
        fflush(stderr);
        return -1;
    }

    uint64_t total_written = 0;
    while (total_written < size) {
        /* WriteFile's dwNumberOfBytesToWrite parameter is DWORD (32-bit unsigned, max 4GB-1).
         * This prevents overflow when size_t (64-bit on x64) exceeds DWORD_MAX.
         * For files >4GB, we write in chunks of at most MAXDWORD bytes per iteration.
         * Without this clamping, casting a large size_t to DWORD would wrap around,
         * causing data corruption or infinite loops. */
        DWORD to_write = (size - total_written > MAXDWORD)
                         ? MAXDWORD
                         : (DWORD)(size - total_written);
        DWORD written;
        if (!WriteFile(hFile, data + total_written, to_write, &written, NULL) || written == 0) {
            DWORD err = GetLastError();
            fprintf(stderr, "Error: Failed to write to file '%s': Windows error %lu (0x%08lX) (wrote %llu/%zu bytes)\n",
                    path, (unsigned long)err, (unsigned long)err,
                    (unsigned long long)total_written, size);
            fflush(stderr);
            CloseHandle(hFile);
            DeleteFileA(path);  // Clean up partial file
            return -1;
        }
        total_written += written;
    }

    /* Flush data to disk before closing to ensure durability.
     * Trade-off: Adds ~10-100ms latency but prevents data loss on power failure.
     * Critical for binary files, config files, and any data where integrity is important.
     * Note: FlushFileBuffers() is roughly equivalent to Unix fsync(). */
    if (!FlushFileBuffers(hFile)) {
        DWORD err = GetLastError();
        fprintf(stderr, "Warning: Failed to flush file '%s' to disk: Windows error %lu (0x%08lX)\n",
                path, (unsigned long)err, (unsigned long)err);
        fflush(stderr);
        // Continue anyway - file was written successfully even if not flushed
    }

    CloseHandle(hFile);
    DEBUG_LOG("Successfully wrote %llu bytes to file: %s\n", (unsigned long long)total_written, path);

#else
    /* Unix: Use open + write with O_NOFOLLOW to prevent TOCTOU attacks via symlinks.
     * O_NOFOLLOW ensures we fail if 'path' is a symlink, preventing attackers from
     * redirecting our write to a different location between the check and use. */
    int fd = open(path, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC | O_NOFOLLOW, mode);
    if (fd == -1) {
        fprintf(stderr, "Error: Failed to create file '%s': %s (errno=%d)\n",
                path, strerror(errno), errno);
        fflush(stderr);
        return -1;
    }

    ssize_t total_written = 0;
    while (total_written < (ssize_t)size) {
        ssize_t n = write(fd, data + total_written, size - total_written);
        if (n <= 0) {
            int saved_errno = errno;
            fprintf(stderr, "Error: Failed to write to file '%s': %s (errno=%d) (wrote %zd/%zu bytes)\n",
                    path, strerror(saved_errno), saved_errno, total_written, size);
            fflush(stderr);
            close(fd);
            unlink(path);  // Clean up partial file
            return -1;
        }
        total_written += n;
    }

    /* Flush data to disk before closing to ensure durability.
     * Trade-off: Adds ~10-100ms latency but prevents data loss on power failure.
     * Critical for binary files, config files, and any data where integrity is important.
     * Note: fsync() forces kernel to write all buffered data to disk. */
    if (fsync(fd) == -1) {
        fprintf(stderr, "Warning: Failed to sync file '%s' to disk: %s (errno=%d)\n",
                path, strerror(errno), errno);
        fflush(stderr);
        // Continue anyway - file was written successfully even if not synced
    }

    close(fd);
    DEBUG_LOG("Successfully wrote %zd bytes to file: %s\n", total_written, path);

#endif

    return 0;
}
