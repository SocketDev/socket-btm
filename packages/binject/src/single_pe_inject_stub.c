/**
 * PE binary injection stub for macOS/Linux.
 *
 * This stub is used on macOS/Linux where windows.h is not available.
 * PE injection on non-Windows platforms requires LIEF library.
 */

#include "binject.h"
#include <stdio.h>

/**
 * Stub for PE injection on macOS/Linux - always returns invalid format error.
 */
int binject_single_pe(const char *executable, const char *output, const char *section_name,
                     const uint8_t *data, size_t size, uint32_t checksum, int is_compressed) {
    (void)executable;
    (void)output;
    (void)section_name;
    (void)data;
    (void)size;
    (void)checksum;
    (void)is_compressed;

    fprintf(stderr, "Error: PE injection requires LIEF library on non-Windows platforms\n");
    return BINJECT_ERROR_INVALID_FORMAT;
}
