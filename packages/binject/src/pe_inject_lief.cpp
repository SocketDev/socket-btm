/**
 * PE binary injection using LIEF
 *
 * Uses LIEF C++ library to inject sections into PE binaries.
 * Enables cross-platform PE injection (not restricted to Windows).
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
 * Inject resource into PE binary using LIEF.
 *
 * This implementation follows the same pattern as ELF injection:
 * 1. Parse the PE binary with LIEF::PE::Parser::parse()
 * 2. Create a new section with the content
 * 3. Add the section to the binary with binary->add_section()
 * 4. Write the modified binary with LIEF::PE::Builder
 *
 * @param executable Path to the PE binary.
 * @param section_name Section name (e.g., ".sea" or ".vfs").
 * @param data Resource data to inject.
 * @param size Size of resource data in bytes.
 * @return BINJECT_OK on success, error code otherwise.
 */
extern "C" int binject_pe_lief(const char* executable,
                               const char* section_name,
                               const uint8_t* data,
                               size_t size) {
  if (!executable || !section_name || !data || size == 0) {
    fprintf(stderr, "Error: Invalid arguments\n");
    return BINJECT_ERROR_INVALID_ARGS;
  }

  try {
    printf("Using LIEF for PE injection (cross-platform)...\n");

    // Parse PE binary
    std::unique_ptr<LIEF::PE::Binary> binary =
        LIEF::PE::Parser::parse(executable);

    if (!binary) {
      fprintf(stderr, "Error: Failed to parse PE binary: %s\n", executable);
      return BINJECT_ERROR_INVALID_FORMAT;
    }

    // Check if section already exists and remove it (auto-overwrite)
    LIEF::PE::Section* existing_section = binary->get_section(section_name);
    if (existing_section) {
      printf("Removing existing section %s...\n", section_name);
      binary->remove_section(section_name, /* clear */ true);
      printf("Removed existing section\n");
    }

    // Create new section with content
    printf("Creating section %s with %zu bytes...\n", section_name, size);
    LIEF::PE::Section new_section(section_name);
    std::vector<uint8_t> content_vec(data, data + size);
    new_section.content(std::move(content_vec));

    // Set section characteristics (readable, writable) - use set method
    uint32_t characteristics = static_cast<uint32_t>(
        LIEF::PE::Section::CHARACTERISTICS::MEM_READ |
        LIEF::PE::Section::CHARACTERISTICS::MEM_WRITE
    );
    new_section.characteristics(characteristics);

    // Add section to binary
    binary->add_section(new_section);
    printf("Added section %s to binary\n", section_name);

    // Write modified binary using binary->write() method like ELF
    printf("Writing modified binary...\n");
    binary->write(executable);

    printf("Successfully injected %zu bytes into section %s\n", size, section_name);
    return BINJECT_OK;

  } catch (const std::exception& e) {
    fprintf(stderr, "Error: LIEF exception: %s\n", e.what());
    return BINJECT_ERROR;
  } catch (...) {
    fprintf(stderr, "Error: Unknown exception during LIEF PE injection\n");
    return BINJECT_ERROR;
  }
}
