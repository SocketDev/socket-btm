/**
 * PE binary injection stub - LIEF-free implementation
 *
 * This is a stub implementation for PE binaries.
 * The full LIEF-based implementation is available in pe_inject.cpp
 * but is not currently needed for macOS-only testing.
 */

#include <stdio.h>
#include "binject.h"

int binject_inject_pe(const char *executable, const char *section_name,
                      const uint8_t *data, size_t size, uint32_t checksum, int is_compressed) {
    (void)executable;
    (void)section_name;
    (void)data;
    (void)size;
    (void)checksum;
    (void)is_compressed;
    fprintf(stderr, "Error: PE injection not implemented in stub version\n");
    return BINJECT_ERROR;
}

int binject_list_pe(const char *executable) {
    (void)executable;
    fprintf(stderr, "Error: PE list operation not implemented in stub version\n");
    return BINJECT_ERROR;
}

int binject_extract_pe(const char *executable, const char *section_name,
                       const char *output_file) {
    (void)executable;
    (void)section_name;
    (void)output_file;
    fprintf(stderr, "Error: PE extract operation not implemented in stub version\n");
    return BINJECT_ERROR;
}

int binject_verify_pe(const char *executable, const char *section_name) {
    (void)executable;
    (void)section_name;
    fprintf(stderr, "Error: PE verify operation not implemented in stub version\n");
    return BINJECT_ERROR;
}
