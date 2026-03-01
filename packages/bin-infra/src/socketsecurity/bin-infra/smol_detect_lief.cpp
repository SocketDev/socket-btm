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

/*
 * ============================================================================
 * Node.js Version Extraction
 * ============================================================================
 *
 * Extract Node.js version from binaries using multiple strategies.
 * Supports: node-smol binaries, compressed stubs, and plain Node.js.
 */

/**
 * Try to extract Node.js version from PE VS_VERSION_INFO resource.
 *
 * Windows PE binaries include version info in a standard resource format.
 * Node.js sets ProductVersion to the Node.js version string.
 *
 * @param pe PE binary to extract from
 * @return Version string (e.g., "25.5.0"), or nullptr if not found
 */
static char* extract_pe_product_version(LIEF::PE::Binary* pe) {
    if (!pe || !pe->has_resources()) {
        return nullptr;
    }

    auto resources_result = pe->resources_manager();
    if (!resources_result) {
        return nullptr;
    }

    LIEF::PE::ResourcesManager resources = std::move(*resources_result);
    if (!resources.has_version()) {
        return nullptr;
    }

    std::vector<LIEF::PE::ResourceVersion> versions = resources.version();
    if (versions.empty()) {
        return nullptr;
    }

    // Get version from file_info() (fixed_file_info_t structure).
    const auto& fixed_info = versions[0].file_info();
    uint32_t ms = fixed_info.product_version_ms;
    uint32_t ls = fixed_info.product_version_ls;

    // Product version is stored as: major.minor in MS, patch.build in LS.
    uint16_t major = (ms >> 16) & 0xFFFF;
    uint16_t minor = ms & 0xFFFF;
    uint16_t patch = (ls >> 16) & 0xFFFF;

    // Format as "major.minor.patch".
    char buffer[32];
    snprintf(buffer, sizeof(buffer), "%u.%u.%u", major, minor, patch);

    char* result = static_cast<char*>(malloc(strlen(buffer) + 1));
    if (result) {
        strcpy(result, buffer);
    }
    return result;
}

/**
 * Try to extract Node.js version from PRESSED_DATA section (for stubs).
 *
 * Stubs have SMOL config embedded in the PRESSED_DATA section header.
 * This reads the nodeVersion field from SMFG v2 format.
 *
 * @param binary Parsed binary
 * @return Version string (e.g., "25.5.0"), or nullptr if not found
 */
static char* extract_pressed_data_version(LIEF::Binary* binary) {
    const uint8_t* pressed_data = nullptr;
    size_t pressed_size = 0;

    // Find PRESSED_DATA section based on binary format.
    if (binary->format() == LIEF::Binary::FORMATS::MACHO) {
        LIEF::MachO::Binary* macho = dynamic_cast<LIEF::MachO::Binary*>(binary);
        if (!macho) return nullptr;

        LIEF::MachO::SegmentCommand* smol_segment = macho->get_segment(MACHO_SEGMENT_SMOL);
        if (!smol_segment) return nullptr;

        LIEF::MachO::Section* pressed_section = nullptr;
        for (LIEF::MachO::Section& sec : smol_segment->sections()) {
            if (sec.name() == MACHO_SECTION_PRESSED_DATA) {
                pressed_section = &sec;
                break;
            }
        }
        if (!pressed_section) return nullptr;

        auto content_span = pressed_section->content();
        if (content_span.empty()) return nullptr;
        pressed_data = content_span.data();
        pressed_size = content_span.size();

    } else if (binary->format() == LIEF::Binary::FORMATS::ELF) {
        LIEF::ELF::Binary* elf = dynamic_cast<LIEF::ELF::Binary*>(binary);
        if (!elf) return nullptr;

        LIEF::ELF::Section* pressed_section = elf->get_section(ELF_SECTION_PRESSED_DATA);
        if (!pressed_section) pressed_section = elf->get_section(PRESSED_DATA_RESOURCE_NAME);
        if (!pressed_section) return nullptr;

        auto content_span = pressed_section->content();
        if (content_span.empty()) return nullptr;
        pressed_data = content_span.data();
        pressed_size = content_span.size();

    } else if (binary->format() == LIEF::Binary::FORMATS::PE) {
        LIEF::PE::Binary* pe = dynamic_cast<LIEF::PE::Binary*>(binary);
        if (!pe) return nullptr;

        LIEF::PE::Section* pressed_section = pe->get_section(PE_SECTION_PRESSED_DATA);
        if (!pressed_section) pressed_section = pe->get_section(PRESSED_DATA_RESOURCE_NAME);
        if (!pressed_section) return nullptr;

        auto content_span = pressed_section->content();
        if (content_span.empty()) return nullptr;
        pressed_data = content_span.data();
        pressed_size = content_span.size();

    } else {
        return nullptr;
    }

    // Build magic marker at runtime to avoid self-match.
    char marker[MAGIC_MARKER_LEN + 1];
    snprintf(marker, sizeof(marker), "%s%s%s",
             MAGIC_MARKER_PART1, MAGIC_MARKER_PART2, MAGIC_MARKER_PART3);

    // Find magic marker in pressed data.
    const uint8_t* marker_pos = nullptr;
    for (size_t i = 0; i + MAGIC_MARKER_LEN <= pressed_size; i++) {
        if (memcmp(pressed_data + i, marker, MAGIC_MARKER_LEN) == 0) {
            marker_pos = pressed_data + i;
            break;
        }
    }
    if (!marker_pos) return nullptr;

    // Calculate offset to SMFG config.
    // Format: [magic][compressed_size 8][uncompressed_size 8][cache_key 16][platform_metadata 3][has_config 1][config if present]
    const uint8_t* metadata_pos = marker_pos + MAGIC_MARKER_LEN;
    size_t remaining = pressed_size - (metadata_pos - pressed_data);
    if (remaining < METADATA_HEADER_LEN) return nullptr;

    // Check has_config flag (at offset: 8 + 8 + 16 + 3 = 35).
    uint8_t has_config = metadata_pos[35];
    if (has_config == 0) return nullptr;

    // SMFG config starts after has_config flag.
    const uint8_t* config_data = metadata_pos + METADATA_HEADER_LEN;
    size_t config_remaining = remaining - METADATA_HEADER_LEN;
    if (config_remaining < 1192) return nullptr;  // SMOL_CONFIG_BINARY_LEN v2

    // Verify SMFG magic (0x534D4647).
    uint32_t smfg_magic;
    memcpy(&smfg_magic, config_data, sizeof(smfg_magic));
    if (smfg_magic != 0x534D4647) return nullptr;

    // Check version (must be v2 for nodeVersion).
    uint16_t smfg_version;
    memcpy(&smfg_version, config_data + 4, sizeof(smfg_version));
    if (smfg_version < 2) return nullptr;

    // nodeVersion is at offset 1176 in SMFG binary.
    // Header (8) + Numeric (16) + Strings (128 + 256 + 512 + 128 + 64 + 64) = 1176
    static const size_t NODE_VERSION_OFFSET = 1176;
    if (NODE_VERSION_OFFSET >= config_remaining) return nullptr;

    // Read length prefix (1 byte) and string.
    uint8_t len = config_data[NODE_VERSION_OFFSET];
    if (len == 0 || len > 15) return nullptr;

    // Bounds check: ensure we can read the full string.
    if (NODE_VERSION_OFFSET + 1 + len > config_remaining) return nullptr;

    char* result = static_cast<char*>(malloc(len + 1));
    if (result) {
        memcpy(result, config_data + NODE_VERSION_OFFSET + 1, len);
        result[len] = '\0';
    }
    return result;
}

/**
 * Try to extract Node.js version from SMOL_VFS_CONFIG section.
 *
 * Reads the nodeVersion field from the SMOL config stored in VFS config section.
 * The SMOL config binary (1192 bytes SMFG format with nodeVersion) is stored directly
 * in the SMOL_VFS_CONFIG section with no header prefix.
 *
 * @param binary Parsed binary
 * @return Version string (e.g., "25.5.0"), or nullptr if not found
 */
static char* extract_smol_config_version(LIEF::Binary* binary) {
    const uint8_t* config_data = nullptr;
    size_t config_size = 0;

    // Find SMOL_VFS_CONFIG section based on binary format.
    if (binary->format() == LIEF::Binary::FORMATS::MACHO) {
        LIEF::MachO::Binary* macho = dynamic_cast<LIEF::MachO::Binary*>(binary);
        if (!macho) return nullptr;

        // Try NODE_SEA segment first (for injected binaries).
        LIEF::MachO::SegmentCommand* segment = macho->get_segment(MACHO_SEGMENT_NODE_SEA);
        if (!segment) {
            // Fallback to SMOL segment.
            segment = macho->get_segment(MACHO_SEGMENT_SMOL);
        }
        if (!segment) return nullptr;

        LIEF::MachO::Section* config_section = nullptr;
        for (LIEF::MachO::Section& sec : segment->sections()) {
            // Check for SMOL_VFS_CONFIG (may be truncated to 16 chars).
            if (sec.name() == MACHO_SECTION_SMOL_VFS_CONFIG ||
                sec.name().rfind("__SMOL_VFS_CONFI", 0) == 0) {
                config_section = &sec;
                break;
            }
        }
        if (!config_section) return nullptr;

        auto content_span = config_section->content();
        if (content_span.empty()) return nullptr;

        config_data = content_span.data();
        config_size = content_span.size();

    } else if (binary->format() == LIEF::Binary::FORMATS::ELF) {
        LIEF::ELF::Binary* elf = dynamic_cast<LIEF::ELF::Binary*>(binary);
        if (!elf) return nullptr;

        // Try to find in notes first.
        for (const LIEF::ELF::Note& note : elf->notes()) {
            if (note.name() == ELF_NOTE_SMOL_VFS_CONFIG) {
                auto desc = note.description();
                if (!desc.empty()) {
                    config_data = desc.data();
                    config_size = desc.size();
                    break;
                }
            }
        }

        // Fallback to section.
        if (!config_data) {
            LIEF::ELF::Section* config_section = elf->get_section(ELF_NOTE_SMOL_VFS_CONFIG);
            if (!config_section) return nullptr;

            auto content_span = config_section->content();
            if (content_span.empty()) return nullptr;

            config_data = content_span.data();
            config_size = content_span.size();
        }

    } else if (binary->format() == LIEF::Binary::FORMATS::PE) {
        LIEF::PE::Binary* pe = dynamic_cast<LIEF::PE::Binary*>(binary);
        if (!pe) return nullptr;

        // Fallback to section.
        LIEF::PE::Section* config_section = pe->get_section(PE_RESOURCE_SMOL_VFS_CONFIG);
        if (!config_section) return nullptr;

        auto content_span = config_section->content();
        if (content_span.empty()) return nullptr;

        config_data = content_span.data();
        config_size = content_span.size();

    } else {
        return nullptr;
    }

    // SMOL config is stored directly in the SMOL_VFS_CONFIG section (1192 bytes SMFG format).
    const size_t SMOL_CONFIG_SIZE_LOCAL = 1192;  // SMFG v2 binary size
    if (config_size < SMOL_CONFIG_SIZE_LOCAL) return nullptr;

    // Check SMFG magic (0x534D4647 = "SMFG" in little-endian).
    uint32_t magic;
    memcpy(&magic, config_data, sizeof(magic));
    if (magic != 0x534D4647) return nullptr;

    // Check version (must be v2 or higher for node_version field).
    uint16_t version;
    memcpy(&version, config_data + 4, sizeof(version));
    if (version < 2) return nullptr;

    // Calculate offset to node_version field within SMOL config.
    // Header (8) + Numeric (16) + Strings (binname 128 + command 256 + url 512 + tag 128 + skipEnv 64 + fakeArgvEnv 64)
    static const size_t NODE_VERSION_OFFSET = 1176;

    // Read node_version string (1 byte length + up to 15 bytes data).
    uint8_t len = config_data[NODE_VERSION_OFFSET];
    if (len == 0 || len > 15) return nullptr;

    // Bounds check: ensure we can read the full string.
    if (config_size < NODE_VERSION_OFFSET + 1 + len) return nullptr;

    char* version_str = static_cast<char*>(malloc(len + 1));
    if (!version_str) return nullptr;

    memcpy(version_str, config_data + NODE_VERSION_OFFSET + 1, len);
    version_str[len] = '\0';

    return version_str;
}

/**
 * Try to extract Node.js version from SMOL_NODE_VER section.
 *
 * This section contains just the version string (e.g., "25.5.0").
 * It's added during node-smol build and is available before any injection.
 *
 * @param binary Parsed binary
 * @return Version string (e.g., "25.5.0"), or nullptr if not found
 */
static char* extract_smol_node_version_section(LIEF::Binary* binary) {
    const uint8_t* version_data = nullptr;
    size_t version_size = 0;

    if (binary->format() == LIEF::Binary::FORMATS::MACHO) {
        LIEF::MachO::Binary* macho = dynamic_cast<LIEF::MachO::Binary*>(binary);
        if (!macho) return nullptr;

        // Look in __DATA segment for __smol_node_ver section.
        // Note: Uses __DATA (not SMOL) because SMOL segment doesn't exist until binpress compression.
        LIEF::MachO::SegmentCommand* data_segment = macho->get_segment("__DATA");
        if (!data_segment) return nullptr;

        LIEF::MachO::Section* version_section = nullptr;
        for (LIEF::MachO::Section& sec : data_segment->sections()) {
            if (sec.name() == "__smol_node_ver") {
                version_section = &sec;
                break;
            }
        }
        if (!version_section) return nullptr;

        auto content_span = version_section->content();
        if (content_span.empty()) return nullptr;

        version_data = content_span.data();
        version_size = content_span.size();

    } else if (binary->format() == LIEF::Binary::FORMATS::ELF) {
        LIEF::ELF::Binary* elf = dynamic_cast<LIEF::ELF::Binary*>(binary);
        if (!elf) return nullptr;

        // Try as a PT_NOTE first.
        for (const LIEF::ELF::Note& note : elf->notes()) {
            if (note.name() == ELF_NOTE_SMOL_NODE_VER) {
                auto desc = note.description();
                if (!desc.empty()) {
                    // Find null terminator or use full length.
                    size_t len = 0;
                    while (len < desc.size() && desc[len] != 0) {
                        len++;
                    }
                    if (len > 0 && len <= 15) {
                        char* result = static_cast<char*>(malloc(len + 1));
                        if (result) {
                            memcpy(result, desc.data(), len);
                            result[len] = '\0';
                            return result;
                        }
                    }
                }
            }
        }

        // Fallback: try as section.
        LIEF::ELF::Section* version_section = elf->get_section(ELF_NOTE_SMOL_NODE_VER);
        if (!version_section) return nullptr;

        auto content_span = version_section->content();
        if (content_span.empty()) return nullptr;

        version_data = content_span.data();
        version_size = content_span.size();

    } else if (binary->format() == LIEF::Binary::FORMATS::PE) {
        LIEF::PE::Binary* pe = dynamic_cast<LIEF::PE::Binary*>(binary);
        if (!pe) return nullptr;

        // Try as section.
        LIEF::PE::Section* version_section = pe->get_section(PE_RESOURCE_SMOL_NODE_VER);
        if (!version_section) return nullptr;

        auto content_span = version_section->content();
        if (content_span.empty()) return nullptr;

        version_data = content_span.data();
        version_size = content_span.size();

    } else {
        return nullptr;
    }

    // Version string should be null-terminated and reasonable length.
    if (version_size == 0 || version_size > 32) return nullptr;

    // Find null terminator.
    size_t len = 0;
    while (len < version_size && version_data[len] != 0) {
        len++;
    }
    if (len == 0 || len > 15) return nullptr;

    char* result = static_cast<char*>(malloc(len + 1));
    if (result) {
        memcpy(result, version_data, len);
        result[len] = '\0';
    }
    return result;
}

/**
 * Extract Node.js version from binary using multiple strategies.
 *
 * Attempts version extraction in order:
 * 1. Stub: PRESSED_DATA section with SMFG config (node_version in config)
 * 2. node-smol: SMOL_NODE_VER section (embedded during node-smol build)
 * 3. PE: VS_VERSION_INFO resource (standard Windows version info for plain Node.js)
 * 4. All: SMOL_CONFIG section (works for injected binaries)
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
    // This is 30-60x faster for SMOL binaries with PRESSED_DATA sections.
    char* version = smol_extract_node_version_fast(binary_path);
    if (version) {
        return version;
    }

    // For ELF and Mach-O: If fast path failed, there's no SMOL data to extract.
    // Skip expensive LIEF parsing for these formats since they don't have
    // VS_VERSION_INFO like PE binaries do.
    //
    // Only PE binaries need the LIEF slow path to extract version from
    // VS_VERSION_INFO resource (for plain Node.js on Windows).

    // Quick check: Read magic bytes to determine format without full LIEF parse.
    FILE* fp = fopen(binary_path, "rb");
    if (!fp) {
        return nullptr;
    }

    unsigned char magic[4];
    size_t read_count = fread(magic, 1, 4, fp);
    fclose(fp);

    if (read_count < 4) {
        return nullptr;
    }

    // Check for ELF magic (0x7F 'E' 'L' 'F')
    if (magic[0] == 0x7F && magic[1] == 'E' && magic[2] == 'L' && magic[3] == 'F') {
        // ELF: Fast path already failed, no version available.
        return nullptr;
    }

    // Check for Mach-O magic (feedface, cefaedfe, feedfacf, cffaedfe)
    uint32_t magic32 = (magic[3] << 24) | (magic[2] << 16) | (magic[1] << 8) | magic[0];
    if (magic32 == 0xFEEDFACE || magic32 == 0xCEFAEDFE ||
        magic32 == 0xFEEDFACF || magic32 == 0xCFFAEDFE ||
        magic32 == 0xCAFEBABE || magic32 == 0xBEBAFECA) {
        // Mach-O: Fast path already failed, no version available.
        return nullptr;
    }

    // Check for PE magic ('M' 'Z')
    if (magic[0] != 'M' || magic[1] != 'Z') {
        // Unknown format, skip LIEF parsing.
        return nullptr;
    }

    // PE binary: Use LIEF to extract VS_VERSION_INFO.
    // This is the only case where we need full LIEF parsing.
    std::unique_ptr<LIEF::Binary> binary = LIEF::Parser::parse(binary_path);
    if (!binary) {
        return nullptr;
    }

    // Strategy 1: For node-smol, try SMOL_NODE_VER section.
    version = extract_smol_node_version_section(binary.get());
    if (version) {
        return version;
    }

    // Strategy 2: For PE binaries (plain Node.js), try VS_VERSION_INFO resource.
    if (binary->format() == LIEF::Binary::FORMATS::PE) {
        LIEF::PE::Binary* pe = dynamic_cast<LIEF::PE::Binary*>(binary.get());
        if (pe) {
            version = extract_pe_product_version(pe);
            if (version) {
                return version;
            }
        }
    }

    // Strategy 3: Try SMOL_CONFIG section (works for injected binaries).
    version = extract_smol_config_version(binary.get());
    if (version) {
        return version;
    }

    // No version found.
    return nullptr;
}
