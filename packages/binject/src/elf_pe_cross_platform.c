/**
 * Cross-platform ELF and PE wrapper functions.
 *
 * On non-native platforms, these forward to LIEF implementations.
 * On native platforms (Linux for ELF, Windows for PE), the full
 * implementations in single_elf_inject.c and single_pe_inject.c are used.
 */

#include <stdio.h>
#include "binject.h"

/* Forward declarations for LIEF-based implementations (C++ functions) */
extern int binject_elf_list_lief(const char *executable);
extern int binject_elf_extract_lief(const char *executable, const char *section_name, const char *output_file);
extern int binject_elf_verify_lief(const char *executable, const char *section_name);
extern int binject_pe_list_lief(const char *executable);
extern int binject_pe_extract_lief(const char *executable, const char *section_name, const char *output_file);
extern int binject_pe_verify_lief(const char *executable, const char *section_name);

#if !defined(__linux__)
/**
 * ELF list/extract/verify wrappers for non-Linux platforms.
 * These forward to LIEF-based implementations for cross-platform support.
 */

int binject_elf_list(const char *executable) {
    return binject_elf_list_lief(executable);
}

int binject_elf_extract(const char *executable, const char *section_name, const char *output_file) {
    return binject_elf_extract_lief(executable, section_name, output_file);
}

int binject_elf_verify(const char *executable, const char *section_name) {
    return binject_elf_verify_lief(executable, section_name);
}
#endif

#if !defined(_WIN32)
/**
 * PE list/extract/verify wrappers for non-Windows platforms.
 * These forward to LIEF-based implementations for cross-platform support.
 */

int binject_pe_list(const char *executable) {
    return binject_pe_list_lief(executable);
}

int binject_pe_extract(const char *executable, const char *section_name, const char *output_file) {
    return binject_pe_extract_lief(executable, section_name, output_file);
}

int binject_pe_verify(const char *executable, const char *section_name) {
    return binject_pe_verify_lief(executable, section_name);
}
#endif
