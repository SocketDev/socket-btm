/**
 * Cross-platform ELF and PE wrapper functions.
 *
 * On non-native platforms, these forward to LIEF implementations.
 * On native platforms (Linux for ELF, Windows for PE), the full
 * implementations in single_elf_inject.c and single_pe_inject.c are used.
 */

#include <stdio.h>
#include "binject.h"

#if !defined(__linux__)
/**
 * ELF list/extract/verify stubs for non-Linux platforms.
 * These are only compiled on macOS and Windows.
 */

int binject_elf_list(const char *executable) {
    fprintf(stderr, "Error: Native ELF list not available on this platform. Use LIEF-based tools instead.\n");
    (void)executable;
    return BINJECT_ERROR_INVALID_FORMAT;
}

int binject_elf_extract(const char *executable, const char *section_name, const char *output_file) {
    fprintf(stderr, "Error: Native ELF extract not available on this platform. Use LIEF-based tools instead.\n");
    (void)executable;
    (void)section_name;
    (void)output_file;
    return BINJECT_ERROR_INVALID_FORMAT;
}

int binject_elf_verify(const char *executable, const char *section_name) {
    fprintf(stderr, "Error: Native ELF verify not available on this platform. Use LIEF-based tools instead.\n");
    (void)executable;
    (void)section_name;
    return BINJECT_ERROR_INVALID_FORMAT;
}
#endif

#if !defined(_WIN32)
/**
 * PE list/extract/verify stubs for non-Windows platforms.
 * These are only compiled on macOS and Linux.
 */

int binject_pe_list(const char *executable) {
    fprintf(stderr, "Error: Native PE list not available on this platform. Use LIEF-based tools instead.\n");
    (void)executable;
    return BINJECT_ERROR_INVALID_FORMAT;
}

int binject_pe_extract(const char *executable, const char *section_name, const char *output_file) {
    fprintf(stderr, "Error: Native PE extract not available on this platform. Use LIEF-based tools instead.\n");
    (void)executable;
    (void)section_name;
    (void)output_file;
    return BINJECT_ERROR_INVALID_FORMAT;
}

int binject_pe_verify(const char *executable, const char *section_name) {
    fprintf(stderr, "Error: Native PE verify not available on this platform. Use LIEF-based tools instead.\n");
    (void)executable;
    (void)section_name;
    return BINJECT_ERROR_INVALID_FORMAT;
}
#endif
