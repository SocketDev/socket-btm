/**
 * binject - Core implementation
 */

#define _POSIX_C_SOURCE 200809L  // For O_CLOEXEC, lstat, fdopen
#define _XOPEN_SOURCE 700        // For additional POSIX features
#ifdef __APPLE__
#define _DARWIN_C_SOURCE         // For O_NOFOLLOW on macOS
#endif

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <limits.h>
#include <sys/stat.h>
#include <fcntl.h>
#ifndef _WIN32
#include <unistd.h>
#endif
#ifdef _WIN32
#include <windows.h>
#include <io.h>
#include <process.h>
// Windows doesn't define S_ISDIR and S_ISREG macros, so we define them ourselves
#ifndef S_ISDIR
#define S_ISDIR(m) (((m) & _S_IFMT) == _S_IFDIR)
#endif
#ifndef S_ISREG
#define S_ISREG(m) (((m) & _S_IFMT) == _S_IFREG)
#endif
#endif
#include "binject.h"
#include "stub_repack.h"

/* Shared compression library from bin-infra */
#include "binary_format.h"
#include "buffer_constants.h"
#include "compression_common.h"
#include "compression_constants.h"
#include "dlx_cache_common.h"
#include "segment_names.h"
#include "smol_segment_reader.h"

/* Shared file utilities from build-infra */
#include "file_utils.h"

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

    /* Use shared binary format detection. */
    binary_format_t format = detect_binary_format(magic);

    /* Convert from shared format enum to binject format enum. */
    switch (format) {
        case BINARY_FORMAT_MACHO:
            return BINJECT_FORMAT_MACHO;
        case BINARY_FORMAT_ELF:
            return BINJECT_FORMAT_ELF;
        case BINARY_FORMAT_PE:
            return BINJECT_FORMAT_PE;
        default:
            return BINJECT_FORMAT_UNKNOWN;
    }
}

/* Maximum resource file size: 500MB to accommodate universal binaries (arm64+x86_64) */
#define MAX_RESOURCE_SIZE (500 * 1024 * 1024)

/* Read resource file into memory */
int binject_read_resource(const char *resource_file, uint8_t **data, size_t *size) {
    FILE *fp = fopen(resource_file, "rb");
    if (!fp) {
        fprintf(stderr, "Error: Cannot open resource file: %s\n", resource_file);
        return BINJECT_ERROR_FILE_NOT_FOUND;
    }

    if (fseek(fp, 0, SEEK_END) != 0) {
        fclose(fp);
        fprintf(stderr, "Error: Cannot seek resource file\n");
        return BINJECT_ERROR;
    }

    long file_size = ftell(fp);
    if (file_size < 0) {
        fclose(fp);
        fprintf(stderr, "Error: Cannot determine resource file size\n");
        return BINJECT_ERROR;
    }

    if ((size_t)file_size > MAX_RESOURCE_SIZE) {
        fclose(fp);
        fprintf(stderr, "Error: Resource file too large (max %d MB)\n", MAX_RESOURCE_SIZE / (1024 * 1024));
        return BINJECT_ERROR;
    }

    *size = (size_t)file_size;

    if (fseek(fp, 0, SEEK_SET) != 0) {
        fclose(fp);
        fprintf(stderr, "Error: Cannot seek resource file\n");
        return BINJECT_ERROR;
    }

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
#include <fcntl.h>
#include <sys/stat.h>
#include <sys/wait.h>
#endif

/* Constants for compressed stub detection */
/* Platform-specific search sizes optimized for each binary format */
#define SEARCH_SIZE_64KB   (64 * 1024)
#define SEARCH_SIZE_128KB  (128 * 1024)
#define SEARCH_SIZE_1408KB (1408 * 1024)

#ifdef __APPLE__
  #define COMPRESSED_STUB_SEARCH_SIZE SEARCH_SIZE_64KB    /* macOS: marker at ~48KB */
#elif defined(_WIN32)
  #define COMPRESSED_STUB_SEARCH_SIZE SEARCH_SIZE_128KB   /* Windows: marker at ~59KB */
#else
  #define COMPRESSED_STUB_SEARCH_SIZE SEARCH_SIZE_1408KB  /* Linux: marker at ~1052KB */
#endif

/* Check if executable is a compressed self-extracting stub */
int binject_is_compressed_stub(const char *executable) {
    FILE *fp = fopen(executable, "rb");
    if (!fp) {
        return 0;
    }

    /* Read platform-specific amount to search for marker */
    size_t search_size = COMPRESSED_STUB_SEARCH_SIZE;
    uint8_t *buffer = malloc(search_size);
    if (!buffer) {
        fclose(fp);
        return 0;
    }

    size_t read_size = fread(buffer, 1, search_size, fp);
    fclose(fp);

    /* Search for magic marker using shared finder. */
    size_t marker_offset;
    int found = (smol_find_marker_in_buffer(buffer, read_size, &marker_offset) == 0);

    if (found) {
        /* The marker must be followed by: [8-byte: compressed_size][8-byte: uncompressed_size][16-byte: cache_key] */
        size_t cache_key_offset = marker_offset + MAGIC_MARKER_LEN + SIZE_HEADER_LEN;
        size_t required_size = cache_key_offset + CACHE_KEY_LEN;

        if (read_size >= required_size) {
            /* Validate that the cache key at expected offset contains only hex digits.
             * This prevents false positives when the marker appears in string constants. */
            int valid_cache_key = 1;

            for (int j = 0; j < CACHE_KEY_LEN; j++) {
                char c = buffer[cache_key_offset + j];
                if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))) {
                    valid_cache_key = 0;
                    break;
                }
            }

            found = valid_cache_key;
        } else {
            found = 0;
        }
    }

    free(buffer);
    return found;
}

/**
 * Extract compressed stub to cache directory (cross-platform).
 * This function manually decompresses the stub without needing to execute it,
 * enabling cross-platform builds (e.g., extracting Linux stubs on macOS).
 *
 * @param compressed_stub Path to compressed stub binary
 * @param extracted_path Path where extracted binary should be written
 * @return BINJECT_OK on success, error code on failure
 */
int binject_extract_stub_to_cache(const char *compressed_stub, const char *extracted_path) {
    FILE *fp = NULL;
    uint8_t *buffer = NULL;
    uint8_t *compressed_data = NULL;
    uint8_t *decompressed_data = NULL;
    int result = BINJECT_ERROR;

    printf("Extracting compressed stub manually...\n");

    /* Open compressed stub. */
    fp = fopen(compressed_stub, "rb");
    if (!fp) {
        fprintf(stderr, "Error: Cannot open compressed stub: %s\n", compressed_stub);
        goto cleanup;
    }

    /* Read first 64KB to find marker and metadata. */
    size_t search_size = COMPRESSED_STUB_SEARCH_SIZE;
    buffer = malloc(search_size);
    if (!buffer) {
        fprintf(stderr, "Error: Out of memory\n");
        goto cleanup;
    }

    size_t read_size = fread(buffer, 1, search_size, fp);

    /* Find magic marker. */
    size_t marker_offset;
    if (smol_find_marker_in_buffer(buffer, read_size, &marker_offset) != 0) {
        fprintf(stderr, "Error: Magic marker not found\n");
        goto cleanup;
    }

    /* Read metadata: [marker][8-byte: compressed_size][8-byte: uncompressed_size][16-byte: cache_key][3-byte: platform_metadata]. */
    size_t metadata_offset = marker_offset + MAGIC_MARKER_LEN;
    if (metadata_offset + METADATA_HEADER_LEN > read_size) {
        fprintf(stderr, "Error: Metadata truncated\n");
        goto cleanup;
    }

    uint64_t compressed_size;
    uint64_t uncompressed_size;
    memcpy(&compressed_size, buffer + metadata_offset, sizeof(uint64_t));
    memcpy(&uncompressed_size, buffer + metadata_offset + sizeof(uint64_t), sizeof(uint64_t));

    /* All platforms now use LZFSE compression exclusively. */
    uint8_t compression_algorithm = 0;  /* LZFSE */

    /* Compressed data starts after: marker + metadata header. */
    size_t data_offset = marker_offset + MAGIC_MARKER_LEN + METADATA_HEADER_LEN;

    printf("  Compressed size: %llu bytes\n", (unsigned long long)compressed_size);
    printf("  Uncompressed size: %llu bytes\n", (unsigned long long)uncompressed_size);
    printf("  Data offset: %zu bytes\n", data_offset);

    /* Seek to compressed data. */
    if (fseek(fp, (long)data_offset, SEEK_SET) != 0) {
        fprintf(stderr, "Error: Failed to seek to compressed data\n");
        goto cleanup;
    }

    /* Allocate and read compressed data. */
    compressed_data = malloc(compressed_size);
    if (!compressed_data) {
        fprintf(stderr, "Error: Out of memory for compressed data\n");
        goto cleanup;
    }

    if (fread(compressed_data, 1, compressed_size, fp) != compressed_size) {
        fprintf(stderr, "Error: Failed to read compressed data\n");
        goto cleanup;
    }

    fclose(fp);
    fp = NULL;

    /* Allocate decompression buffer. */
    decompressed_data = malloc(uncompressed_size);
    if (!decompressed_data) {
        fprintf(stderr, "Error: Out of memory for decompressed data\n");
        goto cleanup;
    }

    /* Decompress using cross-platform decompressor with LZFSE (universal algorithm). */
    printf("  Decompressing... (algorithm: LZFSE)\n");
    int decompress_result = decompress_buffer_with_algorithm(
        compressed_data, compressed_size,
        decompressed_data, uncompressed_size,
        compression_algorithm
    );

    if (decompress_result != COMPRESS_OK) {
        fprintf(stderr, "Error: Decompression failed (code: %d)\n", decompress_result);
        goto cleanup;
    }

    /* Create parent directories if needed. */
    if (create_parent_directories(extracted_path) != 0) {
        fprintf(stderr, "Error: Failed to create parent directories for output path: %s\n", extracted_path);
        goto cleanup;
    }

    /* Write decompressed binary. */
    FILE *out_fp = fopen(extracted_path, "wb");
    if (!out_fp) {
        fprintf(stderr, "Error: Cannot create output file: %s\n", extracted_path);
        goto cleanup;
    }

    if (fwrite(decompressed_data, 1, uncompressed_size, out_fp) != uncompressed_size) {
        fclose(out_fp);
        fprintf(stderr, "Error: Failed to write decompressed data\n");
        goto cleanup;
    }

    fclose(out_fp);

    /* Make executable on Unix. */
#ifndef _WIN32
    if (chmod(extracted_path, 0755) != 0) {
        fprintf(stderr, "Error: Failed to set executable permissions\n");
        goto cleanup;
    }
#endif

    printf("✓ Extraction complete: %s\n", extracted_path);
    result = BINJECT_OK;

cleanup:
    if (fp) fclose(fp);
    if (buffer) free(buffer);
    if (compressed_data) free(compressed_data);
    if (decompressed_data) free(decompressed_data);
    return result;
}

/* Get path to extracted binary from compressed stub */
int binject_get_extracted_path(const char *compressed_stub, char *extracted_path, size_t path_size) {
    /* Validate compressed_stub path to prevent command injection */
    if (!compressed_stub || strlen(compressed_stub) == 0) {
        fprintf(stderr, "Error: Compressed stub path is empty\n");
        return BINJECT_ERROR;
    }

    /* Check for path traversal attempts */
    if (strstr(compressed_stub, "..") != NULL) {
        fprintf(stderr, "Error: Path traversal detected in stub path\n");
        return BINJECT_ERROR;
    }

    /* Validate file exists */
    struct stat stub_st;
    if (stat(compressed_stub, &stub_st) != 0) {
        fprintf(stderr, "Error: Compressed stub not found: %s\n", compressed_stub);
        return BINJECT_ERROR_FILE_NOT_FOUND;
    }

    /* Validate it's a regular file */
    if (!S_ISREG(stub_st.st_mode)) {
        fprintf(stderr, "Error: Compressed stub is not a regular file\n");
        return BINJECT_ERROR;
    }

    FILE *fp = fopen(compressed_stub, "rb");
    if (!fp) {
        fprintf(stderr, "Error: Cannot open compressed stub: %s\n", compressed_stub);
        return BINJECT_ERROR_FILE_NOT_FOUND;
    }

    /* Read file to find marker */
    size_t search_size = COMPRESSED_STUB_SEARCH_SIZE;
    uint8_t *buffer = malloc(search_size);
    if (!buffer) {
        fclose(fp);
        fprintf(stderr, "Error: Out of memory\n");
        return BINJECT_ERROR;
    }

    size_t read_size = fread(buffer, 1, search_size, fp);
    fclose(fp);

    /* Search for magic marker using shared finder. */
    size_t marker_offset;
    if (smol_find_marker_in_buffer(buffer, read_size, &marker_offset) != 0) {
        free(buffer);
        fprintf(stderr, "Error: Magic marker not found in compressed stub\n");
        return BINJECT_ERROR;
    }

    /* Read cache key from binary format:
     * [marker][8-byte: compressed_size][8-byte: uncompressed_size][16-byte: cache_key][data]
     */
    size_t cache_key_offset = marker_offset + MAGIC_MARKER_LEN + SIZE_HEADER_LEN;
    if (cache_key_offset + CACHE_KEY_LEN > read_size) {
        free(buffer);
        fprintf(stderr, "Error: Cache key not found in buffer\n");
        return BINJECT_ERROR;
    }

    char cache_key[CACHE_KEY_LEN + 1];
    memcpy(cache_key, buffer + cache_key_offset, CACHE_KEY_LEN);
    cache_key[CACHE_KEY_LEN] = '\0';
    free(buffer);

    /* Validate cache key is exactly 16 hex bytes with proper null termination */
    for (int i = 0; i < CACHE_KEY_LEN; i++) {
        char c = cache_key[i];
        if (c == '\0') {
            fprintf(stderr, "Error: Cache key contains null byte at position %d\n", i);
            return BINJECT_ERROR;
        }
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))) {
            fprintf(stderr, "Error: Invalid cache key format (must be hex): %s\n", cache_key);
            return BINJECT_ERROR;
        }
    }

    /* Verify null termination at position 16 */
    if (cache_key[CACHE_KEY_LEN] != '\0') {
        fprintf(stderr, "Error: Cache key not properly null-terminated\n");
        return BINJECT_ERROR;
    }

    /* Build extracted binary path: <base_dir>/<cache_key>/node-smol-<platform>-<arch> */
    /* Respects SOCKET_DLX_DIR and SOCKET_HOME environment variables */
    char base_dir[CACHE_DIR_BUFFER_SIZE];
    if (dlx_get_cache_base_dir(base_dir, sizeof(base_dir)) != 0) {
        fprintf(stderr, "Error: Failed to get cache base directory\n");
        return BINJECT_ERROR;
    }

    /* Validate cache directory is accessible */
    struct stat base_st;
#ifdef _WIN32
    /* Windows: use regular stat (lstat not available, symlinks less common) */
    if (stat(base_dir, &base_st) != 0) {
        fprintf(stderr, "Error: Cache directory not accessible: %s\n", base_dir);
        return BINJECT_ERROR;
    }
#else
    /* Unix: use lstat to prevent symlink attacks */
    if (lstat(base_dir, &base_st) != 0) {
        fprintf(stderr, "Error: Cache directory not accessible: %s\n", base_dir);
        return BINJECT_ERROR;
    }

    /* Reject symlinks to prevent TOCTOU attacks */
    if (S_ISLNK(base_st.st_mode)) {
        fprintf(stderr, "Error: Cache directory cannot be a symbolic link: %s\n", base_dir);
        return BINJECT_ERROR;
    }
#endif

    if (!S_ISDIR(base_st.st_mode)) {
        fprintf(stderr, "Error: Cache path is not a directory: %s\n", base_dir);
        return BINJECT_ERROR;
    }

    /* Build extracted binary path using shared helper. */
    /* Path format: <base_dir>/<cache_key>/node (or node.exe on Windows). */
    if (dlx_get_extracted_binary_path(cache_key, extracted_path, path_size) != 0) {
        fprintf(stderr, "Error: Failed to construct extracted binary path\n");
        return BINJECT_ERROR;
    }

    /* Check if extracted binary exists */
    struct stat st;
    if (stat(extracted_path, &st) != 0) {
        fprintf(stderr, "Extracted binary not found in cache\n");

        /* Use cross-platform manual extraction instead of running the stub. */
        /* This enables cross-platform builds (e.g., extracting Linux stubs on macOS). */
        int extract_result = binject_extract_stub_to_cache(compressed_stub, extracted_path);
        if (extract_result != BINJECT_OK) {
            return extract_result;
        }

        /* Verify extraction succeeded by opening and checking file format */
        /* Use O_NOFOLLOW to prevent TOCTOU via symlink attacks */
        FILE *verify_fp = NULL;
#ifndef _WIN32
        int verify_fd = open(extracted_path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
        if (verify_fd < 0) {
            fprintf(stderr, "Error: Cannot open extracted binary (may be symlink): %s\n", extracted_path);
            return BINJECT_ERROR_FILE_NOT_FOUND;
        }
        verify_fp = fdopen(verify_fd, "rb");
        if (!verify_fp) {
            close(verify_fd);
            fprintf(stderr, "Error: Cannot fdopen extracted binary: %s\n", extracted_path);
            return BINJECT_ERROR_FILE_NOT_FOUND;
        }
#else
        /* Windows: Check for symlinks/reparse points before opening */
        DWORD attrs = GetFileAttributesA(extracted_path);
        if (attrs == INVALID_FILE_ATTRIBUTES) {
            fprintf(stderr, "Error: Cannot get file attributes: %s\n", extracted_path);
            return BINJECT_ERROR_FILE_NOT_FOUND;
        }

        /* Reject reparse points (symlinks, mount points, etc.) */
        if (attrs & FILE_ATTRIBUTE_REPARSE_POINT) {
            fprintf(stderr, "Error: File is a reparse point (symlink): %s\n", extracted_path);
            return BINJECT_ERROR_FILE_NOT_FOUND;
        }

        verify_fp = fopen(extracted_path, "rb");
        if (!verify_fp) {
            fprintf(stderr, "Error: Extracted binary not found at: %s\n", extracted_path);
            return BINJECT_ERROR_FILE_NOT_FOUND;
        }
#endif

        // Verify it's a valid binary format by reading magic bytes
        uint8_t magic[4];
        size_t bytes_read = fread(magic, 1, 4, verify_fp);
        fclose(verify_fp);

        if (bytes_read != 4) {
            fprintf(stderr, "Error: Extracted binary is invalid (too small)\n");
            return BINJECT_ERROR_INVALID_FORMAT;
        }

        // Verify magic bytes match a known executable format
        binject_format_t extracted_format = binject_detect_format(extracted_path);
        if (extracted_format == BINJECT_FORMAT_UNKNOWN) {
            fprintf(stderr, "Error: Extracted binary has invalid format\n");
            return BINJECT_ERROR_INVALID_FORMAT;
        }

        fprintf(stderr, "✓ Extraction complete: %s\n", extracted_path);
    }

    return BINJECT_OK;
}

/* CLI: single command */
int binject_single(const char *executable, const char *output, const char *resource_file,
                   const char *section_name) {
    (void)output; // Unused parameter.
    /* During injection, work with the provided binary directly.
     * Stub extraction should only happen at execution time, not during injection.
     * This prevents false positives when injecting into binaries that contain
     * the magic marker string in their code (like binject itself). */
    printf("Injecting resource into %s...\n", executable);
    printf("  Resource: %s\n", resource_file);
    printf("  Section: %s\n", section_name);

    /* Detect binary format */
    binject_format_t format = binject_detect_format(executable);
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

    /* Calculate checksum */
    uint32_t checksum = binject_checksum(data, size);
    printf("  Checksum: 0x%08x\n", checksum);

    /* Platform-specific injection. */
    if (format == BINJECT_FORMAT_MACHO) {
        /* Map section identifier to Mach-O segment/section names. */
        const char *segment = MACHO_SEGMENT_NODE_SEA;
        const char *macho_section = NULL;

        if (strcmp(section_name, "sea") == 0) {
            macho_section = MACHO_SECTION_NODE_SEA_BLOB;
        } else if (strcmp(section_name, "vfs") == 0) {
            macho_section = MACHO_SECTION_SMOL_VFS_BLOB;
        } else {
            fprintf(stderr, "Error: Unknown section identifier '%s'\n", section_name);
            free(data);
            return BINJECT_ERROR_INVALID_ARGS;
        }

        rc = binject_macho(executable, segment, macho_section, data, size);
    } else if (format == BINJECT_FORMAT_ELF) {
        /* Use LIEF for cross-platform ELF injection. */
        rc = binject_elf_lief(executable, section_name, data, size);
    } else if (format == BINJECT_FORMAT_PE) {
        /* Use LIEF for cross-platform PE injection. */
        rc = binject_pe_lief(executable, section_name, data, size);
    } else {
        fprintf(stderr, "Error: Unsupported binary format\n");
        rc = BINJECT_ERROR_INVALID_FORMAT;
    }

    free(data);

    /* Stub repacking removed - injection now works directly with provided binary */
    return rc;
}

/* CLI: batch inject command (SEA and/or VFS in one pass) */
int binject_batch(const char *executable, const char *output,
                         const char *sea_resource, const char *vfs_resource,
                         int vfs_in_memory) {
    (void)vfs_in_memory; // Reserved for future VFS extraction control at runtime

    /* Check if this is a compressed stub */
    int is_compressed = binject_is_compressed_stub(executable);
    char extracted_path[PATH_MAX];
    const char *target_binary = executable;

    if (is_compressed) {
        printf("Detected compressed self-extracting stub: %s\n", executable);

        /* Get path to extracted binary in cache */
        int rc = binject_get_extracted_path(executable, extracted_path, sizeof(extracted_path));
        if (rc != BINJECT_OK) {
            return rc;
        }

        printf("Looking up extracted binary in cache...\n");

        /* Check if extracted binary exists in cache */
        struct stat st;
        if (stat(extracted_path, &st) != 0) {
            fprintf(stderr, "Error: Extracted binary not found in cache: %s\n", extracted_path);
            fprintf(stderr, "Please run the compressed binary once to extract it, then try injection again.\n");
            return BINJECT_ERROR_FILE_NOT_FOUND;
        }

        printf("Found extracted binary: %s\n", extracted_path);

        /* Inject into the extracted binary */
        printf("Injecting resource into %s...\n", extracted_path);
        target_binary = extracted_path;
    } else {
        printf("Batch injection into %s...\n", executable);
    }

    /* Detect binary format */
    binject_format_t format = binject_detect_format(target_binary);
    const char *format_name[] = {"unknown", "Mach-O", "ELF", "PE"};
    printf("  Format: %s\n", format_name[format]);

    if (format == BINJECT_FORMAT_UNKNOWN) {
        fprintf(stderr, "Error: Unknown binary format\n");
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    /* Read SEA resource if provided */
    uint8_t *sea_data = NULL;
    size_t sea_size = 0;
    if (sea_resource) {
        int rc = binject_read_resource(sea_resource, &sea_data, &sea_size);
        if (rc != BINJECT_OK) {
            return rc;
        }
        printf("  SEA resource: %s (%zu bytes)\n", sea_resource, sea_size);
    }

    /* Read VFS resource if provided */
    uint8_t *vfs_data = NULL;
    size_t vfs_size = 0;
    int vfs_compat_mode = 0;
    if (vfs_resource && strlen(vfs_resource) > 0) {
        int rc = binject_read_resource(vfs_resource, &vfs_data, &vfs_size);
        if (rc != BINJECT_OK) {
            free(sea_data);
            return rc;
        }
        printf("  VFS resource: %s (%zu bytes)\n", vfs_resource, vfs_size);
    } else if (vfs_resource && strlen(vfs_resource) == 0) {
        /* VFS compatibility mode - create empty 0-byte VFS section */
        printf("  VFS resource: compatibility mode (0-byte flag)\n");
        vfs_size = 0;
        vfs_data = NULL;
        vfs_compat_mode = 1;
    }

    /* Perform injection based on format */
    int rc;
    /* For compressed stubs, inject into extracted binary and write output there temporarily.
     * We'll repack the stub after injection succeeds. */
    const char *injection_output = is_compressed ? target_binary : output;

    if (format == BINJECT_FORMAT_MACHO) {
        rc = binject_macho_lief_batch(target_binary, injection_output, sea_data, sea_size, vfs_data, vfs_size, vfs_compat_mode);
    } else if (format == BINJECT_FORMAT_ELF) {
        rc = binject_batch_elf(target_binary, injection_output, sea_data, sea_size, vfs_data, vfs_size, vfs_compat_mode);
    } else if (format == BINJECT_FORMAT_PE) {
        rc = binject_batch_pe(target_binary, injection_output, sea_data, sea_size, vfs_data, vfs_size, vfs_compat_mode);
    } else {
        fprintf(stderr, "Error: Unsupported binary format for injection\n");
        rc = BINJECT_ERROR_INVALID_FORMAT;
    }

    free(sea_data);
    free(vfs_data);

    if (rc != BINJECT_OK) {
        return rc;
    }

    /* If this was a compressed stub, repack it with the modified binary */
    if (is_compressed) {
        printf("\n");
        printf("Repacking compressed stub...\n");
        rc = binject_repack_workflow(executable, target_binary, output);
        if (rc != BINJECT_OK) {
            fprintf(stderr, "Error: Failed to repack compressed stub\n");
            return rc;
        }
        printf("✓ Stub repacking complete\n");
    }

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
        return binject_macho_list(executable);
    } else if (format == BINJECT_FORMAT_ELF) {
        return binject_elf_list(executable);
    } else if (format == BINJECT_FORMAT_PE) {
        return binject_pe_list(executable);
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

    /* Map section identifier to actual section name */
    const char *actual_section_name = section_name;
    if (format == BINJECT_FORMAT_MACHO) {
        if (strcmp(section_name, "sea") == 0) {
            actual_section_name = MACHO_SECTION_NODE_SEA_BLOB;
        } else if (strcmp(section_name, "vfs") == 0) {
            actual_section_name = MACHO_SECTION_SMOL_VFS_BLOB;
        }
    } else if (format == BINJECT_FORMAT_ELF) {
        if (strcmp(section_name, "sea") == 0) {
            actual_section_name = ELF_NOTE_NODE_SEA_BLOB;
        } else if (strcmp(section_name, "vfs") == 0) {
            actual_section_name = ELF_NOTE_SMOL_VFS_BLOB;
        }
    } else if (format == BINJECT_FORMAT_PE) {
        if (strcmp(section_name, "sea") == 0) {
            actual_section_name = PE_RESOURCE_NODE_SEA_BLOB;
        } else if (strcmp(section_name, "vfs") == 0) {
            actual_section_name = PE_RESOURCE_SMOL_VFS_BLOB;
        }
    }

    if (format == BINJECT_FORMAT_MACHO) {
        return binject_macho_extract(executable, actual_section_name, output_file);
    } else if (format == BINJECT_FORMAT_ELF) {
        return binject_elf_extract(executable, actual_section_name, output_file);
    } else if (format == BINJECT_FORMAT_PE) {
        return binject_pe_extract(executable, actual_section_name, output_file);
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

    /* Map section identifier to actual section name */
    const char *actual_section_name = section_name;
    if (format == BINJECT_FORMAT_MACHO) {
        if (strcmp(section_name, "sea") == 0) {
            actual_section_name = MACHO_SECTION_NODE_SEA_BLOB;
        } else if (strcmp(section_name, "vfs") == 0) {
            actual_section_name = MACHO_SECTION_SMOL_VFS_BLOB;
        }
    } else if (format == BINJECT_FORMAT_ELF) {
        if (strcmp(section_name, "sea") == 0) {
            actual_section_name = ELF_NOTE_NODE_SEA_BLOB;
        } else if (strcmp(section_name, "vfs") == 0) {
            actual_section_name = ELF_NOTE_SMOL_VFS_BLOB;
        }
    } else if (format == BINJECT_FORMAT_PE) {
        if (strcmp(section_name, "sea") == 0) {
            actual_section_name = PE_RESOURCE_NODE_SEA_BLOB;
        } else if (strcmp(section_name, "vfs") == 0) {
            actual_section_name = PE_RESOURCE_SMOL_VFS_BLOB;
        }
    }

    if (format == BINJECT_FORMAT_MACHO) {
        return binject_macho_verify(executable, actual_section_name);
    } else if (format == BINJECT_FORMAT_ELF) {
        return binject_elf_verify(executable, actual_section_name);
    } else if (format == BINJECT_FORMAT_PE) {
        return binject_pe_verify(executable, actual_section_name);
    } else {
        fprintf(stderr, "Error: Unsupported binary format\n");
        return BINJECT_ERROR_INVALID_FORMAT;
    }
}

/* CRC32 checksum with proper polynomial */
uint32_t binject_checksum(const uint8_t *data, size_t size) {
    /* CRC32 polynomial (IEEE 802.3) */
    static const uint32_t crc32_table[256] = {
        0x00000000, 0x77073096, 0xee0e612c, 0x990951ba, 0x076dc419, 0x706af48f, 0xe963a535, 0x9e6495a3,
        0x0edb8832, 0x79dcb8a4, 0xe0d5e91e, 0x97d2d988, 0x09b64c2b, 0x7eb17cbd, 0xe7b82d07, 0x90bf1d91,
        0x1db71064, 0x6ab020f2, 0xf3b97148, 0x84be41de, 0x1adad47d, 0x6ddde4eb, 0xf4d4b551, 0x83d385c7,
        0x136c9856, 0x646ba8c0, 0xfd62f97a, 0x8a65c9ec, 0x14015c4f, 0x63066cd9, 0xfa0f3d63, 0x8d080df5,
        0x3b6e20c8, 0x4c69105e, 0xd56041e4, 0xa2677172, 0x3c03e4d1, 0x4b04d447, 0xd20d85fd, 0xa50ab56b,
        0x35b5a8fa, 0x42b2986c, 0xdbbbc9d6, 0xacbcf940, 0x32d86ce3, 0x45df5c75, 0xdcd60dcf, 0xabd13d59,
        0x26d930ac, 0x51de003a, 0xc8d75180, 0xbfd06116, 0x21b4f4b5, 0x56b3c423, 0xcfba9599, 0xb8bda50f,
        0x2802b89e, 0x5f058808, 0xc60cd9b2, 0xb10be924, 0x2f6f7c87, 0x58684c11, 0xc1611dab, 0xb6662d3d,
        0x76dc4190, 0x01db7106, 0x98d220bc, 0xefd5102a, 0x71b18589, 0x06b6b51f, 0x9fbfe4a5, 0xe8b8d433,
        0x7807c9a2, 0x0f00f934, 0x9609a88e, 0xe10e9818, 0x7f6a0dbb, 0x086d3d2d, 0x91646c97, 0xe6635c01,
        0x6b6b51f4, 0x1c6c6162, 0x856530d8, 0xf262004e, 0x6c0695ed, 0x1b01a57b, 0x8208f4c1, 0xf50fc457,
        0x65b0d9c6, 0x12b7e950, 0x8bbeb8ea, 0xfcb9887c, 0x62dd1ddf, 0x15da2d49, 0x8cd37cf3, 0xfbd44c65,
        0x4db26158, 0x3ab551ce, 0xa3bc0074, 0xd4bb30e2, 0x4adfa541, 0x3dd895d7, 0xa4d1c46d, 0xd3d6f4fb,
        0x4369e96a, 0x346ed9fc, 0xad678846, 0xda60b8d0, 0x44042d73, 0x33031de5, 0xaa0a4c5f, 0xdd0d7cc9,
        0x5005713c, 0x270241aa, 0xbe0b1010, 0xc90c2086, 0x5768b525, 0x206f85b3, 0xb966d409, 0xce61e49f,
        0x5edef90e, 0x29d9c998, 0xb0d09822, 0xc7d7a8b4, 0x59b33d17, 0x2eb40d81, 0xb7bd5c3b, 0xc0ba6cad,
        0xedb88320, 0x9abfb3b6, 0x03b6e20c, 0x74b1d29a, 0xead54739, 0x9dd277af, 0x04db2615, 0x73dc1683,
        0xe3630b12, 0x94643b84, 0x0d6d6a3e, 0x7a6a5aa8, 0xe40ecf0b, 0x9309ff9d, 0x0a00ae27, 0x7d079eb1,
        0xf00f9344, 0x8708a3d2, 0x1e01f268, 0x6906c2fe, 0xf762575d, 0x806567cb, 0x196c3671, 0x6e6b06e7,
        0xfed41b76, 0x89d32be0, 0x10da7a5a, 0x67dd4acc, 0xf9b9df6f, 0x8ebeeff9, 0x17b7be43, 0x60b08ed5,
        0xd6d6a3e8, 0xa1d1937e, 0x38d8c2c4, 0x4fdff252, 0xd1bb67f1, 0xa6bc5767, 0x3fb506dd, 0x48b2364b,
        0xd80d2bda, 0xaf0a1b4c, 0x36034af6, 0x41047a60, 0xdf60efc3, 0xa867df55, 0x316e8eef, 0x4669be79,
        0xcb61b38c, 0xbc66831a, 0x256fd2a0, 0x5268e236, 0xcc0c7795, 0xbb0b4703, 0x220216b9, 0x5505262f,
        0xc5ba3bbe, 0xb2bd0b28, 0x2bb45a92, 0x5cb36a04, 0xc2d7ffa7, 0xb5d0cf31, 0x2cd99e8b, 0x5bdeae1d,
        0x9b64c2b0, 0xec63f226, 0x756aa39c, 0x026d930a, 0x9c0906a9, 0xeb0e363f, 0x72076785, 0x05005713,
        0x95bf4a82, 0xe2b87a14, 0x7bb12bae, 0x0cb61b38, 0x92d28e9b, 0xe5d5be0d, 0x7cdcefb7, 0x0bdbdf21,
        0x86d3d2d4, 0xf1d4e242, 0x68ddb3f8, 0x1fda836e, 0x81be16cd, 0xf6b9265b, 0x6fb077e1, 0x18b74777,
        0x88085ae6, 0xff0f6a70, 0x66063bca, 0x11010b5c, 0x8f659eff, 0xf862ae69, 0x616bffd3, 0x166ccf45,
        0xa00ae278, 0xd70dd2ee, 0x4e048354, 0x3903b3c2, 0xa7672661, 0xd06016f7, 0x4969474d, 0x3e6e77db,
        0xaed16a4a, 0xd9d65adc, 0x40df0b66, 0x37d83bf0, 0xa9bcae53, 0xdebb9ec5, 0x47b2cf7f, 0x30b5ffe9,
        0xbdbdf21c, 0xcabac28a, 0x53b39330, 0x24b4a3a6, 0xbad03605, 0xcdd70693, 0x54de5729, 0x23d967bf,
        0xb3667a2e, 0xc4614ab8, 0x5d681b02, 0x2a6f2b94, 0xb40bbe37, 0xc30c8ea1, 0x5a05df1b, 0x2d02ef8d
    };

    uint32_t crc = 0xFFFFFFFF;
    for (size_t i = 0; i < size; i++) {
        uint8_t byte = data[i];
        crc = (crc >> 8) ^ crc32_table[(crc ^ byte) & 0xFF];
    }
    return crc ^ 0xFFFFFFFF;
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
