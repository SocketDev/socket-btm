/**
 * @file smol_detect.h
 * @brief SMOL stub detection for all binary formats
 *
 * Provides format-specific detection functions for identifying SMOL compressed stubs.
 * Used by binject for repack detection.
 *
 * Architecture:
 * - Mach-O: Pure C implementation (manual parsing)
 * - ELF: LIEF-based implementation (robust section parsing)
 * - PE: LIEF-based implementation (robust section parsing)
 */

#ifndef SOCKETSECURITY_BINJECT_SMOL_DETECT_H
#define SOCKETSECURITY_BINJECT_SMOL_DETECT_H

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Check if Mach-O binary has __PRESSED_DATA section in SMOL segment.
 *
 * Pure C implementation using manual Mach-O parsing from bin-infra.
 * Used by binject for SMOL stub detection on macOS.
 *
 * @param path Path to binary file
 * @return 1 if found, 0 if not found, -1 on error
 */
int smol_has_pressed_data_macho_impl(const char *path);

/**
 * Check if ELF binary has PRESSED_DATA section using LIEF.
 *
 * LIEF-based implementation for robust ELF parsing.
 * Used by binject for SMOL stub detection on Linux.
 *
 * @param path Path to binary file
 * @return 1 if found, 0 if not found, -1 on error
 */
int smol_has_pressed_data_elf_lief(const char *path);

/**
 * Check if PE binary has PRESSED_DATA section using LIEF.
 *
 * LIEF-based implementation for robust PE parsing.
 * Used by binject for SMOL stub detection on Windows.
 *
 * @param path Path to binary file
 * @return 1 if found, 0 if not found, -1 on error
 */
int smol_has_pressed_data_pe_lief(const char *path);

#ifdef __cplusplus
}
#endif

#endif /* SOCKETSECURITY_BINJECT_SMOL_DETECT_H */
