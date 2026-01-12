/**
 * Mach-O binary injection using LIEF
 *
 * Uses LIEF C++ library to inject sections into Mach-O binaries.
 * This bypasses segedit's size limitations and supports unlimited data sizes.
 *
 * IMPLEMENTATION APPROACH:
 *
 * This implementation uses a hybrid approach combining LIEF's API for structure
 * manipulation with manual file I/O for content injection. This is necessary due
 * to characteristics of the LIEF library when working with custom segments.
 *
 * The correct LIEF pattern for section content (per examples/cpp/elf_add_section.cpp):
 *   Section section(name);
 *   section.content(std::move(data));  // Key: use .content() method
 *   binary->add(section);
 *
 * However, for Mach-O, Binary::add_section() performs complex space allocation
 * that can fail with newly created segments, so we use SegmentCommand::add_section()
 * which only updates metadata.
 *
 * The workaround:
 * 1. Use LIEF to create segment and section structure
 * 2. Let LIEF Builder write the binary (creates proper Mach-O structure)
 * 3. Re-parse to get the actual section file offset
 * 4. Manually write content bytes at that offset
 *
 * This approach is reliable and works with any content size.
 */

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <stdexcept>
#include <vector>
#include <limits.h>
#include <sys/stat.h>

// Platform-specific headers
#ifdef _WIN32
#include <process.h>  // for getpid()
#include <io.h>       // for unlink()
#ifndef PATH_MAX
#define PATH_MAX 260  // Windows MAX_PATH
#endif
#else
#include <unistd.h>   // for getpid(), unlink(), fork()
#endif

#include <LIEF/LIEF.hpp>
#include "macho_lief_utils.hpp"

extern "C" {
#include "segment_names.h"
#include "binject.h"
#include "file_utils.h"
#include "smol_repack_lief.h"
#include "debug_common.h"

// From remove_signature.c
int remove_macho_signature(const char *path);
}

#ifdef __APPLE__
#include <sys/wait.h>
#include <sys/stat.h>
#include <unistd.h>
#endif

/**
 * Sign binary with adhoc signature using codesign (macOS only).
 *
 * @param binary_path Path to the binary to sign.
 * @return true if signing succeeded, false otherwise.
 */
static bool sign_binary_adhoc(const char* binary_path) {
#ifdef __APPLE__
    printf("Signing binary with ad-hoc signature...\n");

    pid_t pid = fork();
    if (pid == -1) {
        fprintf(stderr, "Error: Failed to fork for codesign\n");
        return false;
    }

    if (pid == 0) {
        // Child: sign binary
        char *argv[] = {
            (char*)"codesign",
            (char*)"--sign",
            (char*)"-",
            (char*)"--force",
            (char*)binary_path,
            NULL
        };
        execvp("codesign", argv);
        // If execvp returns, it failed - use _exit to avoid buffer flushing
        _exit(1);
    }

    int status;
    waitpid(pid, &status, 0);

    if (WIFEXITED(status) && WEXITSTATUS(status) == 0) {
        printf("  ✓ Binary signed successfully\n");
        return true;
    }

    fprintf(stderr, "Error: codesign failed\n");
    return false;
#else
    // Non-macOS platforms don't need code signing
    return true;
#endif
}

/**
 * Inject resource into Mach-O binary using LIEF.
 *
 * Implementation pattern (unified across PE/ELF/Mach-O):
 * 1. Validate arguments (allow NULL data with size 0 for VFS compat mode).
 * 2. Parse binary with LIEF parser.
 * 3. Remove existing section if present (auto-overwrite).
 * 4. Create new section with content.
 * 5. Set platform-specific attributes (Mach-O: alignment, type).
 * 6. Add section to binary (Mach-O: via segment).
 * 7. Platform-specific post-processing (Mach-O: flip fuse, remove signature, sign).
 * 8. Write modified binary (atomic rename workflow).
 *
 * Mach-O-specific notes:
 * - Sections belong to segments; create segment if needed.
 * - Section must be added to segment BEFORE calling binary->add().
 * - Remove code signature after modifications.
 * - Re-sign with ad-hoc signature on macOS.
 *
 * @param executable Path to the Mach-O binary.
 * @param segment_name Segment name (e.g., MACHO_SEGMENT_NODE_SEA).
 * @param section_name Section name (e.g., MACHO_SECTION_NODE_SEA_BLOB).
 * @param data Resource data to inject.
 * @param size Size of resource data in bytes.
 * @return BINJECT_OK on success, error code otherwise.
 */
extern "C" int binject_macho_lief(const char* executable,
                                  const char* segment_name,
                                  const char* section_name,
                                  const uint8_t* data,
                                  size_t size) {
  // Step 1: Validate arguments.
  if (!executable || !segment_name || !section_name) {
    fprintf(stderr, "Error: Invalid arguments (NULL parameter)\n");
    return BINJECT_ERROR_INVALID_ARGS;
  }

  // Allow NULL data with size 0 for VFS compatibility mode (0-byte section).
  if (!data && size != 0) {
    fprintf(stderr, "Error: Invalid arguments (data is NULL but size is non-zero)\n");
    return BINJECT_ERROR_INVALID_ARGS;
  }

  try {
    printf("Using LIEF for Mach-O injection (cross-platform)...\n");

    // Step 2: Parse binary.
    // Note: LIEF v0.17.1 can parse signed binaries reliably.
    std::unique_ptr<LIEF::MachO::FatBinary> fat_binary =
        LIEF::MachO::Parser::parse(executable);

    if (!fat_binary || fat_binary->empty()) {
      fprintf(stderr, "Error: Failed to parse Mach-O binary: %s\n", executable);
      return BINJECT_ERROR_INVALID_FORMAT;
    }

    // Get first binary from fat binary (or the only binary if not fat).
    LIEF::MachO::Binary* binary = fat_binary->at(0);
    if (!binary) {
      fprintf(stderr, "Error: No binary found in file\n");
      return BINJECT_ERROR_INVALID_FORMAT;
    }

    // Step 3: Remove existing section if present (auto-overwrite).
    if (binary->get_section(section_name)) {
      printf("Removing existing section %s...\n", section_name);
      binary->remove_section(section_name, /* clear */ true);
      printf("Removed existing section\n");
    }

    // Step 4: Create new section with content.
    printf("Creating section %s with %zu bytes...\n", section_name, size);
    LIEF::MachO::Section new_section(section_name);
    std::vector<uint8_t> content_vec(data, data + size);
    new_section.content(std::move(content_vec));

    // Step 5: Set platform-specific attributes.
    // Mach-O: Set alignment and section type.
    new_section.alignment(2);  // 2^2 = 4 byte alignment.
    new_section.type(LIEF::MachO::Section::TYPE::REGULAR);

    // Step 6: Add section to binary (Mach-O: via segment).
    LIEF::MachO::SegmentCommand* target_segment = nullptr;

    if (!binary->has_segment(segment_name)) {
      // Create new segment with section.
      // CRITICAL: Section must be added to segment BEFORE calling binary->add()
      // so Binary::add() calculates correct load command size.
      printf("Creating segment %s with section %s...\n", segment_name, section_name);
      LIEF::MachO::SegmentCommand new_segment(segment_name);
      new_segment.init_protection(7);  // rwx.
      new_segment.max_protection(7);

      new_segment.add_section(new_section);

      LIEF::MachO::LoadCommand* load_cmd = binary->add(new_segment);
      if (!load_cmd) {
        fprintf(stderr, "Error: Failed to add segment\n");
        return BINJECT_ERROR;
      }

      target_segment = dynamic_cast<LIEF::MachO::SegmentCommand*>(load_cmd);
      if (!target_segment) {
        fprintf(stderr, "Error: Failed to cast segment\n");
        return BINJECT_ERROR;
      }
    } else {
      // Add section to existing segment.
      target_segment = binary->get_segment(segment_name);
      if (!target_segment) {
        fprintf(stderr, "Error: Could not get existing segment %s\n", segment_name);
        return BINJECT_ERROR;
      }
      printf("Adding section to existing segment %s...\n", segment_name);
      target_segment->add_section(new_section);
    }

    printf("Added section %s to segment %s (%zu bytes)\n",
           section_name, segment_name, size);

    // Step 7: Platform-specific post-processing.

    // Mach-O: Flip NODE_SEA_FUSE if this is a SEA injection.
    if (strcmp(section_name, MACHO_SECTION_NODE_SEA_BLOB) == 0) {
      printf("Flipping NODE_SEA_FUSE...\n");

      const char* fuse_string = NODE_SEA_FUSE_UNFLIPPED;
      const size_t fuse_length = strlen(fuse_string);

      bool fuse_found = false;
      for (LIEF::MachO::Section& section : binary->sections()) {
        LIEF::span<const uint8_t> content_span = section.content();
        std::vector<uint8_t> content(content_span.begin(), content_span.end());

        for (size_t i = 0; i + fuse_length <= content.size(); i++) {
          if (memcmp(content.data() + i, fuse_string, fuse_length) == 0) {
            content[i + fuse_length - 1] = '1';  // Flip :0 to :1.
            section.content(std::move(content));
            fuse_found = true;
            printf("✓ Flipped NODE_SEA_FUSE from :0 to :1\n");
            break;
          }
        }
        if (fuse_found) break;
      }

      if (!fuse_found) {
        fprintf(stderr, "⚠ NODE_SEA_FUSE not found (binary may not have SEA support)\n");
      }
    }

    // Mach-O: Remove code signature (required after modifications).
    if (binary->has_code_signature()) {
      binary->remove_signature();
      printf("Removed code signature\n");
    }

    // Step 8: Write modified binary (atomic rename workflow).
    char tmpfile[PATH_MAX];
    snprintf(tmpfile, sizeof(tmpfile), "%s.tmp.%d", executable, getpid());

    // Create parent directories if needed.
    if (create_parent_directories(tmpfile) != 0) {
      fprintf(stderr, "Error: Failed to create parent directories for output path: %s\n", tmpfile);
      return BINJECT_ERROR;
    }

    printf("Writing modified binary...\n");
    // CRITICAL: Use explicit config to ensure proper segment/section building
    // Without this, LIEF may write malformed segments that crash the dynamic linker
    LIEF::MachO::Builder::config_t config;
    binary->write(tmpfile, config);

    // Verify file was actually written (LIEF may silently fail on some platforms).
    printf("Verifying file was created...\n");
    struct stat st;
    if (stat(tmpfile, &st) != 0) {
        fprintf(stderr, "Error: LIEF write() failed - file not created: %s\n", tmpfile);
        fprintf(stderr, "  errno: %d (%s)\n", errno, strerror(errno));
        return BINJECT_ERROR_WRITE_FAILED;
    }
    if (st.st_size == 0) {
        fprintf(stderr, "Error: LIEF write() created empty file\n");
        unlink(tmpfile);
        return BINJECT_ERROR_WRITE_FAILED;
    }
    printf("  File created successfully (%ld bytes)\n", (long)st.st_size);

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

    // Mach-O: Re-sign with ad-hoc signature (macOS only).
    if (!sign_binary_adhoc(executable)) {
      fprintf(stderr, "Error: Failed to sign binary\n");
      return BINJECT_ERROR_WRITE_FAILED;
    }

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

/**
 * List sections in Mach-O binary using LIEF.
 *
 * @param executable Path to the Mach-O binary.
 * @return BINJECT_OK on success, error code otherwise.
 */
extern "C" int binject_macho_list_lief(const char* executable) {
  if (!executable) {
    fprintf(stderr, "Error: Invalid arguments (NULL parameter)\n");
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

    printf("Mach-O binary: %s\n", executable);
    printf("\n");

    // Check for NODE_SEA segment and sections
    if (binary->has_segment(MACHO_SEGMENT_NODE_SEA)) {
      LIEF::MachO::SegmentCommand* segment = binary->get_segment(MACHO_SEGMENT_NODE_SEA);
      printf("Segment: %s\n", MACHO_SEGMENT_NODE_SEA);
      printf("  Sections:\n");

      for (const LIEF::MachO::Section& section : segment->sections()) {
        printf("    - %s (%llu bytes)\n", section.name().c_str(), (unsigned long long)section.size());
      }
      printf("\n");
    }

    // Check for SMOL segment and sections
    if (binary->has_segment(MACHO_SEGMENT_SMOL)) {
      LIEF::MachO::SegmentCommand* segment = binary->get_segment(MACHO_SEGMENT_SMOL);
      printf("Segment: %s\n", MACHO_SEGMENT_SMOL);
      printf("  Sections:\n");

      for (const LIEF::MachO::Section& section : segment->sections()) {
        printf("    - %s (%llu bytes)\n", section.name().c_str(), (unsigned long long)section.size());
      }
      printf("\n");
    }

    return BINJECT_OK;

  } catch (const std::exception& e) {
    fprintf(stderr, "Error: LIEF exception: %s\n", e.what());
    return BINJECT_ERROR;
  } catch (...) {
    fprintf(stderr, "Error: Unknown exception during LIEF list\n");
    return BINJECT_ERROR;
  }
}

/**
 * Extract section from Mach-O binary using LIEF.
 *
 * @param executable Path to the Mach-O binary.
 * @param section_name Section name to extract (e.g., MACHO_SECTION_NODE_SEA_BLOB).
 * @param output_file Path to write extracted data.
 * @return BINJECT_OK on success, error code otherwise.
 */
extern "C" int binject_macho_extract_lief(const char* executable,
                                           const char* section_name,
                                           const char* output_file) {
  if (!executable || !section_name || !output_file) {
    fprintf(stderr, "Error: Invalid arguments (NULL parameter)\n");
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

    // Find the section.
    LIEF::MachO::Section* section = nullptr;

    // Try to find in NODE_SEA segment first
    if (binary->has_segment(MACHO_SEGMENT_NODE_SEA)) {
      LIEF::MachO::SegmentCommand* segment = binary->get_segment(MACHO_SEGMENT_NODE_SEA);
      if (segment->has_section(section_name)) {
        section = segment->get_section(section_name);
      }
    }

    // Try SMOL segment
    if (!section && binary->has_segment(MACHO_SEGMENT_SMOL)) {
      LIEF::MachO::SegmentCommand* segment = binary->get_segment(MACHO_SEGMENT_SMOL);
      if (segment->has_section(section_name)) {
        section = segment->get_section(section_name);
      }
    }

    if (!section) {
      fprintf(stderr, "Error: Section %s not found in binary\n", section_name);
      return BINJECT_ERROR_SECTION_NOT_FOUND;
    }

    // Get section content (LIEF returns span, convert to vector).
    auto content_span = section->content();
    std::vector<uint8_t> content(content_span.begin(), content_span.end());

    if (content.empty()) {
      fprintf(stderr, "Error: Section %s is empty\n", section_name);
      return BINJECT_ERROR;
    }

    // Create parent directories if needed.
    if (create_parent_directories(output_file) != 0) {
      fprintf(stderr, "Error: Failed to create parent directories for output path: %s\n", output_file);
      return BINJECT_ERROR;
    }

    // Write to output file.
    FILE* fp = fopen(output_file, "wb");
    if (!fp) {
      fprintf(stderr, "Error: Cannot create output file: %s\n", output_file);
      return BINJECT_ERROR_FILE_NOT_FOUND;
    }

    size_t written = fwrite(content.data(), 1, content.size(), fp);
    fclose(fp);

    if (written != content.size()) {
      fprintf(stderr, "Error: Failed to write all data to output file\n");
      return BINJECT_ERROR_WRITE_FAILED;
    }

    printf("Extracted %zu bytes from section %s to %s\n",
           content.size(), section_name, output_file);

    return BINJECT_OK;

  } catch (const std::exception& e) {
    fprintf(stderr, "Error: LIEF exception: %s\n", e.what());
    return BINJECT_ERROR;
  } catch (...) {
    fprintf(stderr, "Error: Unknown exception during LIEF extract\n");
    return BINJECT_ERROR;
  }
}

/**
 * Verify section in Mach-O binary using LIEF.
 *
 * @param executable Path to the Mach-O binary.
 * @param section_name Section name to verify (e.g., MACHO_SECTION_NODE_SEA_BLOB).
 * @return BINJECT_OK on success, error code otherwise.
 */
extern "C" int binject_macho_verify_lief(const char* executable,
                                          const char* section_name) {
  if (!executable || !section_name) {
    fprintf(stderr, "Error: Invalid arguments (NULL parameter)\n");
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

    // Find the section.
    LIEF::MachO::Section* section = nullptr;
    std::string segment_name;

    // Try to find in NODE_SEA segment first
    if (binary->has_segment(MACHO_SEGMENT_NODE_SEA)) {
      LIEF::MachO::SegmentCommand* segment = binary->get_segment(MACHO_SEGMENT_NODE_SEA);
      if (segment->has_section(section_name)) {
        section = segment->get_section(section_name);
        segment_name = MACHO_SEGMENT_NODE_SEA;
      }
    }

    // Try SMOL segment
    if (!section && binary->has_segment(MACHO_SEGMENT_SMOL)) {
      LIEF::MachO::SegmentCommand* segment = binary->get_segment(MACHO_SEGMENT_SMOL);
      if (segment->has_section(section_name)) {
        section = segment->get_section(section_name);
        segment_name = MACHO_SEGMENT_SMOL;
      }
    }

    if (!section) {
      fprintf(stderr, "Error: Section %s not found in binary\n", section_name);
      return BINJECT_ERROR_SECTION_NOT_FOUND;
    }

    // Get section content (LIEF returns span, check if it has data).
    auto content_span = section->content();
    bool has_content = !content_span.empty();

    printf("Section verification: %s\n", section_name);
    printf("  Segment: %s\n", segment_name.c_str());
    printf("  Size: %llu bytes\n", (unsigned long long)section->size());
    printf("  Offset: 0x%llx\n", (unsigned long long)section->offset());
    printf("  Content available: %s\n", has_content ? "yes" : "no");

    if (!has_content) {
      fprintf(stderr, "⚠ Section exists but has no content\n");
      return BINJECT_ERROR;
    }

    printf("✓ Section verified successfully\n");
    return BINJECT_OK;

  } catch (const std::exception& e) {
    fprintf(stderr, "Error: LIEF exception: %s\n", e.what());
    return BINJECT_ERROR;
  } catch (...) {
    fprintf(stderr, "Error: Unknown exception during LIEF verify\n");
    return BINJECT_ERROR;
  }
}

/**
 * Batch inject both SEA and VFS sections in a single pass.
 * This avoids the LIEF bug where adding sections to an existing segment
 * after re-parsing creates corrupted virtual addresses.
 */
extern "C" int binject_macho_lief_batch(
    const char *executable,
    const char *output,
    const uint8_t *sea_data, size_t sea_size,
    const uint8_t *vfs_data, size_t vfs_size,
    int vfs_compat_mode
) {
  try {
    printf("Using LIEF for batch injection...\n");

    // Note: LIEF v0.17.1 can parse signed binaries reliably.
    // We remove the signature after modifications, before writing.
    printf("Ready to parse binary\n");

    // Parse the Mach-O binary
    std::unique_ptr<LIEF::MachO::FatBinary> fat_binary =
        LIEF::MachO::Parser::parse(executable);

    if (!fat_binary || fat_binary->size() == 0) {
      fprintf(stderr, "Error: Failed to parse Mach-O binary\n");
      return BINJECT_ERROR;
    }

    // Get first architecture
    LIEF::MachO::Binary *binary = fat_binary->at(0);

    // Check if NODE_SEA segment already exists
    // IMPORTANT: We use segment existence as a proxy for whether the fuse is flipped.
    // If NODE_SEA segment exists, the fuse was already flipped during the first injection.
    // This avoids iterating through binary->sections() which causes segfaults on re-injection
    // due to stale LIEF section references after multiple injection cycles.
    LIEF::MachO::SegmentCommand* target_segment = binary->get_segment(MACHO_SEGMENT_NODE_SEA);
    bool segment_exists = (target_segment != nullptr);

    // Flip NODE_SEA_FUSE (only on first injection when segment doesn't exist yet)
    if (sea_data && sea_size > 0 && !segment_exists) {
      const char* fuse_unflipped = NODE_SEA_FUSE_UNFLIPPED;
      const size_t fuse_length = strlen(fuse_unflipped);
      bool found_unflipped = false;

      printf("Flipping NODE_SEA_FUSE...\n");

      for (LIEF::MachO::Section& section : binary->sections()) {
        LIEF::span<const uint8_t> content_span = section.content();
        std::vector<uint8_t> content(content_span.begin(), content_span.end());

        for (size_t i = 0; i + fuse_length <= content.size(); i++) {
          if (memcmp(content.data() + i, fuse_unflipped, fuse_length) == 0) {
            // Flip the fuse: change last character from '0' to '1'
            content[i + fuse_length - 1] = '1';
            section.content(std::move(content));
            found_unflipped = true;
            printf("✓ Flipped NODE_SEA_FUSE from :0 to :1\n");
            break;
          }
        }
        if (found_unflipped) break;
      }

      if (!found_unflipped) {
        printf("⚠ NODE_SEA_FUSE not found (may not be present in this binary)\n");
      }
    } else if (sea_data && sea_size > 0 && segment_exists) {
      printf("NODE_SEA segment exists, skipping fuse flip (already flipped)\n");
    }

    // Remove existing NODE_SEA segment if it exists (AFTER fuse check to avoid accessing invalid sections)
    if (segment_exists) {
      printf("Removing existing NODE_SEA segment...\n");

      if (remove_segment_by_name(binary, MACHO_SEGMENT_NODE_SEA) == 0) {
        printf("✓ Successfully removed existing NODE_SEA segment\n");
      } else {
        fprintf(stderr, "⚠ Failed to remove existing NODE_SEA segment\n");
      }
    }

    // Create NODE_SEA segment
    LIEF::MachO::SegmentCommand node_sea_seg(MACHO_SEGMENT_NODE_SEA);
    node_sea_seg.init_protection(7);  // VM_PROT_READ | VM_PROT_WRITE | VM_PROT_EXECUTE
    node_sea_seg.max_protection(7);

    // Add SEA section if provided
    if (sea_data && sea_size > 0) {
      printf("Creating SEA section %s with %zu bytes...\n", MACHO_SECTION_NODE_SEA_BLOB, sea_size);

      LIEF::MachO::Section sea_section(MACHO_SECTION_NODE_SEA_BLOB);
      std::vector<uint8_t> sea_content(sea_data, sea_data + sea_size);
      sea_section.content(sea_content);
      sea_section.alignment(2);  // 4-byte alignment

      node_sea_seg.add_section(sea_section);
    }

    // Add VFS section if provided (including 0-byte compat mode)
    if (vfs_data || vfs_compat_mode) {
      if (vfs_compat_mode && vfs_size == 0) {
        printf("Creating empty VFS section %s (0 bytes, compatibility mode)...\n", MACHO_SECTION_SMOL_VFS_BLOB);
      } else {
        printf("Creating VFS section %s with %zu bytes...\n", MACHO_SECTION_SMOL_VFS_BLOB, vfs_size);
      }

      LIEF::MachO::Section vfs_section(MACHO_SECTION_SMOL_VFS_BLOB);
      if (vfs_size > 0 && vfs_data) {
        std::vector<uint8_t> vfs_content(vfs_data, vfs_data + vfs_size);
        vfs_section.content(vfs_content);
      }
      vfs_section.alignment(2);  // 4-byte alignment

      node_sea_seg.add_section(vfs_section);
    }

    // Add the segment to the binary (LIEF handles section layout)
    printf("Adding NODE_SEA segment to binary...\n");
    binary->add(node_sea_seg);

    // Remove old signature
    if (binary->has_code_signature()) {
      printf("Removed code signature (re-sign after injection)\n");
      binary->remove_signature();
    }

    // Write the modified binary using tmpdir workflow
    const char *output_path = (output && strlen(output) > 0) ? output : executable;

    char tmpfile[PATH_MAX];
    snprintf(tmpfile, sizeof(tmpfile), "%s.tmp.%d", output_path, getpid());

    printf("Writing modified binary with LIEF to temp file...\n");

    // Use Builder::write() with appropriate method based on architecture count.
    // If single architecture, write Binary directly. If multiple, write FatBinary.
    LIEF::MachO::Builder::config_t config;
    config.linkedit = true;
    auto result = (fat_binary->size() == 1) ?
        LIEF::MachO::Builder::write(*binary, std::string(tmpfile), config) :
        LIEF::MachO::Builder::write(*fat_binary, std::string(tmpfile), config);
    if (!result) {
        fprintf(stderr, "Error: LIEF Builder::write() failed\n");
        return BINJECT_ERROR_WRITE_FAILED;
    }

    // Debug: Check temp file size after LIEF write.
    if (_debug_enabled) {
        struct stat temp_st;
        if (stat(tmpfile, &temp_st) == 0) {
            DEBUG_LOG("LIEF wrote %lld bytes to temp file\n", (long long)temp_st.st_size);
        }
    }

    // Make executable
#ifndef _WIN32
    if (chmod(tmpfile, 0755) != 0) {
        fprintf(stderr, "Error: Failed to make temp file executable (chmod failed)\n");
        unlink(tmpfile);
        return BINJECT_ERROR_WRITE_FAILED;
    }
#endif

    // Atomic rename to final destination
    // Remove existing output file first (required on Windows)
    remove(output_path);
    if (rename(tmpfile, output_path) != 0) {
        fprintf(stderr, "Error: Failed to move temporary file to output: %s\n", output_path);
        unlink(tmpfile);
        return BINJECT_ERROR_WRITE_FAILED;
    }

    // Sign the binary with adhoc signature
    if (!sign_binary_adhoc(output_path)) {
      fprintf(stderr, "Error: Failed to sign binary\n");
      return BINJECT_ERROR_WRITE_FAILED;
    }

    if (sea_data && vfs_data) {
      printf("Successfully injected both SEA and VFS sections\n");
    } else if (sea_data) {
      printf("Successfully injected SEA section\n");
    } else if (vfs_data) {
      printf("Successfully injected VFS section\n");
    }

    return BINJECT_OK;

  } catch (const std::exception& e) {
    fprintf(stderr, "Error: LIEF exception: %s\n", e.what());
    return BINJECT_ERROR;
  } catch (...) {
    fprintf(stderr, "Error: Unknown exception during LIEF batch injection\n");
    return BINJECT_ERROR;
  }
}

/**
 * Repack compressed stub with new SMOL section content using LIEF.
 *
 * This properly updates the Mach-O structure when the SMOL segment content
 * changes size, ensuring all segment offsets and sizes are correct.
 *
 * IMPORTANT: LIEF's section->content() doesn't properly resize sections when
 * the new content is larger. We must remove the entire SMOL segment and
 * recreate it with the new content size.
 *
 * @param stub_path Path to the original compressed stub.
 * @param section_data New content for __PRESSED_DATA section.
 * @param section_size Size of new content.
 * @param output_path Path to write repacked stub.
 * @return BINJECT_OK on success, error code otherwise.
 */
extern "C" int binject_macho_repack_smol_lief(
    const char* stub_path,
    const uint8_t* section_data,
    size_t section_size,
    const char* output_path) {

    // Use shared repack implementation from bin-infra.
    int result = smol_repack_lief(stub_path, section_data, section_size, output_path);
    if (result != 0) {
        return BINJECT_ERROR;
    }
    return BINJECT_OK;
}
