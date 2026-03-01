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
 * Extract Node.js version from SMOL config segment.
 *
 * Reads the SMOL_CONFIG segment/section from the binary and extracts
 * the nodeVersion field (added in SMOL config v2).
 *
 * @param binary_path Path to node-smol binary
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

    const uint8_t* config_data = nullptr;
    size_t config_size = 0;

    // Find SMOL_CONFIG section based on binary format
    if (binary->format() == LIEF::Binary::FORMATS::MACHO) {
        LIEF::MachO::Binary* macho = dynamic_cast<LIEF::MachO::Binary*>(binary.get());
        if (!macho) {
            return nullptr;
        }

        LIEF::MachO::SegmentCommand* smol_segment = macho->get_segment("SMOL");
        if (!smol_segment) {
            return nullptr;
        }

        LIEF::MachO::Section* config_section = nullptr;
        for (LIEF::MachO::Section& sec : smol_segment->sections()) {
            if (sec.name() == "__SMOL_CONFIG") {
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
        LIEF::ELF::Binary* elf = dynamic_cast<LIEF::ELF::Binary*>(binary.get());
        if (!elf) {
            return nullptr;
        }

        LIEF::ELF::Section* config_section = elf->get_section("SMOL_CONFIG");
        if (!config_section) {
            return nullptr;
        }

        auto content_span = config_section->content();
        if (content_span.empty()) {
            return nullptr;
        }

        config_data = content_span.data();
        config_size = content_span.size();

    } else if (binary->format() == LIEF::Binary::FORMATS::PE) {
        LIEF::PE::Binary* pe = dynamic_cast<LIEF::PE::Binary*>(binary.get());
        if (!pe) {
            return nullptr;
        }

        LIEF::PE::Section* config_section = pe->get_section("SMOLCFG");
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

    // Validate config size
    if (config_size < 1200) {  // SMOL_CONFIG_SIZE
        return nullptr;
    }

    // Check magic
    uint32_t magic = *reinterpret_cast<const uint32_t*>(config_data);
    if (magic != 0x534D4647) {  // SMOL_CONFIG_MAGIC
        return nullptr;
    }

    // Check version (must be v2 or higher for node_version field)
    uint16_t version = *reinterpret_cast<const uint16_t*>(config_data + 4);
    if (version < 2) {
        return nullptr;
    }

    // Calculate offset to node_version field
    // Header (8) + Numeric (16) + Strings (binname 128 + command 256 + url 512 + tag 128 + skipEnv 64 + fakeArgvEnv 64)
    size_t offset = 8 + 16 + 128 + 256 + 512 + 128 + 64 + 64;  // = 1176

    if (offset >= config_size) {
        return nullptr;
    }

    // Read node_version string (1 byte length + up to 15 bytes data)
    uint8_t len = config_data[offset];
    if (len == 0 || len > 15) {  // MAX_NODE_VERSION_LEN
        return nullptr;
    }

    // Allocate and copy version string
    char* version_str = static_cast<char*>(malloc(len + 1));
    if (!version_str) {
        return nullptr;
    }

    memcpy(version_str, config_data + offset + 1, len);
    version_str[len] = '\0';

    return version_str;
}
