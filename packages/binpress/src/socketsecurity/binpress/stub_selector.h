/**
 * @fileoverview Embedded stub selection for binpress
 *
 * Provides infrastructure for embedding pre-compiled self-extracting stubs
 * directly into the binpress binary, eliminating the need for separate
 * stub files at runtime.
 *
 * Architecture:
 * - Stubs are downloaded from GitHub releases during binpress build
 * - Each stub is converted to C array
 * - binpress detects input binary format/arch and selects matching stub
 * - Selected stub is extracted to temp file for segment embedding
 *
 * Supported stubs:
 * - darwin-arm64, darwin-x64 (Mach-O)
 * - linux-arm64, linux-x64, linux-arm64-musl, linux-x64-musl (ELF)
 * - win-arm64, win-x64 (PE)
 */

#ifndef BINPRESS_STUB_SELECTOR_H
#define BINPRESS_STUB_SELECTOR_H

#include <stddef.h>

/**
 * Embedded stub metadata
 */
typedef struct {
    const unsigned char *data;  // Stub binary data
    size_t size;                // Size in bytes
    const char *platform;       // "darwin", "linux", "win"
    const char *arch;           // "x64", "arm64"
    const char *libc;           // "glibc", "musl", NULL (for non-Linux)
} embedded_stub_t;

/**
 * Detect binary format and architecture from input file.
 * Uses magic bytes and headers to determine platform/arch.
 *
 * @param input_path Path to binary to analyze
 * @return embedded_stub_t matching the input, or NULL if unsupported
 */
const embedded_stub_t* select_stub_for_binary(const char *input_path);

/**
 * Select stub with explicit target specification.
 * Used for cross-compilation when target differs from input binary.
 *
 * Supports both combined and individual target parameters:
 * - Combined: target = "linux-x64-musl" (platform-arch-libc format)
 * - Individual: target_platform = "linux", target_arch = "x64", target_libc = "musl"
 *
 * Priority: If target is provided, it's parsed and used. Otherwise, individual parameters are used.
 * If no target parameters are provided, falls back to auto-detection from input_path.
 *
 * @param input_path Path to binary (for format detection fallback)
 * @param target Target platform-arch-libc string (e.g., "linux-x64-musl", "darwin-arm64", "win-x64")
 * @param target_platform Target platform ("linux", "darwin", "win", "win32")
 * @param target_arch Target architecture ("x64", "arm64")
 * @param target_libc Target libc variant ("glibc", "musl", or NULL for non-Linux)
 * @return embedded_stub_t matching target, or NULL if unsupported
 */
const embedded_stub_t* select_stub_with_target(
    const char *input_path,
    const char *target,
    const char *target_platform,
    const char *target_arch,
    const char *target_libc
);

/**
 * Write embedded stub to temporary file.
 * Creates executable temp file and writes stub data.
 *
 * @param stub Embedded stub to write
 * @param output_path Buffer to receive temp file path (must be >= 256 bytes)
 * @param path_size Size of output_path buffer
 * @return 0 on success, -1 on error
 */
int write_temp_stub(const embedded_stub_t *stub, char *output_path, size_t path_size);

/**
 * Clean up temporary stub file.
 *
 * @param stub_path Path returned by write_temp_stub()
 */
void cleanup_temp_stub(const char *stub_path);

#endif // BINPRESS_STUB_SELECTOR_H
