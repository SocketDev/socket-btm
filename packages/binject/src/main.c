/**
 * binject - Pure C alternative to postject
 * Main CLI entry point
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "binject.h"

static void print_usage(const char *program) {
    printf("binject - Pure C alternative to postject\n\n");
    printf("Usage:\n");
    printf("  %s inject -o <output> -r <resource> [--vfs|--sea] [--no-compress] [--overwrite]\n", program);
    printf("  %s list <executable>\n", program);
    printf("  %s extract -e <executable> [--vfs|--sea] -o <output>\n", program);
    printf("  %s verify -e <executable> [--vfs|--sea]\n", program);
    printf("  %s --help\n", program);
    printf("  %s --version\n\n", program);
    printf("Commands:\n");
    printf("  inject   Inject a resource into an executable\n");
    printf("  list     List all embedded resources\n");
    printf("  extract  Extract a resource from an executable\n");
    printf("  verify   Verify the integrity of a resource\n\n");
    printf("Options:\n");
    printf("  -o, --output <path>      Output file path (for inject/extract)\n");
    printf("  -e, --executable <path>  Input executable path (for extract/verify/list)\n");
    printf("  -r, --resource <path>    Path to the resource file (for inject)\n");
    printf("  --vfs                    Target VFS section (__SOCKETSEC/__NODE_VFS_BLOB)\n");
    printf("  --sea                    Target SEA section (__POSTJECT/__NODE_SEA_BLOB)\n");
    printf("  --no-compress            Disable compression\n");
    printf("  --overwrite              Overwrite existing section\n");
    printf("  -h, --help               Show this help message\n");
    printf("  -v, --version            Show version information\n");
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
        const char *output = NULL;
        const char *resource = NULL;
        const char *section = NULL;
        int compress = 1;
        int overwrite = 0;

        for (int i = 2; i < argc; i++) {
            if (strcmp(argv[i], "-o") == 0 || strcmp(argv[i], "--output") == 0) {
                if (i + 1 < argc) output = argv[++i];
            } else if (strcmp(argv[i], "-r") == 0 || strcmp(argv[i], "--resource") == 0) {
                if (i + 1 < argc) resource = argv[++i];
            } else if (strcmp(argv[i], "--vfs") == 0) {
                section = "vfs";
                compress = 0;  // VFS not compressed - binpress compresses entire binary.
            } else if (strcmp(argv[i], "--sea") == 0) {
                section = "sea";
                compress = 0;  // SEA blobs are pre-formatted, never compress.
            } else if (strcmp(argv[i], "--no-compress") == 0) {
                compress = 0;
            } else if (strcmp(argv[i], "--overwrite") == 0) {
                overwrite = 1;
            }
        }

        if (!output || !resource || !section) {
            fprintf(stderr, "Error: inject requires --output, --resource, and either --vfs or --sea\n");
            return BINJECT_ERROR_INVALID_ARGS;
        }

        return binject_inject(output, resource, section, compress, overwrite);
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
