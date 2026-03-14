/**
 * smol_repack_lief.h - Shared SMOL segment repack using LIEF
 *
 * Provides common functionality for repacking SMOL segments in Mach-O binaries.
 * Used by both binpress and binject for updating compressed stubs.
 */

#ifndef SMOL_REPACK_LIEF_H
#define SMOL_REPACK_LIEF_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Repack a SMOL segment in a Mach-O binary with new content using LIEF.
 *
 * This function:
 * 1. Parses the stub binary with LIEF
 * 2. Removes the existing SMOL segment
 * 3. Creates a new SMOL segment with updated __PRESSED_DATA section
 * 4. Removes the code signature (will be invalid after changes)
 * 5. Writes the modified binary
 * 6. Signs with ad-hoc signature
 *
 * CRITICAL: Signature removal must happen AFTER segment manipulation to avoid
 * LIEF chained fixups bug that causes segfaults.
 *
 * @param stub_path Path to existing compressed stub binary
 * @param section_data New section data (includes marker, metadata, compressed data)
 * @param section_size Size of new section data in bytes
 * @param output_path Path where modified binary should be written
 * @return 0 on success, -1 on error
 */
int smol_repack_lief(
    const char* stub_path,
    const uint8_t* section_data,
    size_t section_size,
    const char* output_path
);

/**
 * Repack a SMOL section in an ELF binary with new content using LIEF.
 *
 * Similar to smol_repack_lief but for ELF (Linux) binaries.
 * Handles sections instead of segments (no signing required).
 *
 * @param stub_path Path to existing compressed stub binary
 * @param section_data New section data (includes marker, metadata, compressed data)
 * @param section_size Size of new section data in bytes
 * @param output_path Path where modified binary should be written
 * @return 0 on success, -1 on error
 */
int smol_repack_lief_elf(
    const char* stub_path,
    const uint8_t* section_data,
    size_t section_size,
    const char* output_path
);

/**
 * Repack a SMOL section in a PE binary with new content using LIEF.
 *
 * Similar to smol_repack_lief but for PE (Windows) binaries.
 * Removes signature if present (similar to Mach-O).
 *
 * @param stub_path Path to existing compressed stub binary
 * @param section_data New section data (includes marker, metadata, compressed data)
 * @param section_size Size of new section data in bytes
 * @param output_path Path where modified binary should be written
 * @return 0 on success, -1 on error
 */
int smol_repack_lief_pe(
    const char* stub_path,
    const uint8_t* section_data,
    size_t section_size,
    const char* output_path
);

#ifdef __cplusplus
}
#endif

#endif /* SMOL_REPACK_LIEF_H */
