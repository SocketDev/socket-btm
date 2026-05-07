/**
 * @file buffer_constants.h
 * @brief Buffer size and format constants for binject/binpress tools.
 *
 * This header defines buffer sizes, PE format constants, and alignment values
 * to eliminate magic numbers throughout the codebase.
 */

#ifndef BUFFER_CONSTANTS_H
#define BUFFER_CONSTANTS_H

/**
 * Buffer sizes for file paths and temporary storage.
 */
#define TEMP_PATH_BUFFER_SIZE 1024
#define CACHE_DIR_BUFFER_SIZE 512
#define MAX_JSON_CONFIG_SIZE (1024 * 1024)  /* 1 MB maximum for JSON configuration files. */

/**
 * Compression buffer overhead.
 * Extra space needed beyond input size for compression operations.
 */
#define COMPRESSION_BUFFER_OVERHEAD 4096

/**
 * PE (Portable Executable) format constants.
 */
#define PE_SIGNATURE_SIZE 4           /* Size of "PE\0\0" signature. */
#define PE_SECTION_NAME_MAX_LENGTH 8  /* Maximum length of PE section names. */

/**
 * ELF alignment constants.
 */
#define ALIGNMENT_16_BYTE 16
#define ALIGNMENT_MASK_16 (~15)

/**
 * Macro to align size to 16-byte boundary.
 * @param size Size to align
 * @return Aligned size (rounded up to nearest 16-byte boundary)
 */
#define ALIGN_16(size) (((size) + 15) & ~15)

#endif /* BUFFER_CONSTANTS_H */
