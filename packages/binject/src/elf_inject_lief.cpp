/**
 * ELF binary injection with PHT preservation
 *
 * Uses raw binary manipulation to inject PT_NOTE segments while preserving
 * the Program Header Table (PHT) location. This is critical for static glibc
 * binaries where moving the PHT causes SIGSEGV (glibc reads PHT from base+phoff).
 *
 * LIEF is still used for list/extract/verify operations that don't modify binaries.
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
#include "elf_note_utils.hpp"

/**
 * Inject resource into ELF binary using LIEF (for SEA/VFS injection).
 *
 * Uses LIEF's high-level Note API which sets proper VirtAddr values.
 * This is required for Node.js SEA because postject_find_resource() uses
 * dl_iterate_phdr() which needs notes mapped into memory.
 *
 * NOTE: This approach may restructure the binary. For static glibc binaries
 * (like SMOL stubs), use smol_reuse_multi_ptnote() instead which preserves PHT.
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
  // Validate arguments.
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
    printf("Using LIEF for ELF injection (proper VirtAddr for SEA)...\n");

    // Parse binary with LIEF
    std::unique_ptr<LIEF::ELF::Binary> binary =
        LIEF::ELF::Parser::parse(executable);

    if (!binary) {
      fprintf(stderr, "Error: Failed to parse ELF binary: %s\n", executable);

      // Try to provide more detailed diagnostics
      FILE* f = fopen(executable, "rb");
      if (f) {
        uint8_t magic[4];
        size_t bytes_read = fread(magic, 1, 4, f);
        if (bytes_read == 4) {
          if (memcmp(magic, "\x7f""ELF", 4) == 0) {
            fprintf(stderr, "  File is ELF but LIEF parse failed (possibly corrupted or unsupported format)\n");
          } else {
            fprintf(stderr, "  File is not ELF (magic: %02x %02x %02x %02x)\n",
                    magic[0], magic[1], magic[2], magic[3]);
          }
        } else if (bytes_read > 0) {
          fprintf(stderr, "  File is too small (%zu bytes)\n", bytes_read);
        } else {
          fprintf(stderr, "  File is empty or unreadable\n");
        }
        fclose(f);
      }

      return BINJECT_ERROR_INVALID_FORMAT;
    }

    // Prepare note data
    std::vector<uint8_t> note_data;
    if (size > 0 && data) {
      note_data.assign(data, data + size);
    }

    printf("Preparing note %s with %zu bytes...\n", section_name, size);

    // Use LIEF Note API to add/replace note (sets proper VirtAddr)
    int result = elf_note_utils::replace_or_add(binary.get(), section_name, note_data);
    if (result != 0) {
      fprintf(stderr, "Error: Failed to add note to binary\n");
      return BINJECT_ERROR;
    }

    // Write to temp file first, then atomic rename
    char tmpfile[PATH_MAX];
    binject::create_temp_path(executable, tmpfile, sizeof(tmpfile));

    // Create parent directories if needed.
    if (create_parent_directories(tmpfile) != 0) {
      fprintf(stderr, "Error: Failed to create parent directories for output path: %s\n", tmpfile);
      return BINJECT_ERROR;
    }

    printf("Writing modified binary...\n");

    // Use LIEF approach with proper fixes for SEA/VFS injection
    // This includes: PT_NOTE p_vaddr fixes, ALLOC flag removal,
    // matching PT_LOAD segments, and triple-write pattern
    elf_note_utils::write_with_notes(binary.get(), tmpfile);

    // Verify file was actually written
    result = binject::verify_file_written(tmpfile);
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

    printf("Successfully injected %zu bytes into note %s (LIEF)\n", size, section_name);
    return BINJECT_OK;

  } catch (const std::exception& e) {
    fprintf(stderr, "Error: Exception: %s\n", e.what());
    return BINJECT_ERROR;
  } catch (...) {
    fprintf(stderr, "Error: Unknown exception during ELF injection\n");
    return BINJECT_ERROR;
  }
}

/**
 * Batch inject both SEA and VFS notes using LIEF (for SEA/VFS injection).
 *
 * Uses LIEF's high-level Note API which sets proper VirtAddr values.
 * This is required for Node.js SEA because postject_find_resource() uses
 * dl_iterate_phdr() which needs notes mapped into memory.
 *
 * NOTE: This approach may restructure the binary. For static glibc binaries
 * (like SMOL stubs), use smol_reuse_multi_ptnote() instead which preserves PHT.
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
    printf("Using LIEF for ELF batch injection (proper VirtAddr for SEA)...\n");

    // Parse binary with LIEF
    std::unique_ptr<LIEF::ELF::Binary> binary =
        LIEF::ELF::Parser::parse(executable);

    if (!binary) {
      fprintf(stderr, "Error: Failed to parse ELF binary: %s\n", executable);

      // Try to provide more detailed diagnostics
      FILE* f = fopen(executable, "rb");
      if (f) {
        uint8_t magic[4];
        size_t bytes_read = fread(magic, 1, 4, f);
        if (bytes_read == 4) {
          if (memcmp(magic, "\x7f""ELF", 4) == 0) {
            fprintf(stderr, "  File is ELF but LIEF parse failed (possibly corrupted or unsupported format)\n");
          } else {
            fprintf(stderr, "  File is not ELF (magic: %02x %02x %02x %02x)\n",
                    magic[0], magic[1], magic[2], magic[3]);
          }
        } else if (bytes_read > 0) {
          fprintf(stderr, "  File is too small (%zu bytes)\n", bytes_read);
        } else {
          fprintf(stderr, "  File is empty or unreadable\n");
        }
        fclose(f);
      }

      return BINJECT_ERROR_INVALID_FORMAT;
    }

    // Flip fuse if needed (first SEA injection)
    if (sea_data && sea_size > 0) {
      binject::flip_fuse_if_needed(binary.get(), sea_data, sea_size);
    }

    // Add SEA note if provided
    if (sea_data && sea_size > 0) {
      printf("Preparing NODE_SEA_BLOB note with %zu bytes...\n", sea_size);
      std::vector<uint8_t> sea_vec(sea_data, sea_data + sea_size);
      int result = elf_note_utils::replace_or_add(binary.get(), ELF_NOTE_NODE_SEA_BLOB, sea_vec);
      if (result != 0) {
        fprintf(stderr, "Error: Failed to add NODE_SEA_BLOB note\n");
        return BINJECT_ERROR;
      }
    }

    // Add VFS note if provided or in compat mode
    if ((vfs_data && vfs_size > 0) || vfs_compat_mode) {
      std::vector<uint8_t> vfs_vec;
      if (vfs_compat_mode && (!vfs_data || vfs_size == 0)) {
        printf("Preparing SMOL_VFS_BLOB note (compat mode: 0 bytes)...\n");
        // vfs_vec is already empty
      } else {
        printf("Preparing SMOL_VFS_BLOB note with %zu bytes...\n", vfs_size);
        vfs_vec.assign(vfs_data, vfs_data + vfs_size);
      }
      int result = elf_note_utils::replace_or_add(binary.get(), ELF_NOTE_SMOL_VFS_BLOB, vfs_vec);
      if (result != 0) {
        fprintf(stderr, "Error: Failed to add SMOL_VFS_BLOB note\n");
        return BINJECT_ERROR;
      }
    }

    // Create parent directories if needed
    if (create_parent_directories(output) != 0) {
      fprintf(stderr, "Error: Failed to create parent directories for output: %s\n", output);
      return BINJECT_ERROR;
    }

    // Write to temp file first, then atomic rename
    char tmpfile[PATH_MAX];
    binject::create_temp_path(output, tmpfile, sizeof(tmpfile));

    printf("Writing modified binary...\n");

    // Use LIEF approach with proper fixes for SEA/VFS injection
    // This includes: PT_NOTE p_vaddr fixes, ALLOC flag removal,
    // matching PT_LOAD segments, and triple-write pattern
    elf_note_utils::write_with_notes(binary.get(), tmpfile);

    printf("Wrote binary with PT_NOTE segments (LIEF)\n");

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

    printf("Successfully injected notes into ELF binary (LIEF)\n");

    return BINJECT_OK;

  } catch (const std::exception& e) {
    fprintf(stderr, "Error: Exception: %s\n", e.what());
    return BINJECT_ERROR;
  } catch (...) {
    fprintf(stderr, "Error: Unknown exception during ELF batch injection\n");
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
