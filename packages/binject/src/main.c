/**
 * binject - Pure C alternative to postject
 * Main CLI entry point
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>
#include "binject.h"
#ifdef __APPLE__
#include "macho_compress_segment.h"
#endif

/**
 * Check if a file has a .json extension
 */
static int is_json_file(const char *path) {
    if (!path) return 0;
    const char *ext = strrchr(path, '.');
    return ext && strcmp(ext, ".json") == 0;
}

/**
 * Generate SEA blob from JSON config using node --experimental-sea-config
 * Returns path to generated blob (caller must free), or NULL on error
 */
static char* generate_sea_blob_from_config(const char *node_binary, const char *config_path) {
    printf("Detected SEA config file: %s\n", config_path);
    printf("Generating SEA blob using: %s --experimental-sea-config %s\n",
           node_binary, config_path);

    // Fork and exec node to generate the blob
    pid_t pid = fork();
    if (pid == -1) {
        fprintf(stderr, "Error: Failed to fork process\n");
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
        // If execvp returns, it failed
        fprintf(stderr, "Error: Failed to execute node\n");
        exit(1);
    }

    // Parent: wait for child
    int status;
    waitpid(pid, &status, 0);

    if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) {
        fprintf(stderr, "Error: node --experimental-sea-config failed\n");
        return NULL;
    }

    // Read the JSON config to find the output blob path
    FILE *config_file = fopen(config_path, "r");
    if (!config_file) {
        fprintf(stderr, "Error: Failed to open config file: %s\n", config_path);
        return NULL;
    }

    // Read file contents
    fseek(config_file, 0, SEEK_END);
    long file_size = ftell(config_file);
    fseek(config_file, 0, SEEK_SET);

    char *json_content = malloc(file_size + 1);
    if (!json_content) {
        fprintf(stderr, "Error: Failed to allocate memory for config\n");
        fclose(config_file);
        return NULL;
    }

    fread(json_content, 1, file_size, config_file);
    json_content[file_size] = '\0';
    fclose(config_file);

    // Simple JSON parsing to extract "output" field
    // Look for "output": "filename.blob"
    char *output_key = strstr(json_content, "\"output\"");
    char *blob_filename = NULL;
    if (output_key) {
        char *colon = strchr(output_key, ':');
        if (colon) {
            char *quote_start = strchr(colon, '"');
            if (quote_start) {
                quote_start++; // Move past opening quote
                char *quote_end = strchr(quote_start, '"');
                if (quote_end) {
                    size_t len = quote_end - quote_start;
                    blob_filename = malloc(len + 1);
                    if (blob_filename) {
                        strncpy(blob_filename, quote_start, len);
                        blob_filename[len] = '\0';
                    }
                }
            }
        }
    }

    free(json_content);

    if (!blob_filename) {
        fprintf(stderr, "Error: Could not parse 'output' field from config\n");
        return NULL;
    }

    // Use the blob_filename as-is - Node.js doesn't resolve relative paths,
    // it uses them relative to the current working directory.
    // We mimic this behavior.
    char *blob_path = blob_filename;

    // Verify the blob file was created
    struct stat st;
    if (stat(blob_path, &st) != 0) {
        fprintf(stderr, "Error: Generated blob file not found: %s\n", blob_path);
        free(blob_path);
        return NULL;
    }

    printf("✓ Generated SEA blob: %s\n", blob_path);
    return blob_path;
}

static void print_usage(const char *program) {
    printf("binject - Pure C alternative to postject\n\n");
    printf("Usage:\n");
    printf("  %s inject -e <executable> -o <output> [--sea <path>] [--vfs <path>|--vfs-on-disk <path>] [--vfs-in-memory]\n", program);
#ifdef __APPLE__
    printf("  %s compress-segment -s <stub> -d <data> -o <output> --uncompressed-size <size>\n", program);
    printf("  %s extract-segment -e <executable> -o <output>\n", program);
#endif
    printf("  %s list <executable>\n", program);
    printf("  %s extract -e <executable> [--vfs|--sea] -o <output>\n", program);
    printf("  %s verify -e <executable> [--vfs|--sea]\n", program);
    printf("  %s --help\n", program);
    printf("  %s --version\n\n", program);
    printf("Commands:\n");
    printf("  inject            Inject a resource into an executable\n");
#ifdef __APPLE__
    printf("  compress-segment  Embed compressed data as SMOL segment (maintains valid signatures)\n");
    printf("  extract-segment   Extract compressed data from SMOL segment\n");
#endif
    printf("  list              List all embedded resources\n");
    printf("  extract           Extract a resource from an executable\n");
    printf("  verify            Verify the integrity of a resource\n\n");
    printf("Options:\n");
    printf("  -o, --output <path>           Output file path\n");
    printf("  -e, --executable <path>       Input executable path\n");
    printf("  -s, --stub <path>             Stub binary path (for compress-segment)\n");
    printf("  -d, --data <path>             Compressed data path (for compress-segment)\n");
    printf("  --uncompressed-size <size>    Original uncompressed size (for compress-segment)\n");
    printf("  --vfs <path>                  Inject VFS blob to NODE_SEA/__SMOL_VFS_BLOB (extracts to disk at runtime)\n");
    printf("  --vfs-on-disk <path>          Alias for --vfs\n");
    printf("  --vfs-in-memory               Keep VFS in memory at runtime (default: extract to disk)\n");
    printf("  --sea <path>                  Inject SEA blob to NODE_SEA/__NODE_SEA_BLOB\n");
    printf("                                If path ends in .json, runs: node --experimental-sea-config <path>\n");
    printf("  -h, --help                    Show this help message\n");
    printf("  -v, --version                 Show version information\n");
}

int main(int argc, char *argv[]) {
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

        for (int i = 2; i < argc; i++) {
            if (strcmp(argv[i], "-e") == 0 || strcmp(argv[i], "--executable") == 0) {
                if (i + 1 < argc) executable = argv[++i];
            } else if (strcmp(argv[i], "-o") == 0 || strcmp(argv[i], "--output") == 0) {
                if (i + 1 < argc) output = argv[++i];
            } else if (strcmp(argv[i], "--vfs") == 0 || strcmp(argv[i], "--vfs-on-disk") == 0) {
                if (i + 1 < argc) vfs_resource = argv[++i];
            } else if (strcmp(argv[i], "--sea") == 0) {
                if (i + 1 < argc) sea_resource = argv[++i];
            } else if (strcmp(argv[i], "--vfs-in-memory") == 0) {
                vfs_in_memory = 1;
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
            generated_blob = generate_sea_blob_from_config(executable, sea_resource);
            if (!generated_blob) {
                fprintf(stderr, "Error: Failed to generate SEA blob from config\n");
                return BINJECT_ERROR;
            }
            sea_resource = generated_blob;  // Use generated blob instead
        }

        int result = binject_inject_batch(executable, output, sea_resource, vfs_resource, vfs_in_memory);

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

#ifdef __APPLE__
    if (strcmp(command, "compress-segment") == 0) {
        const char *stub = NULL;
        const char *data = NULL;
        const char *output = NULL;
        size_t uncompressed_size = 0;

        for (int i = 2; i < argc; i++) {
            if (strcmp(argv[i], "-s") == 0 || strcmp(argv[i], "--stub") == 0) {
                if (i + 1 < argc) stub = argv[++i];
            } else if (strcmp(argv[i], "-d") == 0 || strcmp(argv[i], "--data") == 0) {
                if (i + 1 < argc) data = argv[++i];
            } else if (strcmp(argv[i], "-o") == 0 || strcmp(argv[i], "--output") == 0) {
                if (i + 1 < argc) output = argv[++i];
            } else if (strcmp(argv[i], "--uncompressed-size") == 0) {
                if (i + 1 < argc) {
                    uncompressed_size = strtoull(argv[++i], NULL, 10);
                }
            }
        }

        if (!stub || !data || !output || uncompressed_size == 0) {
            fprintf(stderr, "Error: compress-segment requires --stub, --data, --output, and --uncompressed-size\n");
            return BINJECT_ERROR_INVALID_ARGS;
        }

        return binject_embed_compressed_segment(stub, data, output, uncompressed_size);
    }

    if (strcmp(command, "extract-segment") == 0) {
        const char *executable = NULL;
        const char *output = NULL;

        for (int i = 2; i < argc; i++) {
            if (strcmp(argv[i], "-e") == 0 || strcmp(argv[i], "--executable") == 0) {
                if (i + 1 < argc) executable = argv[++i];
            } else if (strcmp(argv[i], "-o") == 0 || strcmp(argv[i], "--output") == 0) {
                if (i + 1 < argc) output = argv[++i];
            }
        }

        if (!executable || !output) {
            fprintf(stderr, "Error: extract-segment requires --executable and --output\n");
            return BINJECT_ERROR_INVALID_ARGS;
        }

        return binject_extract_compressed_segment(executable, output);
    }
#endif

    fprintf(stderr, "Error: unknown command '%s'\n", command);
    print_usage(argv[0]);
    return BINJECT_ERROR_INVALID_ARGS;
}
