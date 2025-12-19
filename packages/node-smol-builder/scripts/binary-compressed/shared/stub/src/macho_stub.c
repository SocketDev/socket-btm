/**
 * macOS Mach-O Minimal Self-Extracting Stub (Shared Code Version)
 *
 * Ultra-minimal launcher that decompresses embedded data inline without extracting binflate.
 * Uses shared code from bin-infra to minimize duplication.
 *
 * Binary format:
 *   [This stub code (~8-10KB)]
 *   [__SOCKETSEC_COMPRESSED_DATA_MAGIC_MARKER]
 *   [8-byte header: compressed size (uint64_t)]
 *   [8-byte header: uncompressed size (uint64_t)]
 *   [16-byte: cache key (hex string)]
 *   [Compressed data]
 *
 * At runtime:
 *   1. Finds compressed data using shared marker_finder.h
 *   2. Decompresses inline using Apple Compression framework
 *   3. Writes to cache using shared dlx_cache_common.h
 *   4. Executes decompressed binary
 */

#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <errno.h>
#include <mach-o/dyld.h>
#include <compression.h>

#include "compression_constants.h"
#include "marker_finder.h"
#include "dlx_cache_common.h"

/**
 * Get path to current executable
 */
static int get_executable_path(char *buf, size_t size) {
    uint32_t bufsize = (uint32_t)size;
    if (_NSGetExecutablePath(buf, &bufsize) != 0) {
        fprintf(stderr, "Error: Buffer too small for executable path\n");
        return -1;
    }
    return 0;
}

/**
 * Extract and execute compressed binary
 */
static int extract_and_execute(int self_fd, const char *exe_path, int argc, char *argv[], char *envp[]) {
    int exit_code = 1;
    unsigned char *compressed_data = NULL;
    unsigned char *decompressed_data = NULL;
    char cache_key[33] = {0};
    char output_path[1024];

    // Find compressed data marker
    long data_offset = find_marker(self_fd, MAGIC_MARKER_PART1, MAGIC_MARKER_PART2, MAGIC_MARKER_PART3, MAGIC_MARKER_LEN);
    if (data_offset == -1) {
        fprintf(stderr, "Error: Compressed data marker not found\n");
        return 1;
    }

    // Seek to size headers
    if (lseek(self_fd, data_offset, SEEK_SET) == -1) {
        fprintf(stderr, "Error: Failed to seek to size headers: %s\n", strerror(errno));
        return 1;
    }

    // Read sizes
    uint64_t compressed_size, uncompressed_size;
    if (read(self_fd, &compressed_size, sizeof(compressed_size)) != sizeof(compressed_size)) {
        fprintf(stderr, "Error: Failed to read compressed size\n");
        return 1;
    }
    if (read(self_fd, &uncompressed_size, sizeof(uncompressed_size)) != sizeof(uncompressed_size)) {
        fprintf(stderr, "Error: Failed to read uncompressed size\n");
        return 1;
    }

    // Skip cache key (16 bytes)
    char cache_key_from_binary[17];
    if (read(self_fd, cache_key_from_binary, 16) != 16) {
        fprintf(stderr, "Error: Failed to read cache key\n");
        return 1;
    }
    cache_key_from_binary[16] = '\0';

    // Validate sizes (limit to 100MB to prevent memory exhaustion)
    const size_t max_size = 100 * 1024 * 1024;
    if (compressed_size == 0 || uncompressed_size == 0 ||
        compressed_size > max_size || uncompressed_size > max_size) {
        fprintf(stderr, "Error: Invalid compressed/uncompressed sizes (max 100MB)\n");
        return 1;
    }

    // Allocate buffers
    compressed_data = malloc(compressed_size);
    decompressed_data = malloc(uncompressed_size);
    if (!compressed_data || !decompressed_data) {
        fprintf(stderr, "Error: Failed to allocate memory\n");
        goto cleanup;
    }

    // Read compressed data
    ssize_t total_read = 0;
    while (total_read < (ssize_t)compressed_size) {
        ssize_t n = read(self_fd, compressed_data + total_read, compressed_size - total_read);
        if (n <= 0) {
            fprintf(stderr, "Error: Failed to read compressed data\n");
            goto cleanup;
        }
        total_read += n;
    }

    // Calculate cache key from compressed data
    if (dlx_calculate_cache_key(compressed_data, compressed_size, cache_key) != 0) {
        fprintf(stderr, "Error: Failed to calculate cache key\n");
        goto cleanup;
    }

    // Validate cache key is exactly 16 hex characters (defense in depth against path traversal)
    if (strlen(cache_key) != 16) {
        fprintf(stderr, "Error: Cache key must be exactly 16 characters\n");
        goto cleanup;
    }

    for (int i = 0; i < 16; i++) {
        char c = cache_key[i];
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))) {
            fprintf(stderr, "Error: Invalid cache key format (must be hex)\n");
            goto cleanup;
        }
    }

    // Check if already cached
    if (dlx_get_cached_binary_path(cache_key, uncompressed_size, output_path, sizeof(output_path)) == 0) {
        // Already cached - execute directly
        free(compressed_data);
        free(decompressed_data);

        // Close self_fd before execve to prevent inheriting the file descriptor
        close(self_fd);

        // Forward all command line arguments
        argv[0] = output_path;
        execve(output_path, argv, envp);

        fprintf(stderr, "Error: Failed to execute cached binary: %s\n", strerror(errno));
        return 1;
    }

    // Decompress
    size_t decompressed_bytes = compression_decode_buffer(
        decompressed_data, uncompressed_size,
        compressed_data, compressed_size,
        NULL, // scratch buffer (optional)
        COMPRESSION_LZFSE
    );

    if (decompressed_bytes != uncompressed_size) {
        fprintf(stderr, "Error: Decompression failed\n");
        goto cleanup;
    }

    // Free compressed data (no longer needed)
    free(compressed_data);
    compressed_data = NULL;

    // Write to cache
    // Note: We don't have the original exe_path, checksum, or compression_algorithm since
    // the stub handles decompression directly. Pass NULL/empty values for metadata.
    if (dlx_write_to_cache(cache_key, decompressed_data, uncompressed_size, compressed_size,
                           exe_path, "", "lzfse") != 0) {
        fprintf(stderr, "Error: Failed to write to cache\n");
        goto cleanup;
    }

    // Get the actual cached path that was written
    const char *home = getenv("HOME");
    int written = snprintf(output_path, sizeof(output_path), "%s/.socket/_dlx/%s/node-smol-%s-%s",
                          home ? home : "/tmp",
                          cache_key,
                          dlx_get_platform(),
                          dlx_get_arch());
    if (written < 0 || (size_t)written >= sizeof(output_path)) {
        fprintf(stderr, "Error: Cache path too long\n");
        goto cleanup;
    }

    // Free decompressed data (written to disk)
    free(decompressed_data);
    decompressed_data = NULL;

    // Close self_fd before execve to prevent inheriting the file descriptor
    close(self_fd);

    // Execute cached binary with forwarded arguments
    argv[0] = output_path;
    execve(output_path, argv, envp);

    // If we get here, exec failed
    fprintf(stderr, "Error: Failed to execute binary: %s\n", strerror(errno));
    fflush(stderr);  // Ensure error message is printed before _exit
    // Use _exit to avoid cleanup that would double-free already-freed memory
    _exit(1);

cleanup:
    if (compressed_data) free(compressed_data);
    if (decompressed_data) free(decompressed_data);
    return exit_code;
}

int main(int argc, char *argv[], char *envp[]) {
    char exe_path[1024];
    int self_fd = -1;
    int exit_code = 1;

    // Get path to current executable
    if (get_executable_path(exe_path, sizeof(exe_path)) != 0) {
        return 1;
    }

    // Open self for reading with O_CLOEXEC to prevent fd leak
    self_fd = open(exe_path, O_RDONLY | O_CLOEXEC);
    if (self_fd == -1) {
        fprintf(stderr, "Error: Failed to open self: %s\n", strerror(errno));
        return 1;
    }

    // Extract and execute with forwarded arguments
    exit_code = extract_and_execute(self_fd, exe_path, argc, argv, envp);

    close(self_fd);
    return exit_code;
}
