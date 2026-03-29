/**
 * smol_repack_lief.cpp - Shared SMOL segment repack using LIEF
 *
 * Extracted from binject's binject_macho_repack_smol_lief() to share between
 * binpress and binject for consistent SMOL segment repacking.
 */

#include <stdio.h>
#include <sys/stat.h>

#ifndef _WIN32
#include <sys/types.h>
#endif

#include <LIEF/LIEF.hpp>
#include "socketsecurity/bin-infra/stub_smol_repack_lief.h"
#include "socketsecurity/bin-infra/macho_lief_utils.hpp"
#include "socketsecurity/build-infra/file_utils.h"
#include "socketsecurity/build-infra/file_io_common.h"
#include "socketsecurity/bin-infra/smol_segment.h"
#include "socketsecurity/bin-infra/segment_names.h"
#include "socketsecurity/bin-infra/elf_note_utils.hpp"

extern "C" int smol_repack_lief(
    const char* stub_path,
    const uint8_t* section_data,
    size_t section_size,
    const char* output_path,
    const char* extracted_source_path) {

    if (!stub_path || !section_data || !output_path || section_size == 0) {
        fprintf(stderr, "Error: Invalid arguments to repack function (NULL parameter or zero size)\n");
        return -1;
    }

        printf("Repacking SMOL segment with LIEF...\n");
        printf("  Stub: %s\n", stub_path);
        printf("  New content size: %zu bytes\n", section_size);
        printf("  Output: %s\n", output_path);

        // Parse the compressed stub.
        std::unique_ptr<LIEF::MachO::FatBinary> fat_binary =
            LIEF::MachO::Parser::parse(stub_path);

        if (!fat_binary || fat_binary->empty()) {
            fprintf(stderr, "Error: Failed to parse Mach-O binary: %s\n", stub_path);
            return -1;
        }

        LIEF::MachO::Binary* binary = fat_binary->at(0);
        if (!binary) {
            fprintf(stderr, "Error: No binary found in file\n");
            return -1;
        }

        // Find the SMOL segment.
        if (!binary->has_segment(MACHO_SEGMENT_SMOL)) {
            fprintf(stderr, "Error: %s segment not found in stub\n", MACHO_SEGMENT_SMOL);
            return -1;
        }

        printf("  Found %s segment, removing and recreating with new size...\n", MACHO_SEGMENT_SMOL);

        // Preserve NODE_SEA segment sections if they exist (SEA blob, VFS blob, VFS config).
        // These must be preserved across stub repacking when SEA/VFS have been injected.
        // Read from extracted_source_path (the modified binary) not stub_path (the original).
        struct PreservedSection {
            std::string name;
            std::vector<uint8_t> content;
            uint32_t alignment;
        };
        std::vector<PreservedSection> preserved_sections;

        if (extracted_source_path) {
            // Parse the extracted binary that has been modified with SEA/VFS injection.
            std::unique_ptr<LIEF::MachO::FatBinary> source_fat = LIEF::MachO::Parser::parse(extracted_source_path);
            if (source_fat && !source_fat->empty()) {
                LIEF::MachO::Binary* source_binary = source_fat->at(0);
                if (source_binary && source_binary->has_segment(MACHO_SEGMENT_NODE_SEA)) {
                    printf("  Found %s segment in extracted source, preserving sections...\n", MACHO_SEGMENT_NODE_SEA);
                    LIEF::MachO::SegmentCommand* node_sea = source_binary->get_segment(MACHO_SEGMENT_NODE_SEA);
                    if (node_sea) {
                        for (const LIEF::MachO::Section& section : node_sea->sections()) {
                            PreservedSection preserved;
                            preserved.name = section.name();
                            auto content_span = section.content();
                            preserved.content = std::vector<uint8_t>(content_span.begin(), content_span.end());
                            preserved.alignment = section.alignment();
                            preserved_sections.push_back(preserved);
                            printf("    Preserved section %s (%zu bytes)\n", preserved.name.c_str(), preserved.content.size());
                        }
                    }
                }
            }
        }

        // CRITICAL ORDER: Remove old segment BEFORE adding new one.
        // LIEF's section->content() doesn't properly resize when new content is larger.
        if (remove_segment_by_name(binary, MACHO_SEGMENT_SMOL) != 0) {
            return -1;
        }

        printf("  Removed old %s segment\n", MACHO_SEGMENT_SMOL);

        // Create new SMOL segment with updated content.
        LIEF::MachO::SegmentCommand new_smol(MACHO_SEGMENT_SMOL);
        new_smol.init_protection(1);  // VM_PROT_READ
        new_smol.max_protection(1);   // VM_PROT_READ

        // Create __PRESSED_DATA section with new content.
        LIEF::MachO::Section pressed_section(MACHO_SECTION_PRESSED_DATA);
        std::vector<uint8_t> new_content(section_data, section_data + section_size);
        pressed_section.content(new_content);
        pressed_section.alignment(2);  // 4-byte alignment
        pressed_section.type(LIEF::MachO::Section::TYPE::REGULAR);

        // Add section to segment before adding to binary.
        new_smol.add_section(pressed_section);

        // Add the new segment to binary.
        LIEF::MachO::LoadCommand* added = binary->add(new_smol);
        if (!added) {
            fprintf(stderr, "Error: Failed to add new SMOL segment\n");
            return -1;
        }

        printf("  Created new SMOL segment with %zu bytes\n", section_size);

        // Restore NODE_SEA sections if they were preserved.
        if (!preserved_sections.empty()) {
            printf("  Restoring %s segment with %zu section(s)...\n", MACHO_SEGMENT_NODE_SEA, preserved_sections.size());

            // Remove existing NODE_SEA segment if present (cleanup before restoration).
            if (binary->has_segment(MACHO_SEGMENT_NODE_SEA)) {
                if (remove_segment_by_name(binary, MACHO_SEGMENT_NODE_SEA) != 0) {
                    fprintf(stderr, "Warning: Failed to remove existing NODE_SEA segment before restoration\n");
                }
            }

            // Create new NODE_SEA segment.
            LIEF::MachO::SegmentCommand node_sea_segment(MACHO_SEGMENT_NODE_SEA);
            node_sea_segment.init_protection(1);  // VM_PROT_READ
            node_sea_segment.max_protection(1);   // VM_PROT_READ

            // Add all preserved sections.
            for (const PreservedSection& preserved : preserved_sections) {
                LIEF::MachO::Section section(preserved.name);
                section.content(preserved.content);
                section.alignment(preserved.alignment);
                section.type(LIEF::MachO::Section::TYPE::REGULAR);
                node_sea_segment.add_section(section);
                printf("    Restored section %s (%zu bytes)\n", preserved.name.c_str(), preserved.content.size());
            }

            // Add NODE_SEA segment to binary.
            if (!binary->add(node_sea_segment)) {
                fprintf(stderr, "Error: Failed to restore NODE_SEA segment\n");
                return -1;
            }
            printf("  ✓ NODE_SEA segment restored successfully\n");
        }

        // CRITICAL ORDER: Remove signature AFTER segment manipulation.
        // Removing signature before causes LIEF chained fixups bug (segfault).
        if (binary->has(LIEF::MachO::LoadCommand::TYPE::CODE_SIGNATURE)) {
            printf("  Removing existing code signature...\n");
            binary->remove_signature();
        }

        // Create parent directories if needed.
        if (create_parent_directories(output_path) != 0) {
            fprintf(stderr, "Error: Failed to create parent directories for output path: %s\n", output_path);
            return -1;
        }

        // Write modified binary.
        printf("  Writing modified binary...\n");
        // CRITICAL: Use explicit config to ensure proper segment/section building
        LIEF::MachO::Builder::config_t config;
        binary->write(output_path, config);

        // Note: Explicit fsync removed to avoid blocking indefinitely on some filesystems.
        // LIEF's write() has already completed, and the kernel will sync asynchronously.

        // CRITICAL: Verify write succeeded immediately
        struct stat st;
        if (stat(output_path, &st) != 0) {
            int saved_errno = errno;
            fprintf(stderr, "Error: LIEF write() failed - file not created: %s\n", output_path);
            fprintf(stderr, "  errno: %d (%s)\n", saved_errno, strerror(saved_errno));
            fprintf(stderr, "  Common causes on macOS:\n");
            fprintf(stderr, "    - Insufficient disk space\n");
            fprintf(stderr, "    - Permission denied\n");
            fprintf(stderr, "    - APFS snapshot interference\n");
            fprintf(stderr, "    - SIP protected path\n");
            return -1;
        }
        if (st.st_size == 0) {
            fprintf(stderr, "Error: LIEF wrote empty file: %s\n", output_path);
            return -1;
        }
        printf("  ✓ File created successfully (%lld bytes)\n", (long long)st.st_size);

        // Set executable permissions.
        if (set_executable_permissions(output_path) != 0) {
            fprintf(stderr, "Error: Failed to set executable permissions\n");
            return -1;
        }

        // Sign with ad-hoc signature using shared utility.
        printf("  Signing binary with ad-hoc signature...\n");
        if (smol_codesign(output_path) != 0) {
            fprintf(stderr, "Error: Failed to sign repacked stub\n");
            return -1;
        }

        printf("  ✓ SMOL segment repacked successfully\n");
        return 0;

}

/**
 * Repack ELF binary with updated SMOL section (Linux).
 *
 * Uses raw byte manipulation to preserve PHT at original offset.
 * For static glibc binaries, PHT MUST stay at offset 64 because glibc
 * reads it from base+phoff in memory. LIEF's write() relocates PHT,
 * causing SIGSEGV on static binaries.
 *
 * This function handles two workflows:
 * 1. Updating existing compressed stub (binpress -u): Replaces existing PT_NOTE
 * 2. Compressing regular binary (binject repack): Adds new PT_NOTE
 */
extern "C" int smol_repack_lief_elf(
    const char* stub_path,
    const uint8_t* section_data,
    size_t section_size,
    const char* output_path) {

    if (!stub_path || !section_data || !output_path || section_size == 0) {
        fprintf(stderr, "Error: Invalid arguments to repack function (NULL parameter or zero size)\n");
        return -1;
    }

    printf("Repacking SMOL section (ELF)...\n");
    printf("  Stub: %s\n", stub_path);
    printf("  New content size: %zu bytes\n", section_size);
    printf("  Output: %s\n", output_path);

    // Create parent directories if needed.
    if (create_parent_directories(output_path) != 0) {
        fprintf(stderr, "Error: Failed to create parent directories for output path: %s\n", output_path);
        return -1;
    }

    // Use shared raw note writer that preserves PHT location.
    // This modifies an existing PT_NOTE entry in-place instead of using
    // LIEF's write() which would restructure the binary.
    std::vector<uint8_t> note_data(section_data, section_data + section_size);

    int result = elf_note_utils::smol_reuse_single_ptnote(
        stub_path,
        output_path,
        ELF_NOTE_PRESSED_DATA,
        note_data
    );

    if (result != 0) {
        fprintf(stderr, "Error: Failed to write ELF with raw note\n");
        return -1;
    }

    printf("  ✓ SMOL section repacked successfully (ELF)\n");
    return 0;
}

/**
 * Repack PE binary with updated SMOL section (Windows).
 * Similar to ELF version but handles PE sections.
 */
extern "C" int smol_repack_lief_pe(
    const char* stub_path,
    const uint8_t* section_data,
    size_t section_size,
    const char* output_path) {

    if (!stub_path || !section_data || !output_path || section_size == 0) {
        fprintf(stderr, "Error: Invalid arguments to repack function (NULL parameter or zero size)\n");
        return -1;
    }

        printf("Repacking SMOL section with LIEF (PE)...\n");
        printf("  Stub: %s\n", stub_path);
        printf("  New content size: %zu bytes\n", section_size);
        printf("  Output: %s\n", output_path);

        // Parse the compressed stub as PE.
        std::unique_ptr<LIEF::PE::Binary> binary =
            LIEF::PE::Parser::parse(stub_path);

        if (!binary) {
            fprintf(stderr, "Error: Failed to parse PE binary: %s\n", stub_path);
            return -1;
        }

        // Find the SMOL section.
        // Section name matches Mach-O: __PRESSED_DATA -> .pressed_data (PE lowercase convention)
        const char* section_name = PE_SECTION_PRESSED_DATA;

        // CRITICAL: Remove old section BEFORE adding new one.
        // LIEF's section->content() doesn't properly resize when new content is larger.
        // We must remove and recreate the section to ensure proper sizing.
        LIEF::PE::Section* old_section = binary->get_section(section_name);
        if (old_section) {
            printf("  Found existing %s section, removing and recreating...\n", section_name);
            binary->remove_section(section_name, true);  // true = clear content
        } else {
            printf("  Creating new %s section...\n", section_name);
        }

        // Create new section with updated content.
        std::vector<uint8_t> new_content(section_data, section_data + section_size);

        LIEF::PE::Section new_section(section_name);
        new_section.content(new_content);
        // Note: PE section alignment is managed by the PE builder, not set directly on sections
        // MEM_READ = readable in memory (matches Mach-O VM_PROT_READ)
        // CNT_INITIALIZED_DATA = initialized data section
        new_section.characteristics(static_cast<uint32_t>(
            LIEF::PE::Section::CHARACTERISTICS::MEM_READ |
            LIEF::PE::Section::CHARACTERISTICS::CNT_INITIALIZED_DATA
        ));

        // Add section to binary
        binary->add_section(new_section);

        printf("  Updated SMOL section with %zu bytes\n", section_size);

        // Note: PE signatures are typically invalidated when modifying sections.
        // Unlike Mach-O, we don't need to explicitly remove them here.
        // The OS will simply fail signature validation on modified binaries.

        // Create parent directories if needed.
        if (create_parent_directories(output_path) != 0) {
            fprintf(stderr, "Error: Failed to create parent directories for output path: %s\n", output_path);
            return -1;
        }

        // Write modified binary.
        printf("  Writing modified PE binary...\n");
        // CRITICAL: Use explicit config to ensure proper segment/section building
        // Conservative config matching pe_inject_lief.cpp for consistency
        LIEF::PE::Builder::config_t config;
        config.resources = true;      // Rebuild resources (SMOL section in .rsrc)
        config.imports = false;       // Don't modify imports
        config.exports = false;       // Don't modify exports
        config.relocations = false;   // Don't modify relocations
        config.load_configuration = false;  // Don't modify load config
        config.tls = false;           // Don't modify TLS
        config.overlay = true;        // Preserve overlay data
        config.dos_stub = true;       // Preserve DOS stub
        config.debug = false;         // Don't modify debug info
        binary->write(output_path, config);

        // Note: Explicit fsync removed to avoid blocking indefinitely on some filesystems.
        // LIEF's write() has already completed, and the kernel will sync asynchronously.

        // CRITICAL: Verify write succeeded immediately
        struct stat st;
        if (stat(output_path, &st) != 0) {
            int saved_errno = errno;
            fprintf(stderr, "Error: LIEF write() failed - file not created: %s\n", output_path);
            fprintf(stderr, "  errno: %d (%s)\n", saved_errno, strerror(saved_errno));
            fprintf(stderr, "  Common causes:\n");
            fprintf(stderr, "    - Insufficient disk space\n");
            fprintf(stderr, "    - Permission denied\n");
            return -1;
        }
        if (st.st_size == 0) {
            fprintf(stderr, "Error: LIEF wrote empty file: %s\n", output_path);
            return -1;
        }
        printf("  ✓ File created successfully (%lld bytes)\n", (long long)st.st_size);

        printf("  ✓ SMOL section repacked successfully (PE)\n");
        return 0;

}
