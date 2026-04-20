// ============================================================================
// compress_lief.h — Cross-platform compression API using LIEF
// ============================================================================
//
// WHAT THIS FILE DOES
// Declares functions for compressing any executable format on any OS:
// elf_compress_lief(), pe_compress_lief(), and macho_compress_lief().
// Each takes an input binary and produces a self-extracting stub.
//
// WHY IT EXISTS
// You might be building on macOS but need to compress a Linux ELF or
// Windows PE binary. LIEF (a C++ library) can read/write any executable
// format on any platform. These functions expose that cross-compilation
// capability through a clean C interface.
// ============================================================================

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
 * @param algorithm Compression algorithm (unused, always ZSTD)
 * @param target Combined target string (e.g., "linux-x64-musl")
 * @param target_platform Target platform ("linux", "darwin", "win", "win32")
 * @param target_arch Target architecture ("x64", "arm64")
 * @param target_libc Target libc variant ("glibc", "musl", or NULL)
 * @param node_version Node.js version to embed (e.g., "24.12.0", or NULL for auto-detect)
 * @return 0 on success, error code otherwise
 */
int elf_compress_lief(const char* input_path,
                      const char* output_path,
                      int algorithm,
                      const char* target,
                      const char* target_platform,
                      const char* target_arch,
                      const char* target_libc,
                      const char* node_version);

/**
 * Compress PE binary using LIEF (cross-platform).
 *
 * @param input_path Path to input PE binary
 * @param output_path Path to output compressed binary
 * @param algorithm Compression algorithm (unused, always ZSTD)
 * @param target Combined target string (e.g., "win32-x64")
 * @param target_platform Target platform ("linux", "darwin", "win", "win32")
 * @param target_arch Target architecture ("x64", "arm64")
 * @param target_libc Target libc variant (NULL for PE binaries)
 * @param node_version Node.js version to embed (e.g., "24.12.0", or NULL for auto-detect)
 * @return 0 on success, error code otherwise
 */
int pe_compress_lief(const char* input_path,
                     const char* output_path,
                     int algorithm,
                     const char* target,
                     const char* target_platform,
                     const char* target_arch,
                     const char* target_libc,
                     const char* node_version);

/**
 * Compress Mach-O binary using LIEF (cross-platform).
 *
 * @param input_path Path to input Mach-O binary
 * @param output_path Path to output compressed binary
 * @param algorithm Compression algorithm (unused, always ZSTD)
 * @param target Combined target string (e.g., "darwin-arm64")
 * @param target_platform Target platform ("linux", "darwin", "win", "win32")
 * @param target_arch Target architecture ("x64", "arm64")
 * @param target_libc Target libc variant (NULL for Mach-O binaries)
 * @param node_version Node.js version to embed (e.g., "24.12.0", or NULL for auto-detect)
 * @return 0 on success, error code otherwise
 */
int macho_compress_lief(const char* input_path,
                        const char* output_path,
                        int algorithm,
                        const char* target,
                        const char* target_platform,
                        const char* target_arch,
                        const char* target_libc,
                        const char* node_version);

#ifdef __cplusplus
}
#endif

#endif /* COMPRESS_LIEF_H */
