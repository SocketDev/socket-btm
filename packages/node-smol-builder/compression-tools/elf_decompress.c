/**
 * Linux ELF Binary Decompressor
 *
 * Self-extracting decompressor for compressed ELF binaries.
 * This decompressor is prepended to compressed data to create a self-extracting binary.
 *
 * Cache Strategy (follows socket-lib dlxBinary):
 *   This implementation follows the exact caching strategy used by socket-lib's dlxBinary.
 *   Reference: https://github.com/SocketDev/socket-lib/blob/v4.3.0/src/dlx-binary.ts#L300
 *
 *   Cache structure: ~/.socket/_dlx/<cache_key>/<binary_name>
 *   - cache_key: First 16 hex chars of SHA-512 hash (generateCacheKey behavior)
 *   - binary_name: node-smol-{platform}-{arch} (e.g., node-smol-linux-x64)
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
#include <errno.h>
#include <lzma.h>

#include "dlx_cache_common.h"

// Marker to find the start of compressed data in the binary
// Split into two parts to avoid this string appearing in the decompressor binary itself
#define MAGIC_MARKER_PART1 "SOCKETBIN_COMPRESSED_DATA_START"
#define MAGIC_MARKER_PART2 "_MAGIC_MARKER"
#define MAGIC_MARKER_LEN 44

/**
 * Find magic marker in file and return offset to compressed data
 */
static long find_compressed_data_offset(int fd) {
    // Build the magic marker at runtime to avoid it appearing in the binary
    char magic_marker[MAGIC_MARKER_LEN + 1];
    snprintf(magic_marker, sizeof(magic_marker), "%s%s", MAGIC_MARKER_PART1, MAGIC_MARKER_PART2);

    char buffer[4096];
    long offset = 0;
    ssize_t bytes_read;

    // Reset file pointer to beginning
    lseek(fd, 0, SEEK_SET);

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

/**
 * Create temp file in preferred tmpfs location and return file descriptor
 */
static int create_temp_file(char *template_path) {
    // Try /dev/shm first (tmpfs, faster), then fall back to /tmp
    const char *temp_dirs[] = {"/dev/shm", "/tmp"};

    for (size_t i = 0; i < sizeof(temp_dirs) / sizeof(temp_dirs[0]); i++) {
        snprintf(template_path, 512, "%s/socketsecurity-node-XXXXXX", temp_dirs[i]);

        int fd = mkstemp(template_path);
        if (fd != -1) {
            // Make executable
            if (fchmod(fd, 0700) == -1) {
                fprintf(stderr, "Error: Failed to make temp file executable: %s\n", strerror(errno));
                close(fd);
                unlink(template_path);
                continue;
            }
            return fd;
        }
    }

    fprintf(stderr, "Error: Failed to create temp file in /dev/shm or /tmp: %s\n", strerror(errno));
    return -1;
}

/**
 * Decompress LZMA data
 */
static int decompress_lzma(const unsigned char *compressed_data, size_t compressed_size,
                           unsigned char *decompressed_data, size_t uncompressed_size) {
    lzma_stream strm = LZMA_STREAM_INIT;

    // Initialize decoder
    lzma_ret ret = lzma_stream_decoder(&strm, UINT64_MAX, LZMA_CONCATENATED);
    if (ret != LZMA_OK) {
        fprintf(stderr, "Error: Failed to initialize LZMA decoder: %d\n", ret);
        return -1;
    }

    // Set up buffers
    strm.next_in = compressed_data;
    strm.avail_in = compressed_size;
    strm.next_out = decompressed_data;
    strm.avail_out = uncompressed_size;

    // Decompress
    ret = lzma_code(&strm, LZMA_FINISH);

    lzma_end(&strm);

    if (ret != LZMA_STREAM_END) {
        fprintf(stderr, "Error: LZMA decompression failed: %d\n", ret);
        return -1;
    }

    size_t decompressed_bytes = uncompressed_size - strm.avail_out;
    if (decompressed_bytes != uncompressed_size) {
        fprintf(stderr, "Error: Decompressed size mismatch (got %zu, expected %zu)\n",
                decompressed_bytes, uncompressed_size);
        return -1;
    }

    return 0;
}

int main(int argc, char *argv[], char *envp[]) {
    (void)argc; // Unused parameter
    int exit_code = 1;
    char exe_path[1024];
    char temp_path[512] = {0};
    int source_fd = -1;
    int dest_fd = -1;
    unsigned char *compressed_data = NULL;
    unsigned char *decompressed_data = NULL;
    char cache_key[17] = {0};
    char checksum[129] = {0};
    char cached_path[1024] = {0};
    int cache_hit = 0;

    // Get path to current executable.
    ssize_t path_len = readlink("/proc/self/exe", exe_path, sizeof(exe_path) - 1);
    if (path_len == -1) {
        fprintf(stderr, "Error: Failed to get executable path: %s\n", strerror(errno));
        goto cleanup;
    }
    exe_path[path_len] = '\0';

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
        compressed_size > 500ULL * 1024 * 1024 || uncompressed_size > 500ULL * 1024 * 1024) {
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
            fprintf(stderr, "Error: Failed to read compressed data: %s\n",
                    n == 0 ? "unexpected EOF" : strerror(errno));
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

    // Check if cached binary exists.
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
    if (decompress_lzma(compressed_data, compressed_size,
                       decompressed_data, uncompressed_size) != 0) {
        goto cleanup;
    }

    // Try to write to cache.
    int cache_written = 0;
    if (cache_key[0] != '\0' && checksum[0] != '\0') {
        if (dlx_write_to_cache(cache_key, decompressed_data, uncompressed_size,
                               compressed_size, exe_path, checksum, "lzma") == 0) {
            cache_written = 1;

            // Execute from cache.
            close(source_fd);
            source_fd = -1;

            free(compressed_data);
            compressed_data = NULL;
            free(decompressed_data);
            decompressed_data = NULL;

            if (dlx_get_cached_binary_path(cache_key, uncompressed_size, cached_path, sizeof(cached_path)) == 0) {
                execve(cached_path, argv, envp);
            }

            // If we get here, exec failed.
            fprintf(stderr, "Error: Failed to execute cached binary: %s\n", strerror(errno));
            return 1;
        } else {
            fprintf(stderr, "Warning: Failed to write to cache (will use temp directory)\n");
        }
    }

    // Fallback - write to temp and execute.
    if (!cache_written) {
        dest_fd = create_temp_file(temp_path);
        if (dest_fd == -1) {
            fprintf(stderr, "Error: Cannot execute - cache unavailable and temp directory failed\n");
            goto cleanup;
        }

        // Write decompressed data.
        ssize_t total_written = 0;
        while (total_written < (ssize_t)uncompressed_size) {
            ssize_t n = write(dest_fd, decompressed_data + total_written,
                             uncompressed_size - total_written);
            if (n <= 0) {
                fprintf(stderr, "Error: Failed to write decompressed data: %s\n", strerror(errno));
                goto cleanup;
            }
            total_written += n;
        }

        // Close file descriptors before exec.
        close(source_fd);
        source_fd = -1;
        close(dest_fd);
        dest_fd = -1;

        // Free memory before exec.
        free(compressed_data);
        compressed_data = NULL;
        free(decompressed_data);
        decompressed_data = NULL;

        // Execute decompressed binary with original arguments and environment.
        execve(temp_path, argv, envp);

        // If we get here, exec failed.
        fprintf(stderr, "Error: Failed to execute decompressed binary: %s\n", strerror(errno));
        unlink(temp_path);
        return 1;
    }

cleanup:
    if (source_fd != -1) close(source_fd);
    if (dest_fd != -1) close(dest_fd);
    if (compressed_data) free(compressed_data);
    if (decompressed_data) free(decompressed_data);
    // Clean up temp file if it was created (mkstemp replaces XXXXXX with actual name).
    if (temp_path[0] != '\0' && strstr(temp_path, "XXXXXX") == NULL) {
        unlink(temp_path);
    }
    return exit_code;
}
