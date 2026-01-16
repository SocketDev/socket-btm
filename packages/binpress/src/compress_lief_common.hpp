/**
 * Common LIEF compression logic shared across PE, ELF, and Mach-O implementations
 */

#ifndef COMPRESS_LIEF_COMMON_HPP
#define COMPRESS_LIEF_COMMON_HPP

#include <cstddef>

extern "C" {
#include "smol_segment.h"
#include "stub_selector.h"
}

// Platform-specific constants
// PE section characteristics
#define PE_IMAGE_SCN_CNT_INITIALIZED_DATA 0x00000040  // Section contains initialized data
#define PE_IMAGE_SCN_MEM_READ             0x40000000  // Section is readable
#define PE_SMOL_CHARACTERISTICS           (PE_IMAGE_SCN_CNT_INITIALIZED_DATA | PE_IMAGE_SCN_MEM_READ)

// Mach-O VM protection flags (from <mach/vm_prot.h>)
#define VM_PROT_READ    1  // Read permission
#define VM_PROT_WRITE   2  // Write permission
#define VM_PROT_EXECUTE 4  // Execute permission

/**
 * Context for compression operations.
 * Contains stub information and section data.
 */
typedef struct {
  const embedded_stub_t* stub;
  char stub_path[256];
  smol_section_t section;
} compress_context_t;

/**
 * Perform common compression steps 1-3:
 * 1. Select appropriate decompressor stub for input binary
 * 2. Read and compress input binary
 * 3. Build SMOL section data (magic marker + metadata + compressed data)
 *
 * @param input_path Path to input binary
 * @param algorithm Compression algorithm to use
 * @param context Output context with stub info and section data
 * @param target Combined target string (e.g., "linux-x64-musl")
 * @param target_platform Target platform ("linux", "darwin", "win32")
 * @param target_arch Target architecture ("x64", "arm64")
 * @param target_libc Target libc variant ("glibc", "musl", or NULL for auto-detect)
 * @return 0 on success, error code otherwise
 */
int compress_lief_common(
    const char* input_path,
    int algorithm,
    compress_context_t* context,
    const char* target,
    const char* target_platform,
    const char* target_arch,
    const char* target_libc
);

/**
 * Free compression context resources.
 *
 * @param context Context to free
 */
void compress_lief_common_free(compress_context_t* context);

/**
 * Build SMOL section from pre-compressed data.
 * Detects platform metadata and builds section data.
 *
 * This is used by both:
 * - compress_lief_common() for PE/ELF after compression
 * - macho_compress_segment.cpp for pre-compressed data
 *
 * @param compressed_data Compressed data buffer
 * @param compressed_size Size of compressed data
 * @param uncompressed_size Original uncompressed size
 * @param platform_override Platform byte (0xFF = auto-detect)
 * @param arch_override Architecture byte (0xFF = auto-detect)
 * @param libc_override Libc byte (0xFF = auto-detect)
 * @param section Output section data
 * @return 0 on success, error code otherwise
 */
int build_smol_section_from_compressed(
    const uint8_t* compressed_data,
    size_t compressed_size,
    size_t uncompressed_size,
    uint8_t platform_override,
    uint8_t arch_override,
    uint8_t libc_override,
    smol_section_t* section
);

/**
 * Print compression header message.
 *
 * @param format_name Binary format name (e.g., "ELF", "PE", "Mach-O")
 */
void print_compression_header(const char* format_name);

/**
 * Print compression completion message.
 *
 * @param format_name Binary format name (e.g., "ELF", "PE", "Mach-O")
 */
void print_compression_complete(const char* format_name);

/**
 * Print LIEF stub parsing header.
 *
 * @param format_name Binary format name (e.g., "ELF", "PE", "Mach-O")
 */
void print_parsing_stub_header(const char* format_name);

/**
 * Print section/segment creation header.
 *
 * @param section_name Section/segment name (e.g., "SMOL section", "__SMOL segment")
 */
void print_creating_section_header(const char* section_name);

/**
 * Create parent directories for output path with error handling.
 *
 * @param output_path Output file path
 * @param stub_path Temp stub path to cleanup on error
 * @return 0 on success, -1 on error
 */
int ensure_output_directory(const char* output_path, const char* stub_path);

/**
 * Verify that a file was successfully written.
 * LIEF write() may silently fail without throwing exceptions on some platforms.
 *
 * @param file_path Path to verify
 * @return 0 on success, -1 if file doesn't exist
 */
int verify_file_written(const char* file_path);

#endif // COMPRESS_LIEF_COMMON_HPP
