/**
 * SMOL stub extraction using LIEF
 *
 * Extracts compressed Node.js binaries from SMOL stubs by reading
 * the __PRESSED_DATA section and decompressing it.
 */

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <vector>

#include <LIEF/LIEF.hpp>

extern "C" {
#include "socketsecurity/bin-infra/segment_names.h"
#include "socketsecurity/bin-infra/compression_common.h"
#include "socketsecurity/bin-infra/compression_constants.h"
#include "socketsecurity/bin-infra/marker_finder.h"
#include "socketsecurity/build-infra/file_utils.h"
#include "socketsecurity/binject/binject.h"
}

/**
 * Extract binary from SMOL compressed stub using LIEF.
 *
 * Reads the __PRESSED_DATA section, decompresses the data, and writes
 * the extracted binary to the output path.
 *
 * @param stub_path Path to SMOL compressed stub
 * @param output_path Path where extracted binary should be written
 * @return 0 on success, -1 on error
 */
extern "C" int smol_extract_binary_lief(const char *stub_path, const char *output_path) {
    if (!stub_path || !output_path) {
        fprintf(stderr, "Error: Invalid arguments to smol_extract_binary_lief\n");
        return -1;
    }

    printf("Extracting SMOL stub using LIEF...\n");
    printf("  Stub: %s\n", stub_path);
    printf("  Output: %s\n", output_path);

    /* Parse binary with LIEF */
    std::unique_ptr<LIEF::Binary> binary = LIEF::Parser::parse(stub_path);
    if (!binary) {
        fprintf(stderr, "Error: Failed to parse binary with LIEF\n");
        return -1;
    }

    /* Determine binary format and find PRESSED_DATA section */
    const uint8_t *compressed_data = nullptr;
    size_t compressed_size = 0;

    if (binary->format() == LIEF::Binary::FORMATS::MACHO) {
        LIEF::MachO::Binary *macho = dynamic_cast<LIEF::MachO::Binary*>(binary.get());
        if (!macho) {
            fprintf(stderr, "Error: Failed to cast to Mach-O binary\n");
            return -1;
        }

        /* Find SMOL segment */
        LIEF::MachO::SegmentCommand *smol_segment = macho->get_segment("SMOL");
        if (!smol_segment) {
            fprintf(stderr, "Error: SMOL segment not found\n");
            return -1;
        }

        /* Find __PRESSED_DATA section */
        LIEF::MachO::Section *pressed_section = nullptr;
        for (LIEF::MachO::Section &sec : smol_segment->sections()) {
            if (sec.name() == "__PRESSED_DATA") {
                pressed_section = &sec;
                break;
            }
        }

        if (!pressed_section) {
            fprintf(stderr, "Error: __PRESSED_DATA section not found\n");
            return -1;
        }

        /* Get section content (LIEF 0.17+ returns span) */
        auto content_span = pressed_section->content();
        if (content_span.empty()) {
            fprintf(stderr, "Error: __PRESSED_DATA section is empty\n");
            return -1;
        }

        compressed_data = content_span.data();
        compressed_size = content_span.size();

        printf("  Found __PRESSED_DATA section: %zu bytes\n", compressed_size);

    } else if (binary->format() == LIEF::Binary::FORMATS::ELF) {
        LIEF::ELF::Binary *elf = dynamic_cast<LIEF::ELF::Binary*>(binary.get());
        if (!elf) {
            fprintf(stderr, "Error: Failed to cast to ELF binary\n");
            return -1;
        }

        /* Find PRESSED_DATA section */
        LIEF::ELF::Section *pressed_section = nullptr;
        for (LIEF::ELF::Section &sec : elf->sections()) {
            if (sec.name() == ".PRESSED_DATA" || sec.name() == "PRESSED_DATA") {
                pressed_section = &sec;
                break;
            }
        }

        if (!pressed_section) {
            fprintf(stderr, "Error: PRESSED_DATA section not found in ELF\n");
            return -1;
        }

        /* Get section content (LIEF 0.17+ returns span) */
        auto content_span = pressed_section->content();
        if (content_span.empty()) {
            fprintf(stderr, "Error: PRESSED_DATA section is empty\n");
            return -1;
        }

        compressed_data = content_span.data();
        compressed_size = content_span.size();

        printf("  Found PRESSED_DATA section: %zu bytes\n", compressed_size);

    } else if (binary->format() == LIEF::Binary::FORMATS::PE) {
        LIEF::PE::Binary *pe = dynamic_cast<LIEF::PE::Binary*>(binary.get());
        if (!pe) {
            fprintf(stderr, "Error: Failed to cast to PE binary\n");
            return -1;
        }

        /* Find PRESSED_DATA section */
        LIEF::PE::Section *pressed_section = nullptr;
        for (LIEF::PE::Section &sec : pe->sections()) {
            if (sec.name() == ".PRESSED_DATA" || sec.name() == "PRESSED_DATA") {
                pressed_section = &sec;
                break;
            }
        }

        if (!pressed_section) {
            fprintf(stderr, "Error: PRESSED_DATA section not found in PE\n");
            return -1;
        }

        /* Get section content (LIEF 0.17+ returns span) */
        auto content_span = pressed_section->content();
        if (content_span.empty()) {
            fprintf(stderr, "Error: PRESSED_DATA section is empty\n");
            return -1;
        }

        compressed_data = content_span.data();
        compressed_size = content_span.size();

        printf("  Found PRESSED_DATA section: %zu bytes\n", compressed_size);

    } else {
        fprintf(stderr, "Error: Unsupported binary format\n");
        return -1;
    }

    /* Parse SMOL metadata from compressed data */
    printf("  Parsing SMOL metadata...\n");

    /* Find magic marker in section data */
    /* Build marker at runtime */
    char marker[MAGIC_MARKER_LEN + 1];
    snprintf(marker, sizeof(marker), "%s%s%s",
             MAGIC_MARKER_PART1, MAGIC_MARKER_PART2, MAGIC_MARKER_PART3);

    /* Search for marker */
    const uint8_t *marker_pos = nullptr;
    for (size_t i = 0; i <= compressed_size - MAGIC_MARKER_LEN; i++) {
        if (memcmp(compressed_data + i, marker, MAGIC_MARKER_LEN) == 0) {
            marker_pos = compressed_data + i;
            break;
        }
    }

    if (!marker_pos) {
        fprintf(stderr, "Error: SMOL magic marker not found in PRESSED_DATA section\n");
        return -1;
    }

    /* Read metadata after marker */
    const uint8_t *metadata_pos = marker_pos + MAGIC_MARKER_LEN;
    size_t remaining = compressed_size - (metadata_pos - compressed_data);

    if (remaining < METADATA_HEADER_LEN) {
        fprintf(stderr, "Error: PRESSED_DATA section too small for metadata\n");
        return -1;
    }

    /* Read sizes */
    uint64_t stored_compressed_size;
    uint64_t uncompressed_size;
    memcpy(&stored_compressed_size, metadata_pos, sizeof(uint64_t));
    memcpy(&uncompressed_size, metadata_pos + sizeof(uint64_t), sizeof(uint64_t));

    printf("  Compressed size: %llu bytes\n", (unsigned long long)stored_compressed_size);
    printf("  Uncompressed size: %llu bytes\n", (unsigned long long)uncompressed_size);

    /* Validate sizes */
    if (uncompressed_size == 0 || uncompressed_size > 500ULL * 1024 * 1024 * 1024) {
        fprintf(stderr, "Error: Invalid uncompressed size: %llu\n",
                (unsigned long long)uncompressed_size);
        return -1;
    }

    if (stored_compressed_size == 0 || stored_compressed_size > compressed_size) {
        fprintf(stderr, "Error: Invalid compressed size: %llu\n",
                (unsigned long long)stored_compressed_size);
        return -1;
    }

    /* Calculate actual compressed data offset */
    /* Metadata format: [compressed_size][uncompressed_size][cache_key][platform_metadata][has_config][optional_config] */
    const uint8_t *data_start = metadata_pos + METADATA_HEADER_LEN;
    size_t actual_compressed_size = stored_compressed_size;

    if (data_start + actual_compressed_size > compressed_data + compressed_size) {
        fprintf(stderr, "Error: Compressed data extends beyond section boundary\n");
        return -1;
    }

    /* Allocate decompression buffer using actual uncompressed size */
    uint8_t *decompressed_data = (uint8_t*)malloc(uncompressed_size);
    if (!decompressed_data) {
        fprintf(stderr, "Error: Out of memory for decompression buffer (%llu bytes)\n",
                (unsigned long long)uncompressed_size);
        return -1;
    }

    /* Decompress using LZFSE (algorithm 0) */
    printf("  Decompressing... (algorithm: LZFSE)\n");
    int decompress_result = decompress_buffer_with_algorithm(
        data_start, actual_compressed_size,
        decompressed_data, uncompressed_size,
        0  /* LZFSE */
    );

    if (decompress_result != COMPRESS_OK) {
        fprintf(stderr, "Error: Decompression failed (code: %d)\n", decompress_result);
        free(decompressed_data);
        return -1;
    }

    /* Write decompressed binary to output */
    if (create_parent_directories(output_path) != 0) {
        fprintf(stderr, "Error: Failed to create parent directories\n");
        free(decompressed_data);
        return -1;
    }

    if (write_file_atomically(output_path, decompressed_data, uncompressed_size, 0755) == -1) {
        fprintf(stderr, "Error: Failed to write extracted binary\n");
        free(decompressed_data);
        return -1;
    }

    if (set_executable_permissions(output_path) != 0) {
        fprintf(stderr, "Error: Failed to set executable permissions\n");
        free(decompressed_data);
        return -1;
    }

    free(decompressed_data);

    printf("  ✓ Extracted (%llu MB)\n", (unsigned long long)(uncompressed_size / 1024 / 1024));
    return 0;
}

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

    // Get version from file_info() (fixed_file_info_t structure)
    const auto& fixed_info = versions[0].file_info();
    uint32_t ms = fixed_info.product_version_ms;
    uint32_t ls = fixed_info.product_version_ls;

    // Product version is stored as: major.minor in MS, patch.build in LS
    uint16_t major = (ms >> 16) & 0xFFFF;
    uint16_t minor = ms & 0xFFFF;
    uint16_t patch = (ls >> 16) & 0xFFFF;
    // uint16_t build = ls & 0xFFFF;  // Usually 0 for Node.js

    // Format as "major.minor.patch"
    char buffer[32];
    snprintf(buffer, sizeof(buffer), "%u.%u.%u", major, minor, patch);

    char* result = static_cast<char*>(malloc(strlen(buffer) + 1));
    if (result) {
        strcpy(result, buffer);
    }
    return result;
}

/**
 * Try to extract Node.js version from pressed data (for stubs).
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

    // Find PRESSED_DATA section based on binary format
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
        if (!pressed_section) pressed_section = elf->get_section("PRESSED_DATA");
        if (!pressed_section) return nullptr;

        auto content_span = pressed_section->content();
        if (content_span.empty()) return nullptr;
        pressed_data = content_span.data();
        pressed_size = content_span.size();

    } else if (binary->format() == LIEF::Binary::FORMATS::PE) {
        LIEF::PE::Binary* pe = dynamic_cast<LIEF::PE::Binary*>(binary);
        if (!pe) return nullptr;

        LIEF::PE::Section* pressed_section = pe->get_section(PE_SECTION_PRESSED_DATA);
        if (!pressed_section) pressed_section = pe->get_section("PRESSED_DATA");
        if (!pressed_section) return nullptr;

        auto content_span = pressed_section->content();
        if (content_span.empty()) return nullptr;
        pressed_data = content_span.data();
        pressed_size = content_span.size();

    } else {
        return nullptr;
    }

    // Build magic marker at runtime to avoid self-match
    char marker[MAGIC_MARKER_LEN + 1];
    snprintf(marker, sizeof(marker), "%s%s%s",
             MAGIC_MARKER_PART1, MAGIC_MARKER_PART2, MAGIC_MARKER_PART3);

    // Find magic marker in pressed data
    const uint8_t* marker_pos = nullptr;
    for (size_t i = 0; i + MAGIC_MARKER_LEN <= pressed_size; i++) {
        if (memcmp(pressed_data + i, marker, MAGIC_MARKER_LEN) == 0) {
            marker_pos = pressed_data + i;
            break;
        }
    }
    if (!marker_pos) return nullptr;

    // Calculate offset to SMFG config
    // Format: [magic][compressed_size 8][uncompressed_size 8][cache_key 16][platform_metadata 3][has_config 1][config if present]
    const uint8_t* metadata_pos = marker_pos + MAGIC_MARKER_LEN;
    size_t remaining = pressed_size - (metadata_pos - pressed_data);
    if (remaining < METADATA_HEADER_LEN) return nullptr;

    // Check has_config flag (at offset: 8 + 8 + 16 + 3 = 35)
    uint8_t has_config = metadata_pos[35];
    if (has_config == 0) return nullptr;

    // SMFG config starts after has_config flag
    const uint8_t* config_data = metadata_pos + METADATA_HEADER_LEN;
    size_t config_remaining = remaining - METADATA_HEADER_LEN;
    if (config_remaining < 1192) return nullptr;  // SMOL_CONFIG_BINARY_LEN v2

    // Verify SMFG magic (0x534D4647)
    uint32_t smfg_magic;
    memcpy(&smfg_magic, config_data, sizeof(smfg_magic));
    if (smfg_magic != 0x534D4647) return nullptr;

    // Check version (must be v2 for nodeVersion)
    uint16_t smfg_version;
    memcpy(&smfg_version, config_data + 4, sizeof(smfg_version));
    if (smfg_version < 2) return nullptr;

    // nodeVersion is at offset 1176 in SMFG binary
    // Header (8) + Numeric (16) + Strings (128 + 256 + 512 + 128 + 64 + 64) = 1176
    size_t node_version_offset = 1176;
    if (node_version_offset >= config_remaining) return nullptr;

    // Read length prefix (1 byte) and string
    uint8_t len = config_data[node_version_offset];
    if (len == 0 || len > 15) return nullptr;

    char* result = static_cast<char*>(malloc(len + 1));
    if (result) {
        memcpy(result, config_data + node_version_offset + 1, len);
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

    // Find SMOL_VFS_CONFIG section based on binary format
    if (binary->format() == LIEF::Binary::FORMATS::MACHO) {
        LIEF::MachO::Binary* macho = dynamic_cast<LIEF::MachO::Binary*>(binary);
        if (!macho) {
            return nullptr;
        }

        // Try NODE_SEA segment first (for injected binaries)
        LIEF::MachO::SegmentCommand* segment = macho->get_segment(MACHO_SEGMENT_NODE_SEA);
        if (!segment) {
            // Fallback to SMOL segment
            segment = macho->get_segment(MACHO_SEGMENT_SMOL);
        }
        if (!segment) {
            return nullptr;
        }

        LIEF::MachO::Section* config_section = nullptr;
        for (LIEF::MachO::Section& sec : segment->sections()) {
            // Check for SMOL_VFS_CONFIG (may be truncated to 16 chars)
            if (sec.name() == MACHO_SECTION_SMOL_VFS_CONFIG ||
                sec.name().rfind("__SMOL_VFS_CONFI", 0) == 0) {
                config_section = &sec;
                break;
            }
        }

        if (!config_section) {
            return nullptr;
        }

        auto content_span = config_section->content();
        if (content_span.empty()) {
            return nullptr;
        }

        config_data = content_span.data();
        config_size = content_span.size();

    } else if (binary->format() == LIEF::Binary::FORMATS::ELF) {
        LIEF::ELF::Binary* elf = dynamic_cast<LIEF::ELF::Binary*>(binary);
        if (!elf) {
            return nullptr;
        }

        // Try to find in notes first
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

        // Fallback to section
        if (!config_data) {
            LIEF::ELF::Section* config_section = elf->get_section(ELF_NOTE_SMOL_VFS_CONFIG);
            if (!config_section) {
                return nullptr;
            }

            auto content_span = config_section->content();
            if (content_span.empty()) {
                return nullptr;
            }

            config_data = content_span.data();
            config_size = content_span.size();
        }

    } else if (binary->format() == LIEF::Binary::FORMATS::PE) {
        LIEF::PE::Binary* pe = dynamic_cast<LIEF::PE::Binary*>(binary);
        if (!pe) {
            return nullptr;
        }

        // Try resource first
        if (pe->has_resources()) {
            auto resources_result = pe->resources_manager();
            if (resources_result) {
                // TODO: Extract from RT_RCDATA resource PE_RESOURCE_SMOL_VFS_CONFIG
            }
        }

        // Fallback to section
        LIEF::PE::Section* config_section = pe->get_section(PE_RESOURCE_SMOL_VFS_CONFIG);
        if (!config_section) {
            return nullptr;
        }

        auto content_span = config_section->content();
        if (content_span.empty()) {
            return nullptr;
        }

        config_data = content_span.data();
        config_size = content_span.size();

    } else {
        return nullptr;
    }

    // SMOL config is stored directly in the SMOL_VFS_CONFIG section (1192 bytes SMFG format)
    // No header prefix - the SMFG binary starts at offset 0
    const size_t SMOL_CONFIG_SIZE_LOCAL = 1192;  // SMFG v2 binary size

    // Validate config size
    if (config_size < SMOL_CONFIG_SIZE_LOCAL) {
        return nullptr;
    }

    // SMOL config starts directly at offset 0
    const uint8_t* smol_config = config_data;

    // Check SMFG magic (0x534D4647 = "SMFG" in little-endian)
    uint32_t magic = *reinterpret_cast<const uint32_t*>(smol_config);
    if (magic != 0x534D4647) {
        return nullptr;
    }

    // Check version (must be v2 or higher for node_version field)
    uint16_t version = *reinterpret_cast<const uint16_t*>(smol_config + 4);
    if (version < 2) {
        return nullptr;
    }

    // Calculate offset to node_version field within SMOL config
    // Header (8) + Numeric (16) + Strings (binname 128 + command 256 + url 512 + tag 128 + skipEnv 64 + fakeArgvEnv 64)
    size_t node_ver_offset = 8 + 16 + 128 + 256 + 512 + 128 + 64 + 64;  // = 1176

    if (node_ver_offset >= SMOL_CONFIG_SIZE_LOCAL) {
        return nullptr;
    }

    // Read node_version string (1 byte length + up to 15 bytes data)
    uint8_t len = smol_config[node_ver_offset];
    if (len == 0 || len > 15) {  // MAX_NODE_VERSION_LEN
        return nullptr;
    }

    // Allocate and copy version string
    char* version_str = static_cast<char*>(malloc(len + 1));
    if (!version_str) {
        return nullptr;
    }

    memcpy(version_str, smol_config + node_ver_offset + 1, len);
    version_str[len] = '\0';

    return version_str;
}

/**
 * Try to extract Node.js version from SMOL_NODE_VERSION section.
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
        if (!macho) {
            return nullptr;
        }

        LIEF::MachO::SegmentCommand* smol_segment = macho->get_segment(MACHO_SEGMENT_SMOL);
        if (!smol_segment) {
            return nullptr;
        }

        LIEF::MachO::Section* version_section = nullptr;
        for (LIEF::MachO::Section& sec : smol_segment->sections()) {
            if (sec.name() == MACHO_SECTION_SMOL_NODE_VER) {
                version_section = &sec;
                break;
            }
        }

        if (!version_section) {
            return nullptr;
        }

        auto content_span = version_section->content();
        if (content_span.empty()) {
            return nullptr;
        }

        version_data = content_span.data();
        version_size = content_span.size();

    } else if (binary->format() == LIEF::Binary::FORMATS::ELF) {
        LIEF::ELF::Binary* elf = dynamic_cast<LIEF::ELF::Binary*>(binary);
        if (!elf) {
            return nullptr;
        }

        // Try as a PT_NOTE first
        for (const LIEF::ELF::Note& note : elf->notes()) {
            if (note.name() == ELF_NOTE_SMOL_NODE_VER) {
                auto desc = note.description();
                if (!desc.empty()) {
                    // Find null terminator or use full length
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

        // Fallback: try as section
        LIEF::ELF::Section* version_section = elf->get_section(ELF_NOTE_SMOL_NODE_VER);
        if (!version_section) {
            return nullptr;
        }

        auto content_span = version_section->content();
        if (content_span.empty()) {
            return nullptr;
        }

        version_data = content_span.data();
        version_size = content_span.size();

    } else if (binary->format() == LIEF::Binary::FORMATS::PE) {
        LIEF::PE::Binary* pe = dynamic_cast<LIEF::PE::Binary*>(binary);
        if (!pe) {
            return nullptr;
        }

        // Try as section (resources would need more complex iteration)
        LIEF::PE::Section* version_section = pe->get_section(PE_RESOURCE_SMOL_NODE_VER);
        if (!version_section) {
            return nullptr;
        }

        auto content_span = version_section->content();
        if (content_span.empty()) {
            return nullptr;
        }

        version_data = content_span.data();
        version_size = content_span.size();

    } else {
        return nullptr;
    }

    // Version string should be null-terminated and reasonable length
    if (version_size == 0 || version_size > 32) {
        return nullptr;
    }

    // Find null terminator
    size_t len = 0;
    while (len < version_size && version_data[len] != 0) {
        len++;
    }

    if (len == 0 || len > 15) {  // MAX_NODE_VERSION_LEN
        return nullptr;
    }

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
 * @return Node version string (e.g., "25.5.0"), or NULL if not found
 *         Caller must free() the returned string.
 */
extern "C" char* smol_extract_node_version(const char* binary_path) {
    if (!binary_path) {
        return nullptr;
    }

    std::unique_ptr<LIEF::Binary> binary = LIEF::Parser::parse(binary_path);
    if (!binary) {
        return nullptr;
    }

    // Strategy 1: For stubs, try pressed data version (SMFG config in PRESSED_DATA)
    char* version = extract_pressed_data_version(binary.get());
    if (version) {
        return version;
    }

    // Strategy 2: For node-smol, try SMOL_NODE_VER section
    version = extract_smol_node_version_section(binary.get());
    if (version) {
        return version;
    }

    // Strategy 3: For PE binaries (plain Node.js), try VS_VERSION_INFO resource
    if (binary->format() == LIEF::Binary::FORMATS::PE) {
        LIEF::PE::Binary* pe = dynamic_cast<LIEF::PE::Binary*>(binary.get());
        if (pe) {
            version = extract_pe_product_version(pe);
            if (version) {
                return version;
            }
        }
    }

    // Strategy 4: Try SMOL_CONFIG section (works for injected binaries)
    version = extract_smol_config_version(binary.get());
    if (version) {
        return version;
    }

    // No version found
    return nullptr;
}
