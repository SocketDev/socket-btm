/**
 * binject - Pure C alternative to postject
 *
 * Inject arbitrary resources into executables (Mach-O, ELF, PE)
 */

#ifndef BINJECT_H
#define BINJECT_H

#include <stddef.h>
#include <stdint.h>

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
                         int vfs_in_memory);
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
int binject_get_extracted_path(const char *compressed_stub, char *extracted_path, size_t path_size);

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
                              const uint8_t *vfs_data, size_t vfs_size);
int binject_macho_list_lief(const char *executable);
int binject_macho_extract_lief(const char *executable, const char *section_name, const char *output_file);
int binject_macho_verify_lief(const char *executable, const char *section_name);

int binject_macho(const char *executable, const char *segment_name,
                  const char *section_name, const uint8_t *data, size_t size);
int binject_macho_list(const char *executable);
int binject_macho_extract(const char *executable, const char *section_name,
                          const char *output_file);
int binject_macho_verify(const char *executable, const char *section_name);

/* Platform-specific operations - ELF (LIEF cross-platform) */
int binject_elf_lief(const char *executable, const char *section_name,
                     const uint8_t *data, size_t size);

/* Platform-specific operations - ELF */
int binject_single_elf(const char *executable, const char *output, const char *section_name,
                               const uint8_t *data, size_t size, uint32_t checksum, int is_compressed);
int binject_batch_elf(const char *executable, const char *output,
                       const uint8_t *sea_data, size_t sea_size,
                       const uint8_t *vfs_data, size_t vfs_size);
int binject_elf_list(const char *executable);
int binject_elf_extract(const char *executable, const char *section_name,
                        const char *output_file);
int binject_elf_verify(const char *executable, const char *section_name);

/* Platform-specific operations - PE (LIEF cross-platform) */
int binject_pe_lief(const char *executable, const char *section_name,
                    const uint8_t *data, size_t size);

/* Platform-specific operations - PE */
int binject_single_pe(const char *executable, const char *output, const char *section_name,
                              const uint8_t *data, size_t size, uint32_t checksum, int is_compressed);
int binject_batch_pe(const char *executable, const char *output,
                      const uint8_t *sea_data, size_t sea_size,
                      const uint8_t *vfs_data, size_t vfs_size);
int binject_pe_list(const char *executable);
int binject_pe_extract(const char *executable, const char *section_name,
                       const char *output_file);
int binject_pe_verify(const char *executable, const char *section_name);

#endif /* BINJECT_H */
