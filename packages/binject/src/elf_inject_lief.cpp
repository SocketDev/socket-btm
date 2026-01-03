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
 * Inject resource into ELF binary using LIEF.
 *
 * Implementation pattern (unified across PE/ELF/Mach-O):
 * 1. Validate arguments (allow NULL data with size 0 for VFS compat mode).
 * 2. Parse binary with LIEF parser.
 * 3. Remove existing section if present (auto-overwrite).
 * 4. Create new section with content.
 * 5. Set platform-specific attributes (ELF: none required).
 * 6. Add section to binary.
 * 7. Platform-specific post-processing (ELF: none required).
 * 8. Write modified binary (atomic rename workflow).
 *
 * @param executable Path to the ELF binary.
 * @param section_name Section name (e.g., "NODE_SEA_BLOB" or "NODE_VFS_BLOB").
 * @param data Resource data to inject.
 * @param size Size of resource data in bytes.
 * @return BINJECT_OK on success, error code otherwise.
 */
extern "C" int binject_elf_lief(const char* executable,
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
    printf("Using LIEF for ELF injection (cross-platform)...\n");

    // Step 2: Parse binary.
    std::unique_ptr<LIEF::ELF::Binary> binary =
        LIEF::ELF::Parser::parse(executable);

    if (!binary) {
      fprintf(stderr, "Error: Failed to parse ELF binary: %s\n", executable);
      return BINJECT_ERROR_INVALID_FORMAT;
    }

    // Step 3: Remove existing section if present (auto-overwrite).
    if (binary->has_section(section_name)) {
      printf("Removing existing section %s...\n", section_name);
      binary->remove_section(section_name, /* clear */ true);
      printf("Removed existing section\n");
    }

    // Step 4: Create new section with content.
    printf("Creating section %s with %zu bytes...\n", section_name, size);
    LIEF::ELF::Section new_section(section_name);
    if (size > 0 && data) {
      std::vector<uint8_t> content_vec(data, data + size);
      new_section.content(std::move(content_vec));
    }

    // Step 5: Set platform-specific attributes.
    // ELF: No additional attributes required (LIEF handles defaults).

    // Step 6: Add section to binary.
    binary->add(new_section);
    printf("Added section %s to binary\n", section_name);

    // Step 7: Platform-specific post-processing.
    // ELF: No additional post-processing required.

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
    fprintf(stderr, "Error: Unknown exception during LIEF ELF injection\n");
    return BINJECT_ERROR;
  }
}
