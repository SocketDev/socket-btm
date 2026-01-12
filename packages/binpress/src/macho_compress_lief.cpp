/**
 * Mach-O binary compression using LIEF
 *
 * Uses LIEF C++ library to read/write Mach-O binaries for cross-platform compression.
 * Enables compressing Mach-O binaries from non-macOS platforms (Linux, Windows).
 *
 * Architecture (mirrors ELF/PE approach):
 * 1. Select appropriate decompressor stub for target binary
 * 2. Compress the input binary
 * 3. Build SMOL section data (magic marker + metadata + compressed data)
 * 4. Add __SMOL segment to stub binary using LIEF
 * 5. Write output executable
 */

#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <stdexcept>
#include <vector>

#include <LIEF/LIEF.hpp>

extern "C" {
#include "compression_common.h"
#include "compression_constants.h"
#include "lief_write_diagnostics.h"
#include "segment_names.h"
}

#include "compress_lief_common.hpp"
#include "file_utils.h"

extern "C" {

/**
 * Compress Mach-O binary using LIEF (cross-platform).
 *
 * This allows compressing Mach-O binaries from Linux/Windows platforms.
 * Creates a self-extracting executable with embedded compressed data.
 *
 * @param input_path Path to input Mach-O binary
 * @param output_path Path to output compressed binary
 * @param algorithm Compression algorithm to use (COMPRESS_ALGORITHM_*)
 * @param target Combined target string (e.g., "darwin-arm64")
 * @param target_platform Target platform ("linux", "darwin", "win", "win32")
 * @param target_arch Target architecture ("x64", "arm64")
 * @param target_libc Target libc variant (NULL for Mach-O binaries)
 * @return 0 on success, error code otherwise
 */
int macho_compress_lief(const char* input_path,
                        const char* output_path,
                        int algorithm,
                        const char* target,
                        const char* target_platform,
                        const char* target_arch,
                        const char* target_libc) {
  if (!input_path || !output_path) {
    fprintf(stderr, "Error: Invalid arguments\n");
    return -1;
  }

  try {
    print_compression_header("Mach-O");
    printf("%s\n", input_path);
    printf("  Output: %s\n", output_path);
    printf("  Algorithm: LZFSE\n");

    // Steps 1-3: Use common compression logic (stub selection, compression, section building).
    compress_context_t context;
    if (compress_lief_common(input_path, algorithm, &context, target, target_platform, target_arch, target_libc) != 0) {
      return -1;
    }

    // Step 4: Add __SMOL segment to stub binary using LIEF.
    print_parsing_stub_header("Mach-O");
    std::unique_ptr<LIEF::MachO::FatBinary> fat_binary =
        LIEF::MachO::Parser::parse(context.stub_path);

    if (!fat_binary || fat_binary->size() == 0) {
      fprintf(stderr, "Error: Failed to parse Mach-O stub binary\n");
      compress_lief_common_free(&context);
      return -1;
    }

    // Get the first binary (or only binary if not a fat binary).
    LIEF::MachO::Binary* binary = fat_binary->at(0);
    if (!binary) {
      fprintf(stderr, "Error: No binary found in Mach-O file\n");
      compress_lief_common_free(&context);
      return -1;
    }

    printf("  Number of segments: %zu\n", binary->segments().size());

    // Convert section data to vector for LIEF.
    std::vector<uint8_t> segment_data(context.section.data,
                                       context.section.data + context.section.size);
    smol_free_section(&context.section);

    // Create new Mach-O segment for SMOL data.
    // Note: Segment name is MACHO_SEGMENT_SMOL (no underscores), following the pattern of NODE_SEA.
    // Section name is MACHO_SECTION_PRESSED_DATA (with underscores), following Mach-O convention.
    print_creating_section_header(MACHO_SEGMENT_SMOL " segment");
    LIEF::MachO::SegmentCommand smol_segment(MACHO_SEGMENT_SMOL);
    smol_segment.content(segment_data);
    smol_segment.init_protection(VM_PROT_READ);
    smol_segment.max_protection(VM_PROT_READ);

    // Create __PRESSED_DATA section within the SMOL segment.
    LIEF::MachO::Section pressed_section(MACHO_SECTION_PRESSED_DATA, segment_data);
    pressed_section.segment_name(MACHO_SEGMENT_SMOL);
    smol_segment.add_section(pressed_section);

    // Add segment to binary.
    LIEF::MachO::LoadCommand* added_segment = binary->add(smol_segment);
    if (!added_segment) {
      fprintf(stderr, "Error: Failed to add %s segment\n", MACHO_SEGMENT_SMOL);
      cleanup_temp_stub(context.stub_path);
      return -1;
    }

    printf("  Segment added successfully\n");
    printf("  New number of segments: %zu\n", binary->segments().size());

    // Step 5: Write output executable.
    printf("\nWriting output binary...\n");
    fflush(stdout);

    // Check system resources and verify output directory writable.
    lief_check_system_resources();

    // Create parent directories if needed.
    printf("  About to call ensure_output_directory()...\n");
    fflush(stdout);
    if (ensure_output_directory(output_path, context.stub_path) != 0) {
      fprintf(stderr, "ERROR: ensure_output_directory() failed, returning -1\n");
      fflush(stderr);
      return -1;
    }
    printf("  ensure_output_directory() completed successfully\n");
    fflush(stdout);

    printf("  About to call lief_verify_output_dir_writable()...\n");
    fflush(stdout);
    if (lief_verify_output_dir_writable(output_path) != 0) {
      fprintf(stderr, "ERROR: lief_verify_output_dir_writable() failed, returning -1\n");
      fflush(stderr);
      cleanup_temp_stub(context.stub_path);
      return -1;
    }
    printf("  lief_verify_output_dir_writable() completed successfully\n");
    fflush(stdout);

    // Write modified binary.
    printf("  Calling LIEF Builder::write()...\n");
    fflush(stdout);
    try {
      // CRITICAL: Use explicit config to ensure proper segment/section building
      // Without this, LIEF may write malformed segments that crash the dynamic linker
      LIEF::MachO::Builder::config_t config;
      auto result = LIEF::MachO::Builder::write(*fat_binary, std::string(output_path), config);
      if (!result) {
        fprintf(stderr, "Error: LIEF Builder::write() failed\n");
        cleanup_temp_stub(context.stub_path);
        return -1;
      }
      printf("  LIEF write() returned successfully\n");
      fflush(stdout);

      // Verify file was actually written
      if (verify_file_written(output_path) != 0) {
        cleanup_temp_stub(context.stub_path);
        return -1;
      }

      printf("  Binary written to: %s\n", output_path);
      fflush(stdout);
    } catch (const std::exception& write_error) {
      fprintf(stderr, "Error: LIEF write() failed: %s\n", write_error.what());
      fflush(stderr);
      cleanup_temp_stub(context.stub_path);
      return -1;
    }

    // Set executable permissions (cross-platform).
    set_executable_permissions(output_path);

    // Clean up temp stub.
    cleanup_temp_stub(context.stub_path);

    print_compression_complete("Mach-O");
    return 0;

  } catch (const std::exception& e) {
    fprintf(stderr, "Error: LIEF exception: %s\n", e.what());
    return -1;
  } catch (...) {
    fprintf(stderr, "Error: Unknown exception during LIEF Mach-O compression\n");
    return -1;
  }
}

} // extern "C"
