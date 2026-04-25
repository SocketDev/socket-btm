// ============================================================================
// elf_compress.c — ELF (Linux) platform routing for binpress
// ============================================================================
//
// WHAT THIS FILE DOES
// Provides the platform-specific binpress_platform_route() for the Linux
// build. Routes compression to the appropriate function based on the target
// stub's format (native ELF, or cross-platform Mach-O/PE via LIEF).
//
// WHY IT EXISTS
// The Linux build of binpress compiles this file to provide the ELF-native
// main(). It includes binpress_main.c (shared entry point) and only adds
// the short routing function that decides which compressor to call.
// ============================================================================

/**
 * Linux ELF Binary Compressor
 *
 * Compresses ELF binaries using ZSTD compression.
 * Updates node-compressed stubs by combining stub + compressed data.
 *
 * Usage:
 *   binpress <input> -d <output>              # Create compressed data file
 *   binpress <input> -o <output>              # Create self-extracting stub
 *   binpress <input> -o <stub> -d <data>      # Create both outputs
 *
 * Note: Compressed stubs are automatically detected and repacked.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "binpress_config.h"
#include "stub_selector.h"
#include "compress_lief.h"
#include "socketsecurity/bin-infra/compression_constants.h"
#include "socketsecurity/bin-infra/compression_common.h"

/**
 * Platform-specific routing for ELF binary.
 * Routes to appropriate compression based on stub platform.
 */
int binpress_platform_route(const binpress_config *config, const embedded_stub_t *stub, const char *output) {
    // Route to appropriate compression based on stub platform.
    // For cross-compilation, use LIEF-based methods; for native ELF, use LIEF ELF.
    if (strcmp(stub->platform, "darwin") == 0) {
        // Cross-compile to macOS: Use LIEF-based Mach-O compression
        printf("Cross-compiling to macOS using LIEF...\n");
        return macho_compress_lief(
            config->input_path,
            output,
            0,
            config->target,
            config->target_platform,
            config->target_arch,
            config->target_libc,
            config->node_version
        );
    } else if (strcmp(stub->platform, "win32") == 0) {
        // Cross-compile to Windows: Use LIEF-based PE compression
        printf("Cross-compiling to Windows using LIEF...\n");
        return pe_compress_lief(
            config->input_path,
            output,
            0,
            config->target,
            config->target_platform,
            config->target_arch,
            config->target_libc,
            config->node_version
        );
    } else {
        // Native ELF or Linux-to-Linux
        printf("Using LIEF-based ELF compression...\n");
        return elf_compress_lief(
            config->input_path,
            output,
            0,
            config->target,
            config->target_platform,
            config->target_arch,
            config->target_libc,
            config->node_version
        );
    }
}

// Include shared main() implementation.
#include "binpress_main.c"

int main(int argc, char *argv[]) {
    return binpress_main(argc, argv);
}
