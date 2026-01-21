/**
 * binject - Pure C alternative to postject
 * Main CLI entry point
 */

#define _POSIX_C_SOURCE 200809L  // For strdup

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <limits.h>
#include <sys/stat.h>
#ifdef _WIN32
#include <process.h>
// Windows doesn't define S_ISREG macro, so we define it ourselves
#ifndef S_ISREG
#define S_ISREG(m) (((m) & _S_IFMT) == _S_IFREG)
#endif
#else
#include <sys/wait.h>
#include <unistd.h>
#endif
#include "binject.h"
#include "buffer_constants.h"
#include "binary_format.h"
#include "debug_common.h"

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
            return strdup(candidates[i]);
        }
    }

    // Fall back to "node" in PATH - don't validate since it's not a file path
    // Let execvp search PATH for us
    return strdup("node");
}

/**
 * Generate SEA blob from JSON config using node --experimental-sea-config
 * Uses the target executable (node-smol) to generate the blob, ensuring
 * the blob is created with the same Node.js version that will run it.
 * Returns path to generated blob (caller must free), or NULL on error
 */
static char* generate_sea_blob_from_config(const char *config_path, const char *executable) {
    char *node_binary = NULL;
    char extracted_path[4096];
    int needs_cleanup = 0;

    // If executable is a compressed stub (node-smol), extract it first
    if (binject_is_compressed_stub(executable)) {
        printf("Detected compressed stub, extracting to generate blob...\n");
        if (binject_get_extracted_path(executable, extracted_path, sizeof(extracted_path)) != BINJECT_OK) {
            fprintf(stderr, "Error: Failed to extract compressed stub\n");
            return NULL;
        }
        node_binary = strdup(extracted_path);
        needs_cleanup = 0;  // Cache handles cleanup
    } else {
        // Use the executable directly if it's not compressed
        node_binary = strdup(executable);
    }

    if (!node_binary) {
        fprintf(stderr, "Error: Failed to determine node binary path\n");
        return NULL;
    }

    // Validate config_path doesn't contain dangerous patterns
    if (!config_path || strlen(config_path) == 0) {
        fprintf(stderr, "Error: Config path is empty\n");
        free(node_binary);
        return NULL;
    }

    // Check for path traversal attempts
    if (strstr(config_path, "..") != NULL) {
        fprintf(stderr, "Error: Path traversal detected in config path\n");
        free(node_binary);
        return NULL;
    }

    // Verify file exists and is readable
    struct stat st;
    if (stat(config_path, &st) != 0) {
        fprintf(stderr, "Error: Config file not found: %s\n", config_path);
        free(node_binary);
        return NULL;
    }

    // Verify it's a regular file (not symlink, device, etc)
    if (!S_ISREG(st.st_mode)) {
        fprintf(stderr, "Error: Config path is not a regular file: %s\n", config_path);
        free(node_binary);
        return NULL;
    }

    printf("Detected SEA config file: %s\n", config_path);
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
        free(node_binary);
        return NULL;
    }

    int status;
    if (_cwait(&status, pid, 0) == -1) {
        fprintf(stderr, "Error: Failed to wait for process\n");
        free(node_binary);
        return NULL;
    }

    if (status != 0) {
        fprintf(stderr, "Error: node --experimental-sea-config failed with exit code %d\n", status);
        free(node_binary);
        return NULL;
    }
#else
    // Unix: use fork and exec
    pid_t pid = fork();
    if (pid == -1) {
        fprintf(stderr, "Error: Failed to fork process\n");
        free(node_binary);
        return NULL;
    }

    if (pid == 0) {
        // Child process: run node --experimental-sea-config
        char *argv[] = {
            (char*)node_binary,
            (char*)"--experimental-sea-config",
            (char*)config_path,
            NULL
        };
        execvp(node_binary, argv);
        // If execvp returns, it failed - use _exit to avoid flushing buffers
        _exit(1);
    }

    // Parent: wait for child
    int status;
    waitpid(pid, &status, 0);

    if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) {
        fprintf(stderr, "Error: node --experimental-sea-config failed\n");
        free(node_binary);
        return NULL;
    }
#endif

    // Done with node_binary - free it
    free(node_binary);
    node_binary = NULL;

    // Read the JSON config to find the output blob path
    FILE *config_file = fopen(config_path, "r");
    if (!config_file) {
        fprintf(stderr, "Error: Failed to open config file: %s\n", config_path);
        return NULL;
    }

    // Read file contents
    if (fseek(config_file, 0, SEEK_END) != 0) {
        fprintf(stderr, "Error: Cannot seek config file\n");
        fclose(config_file);
        return NULL;
    }

    long file_size = ftell(config_file);
    if (file_size < 0) {
        fprintf(stderr, "Error: Cannot determine config file size\n");
        fclose(config_file);
        return NULL;
    }

    if (file_size > MAX_JSON_CONFIG_SIZE) {
        fprintf(stderr, "Error: Config file too large (max 1MB)\n");
        fclose(config_file);
        return NULL;
    }

    if (fseek(config_file, 0, SEEK_SET) != 0) {
        fprintf(stderr, "Error: Cannot seek config file\n");
        fclose(config_file);
        return NULL;
    }

    char *json_content = malloc(file_size + 1);
    if (!json_content) {
        fprintf(stderr, "Error: Failed to allocate memory for config\n");
        fclose(config_file);
        return NULL;
    }

    size_t bytes_read = fread(json_content, 1, file_size, config_file);
    fclose(config_file);

    if (bytes_read != (size_t)file_size) {
        fprintf(stderr, "Error: Failed to read config file completely\n");
        free(json_content);
        return NULL;
    }

    json_content[file_size] = '\0';

    // JSON parsing to extract "output" field
    // Look for "output": "filename.blob" pattern
    // Use more robust parsing to avoid false matches in strings/comments
    char *blob_filename = NULL;
    char *search_pos = json_content;
    char *json_end = json_content + file_size;

    // Validate JSON structure basics - check nesting depth
    int nesting_depth = 0;
    int max_nesting = 50; // Reasonable limit for config files
    for (char *p = json_content; p < json_end; p++) {
        if (*p == '{' || *p == '[') nesting_depth++;
        if (*p == '}' || *p == ']') nesting_depth--;
        if (nesting_depth > max_nesting || nesting_depth < 0) {
            fprintf(stderr, "Error: JSON nesting too deep or unbalanced\n");
            free(json_content);
            return NULL;
        }
    }

    // Search for "output" key - must be followed by : and "value"
    while ((search_pos = strstr(search_pos, "\"output\"")) != NULL) {
        // Skip past the "output" key
        search_pos += 8; // length of "output"

        // Skip whitespace
        while (*search_pos && (*search_pos == ' ' || *search_pos == '\t' ||
               *search_pos == '\r' || *search_pos == '\n')) {
            search_pos++;
        }

        // Must be followed by colon
        if (*search_pos != ':') {
            continue;
        }
        search_pos++;

        // Skip whitespace after colon
        while (*search_pos && (*search_pos == ' ' || *search_pos == '\t' ||
               *search_pos == '\r' || *search_pos == '\n')) {
            search_pos++;
        }

        // Must be followed by opening quote
        if (*search_pos != '"') {
            continue;
        }
        search_pos++; // Move past opening quote

        // Find closing quote (handling proper escape sequences)
        char *value_start = search_pos;
        char *value_end = NULL;
        // Add bounds check to prevent reading beyond buffer
        while (*search_pos && search_pos < json_end) {
            if (*search_pos == '"') {
                // Count consecutive backslashes before this quote
                int backslash_count = 0;
                const char *check_pos = search_pos - 1;
                // Ensure we don't go before the buffer start - check BEFORE dereferencing
                while (check_pos >= value_start && check_pos >= json_content) {
                    if (*check_pos != '\\') {
                        break;
                    }
                    backslash_count++;
                    check_pos--;
                }

                // Even number of backslashes (including 0) means quote is NOT escaped
                if (backslash_count % 2 == 0) {
                    value_end = search_pos;
                    break;
                }
            }
            search_pos++;
        }

        if (value_end) {
            size_t len = value_end - value_start;
            if (len > 0 && len < TEMP_PATH_BUFFER_SIZE) { // Sanity check on path length
                blob_filename = malloc(len + 1);
                if (blob_filename) {
                    memcpy(blob_filename, value_start, len);
                    blob_filename[len] = '\0';
                    break;
                }
            }
        }
    }

    free(json_content);

    if (!blob_filename) {
        fprintf(stderr, "Error: Could not parse 'output' field from config\n");
        return NULL;
    }

    // Validate blob path to prevent path traversal attacks
    // Check for suspicious patterns
    if (strstr(blob_filename, "..") != NULL ||
        strstr(blob_filename, "/./") != NULL ||
        strstr(blob_filename, "\\.\\") != NULL) {
        fprintf(stderr, "Error: Path traversal detected in output path: %s\n", blob_filename);
        free(blob_filename);
        return NULL;
    }

    // Reject absolute paths that go outside current directory
    if (blob_filename[0] == '/' || (strlen(blob_filename) > 2 && blob_filename[1] == ':')) {
        fprintf(stderr, "Error: Absolute paths not allowed in output: %s\n", blob_filename);
        free(blob_filename);
        return NULL;
    }

    // Use the blob_filename as-is - Node.js doesn't resolve relative paths,
    // it uses them relative to the current working directory.
    // We mimic this behavior, but only allow paths within CWD or absolute paths.
    char *blob_path = blob_filename;

    // Verify the blob file was created - open directly instead of stat to avoid TOCTOU
    FILE *verify_fp = fopen(blob_path, "rb");
    if (!verify_fp) {
        fprintf(stderr, "Error: Generated blob file not found: %s\n", blob_path);
        free(blob_path);
        return NULL;
    }
    fclose(verify_fp);

    printf("✓ Generated SEA blob: %s\n", blob_path);
    return blob_path;
}

static void print_usage(const char *program) {
    printf("binject - Pure C alternative to postject\n\n");
    printf("Usage:\n");
    printf("  %s inject -e <executable> -o <output> [--sea <path>] [--vfs <path>|--vfs-on-disk <path>|--vfs-in-memory <path>|--vfs-compat] [--skip-repack]\n", program);
    printf("  %s list <executable>\n", program);
    printf("  %s extract -e <executable> [--vfs|--sea] -o <output>\n", program);
    printf("  %s verify -e <executable> [--vfs|--sea]\n", program);
    printf("  %s --help\n", program);
    printf("  %s --version\n\n", program);
    printf("Commands:\n");
    printf("  inject            Inject a resource into an executable\n");
    printf("  list              List all embedded resources\n");
    printf("  extract           Extract a resource from an executable\n");
    printf("  verify            Verify the integrity of a resource\n\n");
    printf("Options:\n");
    printf("  -o, --output <path>           Output file path\n");
    printf("  -e, --executable <path>       Input executable path\n");
    printf("  --vfs <path>                  Inject VFS blob to NODE_SEA/__SMOL_VFS_BLOB (extracts to disk at runtime)\n");
    printf("  --vfs-on-disk <path>          Alias for --vfs\n");
    printf("  --vfs-in-memory <path>        Inject VFS blob and keep in memory at runtime (no extraction)\n");
    printf("  --vfs-compat                  Enable VFS support without bundling files (compatibility mode)\n");
    printf("  --sea <path>                  Inject SEA blob to NODE_SEA/__NODE_SEA_BLOB\n");
    printf("  --skip-repack                 Skip repacking compressed stub (for testing extracted binary)\n");
    printf("                                If path ends in .json, runs: node --experimental-sea-config <path>\n");
    printf("  -h, --help                    Show this help message\n");
    printf("  -v, --version                 Show version information\n");
}

int main(int argc, char *argv[]) {
    DEBUG_INIT();

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
        // If so, generate the blob using node --experimental-sea-config
        char *generated_blob = NULL;
        if (sea_resource && is_json_file(sea_resource)) {
            generated_blob = generate_sea_blob_from_config(sea_resource, executable);
            if (!generated_blob) {
                fprintf(stderr, "Error: Failed to generate SEA blob from config\n");
                return BINJECT_ERROR;
            }
            sea_resource = generated_blob;  // Use generated blob instead
        }

        int result = binject_batch(executable, output, sea_resource, vfs_resource, vfs_in_memory, skip_repack);

        // Clean up generated blob if we created one
        if (generated_blob) {
            free(generated_blob);
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

    fprintf(stderr, "Error: unknown command '%s'\n", command);
    print_usage(argv[0]);
    return BINJECT_ERROR_INVALID_ARGS;
}
