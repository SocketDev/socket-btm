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
 * @param target Combined target string (e.g., "linux-x64-musl")
 * @param target_platform Target platform ("linux", "darwin", "win", "win32")
 * @param target_arch Target architecture ("x64", "arm64")
 * @param target_libc Target libc variant ("glibc", "musl", or NULL)
 * @return 0 on success, error code otherwise
 */
int elf_compress_lief(const char* input_path,
                      const char* output_path,
                      int algorithm,
                      const char* target,
                      const char* target_platform,
                      const char* target_arch,
                      const char* target_libc);

/**
 * Compress PE binary using LIEF (cross-platform).
 *
 * @param input_path Path to input PE binary
 * @param output_path Path to output compressed binary
 * @param algorithm Compression algorithm (COMPRESS_ALGORITHM_*)
 * @param target Combined target string (e.g., "win32-x64")
 * @param target_platform Target platform ("linux", "darwin", "win", "win32")
 * @param target_arch Target architecture ("x64", "arm64")
 * @param target_libc Target libc variant (NULL for PE binaries)
 * @return 0 on success, error code otherwise
 */
int pe_compress_lief(const char* input_path,
                     const char* output_path,
                     int algorithm,
                     const char* target,
                     const char* target_platform,
                     const char* target_arch,
                     const char* target_libc);

/**
 * Compress Mach-O binary using LIEF (cross-platform).
 *
 * @param input_path Path to input Mach-O binary
 * @param output_path Path to output compressed binary
 * @param algorithm Compression algorithm (COMPRESS_ALGORITHM_*)
 * @param target Combined target string (e.g., "darwin-arm64")
 * @param target_platform Target platform ("linux", "darwin", "win", "win32")
 * @param target_arch Target architecture ("x64", "arm64")
 * @param target_libc Target libc variant (NULL for Mach-O binaries)
 * @return 0 on success, error code otherwise
 */
int macho_compress_lief(const char* input_path,
                        const char* output_path,
                        int algorithm,
                        const char* target,
                        const char* target_platform,
                        const char* target_arch,
                        const char* target_libc);

#ifdef __cplusplus
}
#endif

#endif /* COMPRESS_LIEF_H */
