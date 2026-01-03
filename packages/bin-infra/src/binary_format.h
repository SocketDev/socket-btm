/**
 * @file binary_format.h
 * @brief Binary format detection utility.
 *
 * Provides shared function for detecting binary format (ELF, Mach-O, PE)
 * from magic bytes to eliminate code duplication.
 */

#ifndef BINARY_FORMAT_H
#define BINARY_FORMAT_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Binary format types.
 */
typedef enum {
    BINARY_FORMAT_UNKNOWN = 0,
    BINARY_FORMAT_MACHO,
    BINARY_FORMAT_ELF,
    BINARY_FORMAT_PE
} binary_format_t;

/**
 * Detect binary format from magic bytes.
 *
 * @param magic First 4 bytes of file
 * @return Format type or BINARY_FORMAT_UNKNOWN
 */
binary_format_t detect_binary_format(const uint8_t magic[4]);

#ifdef __cplusplus
}
#endif

#endif /* BINARY_FORMAT_H */
