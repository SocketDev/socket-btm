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
#include <cstdlib>
#include <cstring>
#include <memory>
#include <vector>

#include <LIEF/LIEF.hpp>

extern "C" {
#include "socketsecurity/build-infra/posix_compat.h"
#include "socketsecurity/bin-infra/segment_names.h"
#include "socketsecurity/bin-infra/compression_constants.h"
#include "socketsecurity/bin-infra/smol_segment_reader.h"
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

/**
 * Check if Mach-O binary has compressed data in __PRESSED_DATA section using LIEF.
 *
 * This checks if the SMOL segment's __PRESSED_DATA section contains the magic marker,
 * indicating actual compressed data (not just an empty placeholder section).
 *
 * @param path Path to binary file
 * @param marker_part1 First part of magic marker
 * @param marker_part2 Second part of magic marker
 * @param marker_part3 Third part of magic marker
 * @return 1 if compressed data found, 0 if not found or section empty, -1 on error
 */
extern "C" int smol_has_compressed_data_macho_lief(const char *path,
                                                    const char *marker_part1,
                                                    const char *marker_part2,
                                                    const char *marker_part3) {
    if (!path || !marker_part1 || !marker_part2 || !marker_part3) {
        return -1;
    }

    /* Build marker at runtime to avoid it appearing in the binary */
    char marker[128];
    int marker_len = snprintf(marker, sizeof(marker), "%s%s%s",
                              marker_part1, marker_part2, marker_part3);
    if (marker_len < 0 || marker_len >= (int)sizeof(marker)) {
        return -1;
    }

    /* Parse as Mach-O FatBinary */
    std::unique_ptr<LIEF::MachO::FatBinary> fat = LIEF::MachO::Parser::parse(path);
    if (!fat || fat->size() == 0) {
        return 0;
    }

    /* Check each slice in the fat binary */
    for (LIEF::MachO::Binary &macho : *fat) {
        /* Look for SMOL segment */
        LIEF::MachO::SegmentCommand *smol_seg = macho.get_segment(MACHO_SEGMENT_SMOL);
        if (!smol_seg) {
            continue;
        }

        /* Look for __PRESSED_DATA section within SMOL segment */
        LIEF::MachO::Section *pressed_sec = macho.get_section(MACHO_SEGMENT_SMOL, MACHO_SECTION_PRESSED_DATA);
        if (!pressed_sec || pressed_sec->size() == 0) {
            continue;
        }

        /* Get section content and search for marker */
        LIEF::span<const uint8_t> content = pressed_sec->content();
        if (content.empty()) {
            continue;
        }

        /* Search for marker in section content */
        size_t content_size = content.size();
        size_t marker_size = (size_t)marker_len;
        if (content_size < marker_size) {
            continue;
        }

        for (size_t i = 0; i <= content_size - marker_size; i++) {
            if (memcmp(content.data() + i, marker, marker_size) == 0) {
                return 1;  /* Found compressed data */
            }
        }
    }

    return 0;  /* No compressed data found */
}

/**
 * Check if ELF binary has compressed data in PRESSED_DATA section using LIEF.
 *
 * @param path Path to binary file
 * @param marker_part1 First part of magic marker
 * @param marker_part2 Second part of magic marker
 * @param marker_part3 Third part of magic marker
 * @return 1 if compressed data found, 0 if not found, -1 on error
 */
extern "C" int smol_has_compressed_data_elf_lief(const char *path,
                                                  const char *marker_part1,
                                                  const char *marker_part2,
                                                  const char *marker_part3) {
    if (!path || !marker_part1 || !marker_part2 || !marker_part3) {
        return -1;
    }

    /* Build marker at runtime */
    char marker[128];
    int marker_len = snprintf(marker, sizeof(marker), "%s%s%s",
                              marker_part1, marker_part2, marker_part3);
    if (marker_len < 0 || marker_len >= (int)sizeof(marker)) {
        return -1;
    }

    /* Parse binary with LIEF */
    std::unique_ptr<LIEF::Binary> binary = LIEF::Parser::parse(path);
    if (!binary || binary->format() != LIEF::Binary::FORMATS::ELF) {
        return 0;
    }

    LIEF::ELF::Binary *elf = dynamic_cast<LIEF::ELF::Binary*>(binary.get());
    if (!elf) {
        return 0;
    }

    /* Search for PRESSED_DATA section */
    for (LIEF::ELF::Section &sec : elf->sections()) {
        if (sec.name() != ELF_SECTION_PRESSED_DATA && sec.name() != PRESSED_DATA_RESOURCE_NAME) {
            continue;
        }

        if (sec.size() == 0) {
            continue;
        }

        /* Get section content and search for marker */
        LIEF::span<const uint8_t> content = sec.content();
        if (content.empty()) {
            continue;
        }

        size_t content_size = content.size();
        size_t marker_size = (size_t)marker_len;
        if (content_size < marker_size) {
            continue;
        }

        for (size_t i = 0; i <= content_size - marker_size; i++) {
            if (memcmp(content.data() + i, marker, marker_size) == 0) {
                return 1;
            }
        }
    }

    return 0;
}

/**
 * Check if PE binary has compressed data in PRESSED_DATA section using LIEF.
 *
 * @param path Path to binary file
 * @param marker_part1 First part of magic marker
 * @param marker_part2 Second part of magic marker
 * @param marker_part3 Third part of magic marker
 * @return 1 if compressed data found, 0 if not found, -1 on error
 */
extern "C" int smol_has_compressed_data_pe_lief(const char *path,
                                                 const char *marker_part1,
                                                 const char *marker_part2,
                                                 const char *marker_part3) {
    if (!path || !marker_part1 || !marker_part2 || !marker_part3) {
        return -1;
    }

    /* Build marker at runtime */
    char marker[128];
    int marker_len = snprintf(marker, sizeof(marker), "%s%s%s",
                              marker_part1, marker_part2, marker_part3);
    if (marker_len < 0 || marker_len >= (int)sizeof(marker)) {
        return -1;
    }

    /* Parse binary with LIEF */
    std::unique_ptr<LIEF::Binary> binary = LIEF::Parser::parse(path);
    if (!binary || binary->format() != LIEF::Binary::FORMATS::PE) {
        return 0;
    }

    LIEF::PE::Binary *pe = dynamic_cast<LIEF::PE::Binary*>(binary.get());
    if (!pe) {
        return 0;
    }

    /* Search for PRESSED_DATA section */
    for (LIEF::PE::Section &sec : pe->sections()) {
        if (sec.name() != PE_SECTION_PRESSED_DATA && sec.name() != PRESSED_DATA_RESOURCE_NAME) {
            continue;
        }

        if (sec.size() == 0) {
            continue;
        }

        /* Get section content and search for marker */
        LIEF::span<const uint8_t> content = sec.content();
        if (content.empty()) {
            continue;
        }

        size_t content_size = content.size();
        size_t marker_size = (size_t)marker_len;
        if (content_size < marker_size) {
            continue;
        }

        for (size_t i = 0; i <= content_size - marker_size; i++) {
            if (memcmp(content.data() + i, marker, marker_size) == 0) {
                return 1;
            }
        }
    }

    return 0;
}

/**
 * Extract Node.js version from filepath.
 *
 * Looks for patterns like:
 * - node-v1.2.3-linux-x64/bin/node
 * - node-v1.2.3-darwin-arm64
 * - v1.2.3 anywhere in path
 *
 * @param path File path to parse
 * @return Version string (e.g., "1.2.3"), or NULL if not found.
 *         Caller must free() the returned string.
 */
static char* extract_version_from_path(const char* path) {
    if (!path) {
        return nullptr;
    }

    // Look for "node-v" or just "v" followed by version number
    const char* p = path;
    while (*p) {
        // Check for "node-v" or standalone "v" at path component boundary
        bool at_boundary = (p == path || *(p-1) == '/' || *(p-1) == '\\' || *(p-1) == '-');

        if (at_boundary) {
            const char* version_start = nullptr;

            // Check for "node-v" pattern
            if (strncmp(p, "node-v", 6) == 0) {
                version_start = p + 6;
            }
            // Check for standalone "v" followed by digit
            else if (*p == 'v' && p[1] >= '0' && p[1] <= '9') {
                version_start = p + 1;
            }

            if (version_start) {
                // Parse version: MAJOR.MINOR.PATCH
                const char* end = version_start;
                int dots = 0;
                while ((*end >= '0' && *end <= '9') || *end == '.') {
                    if (*end == '.') dots++;
                    end++;
                }

                // Valid version has at least one dot (e.g., "22.5" or "22.5.0")
                size_t len = end - version_start;
                if (dots >= 1 && len >= 3 && len <= 20) {
                    char* result = (char*)malloc(len + 1);
                    if (result) {
                        memcpy(result, version_start, len);
                        result[len] = '\0';
                        return result;
                    }
                }
            }
        }
        p++;
    }

    return nullptr;
}

/**
 * Extract Node.js version by running binary with --version.
 *
 * Executes the binary with --version flag and parses output.
 * Output format: "v22.5.0\n"
 *
 * @param binary_path Path to Node.js binary
 * @return Version string (e.g., "22.5.0"), or NULL if failed.
 *         Caller must free() the returned string.
 */
static char* extract_version_by_execution(const char* binary_path) {
    if (!binary_path) {
        return nullptr;
    }

    // Build command: "binary_path" --version 2>/dev/null
    size_t path_len = strlen(binary_path);
    size_t cmd_len = path_len + 32;
    char* cmd = (char*)malloc(cmd_len);
    if (!cmd) {
        return nullptr;
    }

#ifdef _WIN32
    snprintf(cmd, cmd_len, "\"%s\" --version 2>NUL", binary_path);
#else
    snprintf(cmd, cmd_len, "\"%s\" --version 2>/dev/null", binary_path);
#endif

    FILE* fp = POSIX_POPEN(cmd, "r");
    free(cmd);
    if (!fp) {
        return nullptr;
    }

    char buffer[64];
    char* result = nullptr;
    if (fgets(buffer, sizeof(buffer), fp)) {
        // Parse "v22.5.0\n" -> "22.5.0"
        char* start = buffer;
        if (*start == 'v') {
            start++;
        }
        // Trim newline
        char* end = start;
        while (*end && *end != '\n' && *end != '\r') {
            end++;
        }
        size_t len = end - start;
        if (len > 0 && len < 20) {
            result = (char*)malloc(len + 1);
            if (result) {
                memcpy(result, start, len);
                result[len] = '\0';
            }
        }
    }

    POSIX_PCLOSE(fp);
    return result;
}

/**
 * Extract Node.js version from binary using multiple strategies.
 *
 * Attempts version extraction in order:
 * 1. Stub: PRESSED_DATA section with SMFG config (node_version in config)
 * 2. node-smol: SMOL_NODE_VER section (embedded during node-smol build)
 * 3. Filepath: Parse version from path (e.g., node-v22.5.0-linux-x64)
 * 4. Execution: Run binary with --version flag
 * 5. PE only: VS_VERSION_INFO resource (standard Windows version info)
 *
 * @param binary_path Path to node-smol or Node.js binary
 * @return Node version string (e.g., "25.5.0"), or NULL if not found.
 *         Caller must free() the returned string.
 */
extern "C" char* smol_extract_node_version(const char* binary_path) {
    if (!binary_path) {
        return nullptr;
    }

    // Fast path: Try native segment reader first (no LIEF parsing).
    // This handles:
    // - SMOL binaries with PRESSED_DATA sections (reads SMFG config)
    // - node-smol binaries with SMOL_NODE_VER section
    // This is 30-60x faster than LIEF and avoids hangs on large binaries.
    char* version = smol_extract_node_version_fast(binary_path);
    if (version) {
        return version;
    }

    // Try extracting version from filepath (e.g., node-v22.5.0-linux-x64)
    version = extract_version_from_path(binary_path);
    if (version) {
        return version;
    }

    // Try running the binary with --version
    version = extract_version_by_execution(binary_path);
    if (version) {
        return version;
    }

    // All fast paths exhausted. The native reader (smol_extract_node_version_fast)
    // already handles PE VS_VERSION_INFO, so no need for LIEF fallback.
    // LIEF parsing would hang on large binaries anyway.
    return nullptr;
}
