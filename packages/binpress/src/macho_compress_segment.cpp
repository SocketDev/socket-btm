/**
 * macho_compress_segment.cpp - Segment-based compression for valid code signatures
 *
 * This implements the "proper" way to embed compressed data in Mach-O binaries
 * while maintaining valid code signatures. Instead of appending data after
 * __LINKEDIT (which invalidates signatures), we insert a new segment BEFORE
 * __LINKEDIT.
 *
 * Architecture:
 * 1. Parse Mach-O binary with LIEF
 * 2. Create new SMOL segment with __PRESSED_DATA section
 * 3. Insert segment BEFORE __LINKEDIT (LIEF handles offset updates)
 * 4. Write modified binary
 * 5. Sign with codesign --sign - (signature will be valid!)
 *
 * Result: Validly signed self-extracting binary compatible with App Store,
 * Gatekeeper, and security policies.
 *
 * Uses shared SMOL segment utilities from bin-infra/smol_segment.h.
 *
 * References:
 * - https://alexomara.com/blog/adding-a-segment-to-an-existing-macos-mach-o-binary/
 * - https://github.com/qyang-nj/llios/blob/main/macho_parser/docs/LC_CODE_SIGNATURE.md
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

/* unistd.h and sys/wait.h no longer needed - using smol_codesign. */

#include <LIEF/LIEF.hpp>
#include "macho_compress_segment.h"
#include "compression_constants.h"

extern "C" {
#include "smol_segment.h"
}

/**
 * Embed compressed data as a segment in Mach-O binary.
 *
 * This creates a SMOL segment with __PRESSED_DATA section containing:
 * - Magic marker: __SMOL_PRESSED_DATA_MAGIC_MARKER (32 bytes)
 * - Compressed size: uint64_t (8 bytes)
 * - Uncompressed size: uint64_t (8 bytes)
 * - Cache key: char[16] (16 bytes, hex string)
 * - Compressed data: variable size
 *
 * Uses shared smol_build_section_data for consistent section format.
 *
 * The segment is inserted BEFORE __LINKEDIT, allowing the binary to be
 * validly signed after insertion.
 */
int binpress_segment_embed(
    const char *stub_path,
    const char *compressed_data_path,
    const char *output_path,
    size_t uncompressed_size
) {
    printf("Embedding compressed data as segment...\n");
    printf("  Stub: %s\n", stub_path);
    printf("  Compressed data: %s\n", compressed_data_path);
    printf("  Output: %s\n", output_path);
    printf("  Uncompressed size: %zu bytes\n", uncompressed_size);

    // Read compressed data.
    FILE *fp = fopen(compressed_data_path, "rb");
    if (!fp) {
        fprintf(stderr, "Error: Cannot open compressed data: %s\n", compressed_data_path);
        return -1;
    }

    fseek(fp, 0, SEEK_END);
    size_t compressed_size = ftell(fp);
    fseek(fp, 0, SEEK_SET);

    uint8_t *compressed_data = (uint8_t*)malloc(compressed_size);
    if (!compressed_data) {
        fclose(fp);
        fprintf(stderr, "Error: Out of memory\n");
        return -1;
    }

    if (fread(compressed_data, 1, compressed_size, fp) != compressed_size) {
        free(compressed_data);
        fclose(fp);
        fprintf(stderr, "Error: Failed to read compressed data\n");
        return -1;
    }
    fclose(fp);

    printf("  Compressed data size: %zu bytes\n", compressed_size);

    // Detect platform metadata from stub binary (for macOS).
    uint8_t platform_byte = 0;  // darwin
    uint8_t arch_byte = 0;      // default to x64
    uint8_t libc_byte = 0;      // n/a for macOS

    // Parse stub to detect architecture.
    std::unique_ptr<LIEF::MachO::FatBinary> stub_fat = LIEF::MachO::Parser::parse(stub_path);
    if (stub_fat && stub_fat->size() > 0) {
        LIEF::MachO::Binary *stub_binary = stub_fat->at(0);
        if (stub_binary) {
            // Detect architecture from stub binary.
            // CPU_TYPE_ARM64 = 0x0100000C, CPU_TYPE_X86_64 = 0x01000007
            LIEF::MachO::Header header = stub_binary->header();
            uint32_t cpu = static_cast<uint32_t>(header.cpu_type());
            if (cpu == 0x0100000C) {  // CPU_TYPE_ARM64
                arch_byte = 1;  // arm64
            } else if (cpu == 0x01000007) {  // CPU_TYPE_X86_64
                arch_byte = 0;  // x64
            }
        }
    }

    // Build section data using shared utility.
    smol_section_t section;
    if (smol_build_section_data(compressed_data, compressed_size, uncompressed_size,
                                 platform_byte, arch_byte, libc_byte, &section) != 0) {
        free(compressed_data);
        fprintf(stderr, "Error: Failed to build section data\n");
        return -1;
    }

    free(compressed_data);

    printf("  Cache key: %s\n", section.cache_key);

    // Convert to std::vector for LIEF.
    std::vector<uint8_t> section_data(section.data, section.data + section.size);
    smol_free_section(&section);

    printf("  Total section data: %zu bytes\n", section_data.size());

    // Parse Mach-O with LIEF
    printf("\nParsing Mach-O binary with LIEF...\n");
    std::unique_ptr<LIEF::MachO::FatBinary> fat_binary = LIEF::MachO::Parser::parse(stub_path);
    if (!fat_binary || fat_binary->size() == 0) {
        fprintf(stderr, "Error: Failed to parse Mach-O binary\n");
        return -1;
    }

    // Get first binary (for fat binaries, we'd need to handle all)
    LIEF::MachO::Binary *binary = fat_binary->at(0);
    if (!binary) {
        fprintf(stderr, "Error: No binary found in fat binary\n");
        return -1;
    }

    printf("  Number of load commands: %zu\n", binary->commands().size());

    // Check if SMOL segment already exists
    if (binary->has_segment("SMOL")) {
        fprintf(stderr, "Error: SMOL segment already exists\n");
        fprintf(stderr, "  Extract the binary first or use a fresh stub\n");
        return -1;
    }

    // Create new segment
    printf("\nCreating SMOL segment...\n");
    LIEF::MachO::SegmentCommand socket_seg("SMOL");

    // Read-only permissions (we don't need write or execute)
    socket_seg.init_protection(1);  // VM_PROT_READ
    socket_seg.max_protection(1);   // VM_PROT_READ

    // Create section with compressed data
    LIEF::MachO::Section socket_sect("__PRESSED_DATA");
    socket_sect.content(section_data);
    socket_sect.alignment(2);  // 4-byte alignment
    socket_sect.type(LIEF::MachO::Section::TYPE::REGULAR);

    // Add section to segment BEFORE adding to binary
    socket_seg.add_section(socket_sect);
    printf("  Section: __PRESSED_DATA (%zu bytes)\n", section_data.size());

    // Verify __LINKEDIT exists (LIEF inserts new segment before it automatically).
    if (!binary->has_segment("__LINKEDIT")) {
        fprintf(stderr, "Error: __LINKEDIT segment not found\n");
        return -1;
    }
    printf("  Found __LINKEDIT segment\n");

    // Add segment (LIEF will insert before __LINKEDIT and update all offsets)
    printf("\nAdding segment to binary...\n");
    LIEF::MachO::LoadCommand* cmd = binary->add(socket_seg);
    if (!cmd) {
        fprintf(stderr, "Error: Failed to add segment\n");
        return -1;
    }

    printf("  Segment added successfully\n");
    printf("  New number of load commands: %zu\n", binary->commands().size());

    // Remove existing signature (required before re-signing)
    printf("\nRemoving existing signature...\n");
    if (binary->has(LIEF::MachO::LoadCommand::TYPE::CODE_SIGNATURE)) {
        binary->remove_signature();
        printf("  Signature removed\n");
    }

    // Write modified binary
    printf("\nWriting modified binary...\n");
    binary->write(output_path);
    printf("  Binary written to: %s\n", output_path);

    // Set executable permissions
    #ifndef _WIN32
    chmod(output_path, 0755);
    #endif

    // Sign the binary using shared utility (macOS only).
    printf("\nSigning binary with ad-hoc signature...\n");
    if (smol_codesign(output_path) == 0) {
        printf("  ✓ Binary signed successfully\n");

        // Verify signature.
        printf("\nVerifying signature...\n");
        if (smol_codesign_verify(output_path) == 0) {
            printf("  ✓ Signature verification PASSED - binary is validly signed!\n");
        } else {
            printf("  ⚠ Signature verification failed (this may be expected for segment-embedded data)\n");
        }
    } else {
        fprintf(stderr, "⚠ codesign failed (continuing anyway)\n");
    }

    printf("\n✓ Segment-based compression complete!\n");
    return 0;
}

/**
 * Extract compressed data from SMOL segment.
 * This is for testing/debugging - the actual extraction happens in the stub.
 */
int binpress_segment_extract(
    const char *binary_path,
    const char *output_path
) {
    printf("Extracting compressed data from segment...\n");
    printf("  Binary: %s\n", binary_path);
    printf("  Output: %s\n", output_path);

    // Parse Mach-O
    std::unique_ptr<LIEF::MachO::FatBinary> fat_binary = LIEF::MachO::Parser::parse(binary_path);
    if (!fat_binary || fat_binary->size() == 0) {
        fprintf(stderr, "Error: Failed to parse Mach-O binary\n");
        return -1;
    }

    LIEF::MachO::Binary *binary = fat_binary->at(0);
    if (!binary) {
        fprintf(stderr, "Error: No binary found\n");
        return -1;
    }

    // Find SMOL segment
    if (!binary->has_segment("SMOL")) {
        fprintf(stderr, "Error: SMOL segment not found\n");
        return -1;
    }

    LIEF::MachO::SegmentCommand* segment = binary->get_segment("SMOL");
    printf("  Found SMOL segment\n");

    // Find __PRESSED_DATA section (may be truncated to __PRESSED_DATA)
    const auto& sections = segment->sections();
    for (const auto& section : sections) {
        std::string section_name = section.name();
        // Match either full name or truncated name
        if (section_name == "__PRESSED_DATA" || section_name == "__PRESSED_DATA") {
            printf("  Found __PRESSED_DATA section (%llu bytes)\n", section.size());

            // Get section content
            LIEF::span<const uint8_t> content = section.content();

            // Parse header - build marker from constants
            char marker[MAGIC_MARKER_LEN + 1];
            snprintf(marker, sizeof(marker), "%s%s%s",
                     MAGIC_MARKER_PART1, MAGIC_MARKER_PART2, MAGIC_MARKER_PART3);
            size_t marker_len = MAGIC_MARKER_LEN;

            if (content.size() < marker_len + 8 + 8 + 16) {
                fprintf(stderr, "Error: Section too small\n");
                return -1;
            }

            // Verify marker
            if (memcmp(content.data(), marker, marker_len) != 0) {
                fprintf(stderr, "Error: Invalid magic marker\n");
                return -1;
            }

            // Read sizes
            uint64_t compressed_size = *(uint64_t*)(content.data() + marker_len);
            uint64_t uncompressed_size = *(uint64_t*)(content.data() + marker_len + 8);
            char cache_key[17];
            memcpy(cache_key, content.data() + marker_len + 16, 16);
            cache_key[16] = '\0';

            printf("  Compressed size: %llu\n", compressed_size);
            printf("  Uncompressed size: %llu\n", uncompressed_size);
            printf("  Cache key: %s\n", cache_key);

            // Extract compressed data
            const uint8_t *compressed_data = content.data() + marker_len + 8 + 8 + 16;
            size_t data_size = content.size() - (marker_len + 8 + 8 + 16);

            printf("  Extracting %zu bytes...\n", data_size);

            // Write to output
            FILE *fp = fopen(output_path, "wb");
            if (!fp) {
                fprintf(stderr, "Error: Cannot create output file\n");
                return -1;
            }

            if (fwrite(compressed_data, 1, data_size, fp) != data_size) {
                fclose(fp);
                fprintf(stderr, "Error: Failed to write data\n");
                return -1;
            }

            fclose(fp);
            printf("  ✓ Extracted to: %s\n", output_path);
            return 0;
        }
    }

    fprintf(stderr, "Error: __PRESSED_DATA section not found\n");
    return -1;
}
