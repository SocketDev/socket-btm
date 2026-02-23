/**
 * Common LIEF compression logic shared across PE and ELF implementations
 *
 * Provides reusable functions for:
 * - Stub selection and temp file management
 * - Input reading and compression
 * - SMOL section building with metadata
 *
 * Platform-specific section/segment creation remains in pe_compress_lief.cpp
 * and elf_compress_lief.cpp.
 */

#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

extern "C" {
#include "socketsecurity/bin-infra/compression_common.h"
#include "socketsecurity/bin-infra/smol_segment.h"
#include "stub_selector.h"
#include "socketsecurity/build-infra/file_io_common.h"
#include "socketsecurity/bin-infra/decompressor_limits.h"
}

#include "compress_lief_common.hpp"
#include "socketsecurity/build-infra/file_utils.h"

/**
 * Perform common compression steps 1-3:
 * 1. Select appropriate decompressor stub for input binary
 * 2. Read and compress input binary
 * 3. Build SMOL section data (magic marker + metadata + compressed data)
 *
 * @param input_path Path to input binary
 * @param algorithm Compression algorithm to use
 * @param context Output context with stub info and section data
 * @param target_libc Target libc variant ("glibc", "musl", or NULL for auto-detect)
 * @return 0 on success, error code otherwise
 */
int compress_lief_common(
    const char* input_path,
    int algorithm,
    compress_context_t* context,
    const char* target,
    const char* target_platform,
    const char* target_arch,
    const char* target_libc
) {
  if (!input_path || !context) {
    fprintf(stderr, "Error: Invalid arguments\n");
    return -1;
  }

  // Initialize context.
  memset(context, 0, sizeof(compress_context_t));

  // Step 1: Select appropriate decompressor stub for input binary.
  printf("\nSelecting decompressor stub...\n");
  const embedded_stub_t* stub = select_stub_with_target(
      input_path, target, target_platform, target_arch, target_libc);
  if (!stub) {
    fprintf(stderr, "Error: No suitable decompressor stub found for binary\n");
    return -1;
  }

  printf("  Selected stub: %s-%s", stub->platform, stub->arch);
  if (stub->libc) {
    printf("-%s", stub->libc);
  }
  printf(" (%zu bytes)\n", stub->size);

  // Write stub to temp file.
  if (write_temp_stub(stub, context->stub_path, sizeof(context->stub_path)) != 0) {
    fprintf(stderr, "Error: Failed to write temp stub\n");
    return -1;
  }

  printf("  Temp stub: %s\n", context->stub_path);
  context->stub = stub;

  // Step 2: Read and compress input binary.
  printf("\nReading input binary...\n");
  uint8_t* input_data;
  size_t input_size;
  if (file_io_read(input_path, &input_data, &input_size) != FILE_IO_OK) {
    cleanup_temp_stub(context->stub_path);
    return -1;
  }

  printf("  Input size: %.2f MB (%zu bytes)\n",
         input_size / 1024.0 / 1024.0, input_size);

  // Validate input size against decompressor limit.
  if (input_size > DECOMPRESSOR_MAX_UNCOMPRESSED_SIZE) {
    fprintf(stderr, "Error: Input binary size (%zu bytes / %.2f MB) exceeds decompressor limit (%zu bytes / %.2f MB)\n",
            input_size, input_size / 1024.0 / 1024.0,
            (size_t)DECOMPRESSOR_MAX_UNCOMPRESSED_SIZE, DECOMPRESSOR_MAX_UNCOMPRESSED_SIZE / 1024.0 / 1024.0);
    fprintf(stderr, "The decompressor stub cannot extract binaries larger than %.2f MB.\n",
            DECOMPRESSOR_MAX_UNCOMPRESSED_SIZE / 1024.0 / 1024.0);
    fprintf(stderr, "Please reduce the binary size or increase DECOMPRESSOR_MAX_UNCOMPRESSED_SIZE in decompressor_limits.h\n");
    free(input_data);
    cleanup_temp_stub(context->stub_path);
    return -1;
  }

  // Compress using LZFSE algorithm.
  printf("\nCompressing with LZFSE...\n");

  uint8_t* compressed_data = nullptr;
  size_t compressed_size = 0;

  int compress_result = compress_buffer_with_algorithm(
      input_data, input_size,
      &compressed_data, &compressed_size,
      algorithm
  );

  free(input_data);

  if (compress_result != COMPRESS_OK) {
    fprintf(stderr, "Error: Compression failed with code %d\n", compress_result);
    if (compress_result == COMPRESS_ERROR_UNSUPPORTED_ALGORITHM) {
      fprintf(stderr, "Algorithm not supported on this platform.\n");
    }
    cleanup_temp_stub(context->stub_path);
    return -1;
  }

  printf("  Compressed size: %.2f MB (%zu bytes)\n",
         compressed_size / 1024.0 / 1024.0, compressed_size);
  printf("  Compression ratio: %.1f%%\n", 100.0 * compressed_size / input_size);

  // Step 3: Build SMOL section data (magic marker + metadata + compressed data).
  // Determine platform metadata from stub.
  uint8_t platform_byte = 0xFF, arch_byte = 0xFF, libc_byte = 0xFF;

  if (strcmp(stub->platform, "win") == 0 || strcmp(stub->platform, "win32") == 0) {
    platform_byte = 2;  // Windows
  } else if (strcmp(stub->platform, "linux") == 0) {
    platform_byte = 0;  // Linux
  } else if (strcmp(stub->platform, "darwin") == 0) {
    platform_byte = 1;  // macOS
  }

  if (strcmp(stub->arch, "arm64") == 0) {
    arch_byte = 1;
  } else if (strcmp(stub->arch, "x64") == 0) {
    arch_byte = 0;
  }

  if (stub->libc) {
    if (strcmp(stub->libc, "musl") == 0) {
      libc_byte = 1;
    } else {
      libc_byte = 0;  // glibc or unspecified
    }
  } else {
    libc_byte = 255;  // Non-Linux (n/a)
  }

  int result = build_smol_section_from_compressed(
      compressed_data, compressed_size, input_size,
      platform_byte, arch_byte, libc_byte,
      &context->section
  );

  free(compressed_data);

  if (result != 0) {
    cleanup_temp_stub(context->stub_path);
    return -1;
  }

  return 0;
}

/**
 * Free compression context resources.
 *
 * @param context Context to free
 */
void compress_lief_common_free(compress_context_t* context) {
  if (!context) {
    return;
  }

  // Free section data if allocated.
  if (context->section.data) {
    smol_free_section(&context->section);
  }

  // Clean up temp stub if created.
  if (context->stub_path[0] != '\0') {
    cleanup_temp_stub(context->stub_path);
  }
}

/**
 * Build SMOL section from pre-compressed data.
 * Detects platform metadata and builds section data.
 *
 * @param compressed_data Compressed data buffer
 * @param compressed_size Size of compressed data
 * @param uncompressed_size Original uncompressed size
 * @param platform_override Platform byte (0xFF = auto-detect)
 * @param arch_override Architecture byte (0xFF = auto-detect)
 * @param libc_override Libc byte (0xFF = auto-detect)
 * @param section Output section data
 * @return 0 on success, error code otherwise
 */
int build_smol_section_from_compressed(
    const uint8_t* compressed_data,
    size_t compressed_size,
    size_t uncompressed_size,
    uint8_t platform_override,
    uint8_t arch_override,
    uint8_t libc_override,
    smol_section_t* section
) {
  if (!compressed_data || !section) {
    fprintf(stderr, "Error: Invalid arguments\n");
    return -1;
  }

  printf("\nBuilding SMOL section data...\n");

  // Detect platform metadata if not overridden.
  uint8_t platform_byte, arch_byte, libc_byte;

  if (platform_override == 0xFF || arch_override == 0xFF || libc_override == 0xFF) {
    // Need to detect some metadata.
    smol_detect_platform_metadata(&platform_byte, &arch_byte, &libc_byte);

    // Apply overrides.
    if (platform_override != 0xFF) platform_byte = platform_override;
    if (arch_override != 0xFF) arch_byte = arch_override;
    if (libc_override != 0xFF) libc_byte = libc_override;
  } else {
    // All overridden.
    platform_byte = platform_override;
    arch_byte = arch_override;
    libc_byte = libc_override;
  }

  // Build section data.
  // binpress doesn't use update config, so pass NULL
  if (smol_build_section_data(compressed_data, compressed_size, uncompressed_size,
                               platform_byte, arch_byte, libc_byte, NULL, section) != 0) {
    fprintf(stderr, "Error: Failed to build section data\n");
    return -1;
  }

  printf("  Cache key: %s\n", section->cache_key);
  printf("  Total section data: %zu bytes\n", section->size);

  return 0;
}

/**
 * Print compression header message.
 */
void print_compression_header(const char* format_name) {
  printf("%s binary compression (LIEF-based)...\n", format_name);
  printf("  Input: ");  // Caller should print input path
}

/**
 * Print compression completion message.
 */
void print_compression_complete(const char* format_name) {
  printf("\n✓ %s compression complete!\n", format_name);
}

/**
 * Print LIEF stub parsing header.
 */
void print_parsing_stub_header(const char* format_name) {
  printf("\nParsing %s stub with LIEF...\n", format_name);
}

/**
 * Print section/segment creation header.
 */
void print_creating_section_header(const char* section_name) {
  printf("\nCreating %s...\n", section_name);
}

/**
 * Create parent directories for output path with error handling.
 */
int ensure_output_directory(const char* output_path, const char* stub_path) {
  printf("  Ensuring output directory exists for: %s\n", output_path);
  fflush(stdout);

  if (create_parent_directories(output_path) != 0) {
    fprintf(stderr, "Error: Failed to create parent directories for: %s\n", output_path);
    fflush(stderr);
    cleanup_temp_stub(stub_path);
    return -1;
  }

  printf("  Output directory ready\n");
  fflush(stdout);
  return 0;
}

/**
 * Verify that a file was successfully written.
 * LIEF write() may silently fail without throwing exceptions on some platforms.
 */
int verify_file_written(const char* file_path) {
  FILE* check_file = fopen(file_path, "rb");
  if (!check_file) {
    fprintf(stderr, "Error: Output file was not created: %s\n", file_path);
    fprintf(stderr, "  errno: %d (%s)\n", errno, strerror(errno));
    fflush(stderr);
    return -1;
  }
  fclose(check_file);
  return 0;
}

/**
 * Compress binary and write data-only output (no executable stub).
 * Creates a .data file containing only the compressed SMOL section data.
 *
 * @param input_path Path to input binary
 * @param output_data_path Path to output .data file
 * @param algorithm Compression algorithm to use
 * @param target Combined target string (e.g., "linux-x64-musl")
 * @param target_platform Target platform ("linux", "darwin", "win32")
 * @param target_arch Target architecture ("x64", "arm64")
 * @param target_libc Target libc variant (NULL for Mach-O binaries)
 * @return 0 on success, error code otherwise
 */
int compress_data_only(
    const char* input_path,
    const char* output_data_path,
    int algorithm,
    const char* target,
    const char* target_platform,
    const char* target_arch,
    const char* target_libc
) {
  if (!input_path || !output_data_path) {
    fprintf(stderr, "Error: Invalid arguments to compress_data_only\n");
    return -1;
  }

  printf("Data-only compression...\n");
  printf("  Input: %s\n", input_path);
  printf("  Output: %s\n", output_data_path);
  printf("  Algorithm: LZFSE\n");

  // Step 1-3: Use common compression logic to build section data
  compress_context_t context;
  if (compress_lief_common(input_path, algorithm, &context, target, target_platform, target_arch, target_libc) != 0) {
    return -1;
  }

  // Step 4: Write section data directly to output file
  printf("\nWriting compressed data...\n");

  // Create parent directories if needed
  if (create_parent_directories(output_data_path) != 0) {
    fprintf(stderr, "Error: Failed to create parent directories for: %s\n", output_data_path);
    smol_free_section(&context.section);
    cleanup_temp_stub(context.stub_path);
    return -1;
  }

  // Write section data to file
  if (write_file_atomically(output_data_path, context.section.data, context.section.size, 0644) != 0) {
    fprintf(stderr, "Error: Failed to write data file: %s\n", output_data_path);
    smol_free_section(&context.section);
    cleanup_temp_stub(context.stub_path);
    return -1;
  }

  printf("  Data written to: %s\n", output_data_path);
  printf("  Size: %zu bytes\n", context.section.size);

  // Clean up
  smol_free_section(&context.section);
  cleanup_temp_stub(context.stub_path);

  printf("\n✓ Data-only compression complete!\n");
  return 0;
}
