/**
 * Shared main() implementation for binpress across all platforms.
 *
 * This eliminates duplication across elf_compress.c, pe_compress.c, and macho_compress.c.
 * Each platform-specific binary includes this file and provides platform routing.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "binpress_config.h"
#include "stub_selector.h"
#include "compress_lief.h"
#include "socketsecurity/bin-infra/compression_constants.h"
#include "socketsecurity/build-infra/debug_common.h"

#ifndef VERSION
#define VERSION "dev"
#endif

/**
 * Platform-specific routing function (implemented by each platform binary).
 *
 * Routes to appropriate compression function based on stub platform:
 * - For native compilation: uses platform-native methods
 * - For cross-compilation: uses LIEF-based methods
 *
 * @param config Configuration from command line
 * @param stub Selected stub for target platform
 * @param output Output path for compressed binary
 * @return 0 on success, error code otherwise
 */
int binpress_platform_route(const binpress_config *config, const embedded_stub_t *stub, const char *output);

/**
 * Shared main() implementation.
 */
int binpress_main(int argc, char *argv[]) {
    DEBUG_INIT("binpress");
    binpress_config config;

    // Parse arguments (shared implementation).
    if (binpress_parse_args(argc, argv, &config) != 0) {
        binpress_print_usage(argv[0]);
        return 1;
    }

    // Handle version and help.
    if (config.show_version) {
        printf("binpress %s\n", VERSION);
        return 0;
    }

    if (config.show_help) {
        binpress_print_usage(argv[0]);
        return 0;
    }

    // Validate configuration (shared implementation).
    if (binpress_validate_config(&config) != 0) {
        fprintf(stderr, "\n");
        binpress_print_usage(argv[0]);
        return 1;
    }

    // Determine output path (output_path or update_stub_path).
    const char *output = config.output_path ? config.output_path : config.update_stub_path;

    // Print configuration.
    printf("  Input: %s\n", config.input_path);
    printf("  Output: %s\n", output);
    if (config.target) {
        printf("  Target: %s\n", config.target);
    }
    if (config.target_platform) {
        printf("  Target platform: %s\n", config.target_platform);
    }
    if (config.target_arch) {
        printf("  Target arch: %s\n", config.target_arch);
    }
    if (config.target_libc) {
        printf("  Target libc: %s\n", config.target_libc);
    }

    // Select appropriate stub based on target flags.
    const embedded_stub_t *stub = select_stub_with_target(
        config.input_path,
        config.target,
        config.target_platform,
        config.target_arch,
        config.target_libc
    );

    if (!stub) {
        fprintf(stderr, "Error: Cannot select stub for input binary\n");
        return -1;
    }

    // Route to platform-specific compression (delegates to each binary's implementation).
    return binpress_platform_route(&config, stub, output);
}
