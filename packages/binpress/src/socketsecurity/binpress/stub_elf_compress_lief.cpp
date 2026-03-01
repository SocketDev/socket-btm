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
#include "socketsecurity/bin-infra/segment_names.h"
#include "socketsecurity/bin-infra/compression_common.h"
#include "socketsecurity/bin-infra/compression_constants.h"
#include "socketsecurity/binpress/lief_write_diagnostics.h"
}

#include "socketsecurity/bin-infra/elf_note_utils.hpp"

#ifndef _WIN32
// Signal handler for debugging crashes (Unix only).
static void signal_handler(int signum) {
  fprintf(stderr, "\n[FATAL] Caught signal %d\n", signum);
  fprintf(stderr, "[FATAL] Signal name: %s\n", strsignal(signum));
  fflush(stderr);
  _exit(128 + signum);
}
#endif

#include "compress_lief_common.hpp"
#include "socketsecurity/build-infra/file_utils.h"

extern "C" {
#include "socketsecurity/bin-infra/segment_names.h"

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
#ifndef _WIN32
  signal(SIGSEGV, signal_handler);
  signal(SIGABRT, signal_handler);
  signal(SIGILL, signal_handler);
  signal(SIGFPE, signal_handler);
#endif

    print_compression_header("ELF");
    printf("%s\n", input_path);
    printf("  Output: %s\n", output_path);
    printf("  Algorithm: LZFSE\n");

    // Steps 1-3: Use common compression logic (stub selection, compression, section building).
    compress_context_t context;
    if (compress_lief_common(input_path, algorithm, &context, target, target_platform, target_arch, target_libc) != 0) {
      return -1;
    }

    // Convert section data to vector for raw note writing
    std::vector<uint8_t> section_data(context.section.data,
                                       context.section.data + context.section.size);
    smol_free_section(&context.section);

    // Step 4: Write output using raw note append (bypasses LIEF write restructuring)
    // LIEF's write() restructures the entire binary, moving PHT and creating new LOAD
    // segments that break the binary. The raw approach preserves the stub structure.
    print_creating_section_header("SMOL PT_NOTE segment (raw)");
    printf("  Using raw note append to preserve stub binary structure\n");
    printf("  Note name: %s\n", ELF_NOTE_PRESSED_DATA);
    printf("  Note data size: %zu bytes\n", section_data.size());
    fflush(stdout);

    // Create parent directories if needed.
    if (ensure_output_directory(output_path, context.stub_path) != 0) {
      fprintf(stderr, "ERROR: ensure_output_directory() failed\n");
      cleanup_temp_stub(context.stub_path);
      return -1;
    }

    // Write using raw note append
    printf("\nWriting output binary (raw note append)...\n");
    printf("  Stub path: %s\n", context.stub_path);
    printf("  Output path: %s\n", output_path);
    fflush(stdout);

    int result = elf_note_utils::smol_reuse_single_ptnote(
        context.stub_path,
        output_path,
        ELF_NOTE_PRESSED_DATA,
        section_data
    );

    if (result != 0) {
      fprintf(stderr, "Error: Raw note write failed\n");
      cleanup_temp_stub(context.stub_path);
      return -1;
    }

    // Verify file was actually written
    if (verify_file_written(output_path) != 0) {
      cleanup_temp_stub(context.stub_path);
      return -1;
    }

    printf("  Binary written to: %s\n", output_path);
    fflush(stdout);

    // Clean up temp stub.
    cleanup_temp_stub(context.stub_path);

    print_compression_complete("ELF");
    return 0;

}

} // extern "C"
