/**
 * @file smol_extract_lief.h
 * @brief SMOL extraction using LIEF
 *
 * Extracts compressed binaries from SMOL stubs by reading the PRESSED_DATA
 * section and decompressing it using LIEF library.
 */

#ifndef SOCKETSECURITY_BINPRESS_SMOL_EXTRACT_LIEF_H
#define SOCKETSECURITY_BINPRESS_SMOL_EXTRACT_LIEF_H

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Extract binary from SMOL compressed stub using LIEF.
 *
 * @param stub_path Path to SMOL compressed stub
 * @param output_path Path where extracted binary should be written
 * @return 0 on success, -1 on error
 */
int smol_extract_binary_lief(const char *stub_path, const char *output_path);

#ifdef __cplusplus
}
#endif

#endif  // SOCKETSECURITY_BINPRESS_SMOL_EXTRACT_LIEF_H
