/**
 * @file binpress_config.h
 * @brief Shared configuration structures and functions for binpress
 *
 * Common CLI argument parsing, validation, and help text used across
 * all platform-specific binpress implementations (Mach-O, ELF, PE).
 */

#ifndef BINPRESS_CONFIG_H
#define BINPRESS_CONFIG_H

/**
 * Configuration for binpress operation.
 * Used across macho_compress.c, elf_compress.c, and pe_compress.c
 */
typedef struct {
    const char *input_path;
    const char *output_path;         // -o, --output (stub output)
    const char *output_data_path;    // -d, --data (data file output)
    const char *target;              // --target (combined platform-arch-libc)
    const char *target_platform;     // --target-platform (linux/darwin/win32)
    const char *target_arch;         // --target-arch (x64/arm64)
    const char *target_libc;         // --target-libc (musl/glibc override)
    int show_help;
    int show_version;
} binpress_config;

/**
 * Print usage information.
 *
 * @param program Program name (argv[0])
 */
void binpress_print_usage(const char *program);

/**
 * Parse command line arguments.
 *
 * @param argc Argument count
 * @param argv Argument vector
 * @param config Output configuration structure
 * @return 0 on success, -1 on error
 */
int binpress_parse_args(int argc, char *argv[], binpress_config *config);

/**
 * Validate configuration.
 *
 * @param config Configuration to validate
 * @return 0 if valid, -1 if invalid
 */
int binpress_validate_config(const binpress_config *config);

#endif // BINPRESS_CONFIG_H
