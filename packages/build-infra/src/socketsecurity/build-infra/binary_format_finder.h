/**
 * @file binary_format_finder.h
 * @brief Cross-platform section finders for ELF, PE, and Mach-O binaries.
 *
 * Given an open FILE*, each function walks ONLY the format's headers and
 * section/segment tables — never the full file — and reports the raw file
 * offset and size of the named section.
 *
 * These are format-only primitives: they know nothing about SMOL, SEA, or
 * any particular payload. Higher layers (bin-infra/smol_*, binject, etc.)
 * call them with their own section-name constants.
 *
 * Signed *size fields use uint64_t for ELF (native) and uint32_t for PE
 * (the spec width). Out params are written only on success.
 *
 * Return value for every function:
 *   0 on success (*offset_out and *size_out are set)
 *  -1 on "not found" or any header/IO error
 */

#ifndef SOCKETSECURITY_BUILD_INFRA_BINARY_FORMAT_FINDER_H
#define SOCKETSECURITY_BUILD_INFRA_BINARY_FORMAT_FINDER_H

#include <stdint.h>
#include <stdio.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Find an ELF section by name.
 *
 * Looks up the name in the section header string table (.shstrtab), then
 * returns the matching section's sh_offset and sh_size. Handles both
 * ELFCLASS32 and ELFCLASS64.
 *
 * @param fp         Open file positioned anywhere (will be seeked).
 * @param name       Null-terminated section name (e.g., ".PRESSED_DATA").
 * @param offset_out Set to sh_offset on success.
 * @param size_out   Set to sh_size on success.
 * @return 0 on success, -1 on not found or error.
 */
int bf_find_elf_section(FILE *fp,
                        const char *name,
                        int64_t *offset_out,
                        uint64_t *size_out);

/**
 * Find a PE section by name prefix.
 *
 * PE stores section names in an 8-byte null-padded slot, so long names
 * are truncated (e.g., ".PRESSED_DATA" becomes ".PRESSED"). Callers
 * should pass the 8-char prefix they expect to see on disk.
 *
 * @param fp         Open file positioned anywhere (will be seeked).
 * @param name8      Up to 8 chars, null-padded at the end if shorter.
 * @param offset_out Set to PointerToRawData on success.
 * @param size_out   Set to SizeOfRawData on success.
 * @return 0 on success, -1 on not found or error.
 */
int bf_find_pe_section(FILE *fp,
                       const char name8[8],
                       int64_t *offset_out,
                       uint32_t *size_out);

/**
 * Find a Mach-O section inside a named segment.
 *
 * Both segname and sectname are the 16-char load-command names (use
 * null padding for shorter values). On 64-bit Mach-O the sh layout
 * differs; this function picks the right offsets internally.
 *
 * @param fp          Open file positioned anywhere (will be seeked).
 * @param segname     Segment name, e.g., "SMOL" (null-padded).
 * @param sectname    Section name, e.g., "__PRESSED_DATA" (null-padded).
 * @param offset_out  Set to section file offset on success.
 * @param size_out    Set to section size on success.
 * @return 0 on success, -1 on not found or error.
 */
int bf_find_macho_section(FILE *fp,
                          const char *segname,
                          const char *sectname,
                          int64_t *offset_out,
                          uint64_t *size_out);

#ifdef __cplusplus
}
#endif

#endif /* SOCKETSECURITY_BUILD_INFRA_BINARY_FORMAT_FINDER_H */
