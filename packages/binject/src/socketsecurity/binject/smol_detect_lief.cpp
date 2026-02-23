/**
 * SMOL stub detection using LIEF
 *
 * Provides robust binary format parsing to detect PRESSED_DATA sections
 * in ELF and PE binaries using LIEF library.
 *
 * CRITICAL: Node.js -fno-exceptions Requirement
 * =============================================
 * Node.js is compiled with -fno-exceptions (C++ exceptions disabled).
 * This file MUST NOT use try/catch blocks or throw statements.
 * Use error code returns (1=found, 0=not found, -1=error) and null checks instead.
 * LIEF operations return nullptr or empty containers on failure, not exceptions.
 */

#include <cstdio>
#include <cstring>
#include <memory>

#include <LIEF/LIEF.hpp>

extern "C" {
#include "socketsecurity/bin-infra/segment_names.h"
}

/**
 * Check if ELF binary has PRESSED_DATA section using LIEF.
 *
 * Properly parses ELF section table to check for PRESSED_DATA section.
 *
 * @param path Path to binary file
 * @return 1 if found, 0 if not found, -1 on error
 */
extern "C" int smol_has_pressed_data_elf_lief(const char *path) {
    if (!path) {
        return -1;
    }

    /* Parse binary with LIEF */
    std::unique_ptr<LIEF::Binary> binary = LIEF::Parser::parse(path);
    if (!binary) {
        /* Failed to parse - IO error or corrupted binary */
        fprintf(stderr, "Error: Failed to parse binary at %s\n", path);
        return -1;
    }

    /* Verify it's actually an ELF binary */
    if (binary->format() != LIEF::Binary::FORMATS::ELF) {
        return 0;
    }

    LIEF::ELF::Binary *elf = dynamic_cast<LIEF::ELF::Binary*>(binary.get());
    if (!elf) {
        return 0;
    }

    /* Search for PRESSED_DATA section
     * Check both ELF_SECTION_PRESSED_DATA (canonical ".PRESSED_DATA") and
     * PRESSED_DATA_RESOURCE_NAME (legacy "PRESSED_DATA") for compatibility */
    for (LIEF::ELF::Section &sec : elf->sections()) {
        if (sec.name() == ELF_SECTION_PRESSED_DATA || sec.name() == PRESSED_DATA_RESOURCE_NAME) {
            /* Verify section has data (empty PRESSED_DATA section is invalid) */
            if (sec.size() > 0) {
                return 1;
            }
        }
    }

    return 0;
}

/**
 * Check if PE binary has PRESSED_DATA section using LIEF.
 *
 * Properly parses PE section table to check for PRESSED_DATA section.
 *
 * @param path Path to binary file
 * @return 1 if found, 0 if not found, -1 on error
 */
extern "C" int smol_has_pressed_data_pe_lief(const char *path) {
    if (!path) {
        return -1;
    }

    /* Parse binary with LIEF */
    std::unique_ptr<LIEF::Binary> binary = LIEF::Parser::parse(path);
    if (!binary) {
        /* Failed to parse - IO error or corrupted binary */
        fprintf(stderr, "Error: Failed to parse binary at %s\n", path);
        return -1;
    }

    /* Verify it's actually a PE binary */
    if (binary->format() != LIEF::Binary::FORMATS::PE) {
        return 0;
    }

    LIEF::PE::Binary *pe = dynamic_cast<LIEF::PE::Binary*>(binary.get());
    if (!pe) {
        return 0;
    }

    /* Search for PRESSED_DATA section
     * Check both PE_SECTION_PRESSED_DATA (canonical ".PRESSED_DATA") and
     * PRESSED_DATA_RESOURCE_NAME (legacy "PRESSED_DATA") for compatibility */
    for (LIEF::PE::Section &sec : pe->sections()) {
        if (sec.name() == PE_SECTION_PRESSED_DATA || sec.name() == PRESSED_DATA_RESOURCE_NAME) {
            /* Verify section has data (empty PRESSED_DATA section is invalid) */
            if (sec.size() > 0) {
                return 1;
            }
        }
    }

    return 0;
}
