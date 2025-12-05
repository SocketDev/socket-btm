/**
 * binject - Core implementation
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include "binject.h"

/* Shared compression library from bin-infra */
#include "compression_common.h"

/* Detect binary format by magic bytes */
binject_format_t binject_detect_format(const char *executable) {
    FILE *fp = fopen(executable, "rb");
    if (!fp) {
        return BINJECT_FORMAT_UNKNOWN;
    }

    uint8_t magic[4];
    if (fread(magic, 1, 4, fp) != 4) {
        fclose(fp);
        return BINJECT_FORMAT_UNKNOWN;
    }
    fclose(fp);

    /* Mach-O magic: 0xFEEDFACE, 0xFEEDFACF, 0xCAFEBABE, 0xBEBAFECA */
    if ((magic[0] == 0xFE && magic[1] == 0xED && magic[2] == 0xFA && (magic[3] == 0xCE || magic[3] == 0xCF)) ||
        (magic[0] == 0xCF && magic[1] == 0xFA && magic[2] == 0xED && magic[3] == 0xFE) ||
        (magic[0] == 0xCA && magic[1] == 0xFE && magic[2] == 0xBA && magic[3] == 0xBE) ||
        (magic[0] == 0xBE && magic[1] == 0xBA && magic[2] == 0xFE && magic[3] == 0xCA)) {
        return BINJECT_FORMAT_MACHO;
    }

    /* ELF magic: 0x7F 'E' 'L' 'F' */
    if (magic[0] == 0x7F && magic[1] == 'E' && magic[2] == 'L' && magic[3] == 'F') {
        return BINJECT_FORMAT_ELF;
    }

    /* PE magic: 'M' 'Z' */
    if (magic[0] == 'M' && magic[1] == 'Z') {
        return BINJECT_FORMAT_PE;
    }

    return BINJECT_FORMAT_UNKNOWN;
}

/* Read resource file into memory */
int binject_read_resource(const char *resource_file, uint8_t **data, size_t *size) {
    FILE *fp = fopen(resource_file, "rb");
    if (!fp) {
        fprintf(stderr, "Error: Cannot open resource file: %s\n", resource_file);
        return BINJECT_ERROR_FILE_NOT_FOUND;
    }

    fseek(fp, 0, SEEK_END);
    *size = ftell(fp);
    fseek(fp, 0, SEEK_SET);

    *data = malloc(*size);
    if (!*data) {
        fclose(fp);
        fprintf(stderr, "Error: Out of memory\n");
        return BINJECT_ERROR;
    }

    if (fread(*data, 1, *size, fp) != *size) {
        free(*data);
        fclose(fp);
        fprintf(stderr, "Error: Failed to read resource file\n");
        return BINJECT_ERROR;
    }

    fclose(fp);
    return BINJECT_OK;
}

/* Compressed binary cache support */

#ifdef _WIN32
#include <sys/stat.h>
#include <direct.h>
#define stat _stat
#else
#include <unistd.h>
#include <sys/stat.h>
#include <sys/wait.h>
#endif

/* Check if executable is a compressed self-extracting stub */
int binject_is_compressed_stub(const char *executable) {
    FILE *fp = fopen(executable, "rb");
    if (!fp) {
        return 0;
    }

    /* Read first 64KB to search for marker */
    size_t search_size = 64 * 1024;
    uint8_t *buffer = malloc(search_size);
    if (!buffer) {
        fclose(fp);
        return 0;
    }

    size_t read_size = fread(buffer, 1, search_size, fp);
    fclose(fp);

    /* Search for magic marker */
    const char *marker = "__SOCKETSEC_COMPRESSED_DATA_MAGIC_MARKER";
    size_t marker_len = strlen(marker);
    int found = 0;

    for (size_t i = 0; i <= read_size - marker_len; i++) {
        if (memcmp(buffer + i, marker, marker_len) == 0) {
            found = 1;
            break;
        }
    }

    free(buffer);
    return found;
}

/* Get path to extracted binary from compressed stub */
int binject_get_extracted_path(const char *compressed_stub, char *extracted_path, size_t path_size) {
    FILE *fp = fopen(compressed_stub, "rb");
    if (!fp) {
        fprintf(stderr, "Error: Cannot open compressed stub: %s\n", compressed_stub);
        return BINJECT_ERROR_FILE_NOT_FOUND;
    }

    /* Read file to find marker */
    size_t search_size = 64 * 1024;
    uint8_t *buffer = malloc(search_size);
    if (!buffer) {
        fclose(fp);
        fprintf(stderr, "Error: Out of memory\n");
        return BINJECT_ERROR;
    }

    size_t read_size = fread(buffer, 1, search_size, fp);
    fclose(fp);

    /* Search for magic marker */
    const char *marker = "__SOCKETSEC_COMPRESSED_DATA_MAGIC_MARKER";
    size_t marker_len = strlen(marker);
    size_t marker_offset = 0;
    int found = 0;

    for (size_t i = 0; i <= read_size - marker_len; i++) {
        if (memcmp(buffer + i, marker, marker_len) == 0) {
            marker_offset = i;
            found = 1;
            break;
        }
    }

    if (!found) {
        free(buffer);
        fprintf(stderr, "Error: Magic marker not found in compressed stub\n");
        return BINJECT_ERROR;
    }

    /* Read cache key from binary format:
     * [marker][8-byte: compressed_size][8-byte: uncompressed_size][16-byte: cache_key][data]
     */
    size_t cache_key_offset = marker_offset + marker_len + 8 + 8;
    if (cache_key_offset + 16 > read_size) {
        free(buffer);
        fprintf(stderr, "Error: Cache key not found in buffer\n");
        return BINJECT_ERROR;
    }

    char cache_key[17];
    memcpy(cache_key, buffer + cache_key_offset, 16);
    cache_key[16] = '\0';
    free(buffer);

    /* Build extracted binary path: ~/.socket/_dlx/<cache_key>/node-smol-<platform>-<arch> */
    const char *home = getenv("HOME");
#ifdef _WIN32
    if (!home) {
        home = getenv("USERPROFILE");
    }
    if (!home) {
        home = "C:\\temp";
    }
#else
    if (!home) {
        home = "/tmp";
    }
#endif

    /* Detect platform and architecture */
    const char *platform;
    const char *arch;

#if defined(__APPLE__)
    platform = "darwin";
#elif defined(__linux__)
    platform = "linux";
#elif defined(_WIN32)
    platform = "win32";
#else
    platform = "unknown";
#endif

#if defined(__x86_64__) || defined(_M_X64)
    arch = "x64";
#elif defined(__aarch64__) || defined(_M_ARM64)
    arch = "arm64";
#elif defined(__i386__) || defined(_M_IX86)
    arch = "ia32";
#else
    arch = "unknown";
#endif

    int written = snprintf(extracted_path, path_size,
                           "%s/.socket/_dlx/%s/node-smol-%s-%s",
                           home, cache_key, platform, arch);

    if (written < 0 || (size_t)written >= path_size) {
        fprintf(stderr, "Error: Path buffer too small\n");
        return BINJECT_ERROR;
    }

    /* Check if extracted binary exists */
    struct stat st;
    if (stat(extracted_path, &st) != 0) {
        fprintf(stderr, "Extracted binary not found in cache\n");
        fprintf(stderr, "Running compressed stub to extract it: %s --version\n", compressed_stub);

#ifdef _WIN32
        /* Windows: Use system() to run the stub */
        char cmd[2048];
        int written = snprintf(cmd, sizeof(cmd), "\"%s\" --version > NUL 2>&1", compressed_stub);
        if (written < 0 || (size_t)written >= sizeof(cmd)) {
            fprintf(stderr, "Error: Command buffer too small\n");
            return BINJECT_ERROR;
        }

        int result = system(cmd);
        if (result != 0) {
            fprintf(stderr, "Error: Stub extraction failed (exit code: %d)\n", result);
            return BINJECT_ERROR;
        }
#else
        /* Unix: Use fork/exec */
        pid_t pid = fork();
        if (pid == -1) {
            fprintf(stderr, "Error: Failed to fork process\n");
            return BINJECT_ERROR;
        }

        if (pid == 0) {
            /* Child process: run the stub */
            char *stub_argv[] = {(char*)compressed_stub, "--version", NULL};
            execv(compressed_stub, stub_argv);
            /* If execv returns, it failed */
            fprintf(stderr, "Error: Failed to execute stub: %s\n", strerror(errno));
            exit(1);
        } else {
            /* Parent process: wait for child to finish */
            int status;
            if (waitpid(pid, &status, 0) == -1) {
                fprintf(stderr, "Error: Failed to wait for stub process\n");
                return BINJECT_ERROR;
            }

            if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) {
                fprintf(stderr, "Error: Stub extraction failed\n");
                return BINJECT_ERROR;
            }
        }
#endif

        /* Verify extraction succeeded */
        if (stat(extracted_path, &st) != 0) {
            fprintf(stderr, "Error: Extracted binary still not found at: %s\n", extracted_path);
            return BINJECT_ERROR_FILE_NOT_FOUND;
        }

        fprintf(stderr, "✓ Extraction complete: %s\n", extracted_path);
    }

    return BINJECT_OK;
}

/* CLI: inject command */
int binject_inject(const char *executable, const char *resource_file,
                   const char *section_name, int compress) {
    /* Check if executable is a compressed self-extracting stub */
    char extracted_path[1024];
    const char *target_executable = executable;

    if (binject_is_compressed_stub(executable)) {
        printf("Detected compressed self-extracting stub: %s\n", executable);
        printf("Looking up extracted binary in cache...\n");

        int rc = binject_get_extracted_path(executable, extracted_path, sizeof(extracted_path));
        if (rc == BINJECT_OK) {
            printf("Found extracted binary: %s\n", extracted_path);
            target_executable = extracted_path;
        } else {
            /* Error message already printed by binject_get_extracted_path */
            return rc;
        }
    }

    printf("Injecting resource into %s...\n", target_executable);
    printf("  Resource: %s\n", resource_file);
    printf("  Section: %s\n", section_name);
    printf("  Compress: %s\n", compress ? "yes" : "no");

    /* Detect binary format */
    binject_format_t format = binject_detect_format(target_executable);
    const char *format_name[] = {"unknown", "Mach-O", "ELF", "PE"};
    printf("  Format: %s\n", format_name[format]);

    if (format == BINJECT_FORMAT_UNKNOWN) {
        fprintf(stderr, "Error: Unsupported binary format\n");
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    /* Read resource */
    uint8_t *data = NULL;
    size_t size = 0;
    int rc = binject_read_resource(resource_file, &data, &size);
    if (rc != BINJECT_OK) {
        return rc;
    }

    printf("  Resource size: %zu bytes\n", size);

    /* Calculate checksum of original data */
    uint32_t checksum = binject_checksum(data, size);
    printf("  Checksum: 0x%08x\n", checksum);

    /* Compress if requested */
    uint8_t *final_data = data;
    size_t final_size = size;

    if (compress) {
        uint8_t *compressed = NULL;
        size_t compressed_size = 0;

        rc = binject_compress(data, size, &compressed, &compressed_size);
        if (rc == BINJECT_OK) {
            printf("  Compressed size: %zu bytes (%.1f%% reduction)\n",
                   compressed_size, 100.0 * (1.0 - (double)compressed_size / size));
            free(data);
            final_data = compressed;
            final_size = compressed_size;
        } else {
            fprintf(stderr, "Warning: Compression failed, storing uncompressed\n");
            compress = 0;
        }
    }

    /* Platform-specific injection */
    if (format == BINJECT_FORMAT_MACHO) {
#if defined(__APPLE__) || defined(__MACH__)
        rc = binject_inject_macho(target_executable, section_name, final_data, final_size, checksum, compress);
#else
        fprintf(stderr, "Error: Mach-O injection not supported on this platform\n");
        rc = BINJECT_ERROR_INVALID_FORMAT;
#endif
    } else if (format == BINJECT_FORMAT_ELF) {
#if defined(__linux__)
        rc = binject_inject_elf(target_executable, section_name, final_data, final_size, checksum, compress);
#else
        fprintf(stderr, "Error: ELF injection not supported on this platform\n");
        rc = BINJECT_ERROR_INVALID_FORMAT;
#endif
    } else if (format == BINJECT_FORMAT_PE) {
#if defined(_WIN32)
        rc = binject_inject_pe(target_executable, section_name, final_data, final_size, checksum, compress);
#else
        fprintf(stderr, "Error: PE injection not supported on this platform\n");
        rc = BINJECT_ERROR_INVALID_FORMAT;
#endif
    } else {
        fprintf(stderr, "Error: Unsupported binary format\n");
        rc = BINJECT_ERROR_INVALID_FORMAT;
    }

    free(final_data);
    return rc;
}

/* CLI: list command */
int binject_list(const char *executable) {
    printf("Listing resources in %s...\n\n", executable);

    binject_format_t format = binject_detect_format(executable);
    if (format == BINJECT_FORMAT_UNKNOWN) {
        fprintf(stderr, "Error: Unsupported binary format\n");
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    if (format == BINJECT_FORMAT_MACHO) {
#if defined(__APPLE__) || defined(__MACH__)
        return binject_list_macho(executable);
#else
        fprintf(stderr, "Error: Mach-O format not supported on this platform\n");
        return BINJECT_ERROR_INVALID_FORMAT;
#endif
    } else if (format == BINJECT_FORMAT_ELF) {
#if defined(__linux__)
        return binject_list_elf(executable);
#else
        fprintf(stderr, "Error: ELF format not supported on this platform\n");
        return BINJECT_ERROR_INVALID_FORMAT;
#endif
    } else if (format == BINJECT_FORMAT_PE) {
#if defined(_WIN32)
        return binject_list_pe(executable);
#else
        fprintf(stderr, "Error: PE format not supported on this platform\n");
        return BINJECT_ERROR_INVALID_FORMAT;
#endif
    } else {
        fprintf(stderr, "Error: Unsupported binary format\n");
        return BINJECT_ERROR_INVALID_FORMAT;
    }
}

/* CLI: extract command */
int binject_extract(const char *executable, const char *section_name,
                    const char *output_file) {
    printf("Extracting section '%s' from %s...\n", section_name, executable);
    printf("  Output: %s\n", output_file);

    binject_format_t format = binject_detect_format(executable);
    if (format == BINJECT_FORMAT_UNKNOWN) {
        fprintf(stderr, "Error: Unsupported binary format\n");
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    if (format == BINJECT_FORMAT_MACHO) {
#if defined(__APPLE__) || defined(__MACH__)
        return binject_extract_macho(executable, section_name, output_file);
#else
        fprintf(stderr, "Error: Mach-O format not supported on this platform\n");
        return BINJECT_ERROR_INVALID_FORMAT;
#endif
    } else if (format == BINJECT_FORMAT_ELF) {
#if defined(__linux__)
        return binject_extract_elf(executable, section_name, output_file);
#else
        fprintf(stderr, "Error: ELF format not supported on this platform\n");
        return BINJECT_ERROR_INVALID_FORMAT;
#endif
    } else if (format == BINJECT_FORMAT_PE) {
#if defined(_WIN32)
        return binject_extract_pe(executable, section_name, output_file);
#else
        fprintf(stderr, "Error: PE format not supported on this platform\n");
        return BINJECT_ERROR_INVALID_FORMAT;
#endif
    } else {
        fprintf(stderr, "Error: Unsupported binary format\n");
        return BINJECT_ERROR_INVALID_FORMAT;
    }
}

/* CLI: verify command */
int binject_verify(const char *executable, const char *section_name) {
    printf("Verifying section '%s' in %s...\n", section_name, executable);

    binject_format_t format = binject_detect_format(executable);
    if (format == BINJECT_FORMAT_UNKNOWN) {
        fprintf(stderr, "Error: Unsupported binary format\n");
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    if (format == BINJECT_FORMAT_MACHO) {
#if defined(__APPLE__) || defined(__MACH__)
        return binject_verify_macho(executable, section_name);
#else
        fprintf(stderr, "Error: Mach-O format not supported on this platform\n");
        return BINJECT_ERROR_INVALID_FORMAT;
#endif
    } else if (format == BINJECT_FORMAT_ELF) {
#if defined(__linux__)
        return binject_verify_elf(executable, section_name);
#else
        fprintf(stderr, "Error: ELF format not supported on this platform\n");
        return BINJECT_ERROR_INVALID_FORMAT;
#endif
    } else if (format == BINJECT_FORMAT_PE) {
#if defined(_WIN32)
        return binject_verify_pe(executable, section_name);
#else
        fprintf(stderr, "Error: PE format not supported on this platform\n");
        return BINJECT_ERROR_INVALID_FORMAT;
#endif
    } else {
        fprintf(stderr, "Error: Unsupported binary format\n");
        return BINJECT_ERROR_INVALID_FORMAT;
    }
}

/* Simple checksum (CRC32-like) */
uint32_t binject_checksum(const uint8_t *data, size_t size) {
    uint32_t checksum = 0;
    for (size_t i = 0; i < size; i++) {
        checksum = (checksum << 1) ^ data[i];
    }
    return checksum;
}

/* Compress data using shared compression library */
int binject_compress(const uint8_t *input, size_t input_size,
                    uint8_t **output, size_t *output_size) {
    int result = compress_buffer(input, input_size, output, output_size);

    /* Map compression_common error codes to binject error codes */
    if (result == COMPRESS_OK) {
        return BINJECT_OK;
    } else {
        return BINJECT_ERROR_COMPRESSION_FAILED;
    }
}

/* Decompress data using shared compression library */
int binject_decompress(const uint8_t *input, size_t input_size,
                      uint8_t **output, size_t *output_size) {
    int result = decompress_buffer(input, input_size, output, output_size);

    /* Map compression_common error codes to binject error codes */
    if (result == COMPRESS_OK) {
        return BINJECT_OK;
    } else {
        return BINJECT_ERROR_DECOMPRESSION_FAILED;
    }
}
