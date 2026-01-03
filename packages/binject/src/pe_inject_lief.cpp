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
#include <limits.h>
#include <sys/stat.h>

// Platform-specific headers.
#ifdef _WIN32
#include <process.h>
#include <io.h>
#ifndef PATH_MAX
#define PATH_MAX 260
#endif
#else
#include <unistd.h>
#endif

#include <LIEF/LIEF.hpp>

extern "C" {
#include "binject.h"
}

/**
 * Inject resource into PE binary using LIEF.
 *
 * Implementation pattern (unified across PE/ELF/Mach-O):
 * 1. Validate arguments (allow NULL data with size 0 for VFS compat mode).
 * 2. Parse binary with LIEF parser.
 * 3. Remove existing section if present (auto-overwrite).
 * 4. Create new section with content.
 * 5. Set platform-specific attributes (PE: characteristics).
 * 6. Add section to binary.
 * 7. Platform-specific post-processing (PE: none required).
 * 8. Write modified binary (atomic rename workflow).
 *
 * @param executable Path to the PE binary.
 * @param section_name Section name (e.g., "NODE_SEA" or "NODE_VFS").
 * @param data Resource data to inject.
 * @param size Size of resource data in bytes.
 * @return BINJECT_OK on success, error code otherwise.
 */
extern "C" int binject_pe_lief(const char* executable,
                               const char* section_name,
                               const uint8_t* data,
                               size_t size) {
  // Step 1: Validate arguments.
  if (!executable || !section_name) {
    fprintf(stderr, "Error: Invalid arguments (NULL parameter)\n");
    return BINJECT_ERROR_INVALID_ARGS;
  }

  // Allow NULL data with size 0 for VFS compatibility mode (0-byte section).
  if (!data && size != 0) {
    fprintf(stderr, "Error: Invalid arguments (data is NULL but size is non-zero)\n");
    return BINJECT_ERROR_INVALID_ARGS;
  }

  try {
    printf("Using LIEF for PE injection (cross-platform)...\n");

    // Step 2: Parse binary.
    std::unique_ptr<LIEF::PE::Binary> binary =
        LIEF::PE::Parser::parse(executable);

    if (!binary) {
      fprintf(stderr, "Error: Failed to parse PE binary: %s\n", executable);
      return BINJECT_ERROR_INVALID_FORMAT;
    }

    // Step 3: Remove existing section if present (auto-overwrite).
    LIEF::PE::Section* existing_section = binary->get_section(section_name);
    if (existing_section) {
      printf("Removing existing section %s...\n", section_name);
      binary->remove_section(section_name, /* clear */ true);
      printf("Removed existing section\n");
    }

    // Step 4: Create new section with content.
    printf("Creating section %s with %zu bytes...\n", section_name, size);
    LIEF::PE::Section new_section(section_name);
    if (size > 0 && data) {
      std::vector<uint8_t> content_vec(data, data + size);
      new_section.content(std::move(content_vec));
    }

    // Step 5: Set platform-specific attributes.
    // PE: Set section characteristics (readable, writable).
    uint32_t characteristics = static_cast<uint32_t>(
        LIEF::PE::Section::CHARACTERISTICS::MEM_READ |
        LIEF::PE::Section::CHARACTERISTICS::MEM_WRITE
    );
    new_section.characteristics(characteristics);

    // Step 6: Add section to binary.
    binary->add_section(new_section);
    printf("Added section %s to binary\n", section_name);

    // Step 7: Platform-specific post-processing.
    // PE: No additional post-processing required.

    // Step 8: Write modified binary (atomic rename workflow).
    char tmpfile[PATH_MAX];
    snprintf(tmpfile, sizeof(tmpfile), "%s.tmp.%d", executable, getpid());

    printf("Writing modified binary...\n");
    binary->write(tmpfile);

    // Set executable permissions (Unix only).
#ifndef _WIN32
    if (chmod(tmpfile, 0755) != 0) {
        fprintf(stderr, "Error: Failed to set executable permissions\n");
        unlink(tmpfile);
        return BINJECT_ERROR_WRITE_FAILED;
    }
#endif

    // Atomic rename (on POSIX systems, rename() is atomic and overwrites).
    // On Windows, must remove first as rename() doesn't overwrite.
#ifdef _WIN32
    remove(executable);
#endif
    if (rename(tmpfile, executable) != 0) {
        fprintf(stderr, "Error: Failed to rename temporary file to output\n");
        unlink(tmpfile);
        return BINJECT_ERROR_WRITE_FAILED;
    }

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
