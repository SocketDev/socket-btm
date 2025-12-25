/**
 * ELF binary injection using LIEF
 *
 * Uses LIEF C++ library to inject sections into ELF binaries.
 * Enables cross-platform ELF injection (not restricted to Linux).
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
 * Inject resource into ELF binary using LIEF.
 *
 * This implementation follows the pattern from LIEF's elf_add_section.cpp example:
 * 1. Parse the ELF binary with LIEF::ELF::Parser::parse()
 * 2. Create a new section with the content
 * 3. Add the section to the binary with binary->add()
 * 4. Write the modified binary with binary->write()
 *
 * @param executable Path to the ELF binary.
 * @param section_name Section name (e.g., ".sea" or ".vfs").
 * @param data Resource data to inject.
 * @param size Size of resource data in bytes.
 * @return BINJECT_OK on success, error code otherwise.
 */
extern "C" int binject_elf_lief(const char* executable,
                                const char* section_name,
                                const uint8_t* data,
                                size_t size) {
  if (!executable || !section_name || !data || size == 0) {
    fprintf(stderr, "Error: Invalid arguments\n");
    return BINJECT_ERROR_INVALID_ARGS;
  }

  try {
    printf("Using LIEF for ELF injection (cross-platform)...\n");

    // Parse ELF binary
    std::unique_ptr<LIEF::ELF::Binary> binary =
        LIEF::ELF::Parser::parse(executable);

    if (!binary) {
      fprintf(stderr, "Error: Failed to parse ELF binary: %s\n", executable);
      return BINJECT_ERROR_INVALID_FORMAT;
    }

    // Check if section already exists and remove it (auto-overwrite)
    if (binary->has_section(section_name)) {
      printf("Removing existing section %s...\n", section_name);
      binary->remove_section(section_name, /* clear */ true);
      printf("Removed existing section\n");
    }

    // Create new section with content (following LIEF example pattern)
    printf("Creating section %s with %zu bytes...\n", section_name, size);
    LIEF::ELF::Section new_section(section_name);
    std::vector<uint8_t> content_vec(data, data + size);
    new_section.content(std::move(content_vec));

    // Add section to binary
    binary->add(new_section);
    printf("Added section %s to binary\n", section_name);

    // Write modified binary
    printf("Writing modified binary...\n");
    binary->write(executable);

    printf("Successfully injected %zu bytes into section %s\n", size, section_name);
    return BINJECT_OK;

  } catch (const std::exception& e) {
    fprintf(stderr, "Error: LIEF exception: %s\n", e.what());
    return BINJECT_ERROR;
  } catch (...) {
    fprintf(stderr, "Error: Unknown exception during LIEF ELF injection\n");
    return BINJECT_ERROR;
  }
}
