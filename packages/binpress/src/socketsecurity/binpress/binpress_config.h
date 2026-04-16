// ============================================================================
// binpress_config.h — CLI argument parsing and configuration for binpress
// ============================================================================
//
// WHAT THIS FILE DOES
// Defines the binpress_config struct that holds all parsed CLI arguments
// (input path, output paths, target platform/arch/libc, etc.) and declares
// functions to parse, validate, and display help for those arguments.
//
// WHY IT EXISTS
// binpress compresses binaries into self-extracting executables. It needs to
// know the input binary, where to write output, and what target platform to
// build for. This header is shared across all platform-specific builds
// (macOS, Linux, Windows) so argument handling is consistent everywhere.
//
// KEY CONCEPTS FOR JS DEVELOPERS
// - Binary compression = creating a small stub that decompresses the real
//     binary at runtime. Think of it like a self-extracting ZIP file, but
//     for executables.
// - ZSTD (Zstandard) is a fast compression algorithm with good ratio.
//     Used here because the compressed binaries need to start up quickly.
// - A stub binary is a tiny executable (~50KB) that decompresses and runs
//     the real binary. It is embedded inside the binpress tool at build time.
// - Segment = a named region in an executable (like a chapter in a book).
//     The compressed data is stored in a segment called "SMOL".
// - struct: Like a plain JS object with fixed, typed fields. binpress_config
//     is the C equivalent of `{ inputPath: string, outputPath: string, ... }`.
// - const char*: A pointer to a string. In C, strings are just arrays of
//     characters with a null byte ('\0') at the end.
// ============================================================================

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
    const char *node_version;        // --node-version (skip detection, use this version)
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
