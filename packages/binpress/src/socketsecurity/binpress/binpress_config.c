/**
 * @file binpress_config.c
 * @brief Shared configuration implementation for binpress
 *
 * Common CLI argument parsing, validation, and help text used across
 * all platform-specific binpress implementations (Mach-O, ELF, PE).
 */

#include "binpress_config.h"
#include "socketsecurity/build-infra/file_utils.h"

#include <errno.h>
#include <stdio.h>
#include <string.h>

/**
 * Print usage information.
 */
void binpress_print_usage(const char *program) {
    (void)program; // Unused - we use "binpress" instead of argv[0] to avoid absolute paths
    printf("binpress - Create self-extracting binaries and compressed data files\n\n");
    printf("Usage:\n");
    printf("  binpress <input> -o <output>              # Create self-extracting stub\n");
    printf("  binpress <input> -d <output>              # Create compressed data file\n");
    printf("  binpress <input> -o <stub> -d <data>      # Create both outputs\n");
    printf("  binpress --help\n");
    printf("  binpress --version\n\n");
    printf("Arguments:\n");
    printf("  input                Path to binary to compress\n\n");
    printf("Options:\n");
    printf("  -o, --output PATH           Output self-extracting stub\n");
    printf("  -d, --data PATH             Output compressed data file\n");
    printf("  -u, --update PATH           Update existing stub with new data (legacy)\n");
    printf("  --target TARGET             Target platform-arch-libc (e.g., linux-x64-musl, darwin-arm64, win32-x64)\n");
    printf("  --target-platform PLATFORM  Target platform (linux, darwin, win32)\n");
    printf("  --target-arch ARCH          Target architecture (x64, arm64)\n");
    printf("  --target-libc VARIANT       Target libc (musl, glibc) - Linux only\n");
    printf("  -h, --help                  Show this help message\n");
    printf("  -v, --version               Show version information\n\n");
    printf("Examples:\n");
    printf("  binpress node -o node-compressed              # Self-extracting binary\n");
    printf("  binpress node -d node.data                    # Compressed data file\n");
    printf("  binpress node -o node-compressed -d node.data # Both outputs\n");
    printf("  binpress node -u stub -o updated              # Update existing stub\n\n");
    printf("Note: At least one output (-o or -d) must be specified.\n");
    printf("      Use -u for legacy update mode (will be replaced by stub embedding).\n");
}

/**
 * Parse command line arguments.
 */
int binpress_parse_args(int argc, char *argv[], binpress_config *config) {
    memset(config, 0, sizeof(binpress_config));

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--version") == 0 || strcmp(argv[i], "-v") == 0) {
            config->show_version = 1;
            return 0;
        } else if (strcmp(argv[i], "--help") == 0 || strcmp(argv[i], "-h") == 0) {
            config->show_help = 1;
            return 0;
        } else if (strcmp(argv[i], "-o") == 0 || strcmp(argv[i], "--output") == 0) {
            if (i + 1 < argc) {
                config->output_path = argv[++i];
            } else {
                fprintf(stderr, "Error: --output requires a path argument\n");
                return -1;
            }
        } else if (strcmp(argv[i], "-u") == 0 || strcmp(argv[i], "--update") == 0) {
            if (i + 1 < argc) {
                config->update_stub_path = argv[++i];
            } else {
                fprintf(stderr, "Error: --update requires a path argument\n");
                return -1;
            }
        } else if (strcmp(argv[i], "-d") == 0 || strcmp(argv[i], "--data") == 0) {
            if (i + 1 < argc) {
                config->output_data_path = argv[++i];
            } else {
                fprintf(stderr, "Error: --data requires a path argument\n");
                return -1;
            }
        } else if (strcmp(argv[i], "--target") == 0) {
            if (i + 1 < argc) {
                config->target = argv[++i];
            } else {
                fprintf(stderr, "Error: --target requires a target argument (e.g., linux-x64-musl)\n");
                return -1;
            }
        } else if (strcmp(argv[i], "--target-platform") == 0) {
            if (i + 1 < argc) {
                config->target_platform = argv[++i];
            } else {
                fprintf(stderr, "Error: --target-platform requires a platform argument (linux/darwin/win32)\n");
                return -1;
            }
        } else if (strcmp(argv[i], "--target-arch") == 0) {
            if (i + 1 < argc) {
                config->target_arch = argv[++i];
            } else {
                fprintf(stderr, "Error: --target-arch requires an architecture argument (x64/arm64)\n");
                return -1;
            }
        } else if (strcmp(argv[i], "--target-libc") == 0) {
            if (i + 1 < argc) {
                config->target_libc = argv[++i];
            } else {
                fprintf(stderr, "Error: --target-libc requires a variant argument (musl/glibc)\n");
                return -1;
            }
        } else if (!config->input_path) {
            config->input_path = argv[i];
        } else {
            fprintf(stderr, "Error: Unexpected argument: %s\n", argv[i]);
            return -1;
        }
    }

    return 0;
}

/**
 * Validate configuration.
 */
int binpress_validate_config(const binpress_config *config) {
    if (!config->input_path) {
        fprintf(stderr, "Error: No input file specified\n");
        return -1;
    }

    // Check if input exists (cross-platform).
    if (!file_exists(config->input_path)) {
        fprintf(stderr, "Error: Cannot read input file: %s (%s)\n",
                config->input_path, strerror(errno));
        return -1;
    }

    // Validate that at least one output is specified.
    if (!config->output_path && !config->output_data_path && !config->update_stub_path) {
        fprintf(stderr, "Error: Must specify at least one output: -o, -d, or -u\n");
        return -1;
    }

    // Validate update mode.
    if (config->update_stub_path) {
        if (!file_exists(config->update_stub_path)) {
            fprintf(stderr, "Error: Cannot read stub file for update: %s (%s)\n",
                    config->update_stub_path, strerror(errno));
            return -1;
        }
    }

    return 0;
}
