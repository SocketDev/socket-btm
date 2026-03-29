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
#include <vector>
#include <limits.h>
#include <sys/stat.h>

// Platform-specific headers.
#ifdef _WIN32
#include <process.h>
#include <io.h>
#else
#include <unistd.h>
#endif

#include <LIEF/LIEF.hpp>

extern "C" {
#include "socketsecurity/bin-infra/segment_names.h"
#include "socketsecurity/binject/binject.h"
#include "socketsecurity/binject/smol_config.h"
#include "socketsecurity/binject/vfs_config.h"
#include "socketsecurity/build-infra/file_io_common.h"
#include "socketsecurity/build-infra/file_utils.h"
}

// Shared DRY infrastructure (must come after binject.h for error codes)
#include "socketsecurity/bin-infra/binject_file_utils.hpp"
#include "socketsecurity/bin-infra/binject_lief_traits.hpp"
#include "socketsecurity/bin-infra/binject_sea_fuse.hpp"
#include "socketsecurity/bin-infra/binject_section_ops.hpp"
#include "socketsecurity/bin-infra/elf_note_utils.hpp"

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

    printf("Using LIEF for ELF injection (proper VirtAddr for SEA)...\n");

    // Fast-fail: Check magic bytes BEFORE expensive LIEF parsing.
    FILE* f = fopen(executable, "rb");
    if (!f) {
      fprintf(stderr, "Error: Cannot open file: %s\n", executable);
      return BINJECT_ERROR_INVALID_FORMAT;
    }

    uint8_t magic[4];
    size_t bytes_read = fread(magic, 1, 4, f);
    fclose(f);

    if (bytes_read < 4) {
      fprintf(stderr, "Error: File is too small (%zu bytes): %s\n", bytes_read, executable);
      return BINJECT_ERROR_INVALID_FORMAT;
    }

    if (memcmp(magic, "\x7f""ELF", 4) != 0) {
      fprintf(stderr, "Error: File is not ELF (magic: %02x %02x %02x %02x): %s\n",
              magic[0], magic[1], magic[2], magic[3], executable);
      return BINJECT_ERROR_INVALID_FORMAT;
    }

    // Parse binary with LIEF (file is confirmed ELF).
    std::unique_ptr<LIEF::ELF::Binary> binary =
        LIEF::ELF::Parser::parse(executable);

    if (!binary) {
      fprintf(stderr, "Error: ELF file is corrupted or unsupported: %s\n", executable);
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
    if (binject::create_temp_path(executable, tmpfile, sizeof(tmpfile)) != 0) {
      fprintf(stderr, "Error: Executable path too long for temporary file\n");
      return BINJECT_ERROR_WRITE_FAILED;
    }

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
    result = set_executable_permissions(tmpfile);
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
    int vfs_compat_mode,
    const uint8_t *vfs_config_data
) {
  if (!executable || !output) {
    fprintf(stderr, "Error: Invalid arguments (NULL parameter)\n");
    return BINJECT_ERROR_INVALID_ARGS;
  }

    // ALWAYS use fast raw approach - bypasses LIEF's O(n²) note hashing bottleneck.
    // The smol_reuse_multi_ptnote() function handles both dynamic and static binaries:
    // - Dynamic (glibc): Extends last PT_LOAD to cover note data for dl_iterate_phdr()
    // - Static (musl): Uses unmapped high vaddr (no PT_LOAD extension needed)
    //
    // LIEF's Parser::parse() has O(n²) complexity when binaries have many PT_NOTE
    // sections (~256 notes in node-smol). parse_notes() calls LIEF::hash() for each
    // note, taking 15+ minutes for static musl builds. The raw approach skips LIEF
    // entirely, reducing this to ~1-5 seconds.
    printf("Using fast raw approach for ELF injection (bypasses LIEF O(n²) bottleneck)...\n");

    // Build notes vector for raw injection
    std::vector<elf_note_utils::NoteEntry> notes;

    if (sea_data && sea_size > 0) {
        printf("Preparing NODE_SEA_BLOB note with %zu bytes...\n", sea_size);
        std::vector<uint8_t> sea_vec(sea_data, sea_data + sea_size);
        notes.emplace_back(ELF_NOTE_NODE_SEA_BLOB, std::move(sea_vec));
    }

    if ((vfs_data && vfs_size > 0) || vfs_compat_mode) {
        std::vector<uint8_t> vfs_vec;
        if (vfs_compat_mode && (!vfs_data || vfs_size == 0)) {
            printf("Preparing SMOL_VFS_BLOB note (compat mode: 0 bytes)...\n");
        } else {
            printf("Preparing SMOL_VFS_BLOB note with %zu bytes...\n", vfs_size);
            vfs_vec.assign(vfs_data, vfs_data + vfs_size);
        }
        notes.emplace_back(ELF_NOTE_SMOL_VFS_BLOB, std::move(vfs_vec));
    }

    if (vfs_config_data) {
        // Note: Despite the name "VFS config", this stores the SMOL config (1192 bytes SMFG format)
        printf("Preparing SMOL_VFS_CONFIG note with %d bytes...\n", SMOL_CONFIG_SIZE);
        std::vector<uint8_t> vfs_config_vec(vfs_config_data, vfs_config_data + SMOL_CONFIG_SIZE);
        notes.emplace_back(ELF_NOTE_SMOL_VFS_CONFIG, std::move(vfs_config_vec));
    }

    // Create parent directories if needed
    if (create_parent_directories(output) != 0) {
        fprintf(stderr, "Error: Failed to create parent directories for output: %s\n", output);
        return BINJECT_ERROR;
    }

    // Use flip_sea_fuse_raw callback for SEA fuse flipping
    elf_note_utils::BinaryModifyCallback fuse_callback = nullptr;
    if (sea_data && sea_size > 0) {
        fuse_callback = elf_note_utils::flip_sea_fuse_raw;
    }

    // Use raw single-write approach (no LIEF parsing or triple-write overhead)
    int result = elf_note_utils::smol_reuse_multi_ptnote(
        executable, output, notes, fuse_callback);
    if (result != 0) {
        fprintf(stderr, "Error: Failed to inject notes via fast raw approach\n");
        return BINJECT_ERROR;
    }

    printf("Successfully injected notes into ELF binary (fast raw)\n");
    return BINJECT_OK;

}

/**
 * List ELF sections of interest using LIEF (cross-platform).
 */
extern "C" int binject_elf_list_lief(const char* executable) {
  return binject::list_sections<LIEF::ELF::Binary>(executable);
}

/**
 * Extract section from ELF binary using LIEF (cross-platform).
 */
extern "C" int binject_elf_extract_lief(const char* executable, const char* section_name, const char* output_file) {
  return binject::extract_section<LIEF::ELF::Binary>(executable, section_name, output_file);
}

/**
 * Verify section exists in ELF binary using LIEF (cross-platform).
 */
extern "C" int binject_elf_verify_lief(const char* executable, const char* section_name) {
  return binject::verify_section<LIEF::ELF::Binary>(executable, section_name);
}
