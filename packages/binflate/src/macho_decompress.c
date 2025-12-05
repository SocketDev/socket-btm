/**
 * macOS Mach-O Binary Decompressor
 *
 * Self-extracting decompressor for compressed Mach-O binaries.
 * This decompressor is prepended to compressed data to create a self-extracting binary.
 *
 * Binary format:
 *   [Decompressor code]
 *   [8-byte header: compressed size (uint64_t)]
 *   [8-byte header: uncompressed size (uint64_t)]
 *   [Compressed data]
 *
 * Cache Strategy (follows socket-lib dlxBinary):
 *   This implementation follows the exact caching strategy used by socket-lib's dlxBinary.
 *   Reference: https://github.com/SocketDev/socket-lib/blob/v4.4.0/src/dlx-binary.ts#L300
 *
 *   Cache structure: ~/.socket/_dlx/<cache_key>/<binary_name>
 *   - cache_key: First 16 hex chars of SHA-512 hash (generateCacheKey behavior)
 *   - binary_name: node-smol-{platform}-{arch} (e.g., node-smol-darwin-arm64)
 *   - Metadata: .dlx-metadata.json (unified DlxMetadata schema)
 *
 * At runtime:
 *   1. Reads compressed data from its own binary (after this decompressor)
 *   2. Calculates SHA-512 hash of compressed data
 *   3. Derives cache_key from first 16 hex chars of hash
 *   4. Creates ~/.socket/_dlx/<cache_key>/ recursively if needed
 *   5. Checks if cached version exists at ~/.socket/_dlx/<cache_key>/node-smol-{platform}-{arch}
 *   6. If cached and valid (correct size + executable), executes from cache
 *   7. If cache miss, decompresses to cache with metadata and executes
 *   8. If cache unavailable (permissions, read-only fs), falls back to temp directory
 *   9. If both cache and temp fail, exits with clear error message
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <sys/mman.h>
#include <errno.h>
#include <compression.h>
#include <mach-o/dyld.h>

#include "dlx_cache_common.h"
#include "compression_constants.h"

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
 * Find magic marker in file and return offset to compressed data
 */
static long find_compressed_data_offset(int fd) {
    // Build the magic marker at runtime to avoid it appearing in the binary
    char magic_marker[MAGIC_MARKER_LEN + 1];
    snprintf(magic_marker, sizeof(magic_marker), "%s%s%s", MAGIC_MARKER_PART1, MAGIC_MARKER_PART2, MAGIC_MARKER_PART3);

    char buffer[4096];
    long offset = 0;
    ssize_t bytes_read;

    while ((bytes_read = read(fd, buffer, sizeof(buffer))) > 0) {
        for (ssize_t i = 0; i < bytes_read - MAGIC_MARKER_LEN; i++) {
            if (memcmp(buffer + i, magic_marker, MAGIC_MARKER_LEN) == 0) {
                // Found marker - return offset just after it
                return offset + i + MAGIC_MARKER_LEN;
            }
        }
        offset += bytes_read;

        // Rewind a bit to handle marker split across buffer boundary
        if (lseek(fd, offset - MAGIC_MARKER_LEN, SEEK_SET) == -1) {
            return -1;
        }
        offset -= MAGIC_MARKER_LEN;
    }

    return -1; // Not found
}

int main(int argc, char *argv[], char *envp[]) {
    (void)argc; // Unused parameter
    int exit_code = 1;
    char exe_path[1024];
    char cached_path[1024];
    char cache_key[17] = {0}; // 16 hex chars + null terminator
    char checksum[SHA512_DIGEST_LEN * 2 + 1] = {0}; // Full SHA-512 hex
    int source_fd = -1;
    unsigned char *compressed_data = NULL;
    unsigned char *decompressed_data = NULL;

    // Get path to current executable.
    if (get_executable_path(exe_path, sizeof(exe_path)) != 0) {
        goto cleanup;
    }

    // Open self for reading.
    source_fd = open(exe_path, O_RDONLY);
    if (source_fd == -1) {
        fprintf(stderr, "Error: Failed to open self: %s\n", strerror(errno));
        goto cleanup;
    }

    // Find compressed data offset.
    long data_offset = find_compressed_data_offset(source_fd);
    if (data_offset == -1) {
        fprintf(stderr, "Error: Could not find compressed data marker in binary\n");
        goto cleanup;
    }

    // Seek to compressed data.
    if (lseek(source_fd, data_offset, SEEK_SET) == -1) {
        fprintf(stderr, "Error: Failed to seek to compressed data: %s\n", strerror(errno));
        goto cleanup;
    }

    // Read sizes.
    uint64_t compressed_size, uncompressed_size;
    if (read(source_fd, &compressed_size, sizeof(compressed_size)) != sizeof(compressed_size)) {
        fprintf(stderr, "Error: Failed to read compressed size\n");
        goto cleanup;
    }
    if (read(source_fd, &uncompressed_size, sizeof(uncompressed_size)) != sizeof(uncompressed_size)) {
        fprintf(stderr, "Error: Failed to read uncompressed size\n");
        goto cleanup;
    }

    // Validate sizes.
    if (compressed_size == 0 || uncompressed_size == 0 ||
        compressed_size > 500 * 1024 * 1024 || uncompressed_size > 500 * 1024 * 1024) {
        fprintf(stderr, "Error: Invalid compressed/uncompressed sizes\n");
        goto cleanup;
    }

    // Allocate buffers.
    compressed_data = malloc(compressed_size);
    decompressed_data = malloc(uncompressed_size);
    if (!compressed_data || !decompressed_data) {
        fprintf(stderr, "Error: Failed to allocate memory\n");
        goto cleanup;
    }

    // Read compressed data.
    ssize_t total_read = 0;
    while (total_read < (ssize_t)compressed_size) {
        ssize_t n = read(source_fd, compressed_data + total_read, compressed_size - total_read);
        if (n <= 0) {
            fprintf(stderr, "Error: Failed to read compressed data\n");
            goto cleanup;
        }
        total_read += n;
    }

    // Calculate cache key and checksum from compressed data.
    if (dlx_calculate_cache_key(compressed_data, compressed_size, cache_key) != 0) {
        fprintf(stderr, "Warning: Failed to calculate cache key\n");
    }

    if (dlx_calculate_sha512_hex(compressed_data, compressed_size, checksum) != 0) {
        fprintf(stderr, "Warning: Failed to calculate checksum\n");
    }

    // Check if cached version exists.
    int cache_hit = 0;
    if (cache_key[0] != '\0' &&
        dlx_get_cached_binary_path(cache_key, uncompressed_size, cached_path, sizeof(cached_path)) == 0) {
        cache_hit = 1;
    }

    if (cache_hit) {
        // Execute from cache.
        close(source_fd);
        source_fd = -1;
        free(compressed_data);
        compressed_data = NULL;
        free(decompressed_data);
        decompressed_data = NULL;

        execve(cached_path, argv, envp);

        // If we get here, exec failed.
        fprintf(stderr, "Error: Failed to execute cached binary: %s\n", strerror(errno));
        return 1;
    }

    // Cache miss - decompress.
    size_t decompressed_bytes = compression_decode_buffer(
        decompressed_data, uncompressed_size,
        compressed_data, compressed_size,
        NULL, // scratch buffer (optional)
        COMPRESSION_LZFSE
    );

    if (decompressed_bytes != uncompressed_size) {
        fprintf(stderr, "Error: Decompression failed (got %zu bytes, expected %llu)\n",
                decompressed_bytes, uncompressed_size);
        goto cleanup;
    }

    // Free compressed data (no longer needed).
    free(compressed_data);
    compressed_data = NULL;

    // Try to write to cache.
    int cache_written = 0;
    if (cache_key[0] != '\0' && checksum[0] != '\0') {
        if (dlx_write_to_cache(cache_key, decompressed_data, uncompressed_size,
                               compressed_size, exe_path, checksum, "lzfse") == 0) {
            cache_written = 1;

            // Execute from cache.
            close(source_fd);
            source_fd = -1;
            free(decompressed_data);
            decompressed_data = NULL;

            if (dlx_get_cached_binary_path(cache_key, uncompressed_size,
                                           cached_path, sizeof(cached_path)) == 0) {
                execve(cached_path, argv, envp);
            }

            // If we get here, exec failed.
            fprintf(stderr, "Error: Failed to execute cached binary: %s\n", strerror(errno));
            return 1;
        } else {
            fprintf(stderr, "Warning: Failed to write to cache (will use temp directory)\n");
        }
    }

    // Fallback - write to temp and execute
    if (!cache_written) {
        char temp_path[512];
        const char *tmpdir = getenv("TMPDIR");
        if (!tmpdir || strlen(tmpdir) == 0) {
            tmpdir = "/tmp";
        }
        snprintf(temp_path, sizeof(temp_path), "%s/socketsecurity-node-XXXXXX", tmpdir);

        int temp_fd = mkstemp(temp_path);
        if (temp_fd == -1) {
            fprintf(stderr, "Error: Failed to create temp file: %s\n", strerror(errno));
            fprintf(stderr, "Error: Cannot execute - cache unavailable and temp directory failed\n");
            goto cleanup;
        }

        if (fchmod(temp_fd, 0700) == -1) {
            fprintf(stderr, "Error: Failed to make temp file executable: %s\n", strerror(errno));
            close(temp_fd);
            unlink(temp_path);
            goto cleanup;
        }

        ssize_t total_written = 0;
        while (total_written < (ssize_t)uncompressed_size) {
            ssize_t n = write(temp_fd, decompressed_data + total_written,
                             uncompressed_size - total_written);
            if (n <= 0) {
                fprintf(stderr, "Error: Failed to write temp file: %s\n", strerror(errno));
                close(temp_fd);
                unlink(temp_path);
                goto cleanup;
            }
            total_written += n;
        }

        close(temp_fd);
        close(source_fd);
        source_fd = -1;
        free(decompressed_data);
        decompressed_data = NULL;

        execve(temp_path, argv, envp);

        // If we get here, exec failed
        fprintf(stderr, "Error: Failed to execute temp binary: %s\n", strerror(errno));
        unlink(temp_path);
        return 1;
    }

cleanup:
    if (source_fd != -1) close(source_fd);
    if (compressed_data) free(compressed_data);
    if (decompressed_data) free(decompressed_data);
    return exit_code;
}
