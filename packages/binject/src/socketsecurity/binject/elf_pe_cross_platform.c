// ============================================================================
// elf_pe_cross_platform.c — Cross-platform ELF and PE wrappers
// ============================================================================
//
// WHAT THIS FILE DOES
// Provides thin wrapper functions that forward ELF (Linux) and PE (Windows)
// list/extract/verify calls to their LIEF-based C++ implementations. This
// lets all platforms handle all binary formats, not just the native one.
//
// WHY IT EXISTS
// You might build on macOS but need to inject into a Linux ELF binary.
// LIEF (a C++ library) can read and write any executable format on any OS.
// These wrappers bridge the C API that binject.h declares to the C++
// functions that call LIEF.
// ============================================================================

/**
 * Cross-platform ELF and PE wrapper functions.
 *
 * All platforms use LIEF-based implementations for ELF and PE support.
 */

#include <stdio.h>
#include "socketsecurity/binject/binject.h"

/* Forward declarations for LIEF-based implementations (C++ functions) */
extern int binject_elf_list_lief(const char *executable);
extern int binject_elf_extract_lief(const char *executable, const char *section_name, const char *output_file);
extern int binject_elf_verify_lief(const char *executable, const char *section_name);
extern int binject_pe_list_lief(const char *executable);
extern int binject_pe_extract_lief(const char *executable, const char *section_name, const char *output_file);
extern int binject_pe_verify_lief(const char *executable, const char *section_name);

/**
 * ELF list/extract/verify wrappers using LIEF.
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

/**
 * PE list/extract/verify wrappers using LIEF.
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
