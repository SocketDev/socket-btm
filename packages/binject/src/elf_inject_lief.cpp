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
#include "segment_names.h"
#include "binject.h"
#include "file_utils.h"
}

// Shared DRY infrastructure (must come after binject.h for error codes)
#include "binject_file_utils.hpp"
#include "binject_lief_traits.hpp"
#include "binject_sea_fuse.hpp"
#include "binject_section_ops.hpp"

/**
 * Inject resource into ELF binary using LIEF.
 *
 * IMPORTANT: Uses PT_NOTE segments (not sections) to align with postject.
 * - postject uses PT_NOTE segments for ELF resource injection
 * - Node.js searches PT_NOTE segments via postject_find_resource()
 * - This creates notes instead of sections to match expected format
 *
 * Implementation pattern:
 * 1. Validate arguments (allow NULL data with size 0 for VFS compat mode).
 * 2. Parse binary with LIEF parser.
 * 3. Remove existing note if present (auto-overwrite).
 * 4. Create new note with content (using LIEF::ELF::Note API).
 * 5. Set platform-specific attributes (ELF: LIEF handles PT_NOTE automatically).
 * 6. Add note to binary.
 * 7. Platform-specific post-processing (ELF: none required).
 * 8. Write modified binary (atomic rename workflow).
 *
 * @param executable Path to the ELF binary.
 * @param section_name Note name (e.g., "NODE_SEA_BLOB" or "NODE_VFS_BLOB").
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

    // Step 3: Remove existing note if present (auto-overwrite).
    // Check for existing notes with the same name
    bool note_exists = false;
    for (const auto& note : binary->notes()) {
      if (note.name() == section_name) {
        note_exists = true;
        break;
      }
    }

    if (note_exists) {
      printf("Removing existing note %s...\n", section_name);
      // Remove by creating a copy and removing all matching notes
      std::vector<LIEF::ELF::Note*> to_remove;
      for (auto& note : binary->notes()) {
        if (note.name() == section_name) {
          to_remove.push_back(&note);
        }
      }
      for (auto* note : to_remove) {
        binary->remove(*note);
      }
      printf("Removed existing note\n");
    }

    // Step 4: Create new note with content (using PT_NOTE segments instead of sections).
    // This aligns with postject's approach and Node.js's postject_find_resource() expectations.
    printf("Creating note %s with %zu bytes...\n", section_name, size);

    std::vector<uint8_t> description;
    if (size > 0 && data) {
      description.assign(data, data + size);
    }

    // Create note using LIEF::ELF::Note API
    // CRITICAL: Use uint32_t(0) overload, NOT Note::TYPE::UNKNOWN enum!
    //
    // The TYPE::UNKNOWN enum overload calls raw_type() which only recognizes
    // standard owners (CORE, GNU, LINUX, ANDROID, GO, etc.) and returns
    // nullptr for custom owners like "NODE_SEA_BLOB".
    //
    // The uint32_t overload has a fallback path that creates a basic Note
    // with TYPE::UNKNOWN instead of failing, allowing custom notes.
    //
    // Parameters:
    // - name: Owner name (e.g., "NODE_SEA_BLOB")
    // - type: 0 for custom notes (will be stored as TYPE::UNKNOWN internally)
    // - description: The actual resource data
    // - section_name: Empty string to let LIEF handle section naming
    // - ftype/arch/cls: Used by LIEF for type resolution (NONE = use defaults)
    auto note = LIEF::ELF::Note::create(
        section_name,                          // name (owner)
        uint32_t(0),                           // type (0 for custom note)
        description,                           // description (data)
        "",                                    // section_name (auto-generate)
        LIEF::ELF::Header::FILE_TYPE::NONE,    // ftype
        LIEF::ELF::ARCH::NONE,                 // arch
        LIEF::ELF::Header::CLASS::NONE         // cls
    );

    // Step 5: Set platform-specific attributes.
    // ELF Notes: LIEF handles PT_NOTE segment creation automatically.

    // Step 6: Add note to binary.
    if (note) {
      binary->add(*note);
      printf("Added note %s to binary (will create PT_NOTE segment)\n", section_name);
    } else {
      fprintf(stderr, "Error: Failed to create ELF note for owner '%s'\n", section_name);
      fprintf(stderr, "  Note owner: %s\n", section_name);
      fprintf(stderr, "  Data size: %zu bytes\n", size);
      fprintf(stderr, "  This indicates LIEF Note::create() returned nullptr\n");
      fprintf(stderr, "  Possible causes:\n");
      fprintf(stderr, "    - Invalid owner name\n");
      fprintf(stderr, "    - Memory allocation failure\n");
      fprintf(stderr, "    - LIEF internal error\n");
      return BINJECT_ERROR;
    }

    // Step 7: Platform-specific post-processing.
    // ELF: No additional post-processing required.

    // Step 8: Write modified binary (atomic rename workflow).
    // Uses shared utilities from binject_file_utils.hpp (replaces ~45 lines)
    char tmpfile[PATH_MAX];
    binject::create_temp_path(executable, tmpfile, sizeof(tmpfile));

    // Create parent directories if needed.
    if (create_parent_directories(tmpfile) != 0) {
      fprintf(stderr, "Error: Failed to create parent directories for output path: %s\n", tmpfile);
      return BINJECT_ERROR;
    }

    printf("Writing modified binary...\n");
    // CRITICAL: Enable PT_NOTE segment building (disabled by default in LIEF)
    // Without this, PT_NOTE segment headers are created but content is NOT written,
    // causing segfaults when the dynamic linker tries to process invalid segments.
    LIEF::ELF::Builder::config_t config;
    config.notes = true;
    binary->write(tmpfile, config);

    // Verify file was actually written (LIEF may silently fail on some platforms).
    int result = binject::verify_file_written(tmpfile);
    if (result != BINJECT_OK) {
        return result;
    }

    // Set executable permissions (Unix only).
    result = binject::set_executable_permissions(tmpfile);
    if (result != BINJECT_OK) {
        return result;
    }

    // Atomic rename (handles platform differences internally).
    result = binject::atomic_rename(tmpfile, executable);
    if (result != BINJECT_OK) {
        return result;
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

/**
 * Batch inject both SEA and VFS notes in a single LIEF pass.
 *
 * IMPORTANT: Uses PT_NOTE segments (not sections) to align with postject.
 * - postject uses PT_NOTE segments for ELF resource injection
 * - Node.js searches PT_NOTE segments via postject_find_resource()
 * - This creates notes instead of sections to match expected format
 *
 * IMPORTANT: LIEF Memory Corruption Prevention
 *
 * LIEF has known bugs where internal state becomes corrupted when:
 * 1. The same binary is parsed multiple times in the same process
 * 2. A binary is modified, written, then re-parsed
 *
 * This batch function avoids these issues by:
 * - Parsing the binary ONCE
 * - Adding ALL notes in a single pass
 * - Writing the binary ONCE
 *
 * @param executable Path to the input ELF binary.
 * @param output Path to write the modified binary.
 * @param sea_data SEA blob data to inject (or NULL to skip).
 * @param sea_size Size of SEA data in bytes.
 * @param vfs_data VFS blob data to inject (or NULL to skip).
 * @param vfs_size Size of VFS data in bytes.
 * @param vfs_compat_mode If true and vfs_data is NULL, inject 0-byte VFS note.
 * @return BINJECT_OK on success, error code otherwise.
 */
extern "C" int binject_elf_lief_batch(
    const char *executable,
    const char *output,
    const uint8_t *sea_data, size_t sea_size,
    const uint8_t *vfs_data, size_t vfs_size,
    int vfs_compat_mode
) {
  if (!executable || !output) {
    fprintf(stderr, "Error: Invalid arguments (NULL parameter)\n");
    return BINJECT_ERROR_INVALID_ARGS;
  }

  try {
    printf("Using LIEF for ELF batch injection (single-pass)...\n");

    // Single parse - avoid LIEF memory corruption from multiple parses
    std::unique_ptr<LIEF::ELF::Binary> binary =
        LIEF::ELF::Parser::parse(executable);

    if (!binary) {
      fprintf(stderr, "Error: Failed to parse ELF binary: %s\n", executable);
      return BINJECT_ERROR_INVALID_FORMAT;
    }

    // Check if NODE_SEA_BLOB note already exists (for fuse flip logic)
    bool note_exists = false;
    for (const auto& note : binary->notes()) {
      if (note.name() == ELF_NOTE_NODE_SEA_BLOB) {
        note_exists = true;
        break;
      }
    }

    // Flip NODE_SEA_FUSE if needed (uses template from binject_sea_fuse.hpp)
    // Replaces 40 lines of duplicate fuse flipping code
    binject::flip_fuse_if_needed(binary.get(), sea_data, sea_size);

    // Remove existing NODE_SEA_BLOB note if it exists (AFTER fuse check)
    if (note_exists) {
      printf("Removing existing %s note...\n", ELF_NOTE_NODE_SEA_BLOB);
      std::vector<LIEF::ELF::Note*> to_remove;
      for (auto& note : binary->notes()) {
        if (note.name() == ELF_NOTE_NODE_SEA_BLOB) {
          to_remove.push_back(&note);
        }
      }
      for (auto* note : to_remove) {
        binary->remove(*note);
      }
    }

    // Add SEA note if provided (using PT_NOTE segment instead of section)
    // CRITICAL: Use uint32_t(0) overload, NOT Note::TYPE::UNKNOWN enum!
    // See comment in binject_elf_lief() for detailed explanation.
    if (sea_data && sea_size > 0) {
      printf("Creating %s note with %zu bytes...\n", ELF_NOTE_NODE_SEA_BLOB, sea_size);
      std::vector<uint8_t> sea_description(sea_data, sea_data + sea_size);

      auto sea_note = LIEF::ELF::Note::create(
          ELF_NOTE_NODE_SEA_BLOB,            // name (owner)
          uint32_t(0),                       // type (0 for custom note)
          sea_description,                   // description (data)
          "",                                // section_name (auto-generate)
          LIEF::ELF::Header::FILE_TYPE::NONE,  // ftype
          LIEF::ELF::ARCH::NONE,             // arch
          LIEF::ELF::Header::CLASS::NONE     // cls
      );

      if (sea_note) {
        binary->add(*sea_note);
        printf("Added %s note to binary (will create PT_NOTE segment)\n", ELF_NOTE_NODE_SEA_BLOB);
      } else {
        fprintf(stderr, "Error: Failed to create ELF note for owner '%s'\n", ELF_NOTE_NODE_SEA_BLOB);
        fprintf(stderr, "  Note owner: %s\n", ELF_NOTE_NODE_SEA_BLOB);
        fprintf(stderr, "  Data size: %zu bytes\n", sea_size);
        fprintf(stderr, "  This indicates LIEF Note::create() returned nullptr\n");
        fprintf(stderr, "  Verify you're using the uint32_t overload, not TYPE enum\n");
        return BINJECT_ERROR;
      }
    }

    // Add VFS note if provided (or 0-byte in compat mode)
    if (vfs_data || vfs_compat_mode) {
      // Remove existing VFS note if present
      bool vfs_note_exists = false;
      for (const auto& note : binary->notes()) {
        if (note.name() == ELF_NOTE_SMOL_VFS_BLOB) {
          vfs_note_exists = true;
          break;
        }
      }

      if (vfs_note_exists) {
        printf("Removing existing %s note...\n", ELF_NOTE_SMOL_VFS_BLOB);
        std::vector<LIEF::ELF::Note*> to_remove;
        for (auto& note : binary->notes()) {
          if (note.name() == ELF_NOTE_SMOL_VFS_BLOB) {
            to_remove.push_back(&note);
          }
        }
        for (auto* note : to_remove) {
          binary->remove(*note);
        }
      }

      if (vfs_compat_mode && vfs_size == 0) {
        printf("Creating empty %s note (0 bytes, compatibility mode)...\n", ELF_NOTE_SMOL_VFS_BLOB);
        std::vector<uint8_t> empty_description;

        auto vfs_note = LIEF::ELF::Note::create(
            ELF_NOTE_SMOL_VFS_BLOB,            // name (owner)
            uint32_t(0),                       // type (0 for custom note)
            empty_description,                 // description (empty)
            "",                                // section_name (auto-generate)
            LIEF::ELF::Header::FILE_TYPE::NONE,  // ftype
            LIEF::ELF::ARCH::NONE,             // arch
            LIEF::ELF::Header::CLASS::NONE     // cls
        );

        if (vfs_note) {
          binary->add(*vfs_note);
          printf("Added empty %s note to binary (will create PT_NOTE segment)\n", ELF_NOTE_SMOL_VFS_BLOB);
        } else {
          fprintf(stderr, "Error: Failed to create ELF note for owner '%s' (empty, compatibility mode)\n", ELF_NOTE_SMOL_VFS_BLOB);
          fprintf(stderr, "  Note owner: %s\n", ELF_NOTE_SMOL_VFS_BLOB);
          fprintf(stderr, "  Data size: 0 bytes (empty note)\n");
          fprintf(stderr, "  This indicates LIEF Note::create() returned nullptr\n");
          fprintf(stderr, "  Verify you're using the uint32_t overload, not TYPE enum\n");
          return BINJECT_ERROR;
        }
      } else if (vfs_data && vfs_size > 0) {
        printf("Creating %s note with %zu bytes...\n", ELF_NOTE_SMOL_VFS_BLOB, vfs_size);
        std::vector<uint8_t> vfs_description(vfs_data, vfs_data + vfs_size);

        auto vfs_note = LIEF::ELF::Note::create(
            ELF_NOTE_SMOL_VFS_BLOB,            // name (owner)
            uint32_t(0),                       // type (0 for custom note)
            vfs_description,                   // description (data)
            "",                                // section_name (auto-generate)
            LIEF::ELF::Header::FILE_TYPE::NONE,  // ftype
            LIEF::ELF::ARCH::NONE,             // arch
            LIEF::ELF::Header::CLASS::NONE     // cls
        );

        if (vfs_note) {
          binary->add(*vfs_note);
          printf("Added %s note to binary (will create PT_NOTE segment)\n", ELF_NOTE_SMOL_VFS_BLOB);
        } else {
          fprintf(stderr, "Error: Failed to create ELF note for owner '%s'\n", ELF_NOTE_SMOL_VFS_BLOB);
          fprintf(stderr, "  Note owner: %s\n", ELF_NOTE_SMOL_VFS_BLOB);
          fprintf(stderr, "  Data size: %zu bytes\n", vfs_size);
          fprintf(stderr, "  This indicates LIEF Note::create() returned nullptr\n");
          fprintf(stderr, "  Verify you're using the uint32_t overload, not TYPE enum\n");
          return BINJECT_ERROR;
        }
      }
    }

    // Create parent directories if needed
    if (create_parent_directories(output) != 0) {
      fprintf(stderr, "Error: Failed to create parent directories for output: %s\n", output);
      return BINJECT_ERROR;
    }

    // Write to temp file first, then atomic rename (consistent with Mach-O batch)
    // Uses shared utilities from binject_file_utils.hpp (Phase 3 refactoring)
    char tmpfile[PATH_MAX];
    binject::create_temp_path(output, tmpfile, sizeof(tmpfile));

    // Single write - avoid LIEF memory corruption from write-then-reparse
    printf("Writing modified ELF binary to temp file...\n");
    // CRITICAL: Enable PT_NOTE segment building (disabled by default in LIEF)
    // Without this, PT_NOTE segment headers are created but content is NOT written,
    // causing segfaults when the dynamic linker tries to process invalid segments.
    LIEF::ELF::Builder::config_t config;
    config.notes = true;
    binary->write(tmpfile, config);

    // Verify file was actually written
    int result = binject::verify_file_written(tmpfile);
    if (result != BINJECT_OK) {
      return result;
    }

    // Set executable permissions (Unix only)
    result = binject::set_executable_permissions(tmpfile);
    if (result != BINJECT_OK) {
      return result;
    }

    // Atomic rename to final destination
    result = binject::atomic_rename(tmpfile, output);
    if (result != BINJECT_OK) {
      return result;
    }

    printf("Successfully injected notes into ELF binary (PT_NOTE segments)\n");
    return BINJECT_OK;

  } catch (const std::exception& e) {
    fprintf(stderr, "Error: LIEF exception: %s\n", e.what());
    return BINJECT_ERROR;
  } catch (...) {
    fprintf(stderr, "Error: Unknown exception during LIEF ELF batch injection\n");
    return BINJECT_ERROR;
  }
}

/**
 * List ELF sections of interest using LIEF (cross-platform).
 */
extern "C" int binject_elf_list_lief(const char* executable) {
  // Use template from binject_section_ops.hpp (Phase 4 refactoring)
  // Replaces ~60 lines of duplicate code with single template call
  return binject::list_sections<LIEF::ELF::Binary>(executable);
}

/**
 * Extract section from ELF binary using LIEF (cross-platform).
 */
extern "C" int binject_elf_extract_lief(const char* executable, const char* section_name, const char* output_file) {
  // Use template from binject_section_ops.hpp (Phase 4 refactoring)
  // Replaces ~62 lines of duplicate code with single template call
  return binject::extract_section<LIEF::ELF::Binary>(executable, section_name, output_file);
}

/**
 * Verify section exists in ELF binary using LIEF (cross-platform).
 */
extern "C" int binject_elf_verify_lief(const char* executable, const char* section_name) {
  // Use template from binject_section_ops.hpp (Phase 4 refactoring)
  // Replaces ~34 lines of duplicate code with single template call
  return binject::verify_section<LIEF::ELF::Binary>(executable, section_name);
}
