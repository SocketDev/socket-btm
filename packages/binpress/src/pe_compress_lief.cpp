/**
 * PE binary compression using LIEF
 *
 * Uses LIEF C++ library to read/write PE binaries for cross-platform compression.
 * Enables compressing PE binaries from non-Windows platforms (macOS, Linux).
 */

#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <stdexcept>

#include <LIEF/LIEF.hpp>

extern "C" {
#include "compression_common.h"
#include "compression_constants.h"

/**
 * Compress PE binary using LIEF (cross-platform).
 *
 * This allows compressing PE binaries from macOS/Linux platforms.
 * On non-Windows platforms, LZMA is used instead of LZMS.
 *
 * @param input_path Path to input PE binary
 * @param output_path Path to output compressed binary
 * @param algorithm Compression algorithm to use (COMPRESS_ALGORITHM_*)
 * @return 0 on success, error code otherwise
 */
int pe_compress_lief(const char* input_path,
                     const char* output_path,
                     int algorithm) {
  if (!input_path || !output_path) {
    fprintf(stderr, "Error: Invalid arguments\n");
    return -1;
  }

  try {
    printf("Using LIEF for PE compression (cross-platform)...\n");
    printf("  Input: %s\n", input_path);
    printf("  Output: %s\n", output_path);
    printf("  Algorithm: %s\n",
           algorithm == COMPRESS_ALGORITHM_LZFSE ? "LZFSE" :
           algorithm == COMPRESS_ALGORITHM_LZMA ? "LZMA" :
           algorithm == COMPRESS_ALGORITHM_LZMS ? "LZMS" : "Unknown");

    // Parse PE binary.
    std::unique_ptr<LIEF::PE::Binary> binary =
        LIEF::PE::Parser::parse(input_path);

    if (!binary) {
      fprintf(stderr, "Error: Failed to parse PE binary: %s\n", input_path);
      return -1;
    }

    printf("Parsed PE binary successfully\n");

    // Read binary data.
    FILE* input_file = fopen(input_path, "rb");
    if (!input_file) {
      fprintf(stderr, "Error: Cannot open input file '%s': %s\n",
              input_path, strerror(errno));
      return -1;
    }

    fseek(input_file, 0, SEEK_END);
    size_t input_size = ftell(input_file);
    fseek(input_file, 0, SEEK_SET);

    uint8_t* input_data = (uint8_t*)malloc(input_size);
    if (!input_data) {
      fprintf(stderr, "Error: Cannot allocate %zu bytes for input file\n", input_size);
      fclose(input_file);
      return -1;
    }

    size_t read_bytes = fread(input_data, 1, input_size, input_file);
    fclose(input_file);

    if (read_bytes != input_size) {
      fprintf(stderr, "Error: Read %zu bytes, expected %zu bytes\n",
              read_bytes, input_size);
      free(input_data);
      return -1;
    }

    printf("  Input size: %.2f MB (%zu bytes)\n",
           input_size / 1024.0 / 1024.0, input_size);

    // Compress using specified algorithm.
    // On non-Windows platforms, LZMS falls back to LZMA automatically.
    printf("\nCompressing with %s...\n",
           algorithm == COMPRESS_ALGORITHM_LZFSE ? "LZFSE" :
           algorithm == COMPRESS_ALGORITHM_LZMA ? "LZMA" :
           algorithm == COMPRESS_ALGORITHM_LZMS ? "LZMS" : "Unknown");

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
      return -1;
    }

    printf("  Compressed size: %.2f MB (%zu bytes)\n",
           compressed_size / 1024.0 / 1024.0, compressed_size);
    printf("  Compression ratio: %.1f%%\n", 100.0 * compressed_size / input_size);

    // Write compressed data to output file.
    printf("\nWriting compressed data to %s...\n", output_path);

    FILE* output_file = fopen(output_path, "wb");
    if (!output_file) {
      fprintf(stderr, "Error: Cannot open output file '%s': %s\n",
              output_path, strerror(errno));
      free(compressed_data);
      return -1;
    }

    size_t written = fwrite(compressed_data, 1, compressed_size, output_file);
    fclose(output_file);
    free(compressed_data);

    if (written != compressed_size) {
      fprintf(stderr, "Error: Wrote %zu bytes, expected %zu bytes\n",
              written, compressed_size);
      return -1;
    }

    printf("\n✓ Compressed data created!\n");
    printf("  Output: %s\n", output_path);
    return 0;

  } catch (const std::exception& e) {
    fprintf(stderr, "Error: LIEF exception: %s\n", e.what());
    return -1;
  } catch (...) {
    fprintf(stderr, "Error: Unknown exception during LIEF PE compression\n");
    return -1;
  }
}

} // extern "C"
