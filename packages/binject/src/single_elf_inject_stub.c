/**
 * ELF binary injection stub for Windows
 *
 * This stub is used on Windows where elf.h is not available.
 * ELF injection on Windows requires LIEF library.
 */

#include "binject.h"
#include <stdio.h>

/**
 * Stub for ELF injection on Windows - always returns unsupported error
 */
int binject_single_elf(const char *executable, const char *output, const char *section_name,
                      const uint8_t *data, size_t size, uint32_t checksum, int is_compressed) {
    (void)executable;
    (void)output;
    (void)section_name;
    (void)data;
    (void)size;
    (void)checksum;
    (void)is_compressed;

    fprintf(stderr, "Error: ELF injection requires LIEF library on Windows\n");
    return BINJECT_ERROR_UNSUPPORTED_PLATFORM;
}
