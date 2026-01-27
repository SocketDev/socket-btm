/**
 * binject_file_utils.hpp - Shared file I/O utilities for binject
 *
 * Provides common file operations to prevent duplication and divergence
 * across Mach-O, ELF, and PE implementations.
 */

#ifndef BINJECT_FILE_UTILS_HPP
#define BINJECT_FILE_UTILS_HPP

#include <cstdio>
#include <cstring>
#include <cerrno>
#include <sys/stat.h>
#include <limits.h>

#ifdef _WIN32
#include <process.h>
#include <io.h>
#ifndef PATH_MAX
#define PATH_MAX 260
#endif
#define unlink _unlink
#define getpid _getpid
#else
#include <unistd.h>
#endif

// Forward declare binject error codes (avoid including binject.h header dependency)
#ifndef BINJECT_OK
#define BINJECT_OK 0
#define BINJECT_ERROR -1
#define BINJECT_ERROR_WRITE_FAILED -9
#endif

// Forward declare C function from binject/file_utils.h
extern "C" int create_parent_directories(const char* path);

namespace binject {

/**
 * Create temporary file path with PID suffix.
 * Pattern: <base_path>.tmp.<pid>
 *
 * @param base_path Original output path
 * @param tmpfile Buffer to store temp path (must be at least PATH_MAX)
 * @param tmpfile_size Size of tmpfile buffer
 */
inline void create_temp_path(const char* base_path, char* tmpfile, size_t tmpfile_size) {
    int written = snprintf(tmpfile, tmpfile_size, "%s.tmp.%d", base_path, getpid());
    if (written < 0 || (size_t)written >= tmpfile_size) {
        fprintf(stderr, "Warning: Temporary path may be truncated\n");
    }
}

/**
 * Verify file was written successfully by LIEF.
 * Checks that file exists and has non-zero size.
 *
 * This is a workaround for LIEF occasionally failing silently.
 * CRITICAL: Must be called after every LIEF write() operation.
 *
 * @param filepath Path to verify
 * @param out_size Optional pointer to receive file size
 * @return BINJECT_OK on success, BINJECT_ERROR_WRITE_FAILED otherwise
 */
inline int verify_file_written(const char* filepath, long* out_size = nullptr) {
    printf("Verifying file was created...\n");

    struct stat st;
    if (stat(filepath, &st) != 0) {
        fprintf(stderr, "Error: LIEF write() failed - file not created: %s\n", filepath);
        fprintf(stderr, "  errno: %d (%s)\n", errno, strerror(errno));
        return BINJECT_ERROR_WRITE_FAILED;
    }

    if (st.st_size == 0) {
        fprintf(stderr, "Error: LIEF write() created empty file\n");
        unlink(filepath);
        return BINJECT_ERROR_WRITE_FAILED;
    }

    printf("  File created successfully (%ld bytes)\n", (long)st.st_size);
    if (out_size) {
        *out_size = st.st_size;
    }

    return BINJECT_OK;
}

/**
 * Set executable permissions on Unix-like systems.
 * No-op on Windows (not applicable).
 *
 * @param filepath Path to file
 * @return BINJECT_OK on success, BINJECT_ERROR_WRITE_FAILED on failure
 */
inline int set_executable_permissions(const char* filepath) {
#ifndef _WIN32
    if (chmod(filepath, 0755) != 0) {
        fprintf(stderr, "Error: Failed to set executable permissions\n");
        unlink(filepath);
        return BINJECT_ERROR_WRITE_FAILED;
    }
#else
    (void)filepath; // Unused on Windows
#endif
    return BINJECT_OK;
}

/**
 * Atomic rename with platform-specific handling.
 *
 * Platform differences:
 * - Windows: Must remove destination before rename (not atomic!)
 * - POSIX: rename() is atomic and overwrites destination
 *
 * @param tmpfile Source (temporary) file path
 * @param output Destination (final) file path
 * @return BINJECT_OK on success, BINJECT_ERROR_WRITE_FAILED on failure
 */
inline int atomic_rename(const char* tmpfile, const char* output) {
#ifdef _WIN32
    // Windows rename() fails if destination exists
    remove(output);
#endif

    if (rename(tmpfile, output) != 0) {
        fprintf(stderr, "Error: Failed to move temporary file to output: %s\n", output);
        fprintf(stderr, "  errno: %d (%s)\n", errno, strerror(errno));
        unlink(tmpfile);
        return BINJECT_ERROR_WRITE_FAILED;
    }

    return BINJECT_OK;
}

/**
 * Complete atomic write workflow for LIEF binaries.
 *
 * Workflow:
 * 1. Create temp file path with PID suffix
 * 2. Write binary to temp file (caller provides write function)
 * 3. Verify temp file was created successfully
 * 4. Set executable permissions (Unix only)
 * 5. Atomic rename to final destination
 *
 * This pattern is used in all Mach-O/ELF/PE injection operations.
 * CRITICAL: Any changes here must be tested on all three platforms.
 *
 * @param output_path Final destination path
 * @param write_callback Function that writes binary to temp file
 * @return BINJECT_OK on success, error code otherwise
 */
inline int atomic_write_workflow(
    const char* output_path,
    int (*write_callback)(const char* tmpfile, void* user_data),
    void* user_data = nullptr
) {
    char tmpfile[PATH_MAX];
    create_temp_path(output_path, tmpfile, sizeof(tmpfile));

    // Create parent directories if needed
    if (create_parent_directories(tmpfile) != 0) {
        fprintf(stderr, "Error: Failed to create parent directories: %s\n", tmpfile);
        return BINJECT_ERROR;
    }

    printf("Writing modified binary to temp file...\n");

    // Caller writes to temp file
    int result = write_callback(tmpfile, user_data);
    if (result != BINJECT_OK) {
        return result;
    }

    // Verify write succeeded
    result = verify_file_written(tmpfile);
    if (result != BINJECT_OK) {
        return result;
    }

    // Set permissions
    result = set_executable_permissions(tmpfile);
    if (result != BINJECT_OK) {
        return result;
    }

    // Atomic rename
    return atomic_rename(tmpfile, output_path);
}

} // namespace binject

#endif // BINJECT_FILE_UTILS_HPP
