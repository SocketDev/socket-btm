/**
 * Windows PE Binary Compressor
 *
 * Compresses PE/PE32+ binaries using LZFSE compression.
 * Updates node-compressed stubs by combining stub + compressed data.
 *
 * Usage:
 *   binpress <input> -d <output>              # Create compressed data file
 *   binpress <input> -o <output>              # Create self-extracting stub
 *   binpress <input> -o <stub> -d <data>      # Create both outputs
 *   binpress <input> -u <stub> [-o <output>]  # Update node-compressed stub (legacy)
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
 * Platform-specific routing for PE binary.
 * Routes to appropriate compression based on stub platform.
 */
int binpress_platform_route(const binpress_config *config, const embedded_stub_t *stub, const char *output) {
    // Route to appropriate compression based on stub platform.
    // For cross-compilation, use LIEF-based methods; for native PE, use LIEF PE.
    if (strcmp(stub->platform, "darwin") == 0) {
        // Cross-compile to macOS: Use LIEF-based Mach-O compression
        printf("Cross-compiling to macOS using LIEF...\n");
        return macho_compress_lief(
            config->input_path,
            output,
            COMPRESS_ALGORITHM_LZFSE,
            config->target,
            config->target_platform,
            config->target_arch,
            config->target_libc
        );
    } else if (strcmp(stub->platform, "linux") == 0) {
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
    } else {
        // Native PE or Windows-to-Windows
        printf("Using LIEF-based PE compression...\n");
        return pe_compress_lief(
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
