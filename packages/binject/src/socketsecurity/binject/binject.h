// ============================================================================
// binject.h — Public API for binary resource injection
// ============================================================================
//
// WHAT THIS FILE DOES
// Declares the complete public interface for binject: functions to inject,
// extract, list, and verify named data sections inside compiled executables.
// Every other .c file in this package includes this header.
//
// WHY IT EXISTS
// Node.js Single Executable Applications (SEA) need to bundle a JavaScript
// blob and an optional Virtual File System (VFS) archive inside the binary.
// This header defines a portable C API that works across macOS (Mach-O),
// Linux (ELF), and Windows (PE) executables. C is used instead of JS because
// modifying executable file formats requires byte-level control that is
// impractical in a garbage-collected language.
//
// KEY CONCEPTS FOR JS DEVELOPERS
// - Binary injection = inserting named data segments into compiled executables,
//     similar to adding entries to a ZIP file but for .exe/.app binaries.
// - ELF (Linux), Mach-O (macOS), PE (Windows) are different executable
//     formats — think of them as different "file types" for programs.
// - LIEF is a C++ library that reads/writes these formats — it is the
//     workhorse behind most inject/extract operations here.
// - SEA blob = the JavaScript app bundled for single-executable deployment.
// - VFS archive = a .tar.gz of node_modules embedded in the binary.
// - #define: A compile-time constant, like `const` in JS but resolved before
//     the code is compiled. Used here for error codes and version numbers.
// - typedef enum: Defines a set of named integer constants (like a TS enum).
// - uint8_t* / size_t: A pointer to raw bytes and its length — the C
//     equivalent of passing a Buffer and its .length in Node.js.
// - Return codes: C functions return integers to signal success (0) or
//     specific error conditions (negative numbers). There are no exceptions.
// ============================================================================

/**
 * binject - Pure C alternative to postject
 *
 * Inject arbitrary resources into executables (Mach-O, ELF, PE)
 */

#ifndef BINJECT_H
#define BINJECT_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Version */
#define BINJECT_VERSION_MAJOR 0
#define BINJECT_VERSION_MINOR 0
#define BINJECT_VERSION_PATCH 0

/* Return codes */
#define BINJECT_OK 0
#define BINJECT_ERROR -1
#define BINJECT_ERROR_INVALID_ARGS -2
#define BINJECT_ERROR_FILE_NOT_FOUND -3
#define BINJECT_ERROR_INVALID_FORMAT -4
#define BINJECT_ERROR_SECTION_EXISTS -5
#define BINJECT_ERROR_SECTION_NOT_FOUND -6
#define BINJECT_ERROR_COMPRESSION_FAILED -7
#define BINJECT_ERROR_DECOMPRESSION_FAILED -8
#define BINJECT_ERROR_WRITE_FAILED -9
#define BINJECT_ERROR_PERMISSION_DENIED -10

/* Binary format detection */
typedef enum {
    BINJECT_FORMAT_UNKNOWN = 0,
    BINJECT_FORMAT_MACHO,
    BINJECT_FORMAT_ELF,
    BINJECT_FORMAT_PE
} binject_format_t;

/* CLI commands */
int binject_single(const char *executable, const char *output, const char *resource_file,
                   const char *section_name);
int binject_batch(const char *executable, const char *output,
                         const char *sea_resource, const char *vfs_resource,
                         int vfs_in_memory, int skip_repack, const uint8_t *vfs_config_data);
int binject_list(const char *executable);
int binject_extract(const char *executable, const char *section_name,
                    const char *output_file);
int binject_verify(const char *executable, const char *section_name);

/* Core operations */
binject_format_t binject_detect_format(const char *executable);
int binject_read_resource(const char *resource_file, uint8_t **data, size_t *size);
int binject_write_resource(const char *executable, const char *section_name,
                           const uint8_t *data, size_t size);

/* Compressed binary cache support */
int binject_is_compressed_stub(const char *executable);
int binject_is_compressed_stub_lief(const char *executable);
int binject_extract_stub_to_cache(const char *compressed_stub, const char *extracted_path);
int binject_get_extracted_path(const char *compressed_stub, char *extracted_path, size_t path_size);

/* SMOL stub extraction and detection support */
int smol_extract_binary_lief(const char *stub_path, const char *output_path);
char* smol_extract_node_version(const char *binary_path);

/* Compression */
int binject_compress(const uint8_t *input, size_t input_size,
                    uint8_t **output, size_t *output_size);
int binject_decompress(const uint8_t *input, size_t input_size,
                      uint8_t **output, size_t *output_size);

/* Checksum */
uint32_t binject_checksum(const uint8_t *data, size_t size);

/* Platform-specific operations - Mach-O */
int binject_macho_lief(const char *executable, const char *segment_name,
                       const char *section_name, const uint8_t *data, size_t size);
int binject_macho_lief_batch(const char *executable,
                              const char *output,
                              const uint8_t *sea_data, size_t sea_size,
                              const uint8_t *vfs_data, size_t vfs_size,
                              int vfs_compat_mode,
                              const uint8_t *vfs_config_data);
int binject_macho_list_lief(const char *executable);
int binject_macho_extract_lief(const char *executable, const char *section_name, const char *output_file);
int binject_macho_verify_lief(const char *executable, const char *section_name);

int binject_macho(const char *executable, const char *segment_name,
                  const char *section_name, const uint8_t *data, size_t size);
int binject_macho_list(const char *executable);
int binject_macho_extract(const char *executable, const char *section_name,
                          const char *output_file);
int binject_macho_verify(const char *executable, const char *section_name);
int binject_macho_repack_smol(const char *stub_path, const uint8_t *section_data,
                               size_t section_size, const char *output_path,
                               const char *extracted_source_path);
int binject_macho_repack_smol_lief(const char *stub_path, const uint8_t *section_data,
                                    size_t section_size, const char *output_path,
                                    const char *extracted_source_path);

/* Platform-specific operations - ELF (LIEF cross-platform) */
int binject_elf_lief(const char *executable, const char *section_name,
                     const uint8_t *data, size_t size);
int binject_elf_lief_batch(const char *executable, const char *output,
                            const uint8_t *sea_data, size_t sea_size,
                            const uint8_t *vfs_data, size_t vfs_size,
                            int vfs_compat_mode,
                            const uint8_t *vfs_config_data);

/* Platform-specific operations - ELF */
int binject_single_elf(const char *executable, const char *output, const char *section_name,
                               const uint8_t *data, size_t size, uint32_t checksum, int is_compressed);
int binject_batch_elf(const char *executable, const char *output,
                       const uint8_t *sea_data, size_t sea_size,
                       const uint8_t *vfs_data, size_t vfs_size,
                       int vfs_compat_mode,
                       const uint8_t *vfs_config_data);
int binject_elf_list(const char *executable);
int binject_elf_extract(const char *executable, const char *section_name,
                        const char *output_file);
int binject_elf_verify(const char *executable, const char *section_name);

/* ELF PHT restoration (fix LIEF relocation) */
int binject_elf_restore_phdr_offset(const char *binary_path, uint64_t original_phoff);

/* Platform-specific operations - PE (LIEF cross-platform) */
int binject_pe_lief(const char *executable, const char *section_name,
                    const uint8_t *data, size_t size);
int binject_pe_lief_batch(const char *executable, const char *output,
                           const uint8_t *sea_data, size_t sea_size,
                           const uint8_t *vfs_data, size_t vfs_size,
                           int vfs_compat_mode,
                           const uint8_t *vfs_config_data);

/* Platform-specific operations - PE */
int binject_single_pe(const char *executable, const char *output, const char *section_name,
                              const uint8_t *data, size_t size, uint32_t checksum, int is_compressed);
int binject_batch_pe(const char *executable, const char *output,
                      const uint8_t *sea_data, size_t sea_size,
                      const uint8_t *vfs_data, size_t vfs_size,
                      int vfs_compat_mode,
                      const uint8_t *vfs_config_data);
int binject_pe_list(const char *executable);
int binject_pe_extract(const char *executable, const char *section_name,
                       const char *output_file);
int binject_pe_verify(const char *executable, const char *section_name);

#ifdef __cplusplus
}
#endif

#endif /* BINJECT_H */
