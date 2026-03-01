/**
 * PE binary compression using LIEF
 *
 * Uses LIEF C++ library to read/write PE binaries for cross-platform compression.
 * Enables compressing PE binaries from non-Windows platforms (macOS, Linux).
 *
 * Architecture (mirrors macOS approach):
 * 1. Select appropriate decompressor stub for target binary
 * 2. Compress the input binary
 * 3. Build SMOL section data (magic marker + metadata + compressed data)
 * 4. Add SMOL section to stub binary using LIEF
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
#include "socketsecurity/bin-infra/segment_names.h"
#include "socketsecurity/bin-infra/compression_common.h"
#include "socketsecurity/bin-infra/compression_constants.h"
#include "socketsecurity/binpress/lief_write_diagnostics.h"
#include "socketsecurity/build-infra/file_io_common.h"
}

#include "compress_lief_common.hpp"
#include "socketsecurity/build-infra/file_utils.h"

extern "C" {
#include "socketsecurity/bin-infra/segment_names.h"

/**
 * Compress PE binary using LIEF (cross-platform).
 *
 * This allows compressing PE binaries from macOS/Linux platforms.
 * Creates a self-extracting executable with embedded compressed data.
 *
 * @param input_path Path to input PE binary
 * @param output_path Path to output compressed binary
 * @param algorithm Compression algorithm to use (COMPRESS_ALGORITHM_*)
 * @return 0 on success, error code otherwise
 */
int pe_compress_lief(const char* input_path,
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

    print_compression_header("PE");
    printf("%s\n", input_path);
    printf("  Output: %s\n", output_path);
    printf("  Algorithm: LZFSE\n");

    // Steps 1-3: Use common compression logic (stub selection, compression, section building).
    compress_context_t context;
    if (compress_lief_common(input_path, algorithm, &context, target, target_platform, target_arch, target_libc) != 0) {
      return -1;
    }

    // Step 4: Add SMOL section to stub binary using LIEF.
    print_parsing_stub_header("PE");
    std::unique_ptr<LIEF::PE::Binary> binary = LIEF::PE::Parser::parse(context.stub_path);

    if (!binary) {
      fprintf(stderr, "Error: Failed to parse PE stub binary\n");
      compress_lief_common_free(&context);
      return -1;
    }

    printf("  Number of sections: %zu\n", binary->sections().size());

    // Convert section data to vector for LIEF.
    std::vector<uint8_t> section_data(context.section.data,
                                       context.section.data + context.section.size);
    smol_free_section(&context.section);

    // Create new PE section for SMOL data.
    // Use .pressed_data to match Mach-O section name __PRESSED_DATA (PE convention: lowercase with dot prefix)
    print_creating_section_header("SMOL section");
    LIEF::PE::Section smol_section(PE_SECTION_PRESSED_DATA);
    smol_section.content(section_data);
    smol_section.characteristics(PE_SMOL_CHARACTERISTICS);

    // Add section to binary.
    LIEF::PE::Section* added_section = binary->add_section(smol_section);
    if (!added_section) {
      fprintf(stderr, "Error: Failed to add SMOL section\n");
      cleanup_temp_stub(context.stub_path);
      return -1;
    }

    printf("  Section added successfully\n");
    printf("  New number of sections: %zu\n", binary->sections().size());

    // Step 5: Write output executable.
    printf("\nWriting output binary...\n");
    fflush(stdout);

    // Ensure output path has .exe extension for PE binaries.
    char* final_output_path = ensure_exe_extension(output_path);
    if (!final_output_path) {
      fprintf(stderr, "Error: Failed to process output path\n");
      fflush(stderr);
      cleanup_temp_stub(context.stub_path);
      return -1;
    }

    // Check system resources and verify output directory writable.
    lief_check_system_resources();

    // Create parent directories if needed.
    printf("  About to call ensure_output_directory()...\n");
    fflush(stdout);
    if (ensure_output_directory(final_output_path, context.stub_path) != 0) {
      fprintf(stderr, "ERROR: ensure_output_directory() failed, returning -1\n");
      fflush(stderr);
      free(final_output_path);
      return -1;
    }
    printf("  ensure_output_directory() completed successfully\n");
    fflush(stdout);

    printf("  About to call lief_verify_output_dir_writable()...\n");
    fflush(stdout);
    if (lief_verify_output_dir_writable(final_output_path) != 0) {
      fprintf(stderr, "ERROR: lief_verify_output_dir_writable() failed, returning -1\n");
      fflush(stderr);
      free(final_output_path);
      cleanup_temp_stub(context.stub_path);
      return -1;
    }
    printf("  lief_verify_output_dir_writable() completed successfully\n");
    fflush(stdout);

    // Write modified binary.
    printf("  Calling LIEF binary->write()...\n");
    fflush(stdout);
      // CRITICAL: Use explicit config to ensure proper segment/section building
      // Without this, LIEF may write malformed segments that crash the dynamic linker
      // Conservative config matching pe_inject_lief.cpp for consistency
      LIEF::PE::Builder::config_t config;
      config.resources = true;      // Rebuild resources (SMOL section in .rsrc)
      config.imports = false;       // Don't modify imports
      config.exports = false;       // Don't modify exports
      config.relocations = false;   // Don't modify relocations
      config.load_configuration = false;  // Don't modify load config
      config.tls = false;           // Don't modify TLS
      config.overlay = true;        // Preserve overlay data
      config.dos_stub = true;       // Preserve DOS stub
      config.debug = false;         // Don't modify debug info
      binary->write(final_output_path, config);
      printf("  LIEF write() returned successfully\n");
      fflush(stdout);

      // Sync to disk (LIEF doesn't fsync internally)
      if (fsync_file_by_path(final_output_path) != FILE_IO_OK) {
        fprintf(stderr, "Error: Failed to sync LIEF output to disk: %s\n", final_output_path);
        free(final_output_path);
        cleanup_temp_stub(context.stub_path);
        return -1;
      }

      // Verify file was actually written
      if (verify_file_written(final_output_path) != 0) {
        free(final_output_path);
        cleanup_temp_stub(context.stub_path);
        return -1;
      }

      printf("  Binary written to: %s\n", final_output_path);
      fflush(stdout);

    // Set executable permissions (cross-platform).
    set_executable_permissions(final_output_path);

    free(final_output_path);

    // Clean up temp stub.
    cleanup_temp_stub(context.stub_path);

    print_compression_complete("PE");
    return 0;
}

} // extern "C"
