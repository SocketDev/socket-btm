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

extern "C" {
#include "binject.h"

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
        fprintf(stderr, "⚠ Failed to fork for codesign\n");
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

    fprintf(stderr, "⚠ codesign failed\n");
    return false;
#else
    // Non-macOS platforms don't need code signing
    return true;
#endif
}

/**
 * Inject resource into Mach-O binary using LIEF.
 *
 * IMPLEMENTATION NOTES:
 *
 * This function uses a hybrid approach due to LIEF API characteristics:
 *
 * 1. Segment Creation: Creates segment via binary->add() which returns a pointer
 *    to the internal SegmentCommand object.
 *
 * 2. Section Addition: Uses SegmentCommand::add_section() instead of
 *    Binary::add_section() because Binary::add_section() attempts complex space
 *    allocation via extend() which can fail with newly created segments.
 *
 * 3. Content Storage: The key insight is that LIEF stores section content via
 *    the .content() method (not the constructor).
 *
 *    However, SegmentCommand::add_section() only updates metadata, not file
 *    content. The workaround is to:
 *    a) Let LIEF Builder write the binary structure
 *    b) Re-parse to get the actual section offset LIEF assigned
 *    c) Manually write content bytes at that offset
 *
 * @param executable Path to the Mach-O binary.
 * @param segment_name Segment name (e.g., "NODE_SEA").
 * @param section_name Section name (e.g., "__NODE_SEA_BLOB").
 * @param data Resource data to inject (exactly `size` bytes).
 * @param size Size of resource data in bytes.
 * @param overwrite Whether to overwrite existing section.
 * @return BINJECT_OK on success, error code otherwise.
 */
extern "C" int binject_macho_lief(const char* executable,
                                  const char* segment_name,
                                  const char* section_name,
                                  const uint8_t* data,
                                  size_t size) {
  if (!executable || !segment_name || !section_name || !data || size == 0) {
    fprintf(stderr, "Error: Invalid arguments\n");
    return BINJECT_ERROR_INVALID_ARGS;
  }

  try {
#ifdef __APPLE__
    // CRITICAL: Remove any existing code signature before parsing with LIEF.
    // LIEF cannot reliably parse already-signed binaries and may hang or crash.
    // We'll re-sign with an adhoc signature after injection is complete.
    printf("Removing any existing code signature before parsing...\n");
    remove_macho_signature(executable);
    printf("Ready to parse binary\n");
#endif

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

    // Step 1: Ensure segment exists
    LIEF::MachO::SegmentCommand* target_segment = nullptr;

    // Step 1b: Handle existing section (if any)
    LIEF::MachO::Section* existing_section = binary->get_section(section_name);
    if (existing_section) {
      // Auto-overwrite: remove existing section
      printf("Removing existing section %s...\n", section_name);
      binary->remove_section(section_name, /* clear */ true);
      printf("Removed existing section\n");
    }

    // Step 2: Create section with content
    printf("Creating section %s with %zu bytes...\n", section_name, size);
    LIEF::MachO::Section new_section(section_name);
    std::vector<uint8_t> content_vec(data, data + size);
    new_section.content(std::move(content_vec));
    new_section.alignment(2);  // 2^2 = 4 byte alignment
    new_section.type(LIEF::MachO::Section::TYPE::REGULAR);

    // Step 3: Create or get segment
    if (!binary->has_segment(segment_name)) {
      // Create new segment with the section already in it
      // CRITICAL: Section must be added to segment BEFORE calling binary->add()
      // so that Binary::add() can calculate the correct load command size
      // (72 bytes base + 80 bytes per section = 152 bytes for 1 section)
      printf("Creating new segment: %s\n", segment_name);
      LIEF::MachO::SegmentCommand new_segment(segment_name);
      new_segment.init_protection(7);  // rwx
      new_segment.max_protection(7);   // rwx

      // Add section to segment before adding to binary
      new_segment.add_section(new_section);
      printf("Added section to new segment\n");

      // Now add the segment (with section) to binary
      // Binary::add() will calculate cmdsize = 72 + (1 * 80) = 152
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

      printf("Created segment %s with section %s (%zu bytes)\n",
             segment_name, section_name, size);
    } else {
      // Segment exists - add section to existing segment
      target_segment = binary->get_segment(segment_name);
      if (!target_segment) {
        fprintf(stderr, "Error: Could not get existing segment\n");
        return BINJECT_ERROR;
      }
      printf("Found existing segment: %s\n", segment_name);

      // Calculate the correct virtual address for the new section
      // It should be placed right after the last existing section in the segment
      uint64_t next_vaddr = target_segment->virtual_address();
      uint64_t next_offset = target_segment->file_offset();

      const auto& sections = target_segment->sections();
      if (!sections.empty()) {
        // Find the last section in the segment by iterating
        const LIEF::MachO::Section* last_section = nullptr;
        for (const LIEF::MachO::Section& section : sections) {
          last_section = &section;
        }

        if (last_section) {
          // Get last section details for debugging
          uint64_t last_vaddr = last_section->virtual_address();
          uint64_t last_size = last_section->size();
          uint64_t last_offset = last_section->offset();

          printf("  Last section: vaddr=0x%llx, size=0x%llx, offset=%llu\n",
                 last_vaddr, last_size, last_offset);
        }
      }

      // Don't set addresses manually - let LIEF calculate them
      // LIEF should handle layout automatically when adding sections

      // Add section to existing segment
      printf("Adding section to existing segment (LIEF will calculate addresses)...\n");
      target_segment->add_section(new_section);
      printf("Added section %s to segment %s (%zu bytes)\n",
             section_name, segment_name, size);
    }

    // Step 5: Flip NODE_SEA_FUSE if this is a SEA injection
    if (strcmp(section_name, "__NODE_SEA_BLOB") == 0) {
      printf("Flipping NODE_SEA_FUSE...\n");

      // Find and flip the fuse from :0 to :1
      const char* fuse_string = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2:0";
      const char* fuse_flipped = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2:1";
      const size_t fuse_length = strlen(fuse_string);

      bool fuse_found = false;
      for (LIEF::MachO::Section& section : binary->sections()) {
        LIEF::span<const uint8_t> content_span = section.content();
        std::vector<uint8_t> content(content_span.begin(), content_span.end());

        // Search for fuse string in section content
        for (size_t i = 0; i + fuse_length <= content.size(); i++) {
          if (memcmp(content.data() + i, fuse_string, fuse_length) == 0) {
            // Flip the fuse: change last character from '0' to '1'
            content[i + fuse_length - 1] = '1';
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

    // Step 6: Remove code signature (required after modifying binary)
    if (binary->has_code_signature()) {
      binary->remove_signature();
      printf("Removed code signature (re-sign after injection)\n");
    }

    // Step 7: Write binary using Binary::write() method to temporary file (tmpdir workflow)
    // This properly handles the section content we set via .content() method
    char tmpfile[PATH_MAX];
    snprintf(tmpfile, sizeof(tmpfile), "%s.tmp.%d", executable, getpid());

    printf("Writing modified binary with LIEF to temp file...\n");
    binary->write(tmpfile);

    // Make executable
    if (chmod(tmpfile, 0755) != 0) {
        fprintf(stderr, "Warning: Failed to make temp file executable (chmod failed)\n");
    }

    // Atomic rename to final destination
    // Remove existing output file first (required on Windows)
    remove(executable);
    if (rename(tmpfile, executable) != 0) {
        fprintf(stderr, "Error: Failed to move temporary file to output: %s\n", executable);
        unlink(tmpfile);
        return BINJECT_ERROR_WRITE_FAILED;
    }

    // Step 8: Sign the binary with adhoc signature
    if (!sign_binary_adhoc(executable)) {
      fprintf(stderr, "⚠ Warning: Failed to sign binary (continuing anyway)\n");
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

    printf("Mach-O binary: %s\n", executable);
    printf("\n");

    // Check for NODE_SEA segment and sections
    if (binary->has_segment("NODE_SEA")) {
      LIEF::MachO::SegmentCommand* segment = binary->get_segment("NODE_SEA");
      printf("Segment: NODE_SEA\n");
      printf("  Sections:\n");

      for (const LIEF::MachO::Section& section : segment->sections()) {
        printf("    - %s (%llu bytes)\n", section.name().c_str(), (unsigned long long)section.size());
      }
      printf("\n");
    }

    // Check for SMOL segment and sections
    if (binary->has_segment("SMOL")) {
      LIEF::MachO::SegmentCommand* segment = binary->get_segment("SMOL");
      printf("Segment: SMOL\n");
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
 * @param section_name Section name to extract (e.g., "__NODE_SEA_BLOB").
 * @param output_file Path to write extracted data.
 * @return BINJECT_OK on success, error code otherwise.
 */
extern "C" int binject_macho_extract_lief(const char* executable,
                                           const char* section_name,
                                           const char* output_file) {
  if (!executable || !section_name || !output_file) {
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

    // Find the section.
    LIEF::MachO::Section* section = nullptr;

    // Try to find in NODE_SEA segment first
    if (binary->has_segment("NODE_SEA")) {
      LIEF::MachO::SegmentCommand* segment = binary->get_segment("NODE_SEA");
      if (segment->has_section(section_name)) {
        section = segment->get_section(section_name);
      }
    }

    // Try SMOL segment
    if (!section && binary->has_segment("SMOL")) {
      LIEF::MachO::SegmentCommand* segment = binary->get_segment("SMOL");
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
 * @param section_name Section name to verify (e.g., "__NODE_SEA_BLOB").
 * @return BINJECT_OK on success, error code otherwise.
 */
extern "C" int binject_macho_verify_lief(const char* executable,
                                          const char* section_name) {
  if (!executable || !section_name) {
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

    // Find the section.
    LIEF::MachO::Section* section = nullptr;
    std::string segment_name;

    // Try to find in NODE_SEA segment first
    if (binary->has_segment("NODE_SEA")) {
      LIEF::MachO::SegmentCommand* segment = binary->get_segment("NODE_SEA");
      if (segment->has_section(section_name)) {
        section = segment->get_section(section_name);
        segment_name = "NODE_SEA";
      }
    }

    // Try SMOL segment
    if (!section && binary->has_segment("SMOL")) {
      LIEF::MachO::SegmentCommand* segment = binary->get_segment("SMOL");
      if (segment->has_section(section_name)) {
        section = segment->get_section(section_name);
        segment_name = "SMOL";
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
    const uint8_t *vfs_data, size_t vfs_size
) {
  try {
    printf("Using LIEF for batch injection...\n");

#ifdef __APPLE__
    // CRITICAL: Remove any existing code signature before parsing with LIEF.
    // LIEF cannot reliably parse already-signed binaries and may hang or crash.
    // We'll re-sign with an adhoc signature after injection is complete.
    printf("Removing any existing code signature before parsing...\n");
    remove_macho_signature(executable);
    printf("Ready to parse binary\n");
#endif

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
    LIEF::MachO::SegmentCommand* target_segment = binary->get_segment("NODE_SEA");
    bool segment_exists = (target_segment != nullptr);
    bool was_overwritten = false;

    // Flip NODE_SEA_FUSE (only on first injection when segment doesn't exist yet)
    if (sea_data && sea_size > 0 && !segment_exists) {
      const char* fuse_unflipped = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2:0";
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

      // Find the index of the NODE_SEA segment in the load commands
      size_t segment_index = 0;
      bool found = false;
      for (const LIEF::MachO::LoadCommand& cmd : binary->commands()) {
        if (cmd.command() == LIEF::MachO::LoadCommand::TYPE::SEGMENT_64 ||
            cmd.command() == LIEF::MachO::LoadCommand::TYPE::SEGMENT) {
          const LIEF::MachO::SegmentCommand* seg = dynamic_cast<const LIEF::MachO::SegmentCommand*>(&cmd);
          if (seg && seg->name() == "NODE_SEA") {
            found = true;
            break;
          }
        }
        segment_index++;
      }

      if (found) {
        if (!binary->remove_command(segment_index)) {
          fprintf(stderr, "⚠ Failed to remove existing NODE_SEA segment\n");
        } else {
          printf("✓ Successfully removed existing NODE_SEA segment\n");
          was_overwritten = true;
        }
      }
    }

    // Create NODE_SEA segment
    LIEF::MachO::SegmentCommand node_sea_seg("NODE_SEA");
    node_sea_seg.init_protection(7);  // VM_PROT_READ | VM_PROT_WRITE | VM_PROT_EXECUTE
    node_sea_seg.max_protection(7);

    // Add SEA section if provided
    if (sea_data && sea_size > 0) {
      printf("Creating SEA section __NODE_SEA_BLOB with %zu bytes...\n", sea_size);

      LIEF::MachO::Section sea_section("__NODE_SEA_BLOB");
      std::vector<uint8_t> sea_content(sea_data, sea_data + sea_size);
      sea_section.content(sea_content);
      sea_section.alignment(2);  // 4-byte alignment

      node_sea_seg.add_section(sea_section);
    }

    // Add VFS section if provided
    if (vfs_data && vfs_size > 0) {
      printf("Creating VFS section __SMOL_VFS_BLOB with %zu bytes...\n", vfs_size);

      LIEF::MachO::Section vfs_section("__SMOL_VFS_BLOB");
      std::vector<uint8_t> vfs_content(vfs_data, vfs_data + vfs_size);
      vfs_section.content(vfs_content);
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
    if (getenv("DEBUG")) {
        struct stat temp_st;
        if (stat(tmpfile, &temp_st) == 0) {
            printf("Debug: LIEF wrote %lld bytes to temp file\n", (long long)temp_st.st_size);
        }
    }

    // Make executable
    if (chmod(tmpfile, 0755) != 0) {
        fprintf(stderr, "Warning: Failed to make temp file executable (chmod failed)\n");
    }

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
      fprintf(stderr, "⚠ Warning: Failed to sign binary (continuing anyway)\n");
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
