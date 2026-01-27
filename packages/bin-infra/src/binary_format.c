/**
 * @file binary_format.c
 * @brief Binary format detection utility implementation.
 */

#include "binary_format.h"

/**
 * Detect binary format from magic bytes.
 */
binary_format_t detect_binary_format(const uint8_t magic[4]) {
    if (!magic) {
        return BINARY_FORMAT_UNKNOWN;
    }

    /* ELF magic: 0x7F 'E' 'L' 'F' */
    if (magic[0] == 0x7F && magic[1] == 'E' && magic[2] == 'L' && magic[3] == 'F') {
        return BINARY_FORMAT_ELF;
    }

    /* Mach-O magic: 0xFEEDFACE (32-bit), 0xFEEDFACF (64-bit), 0xCAFEBABE (universal), 0xBEBAFECA (universal reverse) */
    if ((magic[0] == 0xFE && magic[1] == 0xED && magic[2] == 0xFA && (magic[3] == 0xCE || magic[3] == 0xCF)) ||
        (magic[0] == 0xCF && magic[1] == 0xFA && magic[2] == 0xED && magic[3] == 0xFE) ||
        (magic[0] == 0xCA && magic[1] == 0xFE && magic[2] == 0xBA && magic[3] == 0xBE) ||
        (magic[0] == 0xBE && magic[1] == 0xBA && magic[2] == 0xFE && magic[3] == 0xCA)) {
        return BINARY_FORMAT_MACHO;
    }

    /* PE/COFF magic: 'M' 'Z' (DOS header) */
    if (magic[0] == 'M' && magic[1] == 'Z') {
        return BINARY_FORMAT_PE;
    }

    return BINARY_FORMAT_UNKNOWN;
}
