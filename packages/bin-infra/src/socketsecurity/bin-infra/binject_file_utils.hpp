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

extern "C" {
#include "socketsecurity/build-infra/file_io_common.h"
}

// Include posix_compat.h for POSIX_* macros (C++ safe, no namespace conflicts)
#include "socketsecurity/build-infra/posix_compat.h"

#ifdef _WIN32
#include <process.h>
#else
#include <unistd.h>
#endif

// Forward declare binject error codes (avoid including binject.h header dependency)
#ifndef BINJECT_OK
#define BINJECT_OK 0
#define BINJECT_ERROR -1
#define BINJECT_ERROR_WRITE_FAILED -9
#endif

// Forward declare C functions from build-infra/file_utils.h
extern "C" int create_parent_directories(const char* path);
extern "C" int set_executable_permissions(const char* path);

namespace binject {

/**
 * Create temporary file path with PID suffix.
 * Pattern: <base_path>.tmp.<pid>
 *
 * @param base_path Original output path
 * @param tmpfile Buffer to store temp path (must be at least PATH_MAX)
 * @param tmpfile_size Size of tmpfile buffer
 * @return 0 on success, -1 on error (path truncation)
 */
inline int create_temp_path(const char* base_path, char* tmpfile, size_t tmpfile_size) {
    int written = snprintf(tmpfile, tmpfile_size, "%s.tmp.%d", base_path, POSIX_GETPID());
    if (written < 0 || (size_t)written >= tmpfile_size) {
        fprintf(stderr, "Error: Temporary path too long (would be truncated)\n");
        return -1;
    }
    return 0;
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
        POSIX_UNLINK(filepath);
        return BINJECT_ERROR_WRITE_FAILED;
    }

    printf("  File created successfully (%ld bytes)\n", (long)st.st_size);
    if (out_size) {
        *out_size = st.st_size;
    }

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
        POSIX_UNLINK(tmpfile);
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
    if (create_temp_path(output_path, tmpfile, sizeof(tmpfile)) != 0) {
        fprintf(stderr, "Error: Output path too long for temporary file\n");
        return BINJECT_ERROR_WRITE_FAILED;
    }

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
