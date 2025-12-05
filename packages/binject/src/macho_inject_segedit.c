/**
 * Mach-O binary injection using segedit
 *
 * Uses macOS's built-in segedit tool to resize and replace Mach-O sections.
 * This is a simpler alternative to LIEF that works perfectly with pre-created
 * 1-byte placeholder sections.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include "binject.h"

/**
 * Check if segedit is available on the system
 *
 * @return BINJECT_OK if available, error code otherwise
 */
static int check_segedit_available(void) {
    int result = system("which segedit >/dev/null 2>&1");
    if (result != 0) {
        fprintf(stderr, "Error: segedit not found. Please install Xcode Command Line Tools:\n");
        fprintf(stderr, "       xcode-select --install\n");
        return BINJECT_ERROR;
    }
    return BINJECT_OK;
}

/**
 * Inject resource into Mach-O binary using segedit
 *
 * @param executable Path to the Mach-O binary
 * @param segment_name Segment name (e.g., "NODE_SEA")
 * @param section_name Section name (e.g., "__NODE_VFS_BLOB")
 * @param data Resource data to inject
 * @param size Size of resource data
 * @return BINJECT_OK on success, error code otherwise
 */
int binject_inject_macho_segedit(const char *executable, const char *segment_name,
                                   const char *section_name, const uint8_t *data, size_t size) {
    if (!executable || !segment_name || !section_name || !data || size == 0) {
        fprintf(stderr, "Error: Invalid arguments\n");
        return BINJECT_ERROR_INVALID_ARGS;
    }

    // Check if segedit is available before attempting to use it
    int check_result = check_segedit_available();
    if (check_result != BINJECT_OK) {
        return check_result;
    }

    // Create temporary file for the resource data
    char temp_data_file[256];
    snprintf(temp_data_file, sizeof(temp_data_file), "/tmp/binject_data_%d.tmp", getpid());

    // Write data to temp file
    FILE *fp = fopen(temp_data_file, "wb");
    if (!fp) {
        fprintf(stderr, "Error: Failed to create temp file: %s\n", temp_data_file);
        return BINJECT_ERROR;
    }

    size_t written = fwrite(data, 1, size, fp);
    fclose(fp);

    if (written != size) {
        fprintf(stderr, "Error: Failed to write data to temp file\n");
        unlink(temp_data_file);
        return BINJECT_ERROR;
    }

    // Create temporary file for the output binary
    char temp_output_file[512];
    snprintf(temp_output_file, sizeof(temp_output_file), "%s.segedit.tmp", executable);

    // Build segedit command
    // segedit <input> -replace <segment> <section> <datafile> -output <output>
    char command[2048];
    snprintf(command, sizeof(command),
             "segedit \"%s\" -replace %s %s \"%s\" -output \"%s\" 2>&1",
             executable, segment_name, section_name, temp_data_file, temp_output_file);

    // Run segedit
    printf("Running: %s\n", command);
    int result = system(command);

    // Clean up temp data file
    unlink(temp_data_file);

    if (result != 0) {
        fprintf(stderr, "Error: segedit failed with exit code %d\n", result);
        unlink(temp_output_file);
        return BINJECT_ERROR;
    }

    // Replace original file with modified one
    snprintf(command, sizeof(command), "mv \"%s\" \"%s\"", temp_output_file, executable);
    result = system(command);

    if (result != 0) {
        fprintf(stderr, "Error: Failed to replace original file\n");
        unlink(temp_output_file);
        return BINJECT_ERROR;
    }

    printf("Successfully injected %zu bytes into %s:%s\n", size, segment_name, section_name);
    return BINJECT_OK;
}
