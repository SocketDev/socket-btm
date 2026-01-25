/**
 * LIEF Write Diagnostics - Cross-platform diagnostic helpers for LIEF binary writes
 *
 * Provides utilities for diagnosing LIEF write failures (particularly on musl):
 * - System resource checks (disk space, memory)
 * - Output directory writability validation
 * - Cross-platform access() function and W_OK constant
 *
 * These diagnostics help identify root causes when LIEF binary->write() fails
 * silently on some platforms (e.g., musl-based systems).
 *
 * Debug output is controlled by the DEBUG environment variable.
 * Set DEBUG=1 to enable diagnostic output.
 */

#ifndef LIEF_WRITE_DIAGNOSTICS_H
#define LIEF_WRITE_DIAGNOSTICS_H

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <sys/stat.h>

// Platform-specific includes for access() function
#ifdef _WIN32
#include <io.h>
#define access _access
#define W_OK 2
#else
#include <unistd.h>
#endif

#include "../../build-infra/src/debug_common.h"

/**
 * Check system resources before attempting LIEF write.
 * Prints disk space and memory information for diagnostic purposes.
 * Only outputs when DEBUG env var is set.
 */
static inline void lief_check_system_resources(void) {
    DEBUG_LOG("Checking system resources...\n");
    if (_debug_enabled) {
        (void)system("df -h . | tail -1");  // Disk space
        DEBUG_LOG("df command completed\n");
        (void)system("free -m | grep Mem || echo 'free command not available'");  // Memory (if available)
        DEBUG_LOG("free command completed\n");
    }
    DEBUG_LOG("lief_check_system_resources() returning\n");
}

/**
 * Verify that the output directory is writable before LIEF write.
 * Returns 0 if writable, -1 if not writable or on error.
 * Debug output controlled by DEBUG env var.
 *
 * @param output_path Full path to the output file
 */
static inline int lief_verify_output_dir_writable(const char* output_path) {
    DEBUG_LOG("Verifying output directory is writable...\n");
    DEBUG_LOG("Output path: %s\n", output_path);

    char dir_path[4096];
    strncpy(dir_path, output_path, sizeof(dir_path) - 1);
    dir_path[sizeof(dir_path) - 1] = '\0';

    char* last_slash = strrchr(dir_path, '/');
    if (last_slash) {
        *last_slash = '\0';
        DEBUG_LOG("Checking directory: %s\n", dir_path);

        // Check if directory exists
        struct stat st;
        if (stat(dir_path, &st) != 0) {
            fprintf(stderr, "Error: Output directory does not exist: %s\n", dir_path);
            fprintf(stderr, "  errno: %d (%s)\n", errno, strerror(errno));
            fflush(stderr);
            return -1;
        }

        if (!S_ISDIR(st.st_mode)) {
            fprintf(stderr, "Error: Path is not a directory: %s\n", dir_path);
            fflush(stderr);
            return -1;
        }

        DEBUG_LOG("Directory exists\n");

        // Check write permissions
        if (access(dir_path, W_OK) != 0) {
            fprintf(stderr, "Error: Output directory not writable: %s\n", dir_path);
            fprintf(stderr, "  errno: %d (%s)\n", errno, strerror(errno));
            fflush(stderr);
            return -1;
        }
        DEBUG_LOG("Directory is writable (access W_OK passed)\n");

        // Try creating a test file to verify we can actually write
        char test_path[4096];
        snprintf(test_path, sizeof(test_path), "%s/.lief_write_test", dir_path);
        FILE* test_file = fopen(test_path, "w");
        if (!test_file) {
            fprintf(stderr, "Error: Cannot create test file in directory: %s\n", dir_path);
            fprintf(stderr, "  errno: %d (%s)\n", errno, strerror(errno));
            fflush(stderr);
            return -1;
        }
        fclose(test_file);
        remove(test_path);
        DEBUG_LOG("Test file write successful\n");
    }

    return 0;
}

#endif // LIEF_WRITE_DIAGNOSTICS_H
