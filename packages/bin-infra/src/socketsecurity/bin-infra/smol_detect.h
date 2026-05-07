/**
 * @file smol_detect.h
 * @brief SMOL stub detection for all binary formats
 *
 * Provides format-specific detection functions for identifying SMOL compressed stubs.
 * Used by binject for repack detection and potentially by binpress/binflate for
 * their own stub detection needs.
 *
 * Architecture:
 * - Pure C implementations (smol_has_pressed_data_*_impl) for all three
 *   formats in smol_segment_reader.c — these are preferred and avoid
 *   the ~30-60ms LIEF parse cost for a yes/no detection check.
 * - LIEF fallbacks (smol_has_pressed_data_*_lief) in smol_detect_lief.cpp
 *   are kept for compatibility and for the content-searching variants
 *   (smol_has_compressed_data_*_lief) that also inspect section bytes.
 */

#ifndef SOCKETSECURITY_BIN_INFRA_SMOL_DETECT_H
#define SOCKETSECURITY_BIN_INFRA_SMOL_DETECT_H

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Check if Mach-O binary has __PRESSED_DATA section in SMOL segment.
 *
 * Pure C implementation using manual Mach-O parsing from bin-infra.
 * Used by binject for SMOL stub detection on any host.
 *
 * @param path Path to binary file
 * @return 1 if found, 0 if not found, -1 on error
 */
int smol_has_pressed_data_macho_impl(const char *path);

/**
 * Check if ELF binary has .PRESSED_DATA section.
 *
 * Pure C implementation using manual ELF parsing from bin-infra.
 * Walks only the section header + string table (KBs, not MBs) so it's
 * ~30-60ms faster than the LIEF variant on a 25MB binary.
 *
 * @param path Path to binary file
 * @return 1 if found, 0 if not found, -1 on error
 */
int smol_has_pressed_data_elf_impl(const char *path);

/**
 * Check if PE binary has .PRESSED_DATA section.
 *
 * Pure C implementation using manual PE header parsing from bin-infra.
 * Walks only the DOS/PE headers + section table (small) so it's
 * ~30-60ms faster than the LIEF variant on a 25MB binary.
 *
 * @param path Path to binary file
 * @return 1 if found, 0 if not found, -1 on error
 */
int smol_has_pressed_data_pe_impl(const char *path);

/**
 * Check if ELF binary has PRESSED_DATA section using LIEF.
 *
 * LIEF-based fallback. Prefer smol_has_pressed_data_elf_impl for the
 * yes/no detection check.
 *
 * @param path Path to binary file
 * @return 1 if found, 0 if not found, -1 on error
 */
int smol_has_pressed_data_elf_lief(const char *path);

/**
 * Check if PE binary has PRESSED_DATA section using LIEF.
 *
 * LIEF-based fallback. Prefer smol_has_pressed_data_pe_impl for the
 * yes/no detection check.
 *
 * @param path Path to binary file
 * @return 1 if found, 0 if not found, -1 on error
 */
int smol_has_pressed_data_pe_lief(const char *path);

/**
 * Check if Mach-O binary has compressed data in __PRESSED_DATA section using LIEF.
 *
 * Reads section content directly via LIEF and searches for magic marker.
 * This eliminates arbitrary search size limits by reading exact section content.
 *
 * @param path Path to binary file
 * @param marker_part1 First part of magic marker
 * @param marker_part2 Second part of magic marker
 * @param marker_part3 Third part of magic marker
 * @return 1 if compressed data found, 0 if not found, -1 on error
 */
int smol_has_compressed_data_macho_lief(const char *path,
                                         const char *marker_part1,
                                         const char *marker_part2,
                                         const char *marker_part3);

/**
 * Check if ELF binary has compressed data in PRESSED_DATA section using LIEF.
 *
 * Reads section content directly via LIEF and searches for magic marker.
 *
 * @param path Path to binary file
 * @param marker_part1 First part of magic marker
 * @param marker_part2 Second part of magic marker
 * @param marker_part3 Third part of magic marker
 * @return 1 if compressed data found, 0 if not found, -1 on error
 */
int smol_has_compressed_data_elf_lief(const char *path,
                                       const char *marker_part1,
                                       const char *marker_part2,
                                       const char *marker_part3);

/**
 * Check if PE binary has compressed data in PRESSED_DATA section using LIEF.
 *
 * Reads section content directly via LIEF and searches for magic marker.
 *
 * @param path Path to binary file
 * @param marker_part1 First part of magic marker
 * @param marker_part2 Second part of magic marker
 * @param marker_part3 Third part of magic marker
 * @return 1 if compressed data found, 0 if not found, -1 on error
 */
int smol_has_compressed_data_pe_lief(const char *path,
                                      const char *marker_part1,
                                      const char *marker_part2,
                                      const char *marker_part3);

/**
 * Extract Node.js version from binary using multiple strategies.
 *
 * Attempts version extraction in order:
 * 1. Stub: PRESSED_DATA section with SMFG config (node_version in config)
 * 2. node-smol: SMOL_NODE_VER section (embedded during node-smol build)
 * 3. PE: VS_VERSION_INFO resource (standard Windows version info for plain Node.js)
 * 4. All: SMOL_CONFIG section (works for injected binaries)
 *
 * @param binary_path Path to node-smol or Node.js binary
 * @return Node version string (e.g., "25.5.0"), or NULL if not found.
 *         Caller must free() the returned string.
 */
char* smol_extract_node_version(const char* binary_path);

#ifdef __cplusplus
}
#endif

#endif /* SOCKETSECURITY_BIN_INFRA_SMOL_DETECT_H */
