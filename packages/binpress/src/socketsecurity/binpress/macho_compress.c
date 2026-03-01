/**
 * macOS Mach-O Binary Compressor
 *
 * Compresses Mach-O binaries using Apple Compression framework (LZFSE).
 * Creates self-extracting stubs and/or compressed data files.
 * Uses LIEF for proper Mach-O manipulation while preserving code signatures.
 *
 * Usage:
 *   binpress <input> -o <output>              # Create self-extracting stub
 *   binpress <input> -d <output>              # Create compressed data file
 *   binpress <input> -o <stub> -d <data>      # Create both
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
 * Platform-specific routing for Mach-O binary.
 * Routes to appropriate compression based on stub platform.
 */
int binpress_platform_route(const binpress_config *config, const embedded_stub_t *stub, const char *output) {
    // Route to appropriate compression based on stub platform.
    // For cross-compilation, use LIEF-based methods; for native Mach-O, use LIEF Mach-O.
    if (strcmp(stub->platform, "linux") == 0) {
        // Cross-compile to Linux: Use LIEF-based ELF compression
        printf("Cross-compiling to Linux using LIEF...\n");
        return elf_compress_lief(
            config->input_path,
            output,
            COMPRESS_ALGORITHM_LZFSE,
            config->target,
            config->target_platform,
            config->target_arch,
            config->target_libc
        );
    } else if (strcmp(stub->platform, "win32") == 0) {
        // Cross-compile to Windows: Use LIEF-based PE compression
        printf("Cross-compiling to Windows using LIEF...\n");
        return pe_compress_lief(
            config->input_path,
            output,
            COMPRESS_ALGORITHM_LZFSE,
            config->target,
            config->target_platform,
            config->target_arch,
            config->target_libc
        );
    } else {
        // Native Mach-O or macOS-to-macOS
        printf("Using LIEF-based Mach-O compression...\n");
        return macho_compress_lief(
            config->input_path,
            output,
            COMPRESS_ALGORITHM_LZFSE,
            config->target,
            config->target_platform,
            config->target_arch,
            config->target_libc
        );
    }
}

// Include shared main() implementation.
#include "binpress_main.c"

int main(int argc, char *argv[]) {
    return binpress_main(argc, argv);
}
