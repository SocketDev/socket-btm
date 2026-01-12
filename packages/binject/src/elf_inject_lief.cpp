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
      // Remove all notes with matching name, restarting iteration after each removal
      // to avoid iterator invalidation issues
      bool found;
      do {
        found = false;
        for (auto& note : binary->notes()) {
          if (note.name() == section_name) {
            binary->remove(note);
            found = true;
            break;  // Restart iteration after removal
          }
        }
      } while (found);
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
    // - section_name: MUST specify section name for custom notes (LIEF #1026 fix)
    // - ftype/arch/cls: Used by LIEF for type resolution (NONE = use defaults)
    //
    // CRITICAL: We must provide a specific section name (not empty string) for LIEF
    // to properly serialize the note. This is required post-LIEF #1026 regression fix.
    // Format: .note.<owner_name> (e.g., ".note.NODE_SEA_BLOB")
    std::string note_section = std::string(".note.") + section_name;
    auto note = LIEF::ELF::Note::create(
        section_name,                          // name (owner)
        uint32_t(0),                           // type (0 for custom note)
        description,                           // description (data)
        note_section,                          // section_name (e.g., ".note.NODE_SEA_BLOB")
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

    // EXPERIMENTAL: Try minimal config to preserve binary layout
    // We need config.notes = true to write the PT_NOTE segment we just added,
    // but we want to minimize other changes to prevent PHT relocation.
    // Disable ALL rebuilding except notes.
    LIEF::ELF::Builder::config_t config;
    config.dt_hash = false;
    config.dyn_str = false;
    config.dynamic_section = false;
    config.fini_array = false;
    config.gnu_hash = false;
    config.init_array = false;
    config.interpreter = false;
    config.jmprel = false;
    config.notes = true;  // MUST be true to write the note we added
    config.preinit_array = false;
    config.relr = false;
    config.android_rela = false;
    config.rela = false;
    config.static_symtab = false;
    config.sym_verdef = false;
    config.sym_verneed = false;
    config.sym_versym = false;
    config.symtab = false;
    config.coredump_notes = false;
    config.force_relocate = false;
    config.skip_dynamic = true;

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
      // Remove all notes with matching name, restarting iteration after each removal
      // to avoid iterator invalidation issues
      bool found;
      do {
        found = false;
        for (auto& note : binary->notes()) {
          if (note.name() == ELF_NOTE_NODE_SEA_BLOB) {
            binary->remove(note);
            found = true;
            break;  // Restart iteration after removal
          }
        }
      } while (found);
    }

    // Use LIEF's high-level Note API like postject does
    // This is much simpler and lets LIEF handle all the complexity
    if (sea_data && sea_size > 0) {
      printf("Creating NODE_SEA_BLOB note with %zu bytes...\n", sea_size);

      // Convert raw data to vector for LIEF
      std::vector<uint8_t> desc(sea_data, sea_data + sea_size);

      // CRITICAL FIX for LIEF Issue #1026:
      // Custom notes MUST specify section_name parameter in the format ".note.<owner_name>"
      // Without this, LIEF's binary->write() will NOT serialize the note to disk
      // This matches postject's approach and ensures Node.js SEA works correctly
      std::string section_name = std::string(".note.") + ELF_NOTE_NODE_SEA_BLOB;

      // Create note using static factory method with section_name parameter
      // Signature: Note::create(name, type, description, section_name, ...)
      auto note = LIEF::ELF::Note::create(
        ELF_NOTE_NODE_SEA_BLOB,  // name/owner
        uint32_t(0),              // type (0 for custom notes)
        desc,                     // description (SEA blob data)
        section_name              // section_name (REQUIRED for serialization)
      );

      // CRITICAL: Check if note creation succeeded before adding to binary
      if (!note) {
        fprintf(stderr, "Error: Failed to create NODE_SEA_BLOB note\n");
        fprintf(stderr, "  Owner: %s\n", ELF_NOTE_NODE_SEA_BLOB);
        fprintf(stderr, "  Size: %zu bytes\n", sea_size);
        fprintf(stderr, "  Section: %s\n", section_name.c_str());
        fprintf(stderr, "  This indicates LIEF Note::create() failed\n");
        return BINJECT_ERROR;
      }

      // Add note to binary - LIEF will handle PT_NOTE segment creation
      binary->add(*note);

      printf("Added NODE_SEA_BLOB note to binary with section_name: %s\n", section_name.c_str());
    }

    // Inject VFS note (aligns with Mach-O __SMOL_VFS_BLOB and PE SMOL_VFS_BLOB)
    // Supports both real VFS data and compat mode (0-byte placeholder)
    if ((vfs_data && vfs_size > 0) || vfs_compat_mode) {
      // Remove existing SMOL_VFS_BLOB note if it exists
      bool vfs_note_exists = false;
      for (const auto& note : binary->notes()) {
        if (note.name() == ELF_NOTE_SMOL_VFS_BLOB) {
          vfs_note_exists = true;
          break;
        }
      }

      if (vfs_note_exists) {
        printf("Removing existing %s note...\n", ELF_NOTE_SMOL_VFS_BLOB);
        // Use safe iterator removal pattern
        bool found;
        do {
          found = false;
          for (auto& note : binary->notes()) {
            if (note.name() == ELF_NOTE_SMOL_VFS_BLOB) {
              binary->remove(note);
              found = true;
              break;  // Restart iteration after removal
            }
          }
        } while (found);
      }

      // Determine VFS data to inject
      const uint8_t* vfs_inject_data = vfs_data;
      size_t vfs_inject_size = vfs_size;

      // Compat mode: inject 0-byte note if no real data provided
      if (vfs_compat_mode && (!vfs_data || vfs_size == 0)) {
        vfs_inject_data = nullptr;
        vfs_inject_size = 0;
        printf("Creating SMOL_VFS_BLOB note (compat mode: 0 bytes)...\n");
      } else {
        printf("Creating SMOL_VFS_BLOB note with %zu bytes...\n", vfs_inject_size);
      }

      // Convert data to vector for LIEF
      std::vector<uint8_t> vfs_desc;
      if (vfs_inject_data && vfs_inject_size > 0) {
        vfs_desc.assign(vfs_inject_data, vfs_inject_data + vfs_inject_size);
      }

      // CRITICAL: Must specify section_name for LIEF serialization (Issue #1026)
      std::string vfs_section_name = std::string(".note.") + ELF_NOTE_SMOL_VFS_BLOB;

      // Create VFS note
      auto vfs_note = LIEF::ELF::Note::create(
        ELF_NOTE_SMOL_VFS_BLOB,  // name/owner
        uint32_t(0),              // type (0 for custom notes)
        vfs_desc,                 // description (VFS blob data or empty)
        vfs_section_name          // section_name (REQUIRED for serialization)
      );

      // Check if note creation succeeded
      if (!vfs_note) {
        fprintf(stderr, "Error: Failed to create SMOL_VFS_BLOB note\n");
        fprintf(stderr, "  Owner: %s\n", ELF_NOTE_SMOL_VFS_BLOB);
        fprintf(stderr, "  Size: %zu bytes\n", vfs_inject_size);
        fprintf(stderr, "  Section: %s\n", vfs_section_name.c_str());
        fprintf(stderr, "  This indicates LIEF Note::create() failed\n");
        return BINJECT_ERROR;
      }

      // Add VFS note to binary
      binary->add(*vfs_note);

      printf("Added SMOL_VFS_BLOB note to binary with section_name: %s\n", vfs_section_name.c_str());
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

    printf("Writing modified binary...\n");

    // Use minimal config matching the single-injection approach
    // This preserves binary layout while still writing the note we added
    LIEF::ELF::Builder::config_t config;
    config.dt_hash = false;
    config.dyn_str = false;
    config.dynamic_section = false;
    config.fini_array = false;
    config.gnu_hash = false;
    config.init_array = false;
    config.interpreter = false;
    config.jmprel = false;
    config.notes = true;  // MUST be true to write the note we added
    config.preinit_array = false;
    config.relr = false;
    config.android_rela = false;
    config.rela = false;
    config.static_symtab = false;
    config.sym_verdef = false;
    config.sym_verneed = false;
    config.sym_versym = false;
    config.symtab = false;
    config.coredump_notes = false;
    config.force_relocate = false;
    config.skip_dynamic = true;

    binary->write(tmpfile, config);

    printf("Wrote binary with PT_NOTE segments using LIEF binary->write() (notes enabled)\n");

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

    // NOTE: PHT restoration is not needed because LIEF's write() with notes=true
    // correctly handles PT_NOTE segments without relocating the program header table.
    // The PHT stays at its original offset, avoiding segfaults.

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
