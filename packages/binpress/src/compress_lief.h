/**
 * @file compress_lief.h
 * @brief LIEF-based cross-platform binary compression functions
 *
 * This header declares functions for compressing different binary formats
 * using LIEF library, enabling cross-platform compression:
 * - macOS: Compress ELF and PE binaries
 * - Linux: Compress Mach-O and PE binaries
 * - Windows: Compress Mach-O and ELF binaries
 */

#ifndef COMPRESS_LIEF_H
#define COMPRESS_LIEF_H

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Compress ELF binary using LIEF (cross-platform).
 *
 * @param input_path Path to input ELF binary
 * @param output_path Path to output compressed binary
 * @param algorithm Compression algorithm (COMPRESS_ALGORITHM_*)
 * @return 0 on success, error code otherwise
 */
int elf_compress_lief(const char* input_path,
                      const char* output_path,
                      int algorithm);

/**
 * Compress PE binary using LIEF (cross-platform).
 *
 * @param input_path Path to input PE binary
 * @param output_path Path to output compressed binary
 * @param algorithm Compression algorithm (COMPRESS_ALGORITHM_*)
 * @return 0 on success, error code otherwise
 */
int pe_compress_lief(const char* input_path,
                     const char* output_path,
                     int algorithm);

/**
 * Compress Mach-O binary using LIEF (cross-platform).
 *
 * @param input_path Path to input Mach-O binary
 * @param output_path Path to output compressed binary
 * @param algorithm Compression algorithm (COMPRESS_ALGORITHM_*)
 * @return 0 on success, error code otherwise
 */
int macho_compress_lief(const char* input_path,
                        const char* output_path,
                        int algorithm);

#ifdef __cplusplus
}
#endif

#endif /* COMPRESS_LIEF_H */
