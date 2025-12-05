/**
 * Mach-O binary injection implementation using LIEF
 *
 * Injects resources into Mach-O binaries by adding a new segment with a custom section
 * containing the resource data. Uses LIEF library for robust binary manipulation.
 */

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <vector>
#include <sys/stat.h>

#include <LIEF/LIEF.hpp>

extern "C" {
#include "binject.h"
}

// Segment and section names
#define BINJECT_SEGMENT_NAME "__BINJECT"
#define BINJECT_META_SUFFIX "_meta"

// Metadata structure (stored in a separate section)
struct binject_metadata {
    uint32_t magic;          // 0x424A5421 ("BJT!")
    uint32_t version;        // Metadata version
    uint32_t checksum;       // Original data checksum
    uint32_t is_compressed;  // 1 if compressed, 0 if not
    uint32_t original_size;  // Original uncompressed size
    uint32_t data_size;      // Size of data in main section
    char section_name[56];   // Name of data section (for verification)
};

#define BINJECT_MAGIC 0x424A5421  // "BJT!"
#define BINJECT_VERSION 1

/**
 * Inject resource into Mach-O binary using LIEF
 */
int binject_inject_macho(const char *executable, const char *section_name,
                          const uint8_t *data, size_t size, uint32_t checksum, int is_compressed) {
    (void)checksum;      // Not yet used - TODO: implement metadata
    (void)is_compressed; // Not yet used - TODO: implement metadata

    if (!executable || !section_name || !data || size == 0) {
        fprintf(stderr, "Error: Invalid arguments\n");
        return BINJECT_ERROR;
    }

    try {
        // Parse the Mach-O binary
        std::unique_ptr<LIEF::MachO::FatBinary> fat_binary =
            LIEF::MachO::Parser::parse(executable);

        if (!fat_binary) {
            fprintf(stderr, "Error: Failed to parse Mach-O binary: %s\n", executable);
            return BINJECT_ERROR_INVALID_FORMAT;
        }

        // Get the number of architectures
        size_t num_binaries = fat_binary->size();
        if (num_binaries == 0) {
            fprintf(stderr, "Error: No architectures found in binary\n");
            return BINJECT_ERROR_INVALID_FORMAT;
        }

        // Inject into all architectures
        for (size_t i = 0; i < num_binaries; i++) {
            LIEF::MachO::Binary* binary = fat_binary->at(i);
            if (!binary) {
                continue;
            }

            // Check if it's 64-bit
            // Note: Skipping architecture check for LIEF 0.14.0 compatibility
            // TODO: Restore architecture validation when stable on newer LIEF

            // Implementation based on postject's approach for safer segment/section handling
            // Reference: https://github.com/nodejs/postject/blob/main/src/postject.cpp

            // Try to get existing segment or create a new one
            // See postject.cpp:219-221 - Check if segment exists before creating new one
            LIEF::MachO::SegmentCommand* segment = nullptr;
            if (binary->has_segment(BINJECT_SEGMENT_NAME)) {
                segment = binary->get_segment(BINJECT_SEGMENT_NAME);
            }

            // Create a new section with the data
            // See postject.cpp:223-225 - Create section with data vector
            LIEF::MachO::Section section(section_name, std::vector<uint8_t>(data, data + size));
            section.segment_name(BINJECT_SEGMENT_NAME);
            section.alignment(3); // 2^3 = 8 bytes

            if (segment != nullptr) {
                // Add section to existing segment using binary.add_section()
                // See postject.cpp:247 - Reuse existing segment when possible
                binary->add_section(*segment, section);
            } else {
                // Create new segment with read-only protection
                // See postject.cpp:227-230 - Mark segment as read-only with VM_PROT_READ
                LIEF::MachO::SegmentCommand new_segment(BINJECT_SEGMENT_NAME);
                // Note: Skipping VM protection settings for LIEF 0.14.0 compatibility
                // TODO: Restore VM protections when stable on newer LIEF
                // new_segment.max_protection(static_cast<uint32_t>(LIEF::MachO::VM_PROTECTIONS::READ));
                // new_segment.init_protection(static_cast<uint32_t>(LIEF::MachO::VM_PROTECTIONS::READ));

                // Add section to new segment then add segment to binary
                // See postject.cpp:232-233 - Add section then segment to binary
                new_segment.add_section(section);
                binary->add(new_segment);
            }

            // Remove code signature if present (will be invalid after modification)
            // See postject.cpp:251-253 - Signature removal with comment "it will need to be signed again anyway"
            if (binary->has_code_signature()) {
                binary->remove_signature();
            }
        }

        // Write the modified binary back
        // NOTE: LIEF has a known limitation with Mach-O segment/section addition:
        // "This method may corrupt the file if the segment is not the first one nor the last one"
        // Reference: https://lief.re/doc/stable/doxygen/classLIEF_1_1MachO_1_1Binary.html
        //
        // We follow postject's approach to minimize risk:
        // - Reuse existing segments when possible (binary.add_section())
        // - Only create new segments when necessary
        // - Remove code signatures before writing
        //
        // However, complex binaries like Node.js may still be corrupted due to this LIEF limitation.
        // See postject.cpp:256-258 for their write implementation
        fat_binary->write(executable);

        // Preserve executable permissions
        struct stat st;
        if (stat(executable, &st) == 0) {
            chmod(executable, st.st_mode);
        }

        printf("✓ Successfully injected %zu bytes into %s\n", size, executable);
        return BINJECT_OK;

    } catch (const std::exception& e) {
        fprintf(stderr, "Error: LIEF exception: %s\n", e.what());
        return BINJECT_ERROR;
    } catch (...) {
        fprintf(stderr, "Error: Unknown exception during injection\n");
        return BINJECT_ERROR;
    }
}

/**
 * List all binject resources in Mach-O binary
 */
int binject_list_macho(const char *executable) {
    (void)executable;
    fprintf(stderr, "Error: List operation not yet implemented for Mach-O binaries\n");
    return BINJECT_ERROR;
}

/**
 * Extract resource from Mach-O binary
 */
int binject_extract_macho(const char *executable, const char *section_name,
                           const char *output_file) {
    (void)executable;
    (void)section_name;
    (void)output_file;
    fprintf(stderr, "Error: Extract operation not yet implemented for Mach-O binaries\n");
    return BINJECT_ERROR;
}

/**
 * Verify resource integrity in Mach-O binary
 */
int binject_verify_macho(const char *executable, const char *section_name) {
    (void)executable;
    (void)section_name;
    fprintf(stderr, "Error: Verify operation not yet implemented for Mach-O binaries\n");
    return BINJECT_ERROR;
}
