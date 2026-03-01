/**
 * binject - Pure C alternative to postject
 * Main CLI entry point
 */

#ifndef _WIN32
#define _POSIX_C_SOURCE 200809L  // For strdup
#endif

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <limits.h>
#include <sys/stat.h>
#include "socketsecurity/build-infra/file_io_common.h"
#include "socketsecurity/build-infra/process_exec.h"
#ifdef _WIN32
#include <process.h>
#include "socketsecurity/build-infra/posix_compat.h"
#else
#include <errno.h>
#include <sys/wait.h>
#include <unistd.h>
#endif
#include "socketsecurity/binject/binject.h"
#include "socketsecurity/bin-infra/buffer_constants.h"
#include "socketsecurity/bin-infra/binary_format.h"
#include "socketsecurity/build-infra/debug_common.h"
#include "socketsecurity/build-infra/dlx_cache_common.h"
#include "socketsecurity/binject/json_parser.h"
#include "socketsecurity/binject/smol_config.h"
#include "socketsecurity/binject/vfs_utils.h"
#include "socketsecurity/bin-infra/smol_detect.h"
#include "socketsecurity/bin-infra/smol_segment_reader.h"
#ifdef _WIN32
#include <fcntl.h>  // For _O_RDONLY
#define O_RDONLY _O_RDONLY
#endif

/**
 * SEA Performance Impact Constants (in milliseconds)
 *
 * These values are based on documented benchmarks and real-world measurements:
 *
 * Code Cache (useCodeCache):
 *   - Provides ~13% faster startup time
 *   - Reduces V8 script compilation time by pre-compiling JavaScript to bytecode
 *   - Measured impact: 21.6ms for 500-module TypeScript application (161.3ms → 139.7ms)
 *   - V8 reports 20-40% reduction in parse/compile time
 *   - Reference: https://github.com/yyx990803/bun-vs-node-sea-startup (real benchmark)
 *   - Reference: https://v8.dev/blog/improved-code-caching
 *
 * Snapshot (useSnapshot):
 *   - Provides ~2x faster startup (skips parse/compile/execute)
 *   - Pre-initializes V8 heap state, avoiding cold start initialization
 *   - Simple apps: ~20ms savings (40ms → 20ms on MacBook)
 *   - Complex apps: ~100ms savings (TypeScript compiler benchmark)
 *   - Reference: Node.js startup snapshots talk by Joyee Cheung
 *   - Reference: https://v8.dev/blog/custom-startup-snapshots (TypeScript example)
 *
 * Combined (Code Cache + Snapshot):
 *   - Effects are mostly additive (snapshot dominates the benefit)
 *   - Simple apps: ~40ms total (20ms code cache + 20ms snapshot)
 *   - Complex apps: ~125ms total (25ms code cache + 100ms snapshot)
 *   - Most significant for applications with large dependency trees
 *
 * Note: Actual impact varies based on:
 *   - Application size and complexity (number of modules/functions)
 *   - CPU performance and memory bandwidth
 *   - Whether modules are CJS or ESM (affects parse/compile cost)
 */
/* Code cache impact: 21.6ms measured in real benchmark
 * Source: https://github.com/yyx990803/bun-vs-node-sea-startup - Real benchmark with 500 TypeScript modules
 * Source: https://v8.dev/blog/improved-code-caching - V8 engineering blog */
#define SEA_PERF_CODE_CACHE_MIN_MS 20
#define SEA_PERF_CODE_CACHE_MAX_MS 25

/* Snapshot impact: 20ms (simple apps) to 100ms (TypeScript compiler)
 * Source: https://v8.dev/blog/custom-startup-snapshots - TypeScript example
 * Source: Node.js startup snapshots talk by Joyee Cheung */
#define SEA_PERF_SNAPSHOT_MIN_MS 20
#define SEA_PERF_SNAPSHOT_MAX_MS 100

/* Combined impact: additive effect (code cache + snapshot)
 * Source: Calculated from above benchmarks */
#define SEA_PERF_COMBINED_MIN_MS 40
#define SEA_PERF_COMBINED_MAX_MS 125

/**
 * Check if a file has a .json extension
 */
static int is_json_file(const char *path) {
    if (!path) return 0;
    const char *ext = strrchr(path, '.');
    return ext && strcmp(ext, ".json") == 0;
}

/**
 * Validate that a path is a legitimate Node.js binary
 * Basic validation: must be an existing executable file
 */
static int validate_node_binary(const char *path) {
    if (!path || strlen(path) == 0) {
        return 0;
    }

    // Resolve to canonical absolute path to prevent path traversal
    char resolved_path[PATH_MAX];
#ifdef _WIN32
    if (_fullpath(resolved_path, path, PATH_MAX) == NULL) {
        fprintf(stderr, "Error: Invalid path: %s\n", path);
        return 0;
    }
#else
    if (realpath(path, resolved_path) == NULL) {
        fprintf(stderr, "Error: Invalid path: %s\n", path);
        return 0;
    }
#endif

    // Check if file exists and is executable
    struct stat st;
    if (stat(resolved_path, &st) != 0) {
        fprintf(stderr, "Error: Node binary not found: %s\n", resolved_path);
        return 0;
    }

    if (!S_ISREG(st.st_mode)) {
        fprintf(stderr, "Error: Node binary path is not a regular file: %s\n", resolved_path);
        return 0;
    }

#ifndef _WIN32
    // On Unix, check if file is executable
    if (!(st.st_mode & S_IXUSR) && !(st.st_mode & S_IXGRP) && !(st.st_mode & S_IXOTH)) {
        fprintf(stderr, "Error: Node binary is not executable: %s\n", resolved_path);
        return 0;
    }
#endif

    // Verify it's actually a valid binary format (prevent arbitrary command execution)
    FILE *fp = fopen(resolved_path, "rb");
    if (!fp) {
        fprintf(stderr, "Error: Cannot open node binary for validation: %s\n", resolved_path);
        return 0;
    }

    uint8_t magic[4];
    size_t bytes_read = fread(magic, 1, 4, fp);
    fclose(fp);

    if (bytes_read != 4) {
        fprintf(stderr, "Error: Node binary too small to be valid: %s\n", path);
        return 0;
    }

    // Check for valid executable format using shared detection
    binary_format_t format = detect_binary_format(magic);

    if (format == BINARY_FORMAT_UNKNOWN) {
        fprintf(stderr, "Error: Node binary is not a valid executable format: %s\n", path);
        return 0;
    }

    return 1;
}

/**
 * Get Node.js version by executing: node --version
 * Returns version string without 'v' prefix (e.g., "25.5.0")
 * Caller must free() the returned string
 */
static char* get_node_version(const char* node_binary) {
    // Spawn node --version without shell (defense-in-depth against command injection)
    // Uses fork()/execvp() on Unix, CreateProcess() on Windows
    const char* args[] = {node_binary, "--version", NULL};
    char* output = spawn_command(node_binary, args, 1024);

    if (!output) {
        return NULL;
    }

    // Strip 'v' prefix and newline: "v25.5.0\n" -> "25.5.0"
    char* start = output;
    if (start[0] == 'v') {
        start++;
    }

    char* newline = strchr(start, '\n');
    if (newline) {
        *newline = '\0';
    }

    // Create a copy since we need to free the original output buffer
    char* version = strdup(start);
    free(output);

    return version;
}

/**
 * Find system Node.js binary for running --experimental-sea-config
 * Returns path to node binary, or NULL if not found
 * Caller is responsible for freeing the returned string
 */
static char* find_system_node_binary(void) {
    const char *candidates[] = {
        "/usr/local/bin/node",
        "/usr/bin/node",
        "/opt/homebrew/bin/node",
        NULL
    };

    // Try known paths first
    for (int i = 0; candidates[i] != NULL; i++) {
        // Try to validate if it's a real node binary
        if (validate_node_binary(candidates[i])) {
            char *result = strdup(candidates[i]);
            if (!result) {
                fprintf(stderr, "Error: Cannot allocate memory for binary path\n");
            }
            return result;
        }
    }

    // Fall back to "node" in PATH - don't validate since it's not a file path
    // Let execvp search PATH for us
    char *result = strdup("node");
    if (!result) {
        fprintf(stderr, "Error: Cannot allocate memory for binary path\n");
    }
    return result;
}


/**
 * Generate SEA blob from JSON config using node --experimental-sea-config
 * Uses the target executable (node-smol) to generate the blob, ensuring
 * the blob is created with the same Node.js version that will run it.
 * Returns path to generated blob (caller must free), or NULL on error
 */
static char* generate_sea_blob_from_config(const char *config_path, const char *executable) {
    char *node_binary = NULL;
    char extracted_path[4096] = {0};  // Cache path for extracted node
    (void)extracted_path;  // Suppress unused warning - reserved for future use

    // Helper macro for cleanup on error
    #define CLEANUP_AND_RETURN_NULL() do { \
        if (node_binary) { \
            free(node_binary); \
        } \
        return NULL; \
    } while(0)

    // For SEA blob generation, use the HOST system's node binary (not the target executable)
    // This enables cross-compilation: generate blobs on linux-x64 for win32-arm64
    // SEA blobs contain platform-independent V8 bytecode/snapshots that work across architectures

    // Step 1: Extract target Node.js version from the executable
    char *target_version = smol_extract_node_version(executable);
    if (!target_version) {
        fprintf(stderr, "⚠️  Warning: Could not extract Node.js version from target binary\n");
        fprintf(stderr, "   Target: %s\n", executable);
        fprintf(stderr, "   This may be a plain Node.js binary without SMOL config.\n");
        fprintf(stderr, "   Continuing with system Node.js...\n\n");
    }

    // Step 2: Find system node binary
    node_binary = find_system_node_binary();
    if (!node_binary) {
        fprintf(stderr, "Error: Node.js not found on system\n");
        fprintf(stderr, "   Searched: /usr/local/bin/node, /usr/bin/node, /opt/homebrew/bin/node, $PATH\n");
        fprintf(stderr, "\n");
        fprintf(stderr, "   To install Node.js:\n");
        if (target_version) {
            fprintf(stderr, "     nvm install %s\n", target_version);
            fprintf(stderr, "     nvm use %s\n", target_version);
        } else {
            fprintf(stderr, "     nvm install node\n");
        }
        fprintf(stderr, "\n");
        if (target_version) {
            free(target_version);
        }
        return NULL;
    }

    // Step 3: Get system Node.js version
    char *system_version = get_node_version(node_binary);
    if (!system_version) {
        fprintf(stderr, "⚠️  Warning: Could not determine system Node.js version\n");
        fprintf(stderr, "   Binary: %s\n", node_binary);
        fprintf(stderr, "   Continuing anyway...\n\n");
    }

    // Step 4: Compare versions and display helpful warnings
    if (target_version && system_version) {
        if (strcmp(target_version, system_version) != 0) {

            // Parse config to check what optimizations were requested
            int wants_code_cache = 0;
            int wants_snapshot = 0;

            FILE *config_file = fopen(config_path, "rb");
            if (config_file) {
                fseek(config_file, 0, SEEK_END);
                long fsize = ftell(config_file);
                fseek(config_file, 0, SEEK_SET);

                if (fsize > 0 && fsize < 1024 * 1024) {
                    char *config_content = malloc(fsize + 1);
                    if (config_content && fread(config_content, 1, fsize, config_file) == (size_t)fsize) {
                        config_content[fsize] = '\0';

                        // Check for useCodeCache: true
                        const char *use_code_cache_str = strstr(config_content, "useCodeCache");
                        if (use_code_cache_str) {
                            const char *colon = strchr(use_code_cache_str, ':');
                            if (colon) {
                                const char *value = colon + 1;
                                while (*value && (*value == ' ' || *value == '\t' || *value == '\n' || *value == '\r')) {
                                    value++;
                                }
                                if (strncmp(value, "true", 4) == 0) {
                                    wants_code_cache = 1;
                                }
                            }
                        }

                        // Check for useSnapshot: true
                        const char *use_snapshot_str = strstr(config_content, "useSnapshot");
                        if (use_snapshot_str) {
                            const char *colon = strchr(use_snapshot_str, ':');
                            if (colon) {
                                const char *value = colon + 1;
                                while (*value && (*value == ' ' || *value == '\t' || *value == '\n' || *value == '\r')) {
                                    value++;
                                }
                                if (strncmp(value, "true", 4) == 0) {
                                    wants_snapshot = 1;
                                }
                            }
                        }

                        free(config_content);
                    }
                }
                fclose(config_file);
            }

            // Build performance impact message based on what they wanted
            char impact_msg[256] = {0};
            int total_min = 0;
            int total_max = 0;

            if (wants_code_cache && wants_snapshot) {
                snprintf(impact_msg, sizeof(impact_msg), "missing code cache + snapshot");
                total_min = SEA_PERF_COMBINED_MIN_MS;
                total_max = SEA_PERF_COMBINED_MAX_MS;
            } else if (wants_code_cache) {
                snprintf(impact_msg, sizeof(impact_msg), "missing code cache");
                total_min = SEA_PERF_CODE_CACHE_MIN_MS;
                total_max = SEA_PERF_CODE_CACHE_MAX_MS;
            } else if (wants_snapshot) {
                snprintf(impact_msg, sizeof(impact_msg), "missing snapshot");
                total_min = SEA_PERF_SNAPSHOT_MIN_MS;
                total_max = SEA_PERF_SNAPSHOT_MAX_MS;
            }

            // Only show warning if they wanted optimizations
            if (wants_code_cache || wants_snapshot) {
                fprintf(stderr, "\n");
                fprintf(stderr, "⚠️  Version mismatch: need %s, found %s\n", target_version, system_version);
                fprintf(stderr, "   Startup will be ~%d-%dms slower (%s)\n", total_min, total_max, impact_msg);
                fprintf(stderr, "   Fix: nvm install %s && nvm use %s\n", target_version, target_version);
                fprintf(stderr, "\n");
            }
        } else {
            printf("✓ Node.js version match: %s\n", system_version);
        }
    }

    // Clean up version strings
    if (target_version) {
        free(target_version);
    }
    if (system_version) {
        free(system_version);
    }

    if (!node_binary) {
        fprintf(stderr, "Error: Failed to determine node binary path\n");
        return NULL;
    }

    // Validate config_path doesn't contain dangerous patterns
    if (!config_path || strlen(config_path) == 0) {
        fprintf(stderr, "Error: Config path is empty\n");
        CLEANUP_AND_RETURN_NULL();
    }

    // Check for path traversal attempts
    if (strstr(config_path, "..") != NULL) {
        fprintf(stderr, "Error: Path traversal detected in config path\n");
        CLEANUP_AND_RETURN_NULL();
    }

    // Verify file exists and is readable
    struct stat st;
    if (stat(config_path, &st) != 0) {
        fprintf(stderr, "Error: Config file not found: %s\n", config_path);
        CLEANUP_AND_RETURN_NULL();
    }

    // Verify it's a regular file (not symlink, device, etc)
    if (!S_ISREG(st.st_mode)) {
        fprintf(stderr, "Error: Config path is not a regular file: %s\n", config_path);
        CLEANUP_AND_RETURN_NULL();
    }

    printf("Detected SEA config file: %s\n", config_path);

    // Validate useCodeCache setting for performance (optional warning)
    {
        FILE *config_file = fopen(config_path, "rb");
        if (config_file) {
            fseek(config_file, 0, SEEK_END);
            long fsize = ftell(config_file);
            fseek(config_file, 0, SEEK_SET);

            if (fsize > 0 && fsize < 1024 * 1024) {  // Sanity check: < 1MB
                char *config_content = malloc(fsize + 1);
                if (config_content) {
                    if (fread(config_content, 1, fsize, config_file) == (size_t)fsize) {
                        config_content[fsize] = '\0';

                        // Simple string search for useCodeCache (avoid full JSON parse for performance)
                        const char *use_code_cache_str = strstr(config_content, "useCodeCache");
                        int has_code_cache = 0;

                        if (use_code_cache_str) {
                            // Look for "useCodeCache": true pattern
                            const char *colon = strchr(use_code_cache_str, ':');
                            if (colon) {
                                // Skip whitespace
                                const char *value = colon + 1;
                                while (*value && (*value == ' ' || *value == '\t' || *value == '\n' || *value == '\r')) {
                                    value++;
                                }
                                // Check if it's true
                                if (strncmp(value, "true", 4) == 0) {
                                    has_code_cache = 1;
                                }
                            }
                        }

                        if (!has_code_cache) {
                            fprintf(stderr, "\n");
                            fprintf(stderr, "⚠️  Performance Warning: useCodeCache not enabled\n");
                            fprintf(stderr, "   Setting 'useCodeCache: true' provides ~13%% faster startup (~22ms)\n");
                            fprintf(stderr, "   Trade-off: +2-3 MB binary size\n");
                            fprintf(stderr, "   Recommended for production builds where startup speed matters\n");
                            fprintf(stderr, "\n");
                            fprintf(stderr, "   Add to %s:\n", config_path);
                            fprintf(stderr, "   {\n");
                            fprintf(stderr, "     \"useCodeCache\": true,\n");
                            fprintf(stderr, "     ...\n");
                            fprintf(stderr, "   }\n");
                            fprintf(stderr, "\n");
                        }
                    }
                    // Free config_content on all paths (success or fread failure)
                    free(config_content);
                }
            }
            fclose(config_file);
        }
    }

    printf("Generating SEA blob using: %s --experimental-sea-config %s\n",
           node_binary, config_path);

#ifdef _WIN32
    // Windows: use _spawnvp and _cwait
    char *argv[] = {
        (char*)node_binary,
        (char*)"--experimental-sea-config",
        (char*)config_path,
        NULL
    };

    intptr_t pid = _spawnvp(_P_NOWAIT, node_binary, (const char* const*)argv);
    if (pid == -1) {
        fprintf(stderr, "Error: Failed to spawn process\n");
        CLEANUP_AND_RETURN_NULL();
    }

    int status;
    if (_cwait(&status, pid, 0) == -1) {
        fprintf(stderr, "Error: Failed to wait for process\n");
        CLEANUP_AND_RETURN_NULL();
    }

    if (status != 0) {
        fprintf(stderr, "Error: node --experimental-sea-config failed with exit code %d\n", status);
        CLEANUP_AND_RETURN_NULL();
    }
#else
    // Unix: use fork and exec
    pid_t pid = fork();
    if (pid == -1) {
        fprintf(stderr, "Error: Failed to fork process\n");
        CLEANUP_AND_RETURN_NULL();
    }

    if (pid == 0) {
        // Child process: change to config directory, then run node
        // Extract directory and filename from config_path
        char config_dir[PATH_MAX];
        const char *config_filename = config_path;
        const char *last_slash = strrchr(config_path, '/');
        if (last_slash != NULL) {
            size_t dir_len = last_slash - config_path;
            if (dir_len > 0 && dir_len < sizeof(config_dir)) {
                memcpy(config_dir, config_path, dir_len);
                config_dir[dir_len] = '\0';

                // Change to config directory so relative paths in config work
                if (chdir(config_dir) != 0) {
                    fprintf(stderr, "Error: Failed to change to config directory %s: %s\n",
                            config_dir, strerror(errno));
                    _exit(1);
                }

                // Use just the filename after changing directory
                config_filename = last_slash + 1;
            }
        }

        char *argv[] = {
            (char*)node_binary,
            (char*)"--experimental-sea-config",
            (char*)config_filename,
            NULL
        };
        // Use execv for absolute paths, execvp for PATH lookup (like "node")
        if (node_binary[0] == '/') {
            execv(node_binary, argv);
        } else {
            execvp(node_binary, argv);
        }
        // If exec returns, it failed - print error and exit
        fprintf(stderr, "Error: exec failed for %s: %s\n", node_binary, strerror(errno));
        _exit(1);
    }

    // Parent: wait for child
    int status;
    pid_t result;
    /* Retry waitpid on EINTR (interrupted by signal) */
    do {
        result = waitpid(pid, &status, 0);
    } while (result == -1 && errno == EINTR);

    if (result == -1) {
        fprintf(stderr, "Error: waitpid failed: %s\n", strerror(errno));
        CLEANUP_AND_RETURN_NULL();
    }

    if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) {
        int exit_code = WIFEXITED(status) ? WEXITSTATUS(status) : -1;
        fprintf(stderr, "Error: node --experimental-sea-config failed (exit code: %d)\n", exit_code);
        if (WIFSIGNALED(status)) {
            fprintf(stderr, "Process terminated by signal: %d\n", WTERMSIG(status));
        }
        CLEANUP_AND_RETURN_NULL();
    }
#endif

    // Free node_binary
    free(node_binary);
    node_binary = NULL;

    // Parse sea-config.json using cJSON
    sea_config_t *config = parse_sea_config(config_path);
    if (!config) {
        fprintf(stderr, "Error: Failed to parse sea-config.json\n");
        return NULL;
    }

    // Construct full path to blob file (config directory + output filename)
    // The blob is written to the same directory as the config file
    char *blob_path = NULL;
    const char *last_slash = strrchr(config_path, '/');
    if (last_slash != NULL && config->output[0] != '/') {
        // Relative output path - prepend config directory
        size_t dir_len = last_slash - config_path;
        size_t blob_len = strlen(config->output);
        blob_path = (char*)malloc(dir_len + 1 + blob_len + 1);  // dir + '/' + filename + '\0'
        if (blob_path) {
            memcpy(blob_path, config_path, dir_len);
            blob_path[dir_len] = '/';
            memcpy(blob_path + dir_len + 1, config->output, blob_len);
            blob_path[dir_len + 1 + blob_len] = '\0';
        }
    } else {
        // Absolute output path or no directory in config_path - use as-is
        blob_path = strdup(config->output);
    }

    free_sea_config(config);

    if (!blob_path) {
        fprintf(stderr, "Error: Failed to allocate memory for blob path\n");
        return NULL;
    }

    // Verify the blob file was created - open directly instead of stat to avoid TOCTOU
    FILE *verify_fp = fopen(blob_path, "rb");
    if (!verify_fp) {
        fprintf(stderr, "Error: Generated blob file not found: %s\n", blob_path);
        free(blob_path);
        return NULL;
    }
    fclose(verify_fp);

    printf("✓ Generated SEA blob: %s\n", blob_path);

    // Clean up macro definition
    #undef CLEANUP_AND_RETURN_NULL
    return blob_path;
}

static void print_usage(const char *program) {
    printf("binject - Pure C alternative to postject\n\n");
    printf("Usage:\n");
    printf("  %s inject -e <executable> -o <output> [--sea <path>] [--vfs <path>|--vfs-on-disk <path>|--vfs-in-memory <path>|--vfs-compat] [--skip-repack]\n", program);
    printf("  %s blob <sea-config.json>\n", program);
    printf("  %s list <executable>\n", program);
    printf("  %s extract -e <executable> [--vfs|--sea] -o <output>\n", program);
    printf("  %s verify -e <executable> [--vfs|--sea]\n", program);
    printf("  %s --help\n", program);
    printf("  %s --version\n\n", program);
    printf("Commands:\n");
    printf("  inject            Inject a resource into an executable\n");
    printf("  blob              Generate SEA blob from sea-config.json (does not inject)\n");
    printf("  list              List all embedded resources\n");
    printf("  extract           Extract a resource from an executable\n");
    printf("  verify            Verify the integrity of a resource\n\n");
    printf("Options:\n");
    printf("  -o, --output <path>           Output file path\n");
    printf("  -e, --executable <path>       Input executable path\n");
    printf("  --vfs <path>                  Inject VFS to NODE_SEA/__SMOL_VFS_BLOB (extracts to disk at runtime)\n");
    printf("                                Accepts: directory, .tar.gz, .tgz, or .tar (auto-compressed)\n");
    printf("                                Note: VFS can also be configured in sea-config.json (smol.vfs section)\n");
    printf("  --vfs-on-disk <path>          Alias for --vfs\n");
    printf("  --vfs-in-memory <path>        Inject VFS and keep in memory at runtime (no extraction)\n");
    printf("  --vfs-compat                  Enable VFS support without bundling files (compatibility mode)\n");
    printf("  --sea <path>                  Inject SEA blob to NODE_SEA/__NODE_SEA_BLOB\n");
    printf("                                If path ends in .json, automatically embeds smol config + VFS from 'smol' section\n");
    printf("  --skip-repack                 Skip SMOL stub auto-detection and repacking\n");
    printf("                                (SMOL stubs with __PRESSED_DATA are auto-detected unless this flag is used)\n");
    printf("  -h, --help                    Show this help message\n");
    printf("  -v, --version                 Show version information\n\n");
    printf("Notes:\n");
    printf("  VFS Configuration Priority:\n");
    printf("    1. CLI flags (--vfs, --vfs-in-memory, --vfs-on-disk, --vfs-compat)\n");
    printf("    2. sea-config.json smol.vfs section (if CLI flags not provided)\n");
    printf("  CLI flags always take precedence over sea-config.json settings.\n");
}

int main(int argc, char *argv[]) {
    DEBUG_INIT("binject");

    if (argc < 2) {
        print_usage(argv[0]);
        return BINJECT_ERROR_INVALID_ARGS;
    }

    const char *command = argv[1];

    if (strcmp(command, "--version") == 0 || strcmp(command, "-v") == 0) {
        printf("binject %s\n", VERSION);
        return BINJECT_OK;
    }

    if (strcmp(command, "--help") == 0 || strcmp(command, "-h") == 0) {
        print_usage(argv[0]);
        return BINJECT_OK;
    }

    if (strcmp(command, "inject") == 0) {
        const char *executable = NULL;
        const char *output = NULL;
        const char *sea_resource = NULL;
        const char *vfs_resource = NULL;
        int vfs_in_memory = 0;  // Default: extract VFS to disk at runtime
        int skip_repack = 0; // Default: repack compressed stubs

        for (int i = 2; i < argc; i++) {
            if (strcmp(argv[i], "-e") == 0 || strcmp(argv[i], "--executable") == 0) {
                if (i + 1 < argc) executable = argv[++i];
            } else if (strcmp(argv[i], "-o") == 0 || strcmp(argv[i], "--output") == 0) {
                if (i + 1 < argc) output = argv[++i];
            } else if (strcmp(argv[i], "--vfs") == 0 || strcmp(argv[i], "--vfs-on-disk") == 0) {
                if (i + 1 < argc) vfs_resource = argv[++i];
            } else if (strcmp(argv[i], "--vfs-in-memory") == 0) {
                if (i + 1 < argc) vfs_resource = argv[++i];
                vfs_in_memory = 1;
            } else if (strcmp(argv[i], "--vfs-compat") == 0) {
                vfs_resource = "";  // Empty string marker for VFS compatibility mode
            } else if (strcmp(argv[i], "--sea") == 0) {
                if (i + 1 < argc) sea_resource = argv[++i];
            } else if (strcmp(argv[i], "--skip-repack") == 0) {
                skip_repack = 1;
            }
        }

        if (!executable || !output || (!sea_resource && !vfs_resource)) {
            fprintf(stderr, "Error: inject requires --executable, --output, and at least one of --sea <path> or --vfs <path>\n");
            return BINJECT_ERROR_INVALID_ARGS;
        }

        if (vfs_resource && !sea_resource) {
            fprintf(stderr, "Error: --vfs requires --sea to be specified\n");
            fprintf(stderr, "VFS (Virtual File System) must be injected alongside a SEA (Single Executable Application) blob\n");
            return BINJECT_ERROR_INVALID_ARGS;
        }

        // Check if SEA resource is a JSON config file
        // If so, generate the blob using node --experimental-sea-config and parse smol + VFS config
        char *generated_blob = NULL;
        uint8_t *smol_config_binary = NULL;
        char *temp_vfs_archive = NULL;  // Track temporary VFS archive (must be deleted)
        int cli_vfs_specified = (vfs_resource != NULL);  // Track if CLI specified VFS

        if (sea_resource && is_json_file(sea_resource)) {
            // Parse sea-config.json to extract smol config and VFS config
            sea_config_t *config = parse_sea_config(sea_resource);
            if (config) {
                // Parse smol.update configuration from JSON to struct.
                smol_update_config_t smol_update_config;
                if (parse_smol_update_config(config->smol, &smol_update_config) == 0) {
                    // Serialize smol config to binary (1176 bytes).
                    smol_config_binary = serialize_smol_config(&smol_update_config);
                }

                // Process VFS config (priority 2: only if CLI flags not provided)
                if (!cli_vfs_specified && config->vfs) {
                    printf("VFS: Using configuration from sea-config.json\n");

                    // Handle compat mode
                    if (strcmp(config->vfs->mode, "compat") == 0) {
                        printf("VFS: compat mode (API compatibility, no files embedded)\n");
                        vfs_resource = "";  // Empty string marker for compat mode
                    } else {
                        // Resolve source path (relative to sea-config.json directory)
                        char *resolved_source = resolve_relative_path(sea_resource, config->vfs->source);
                        if (!resolved_source) {
                            fprintf(stderr, "Error: Failed to resolve VFS source path\n");
                            free_sea_config(config);
                            if (smol_config_binary) free(smol_config_binary);
                            return BINJECT_ERROR;
                        }

                        // Detect source type
                        vfs_source_type_t source_type = detect_vfs_source_type(resolved_source);
                        if (source_type == VFS_SOURCE_NOT_FOUND) {
                            // Source doesn't exist - skip VFS gracefully.
                            printf("VFS: Source not found '%s', skipping VFS\n", resolved_source);
                            free(resolved_source);
                            resolved_source = NULL;
                            // Continue without VFS.
                        } else if (source_type == VFS_SOURCE_ERROR) {
                            fprintf(stderr, "Error: Invalid VFS source: %s\n", resolved_source);
                            free(resolved_source);
                            free_sea_config(config);
                            if (smol_config_binary) free(smol_config_binary);
                            return BINJECT_ERROR;
                        }

                        // Only process VFS if source was found and valid.
                        if (resolved_source != NULL) {
                            if (source_type == VFS_SOURCE_DIR) {
                                // Directory - create TAR.GZ with gzip level 9
                                printf("VFS: Creating archive from directory '%s' (gzip level 9)\n", resolved_source);
                                temp_vfs_archive = create_vfs_archive_from_dir(resolved_source);
                                if (!temp_vfs_archive) {
                                    fprintf(stderr, "Error: Failed to create VFS archive\n");
                                    free(resolved_source);
                                    free_sea_config(config);
                                    if (smol_config_binary) free(smol_config_binary);
                                    return BINJECT_ERROR;
                                }
                                vfs_resource = temp_vfs_archive;
                            } else if (source_type == VFS_SOURCE_TAR) {
                                // .tar file - compress with gzip level 9
                                printf("VFS: Compressing tar archive '%s' (gzip level 9)\n", resolved_source);
                                temp_vfs_archive = compress_tar_archive(resolved_source);
                                if (!temp_vfs_archive) {
                                    fprintf(stderr, "Error: Failed to compress VFS archive\n");
                                    free(resolved_source);
                                    free_sea_config(config);
                                    if (smol_config_binary) free(smol_config_binary);
                                    return BINJECT_ERROR;
                                }
                                vfs_resource = temp_vfs_archive;
                            } else {
                                // .tar.gz file - use as-is
                                printf("VFS: Using compressed archive '%s'\n", resolved_source);
                                vfs_resource = resolved_source;
                            }

                            // Set mode flag
                            if (strcmp(config->vfs->mode, "in-memory") == 0) {
                                vfs_in_memory = 1;
                                printf("VFS: mode=in-memory (keep in RAM)\n");
                            } else {
                                // "on-disk" mode (default if not in-memory)
                                printf("VFS: mode=on-disk (extract to temp directory)\n");
                            }

                            free(resolved_source);
                        }
                    }
                } else if (cli_vfs_specified) {
                    printf("Note: CLI VFS flags override sea-config.json vfs section\n");
                }

                free_sea_config(config);
            }

            // Generate SEA blob
            generated_blob = generate_sea_blob_from_config(sea_resource, executable);
            if (!generated_blob) {
                fprintf(stderr, "Error: Failed to generate SEA blob from config\n");
                if (smol_config_binary) free(smol_config_binary);
                if (temp_vfs_archive) {
                    if (unlink(temp_vfs_archive) != 0 && errno != ENOENT) {
                        fprintf(stderr, "Warning: Failed to delete temporary file %s: %s\n",
                                temp_vfs_archive, strerror(errno));
                    }
                    free(temp_vfs_archive);
                }
                return BINJECT_ERROR;
            }
            sea_resource = generated_blob;  // Use generated blob instead
        }

        int result = binject_batch(executable, output, sea_resource, vfs_resource, vfs_in_memory, skip_repack, smol_config_binary);

        // Clean up generated resources
        if (generated_blob) {
            free(generated_blob);
        }
        if (smol_config_binary) {
            free(smol_config_binary);
        }
        if (temp_vfs_archive) {
            // Delete temporary archive file
            if (unlink(temp_vfs_archive) != 0 && errno != ENOENT) {
                fprintf(stderr, "Warning: Failed to delete temporary file %s: %s\n",
                        temp_vfs_archive, strerror(errno));
            }
            free(temp_vfs_archive);
        }

        return result;
    }

    if (strcmp(command, "list") == 0) {
        if (argc < 3) {
            fprintf(stderr, "Error: list requires an executable path\n");
            return BINJECT_ERROR_INVALID_ARGS;
        }
        return binject_list(argv[2]);
    }

    if (strcmp(command, "extract") == 0) {
        const char *executable = NULL;
        const char *section = NULL;
        const char *output = NULL;

        for (int i = 2; i < argc; i++) {
            if (strcmp(argv[i], "-e") == 0 || strcmp(argv[i], "--executable") == 0) {
                if (i + 1 < argc) executable = argv[++i];
            } else if (strcmp(argv[i], "--vfs") == 0) {
                section = "vfs";
            } else if (strcmp(argv[i], "--sea") == 0) {
                section = "sea";
            } else if (strcmp(argv[i], "-o") == 0 || strcmp(argv[i], "--output") == 0) {
                if (i + 1 < argc) output = argv[++i];
            }
        }

        if (!executable || !section || !output) {
            fprintf(stderr, "Error: extract requires --executable, either --vfs or --sea, and --output\n");
            return BINJECT_ERROR_INVALID_ARGS;
        }

        return binject_extract(executable, section, output);
    }

    if (strcmp(command, "verify") == 0) {
        const char *executable = NULL;
        const char *section = NULL;

        for (int i = 2; i < argc; i++) {
            if (strcmp(argv[i], "-e") == 0 || strcmp(argv[i], "--executable") == 0) {
                if (i + 1 < argc) executable = argv[++i];
            } else if (strcmp(argv[i], "--vfs") == 0) {
                section = "vfs";
            } else if (strcmp(argv[i], "--sea") == 0) {
                section = "sea";
            }
        }

        if (!executable || !section) {
            fprintf(stderr, "Error: verify requires --executable and either --vfs or --sea\n");
            return BINJECT_ERROR_INVALID_ARGS;
        }

        return binject_verify(executable, section);
    }

    if (strcmp(command, "blob") == 0) {
        // Generate SEA blob from sea-config.json (does not inject into binary)
        // Usage: binject blob <sea-config.json>

        if (argc < 3) {
            fprintf(stderr, "Error: blob command requires a sea-config.json path\n");
            fprintf(stderr, "Usage: %s blob <sea-config.json>\n", argv[0]);
            return BINJECT_ERROR_INVALID_ARGS;
        }

        const char *config_path = argv[2];

        // Validate config file exists
        if (!is_json_file(config_path)) {
            fprintf(stderr, "Error: Config file must be a JSON file (*.json): %s\n", config_path);
            return BINJECT_ERROR_INVALID_ARGS;
        }

        // Use a dummy executable path (required by generate_sea_blob_from_config for version extraction)
        // Since we don't have a target binary yet, use the host node
        char *node_binary = find_system_node_binary();
        if (!node_binary) {
            fprintf(stderr, "Error: Node.js not found on system. Blob generation requires Node.js.\n");
            return BINJECT_ERROR;
        }

        // Generate the blob
        char *blob_path = generate_sea_blob_from_config(config_path, node_binary);
        free(node_binary);

        if (!blob_path) {
            fprintf(stderr, "Error: Failed to generate SEA blob\n");
            return BINJECT_ERROR;
        }

        printf("✓ SEA blob generated: %s\n", blob_path);
        printf("  To inject into a binary: binject inject -e <binary> -o <output> --sea %s\n", blob_path);

        free(blob_path);
        return BINJECT_OK;
    }

    fprintf(stderr, "Error: unknown command '%s'\n", command);
    print_usage(argv[0]);
    return BINJECT_ERROR_INVALID_ARGS;
}
