/**
 * Mach-O binary injection using LIEF
 *
 * Uses LIEF C++ library to inject sections into Mach-O binaries.
 * This bypasses segedit's size limitations and supports unlimited data sizes.
 */

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <stdexcept>
#include <vector>

#include <LIEF/LIEF.hpp>

extern "C" {
#include "binject.h"
}

/**
 * Inject resource into Mach-O binary using LIEF.
 *
 * @param executable Path to the Mach-O binary.
 * @param segment_name Segment name (e.g., "NODE_SEA").
 * @param section_name Section name (e.g., "__NODE_VFS_BLOB").
 * @param data Resource data to inject.
 * @param size Size of resource data.
 * @param overwrite Whether to overwrite existing section.
 * @return BINJECT_OK on success, error code otherwise.
 */
extern "C" int binject_inject_macho_lief(const char* executable,
                                         const char* segment_name,
                                         const char* section_name,
                                         const uint8_t* data,
                                         size_t size,
                                         int overwrite) {
  if (!executable || !segment_name || !section_name || !data || size == 0) {
    fprintf(stderr, "Error: Invalid arguments\n");
    return BINJECT_ERROR_INVALID_ARGS;
  }

  try {
    // Parse Mach-O binary.
    std::unique_ptr<LIEF::MachO::FatBinary> fat_binary =
        LIEF::MachO::Parser::parse(executable);

    if (!fat_binary || fat_binary->empty()) {
      fprintf(stderr, "Error: Failed to parse Mach-O binary: %s\n", executable);
      return BINJECT_ERROR_INVALID_FORMAT;
    }

    // Get the first binary from fat binary (or the only binary if not fat).
    LIEF::MachO::Binary* binary = fat_binary->at(0);
    if (!binary) {
      fprintf(stderr, "Error: No binary found in file\n");
      return BINJECT_ERROR_INVALID_FORMAT;
    }

    // Check if segment already exists.
    LIEF::MachO::SegmentCommand* segment = nullptr;
    if (binary->has_segment(segment_name)) {
      segment = binary->get_segment(segment_name);
      printf("Found existing segment: %s\n", segment_name);
    }

    // Check if section already exists in the segment.
    if (segment && segment->has_section(section_name)) {
      // Section exists - check if we're allowed to overwrite.
      if (!overwrite) {
        fprintf(stderr,
                "Error: Section %s already exists in segment %s (use --overwrite "
                "to replace)\n",
                section_name, segment_name);
        return BINJECT_ERROR_SECTION_EXISTS;
      }

      // Overwrite: Remove existing section and add new one.
      printf("Removing existing section %s from segment %s...\n", section_name,
             segment_name);
      LIEF::MachO::Section* existing_section = segment->get_section(section_name);
      if (existing_section) {
        binary->remove_section(section_name, /* clear */ true);
        printf("Removed existing section\n");
      }
    }

    // Create new section with the data.
    LIEF::MachO::Section new_section(section_name);
    new_section.content(std::vector<uint8_t>(data, data + size));
    new_section.segment_name(segment_name);

    // Set section properties.
    new_section.alignment(0); // No special alignment.
    new_section.type(LIEF::MachO::Section::TYPE::REGULAR);

    // Add section to binary.
    // LIEF will create the segment if it doesn't exist.
    LIEF::MachO::Section* added_section = binary->add_section(new_section);
    if (!added_section) {
      fprintf(stderr, "Error: Failed to add section to binary\n");
      return BINJECT_ERROR;
    }

    printf("Added section %s to segment %s (%zu bytes)\n", section_name,
           segment_name, size);

    // Remove code signature (required after modifying binary).
    if (binary->has_code_signature()) {
      binary->remove_signature();
      printf("Removed code signature (re-sign after injection)\n");
    }

    // Write modified binary.
    fat_binary->write(executable);

    printf("Successfully injected %zu bytes into %s:%s\n", size, segment_name,
           section_name);
    return BINJECT_OK;

  } catch (const std::exception& e) {
    fprintf(stderr, "Error: LIEF exception: %s\n", e.what());
    return BINJECT_ERROR;
  } catch (...) {
    fprintf(stderr, "Error: Unknown exception during LIEF injection\n");
    return BINJECT_ERROR;
  }
}
