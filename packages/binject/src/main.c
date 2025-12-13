/**
 * binject - Pure C alternative to postject
 * Main CLI entry point
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "binject.h"
#ifdef __APPLE__
#include "macho_compress_segment.h"
#endif

static void print_usage(const char *program) {
    printf("binject - Pure C alternative to postject\n\n");
    printf("Usage:\n");
    printf("  %s inject -e <executable> -o <output> [--sea <path>] [--vfs <path>] [--no-compress]\n", program);
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
    printf("  --vfs <path>                  Inject VFS blob to NODE_SEA/__SMOL_VFS_BLOB\n");
    printf("  --sea <path>                  Inject SEA blob to NODE_SEA/__NODE_SEA_BLOB\n");
    printf("  --no-compress                 Disable compression\n");
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
        int compress = 1;

        for (int i = 2; i < argc; i++) {
            if (strcmp(argv[i], "-e") == 0 || strcmp(argv[i], "--executable") == 0) {
                if (i + 1 < argc) executable = argv[++i];
            } else if (strcmp(argv[i], "-o") == 0 || strcmp(argv[i], "--output") == 0) {
                if (i + 1 < argc) output = argv[++i];
            } else if (strcmp(argv[i], "--vfs") == 0) {
                if (i + 1 < argc) vfs_resource = argv[++i];
            } else if (strcmp(argv[i], "--sea") == 0) {
                if (i + 1 < argc) sea_resource = argv[++i];
            } else if (strcmp(argv[i], "--no-compress") == 0) {
                compress = 0;
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

        return binject_inject_batch(executable, output, sea_resource, vfs_resource, compress);
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
