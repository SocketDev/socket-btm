/**
 * ELF binary compression using LIEF
 *
 * Uses LIEF C++ library to read/write ELF binaries for cross-platform compression.
 * Enables compressing ELF binaries from non-Linux platforms (macOS, Windows).
 *
 * Architecture (mirrors macOS approach):
 * 1. Select appropriate decompressor stub for target binary
 * 2. Compress the input binary
 * 3. Build SMOL section data (magic marker + metadata + compressed data)
 * 4. Add SMOL section to stub binary using LIEF
 * 5. Write output executable
 */

#include <cerrno>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <stdexcept>
#include <vector>

#include <LIEF/LIEF.hpp>

extern "C" {
#include "segment_names.h"
#include "compression_common.h"
#include "compression_constants.h"
#include "lief_write_diagnostics.h"
}

// Signal handler for debugging crashes
static void signal_handler(int signum) {
  fprintf(stderr, "\n[FATAL] Caught signal %d\n", signum);
#ifndef _WIN32
  // strsignal() is not available on Windows
  fprintf(stderr, "[FATAL] Signal name: %s\n", strsignal(signum));
#endif
  fflush(stderr);
  _exit(128 + signum);
}

#include "compress_lief_common.hpp"
#include "file_utils.h"

extern "C" {
#include "segment_names.h"

/**
 * Compress ELF binary using LIEF (cross-platform).
 *
 * This allows compressing ELF binaries from macOS/Windows platforms.
 * Creates a self-extracting executable with embedded compressed data.
 *
 * @param input_path Path to input ELF binary
 * @param output_path Path to output compressed binary
 * @param algorithm Compression algorithm to use (COMPRESS_ALGORITHM_*)
 * @return 0 on success, error code otherwise
 */
int elf_compress_lief(const char* input_path,
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

  // Install signal handlers for crash debugging
  signal(SIGSEGV, signal_handler);
  signal(SIGABRT, signal_handler);
  signal(SIGILL, signal_handler);
  signal(SIGFPE, signal_handler);

  try {
    print_compression_header("ELF");
    printf("%s\n", input_path);
    printf("  Output: %s\n", output_path);
    printf("  Algorithm: LZFSE\n");

    // Steps 1-3: Use common compression logic (stub selection, compression, section building).
    compress_context_t context;
    if (compress_lief_common(input_path, algorithm, &context, target, target_platform, target_arch, target_libc) != 0) {
      return -1;
    }

    // Step 4: Add SMOL section to stub binary using LIEF.
    print_parsing_stub_header("ELF");
    std::unique_ptr<LIEF::ELF::Binary> binary = LIEF::ELF::Parser::parse(context.stub_path);

    if (!binary) {
      fprintf(stderr, "Error: Failed to parse ELF stub binary\n");
      compress_lief_common_free(&context);
      return -1;
    }

    printf("  Number of sections: %zu\n", binary->sections().size());

    // Convert section data to vector for LIEF.
    std::vector<uint8_t> section_data(context.section.data,
                                       context.section.data + context.section.size);
    smol_free_section(&context.section);

    // CRITICAL: Use PT_NOTE segment instead of section for ELF
    // Match postject's EXACT pattern (lines 71-74 of postject.cpp):
    //   LIEF::ELF::Note note;
    //   note.name(note_name);
    //   note.description(vec_from_val(data));
    //   binary->add(note);
    print_creating_section_header("SMOL PT_NOTE segment");

    LIEF::ELF::Note note;
    note.name(ELF_SECTION_PRESSED_DATA);
    note.description(section_data);
    binary->add(note);

    printf("  PT_NOTE segment added successfully\n");
    printf("  Number of PT_NOTE segments: %zu\n", binary->notes().size());

    // Step 5: Write output executable.
    printf("\nWriting output binary...\n");
    fflush(stdout);

    // Check system resources and verify output directory writable.
    printf("  [TRACE] About to call lief_check_system_resources()...\n");
    fflush(stdout);
    fflush(stderr);
    lief_check_system_resources();
    printf("  [TRACE] Returned from lief_check_system_resources()\n");
    fflush(stdout);
    fflush(stderr);

    // Create parent directories if needed.
    printf("  About to call ensure_output_directory()...\n");
    fflush(stdout);
    fflush(stderr);
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
    printf("  Output path: %s\n", output_path);
    printf("  Calling LIEF binary->raw()...\n");
    fflush(stdout);
    try {
      // CRITICAL: Use raw() instead of write() to avoid PHT relocation
      //
      // LIEF's write() method (even with config.notes=false) goes through the Builder
      // which can corrupt binaries by relocating the program header table.
      //
      // Postject (Node.js's official SEA injector) uses binary->raw() instead, which
      // directly serializes the modified binary without going through the Builder.
      // This preserves the original binary layout and prevents segmentation faults.
      //
      // See: https://github.com/nodejs/postject/blob/main/src/postject.cpp#L77
      //      std::vector<uint8_t> raw_binary = binary->raw();
      std::vector<uint8_t> raw_binary = binary->raw();

      // Write the raw binary data to output file
      FILE* fp = fopen(output_path, "wb");
      if (!fp) {
        fprintf(stderr, "Error: Failed to open output file for writing: %s\n", output_path);
        fflush(stderr);
        cleanup_temp_stub(context.stub_path);
        return -1;
      }

      size_t written = fwrite(raw_binary.data(), 1, raw_binary.size(), fp);
      fclose(fp);

      if (written != raw_binary.size()) {
        fprintf(stderr, "Error: Failed to write all bytes (%zu / %zu written)\n", written, raw_binary.size());
        fflush(stderr);
        cleanup_temp_stub(context.stub_path);
        return -1;
      }

      printf("  LIEF raw() wrote %zu bytes successfully\n", written);
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

    print_compression_complete("ELF");
    return 0;

  } catch (const std::exception& e) {
    fprintf(stderr, "Error: LIEF exception: %s\n", e.what());
    return -1;
  } catch (...) {
    fprintf(stderr, "Error: Unknown exception during LIEF ELF compression\n");
    return -1;
  }
}

} // extern "C"
