/**
 * Linux ELF Binary Decompressor
 *
 * Self-extracting decompressor for compressed ELF binaries.
 * This decompressor is prepended to compressed data to create a self-extracting binary.
 *
 * Cache Strategy (follows socket-lib dlxBinary):
 *   This implementation follows the exact caching strategy used by socket-lib's dlxBinary.
 *   Reference: https://github.com/SocketDev/socket-lib/blob/v4.4.0/src/dlx-binary.ts#L300
 *
 *   Cache structure: ~/.socket/_dlx/<cache_key>/<binary_name>
 *   - cache_key: First 16 hex chars of SHA-512 hash (generateCacheKey behavior)
 *   - binary_name: node (or node.exe on Windows)
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
#include "binflate_common.h"
#include "compression_constants.h"
#include "marker_finder.h"
#include "tmpdir_common.h"

/* find_compressed_data_offset removed - using find_marker from marker_finder.h */

/**
 * Create temp file in preferred tmpfs location and return file descriptor.
 * Uses Node.js os.tmpdir() compatible temp directory selection.
 * Reference: https://github.com/nodejs/node/blob/v24.12.0/src/node_os.cc#L239-L260
 *
 * Priority order (Node.js v24.12.0 compatible):
 *   1. TMPDIR/TMP/TEMP environment variables (via get_tmpdir_nodejs)
 *   2. /dev/shm (tmpfs, faster than /tmp)
 *   3. /tmp (POSIX standard fallback)
 */
static int create_temp_file(char *template_path) {
    // Try directories in order: env vars (TMPDIR→TMP→TEMP), /dev/shm, /tmp.
    const char *temp_dirs[] = {
        get_tmpdir_nodejs("/dev/shm"),
        "/dev/shm",
        "/tmp"
    };

    for (size_t i = 0; i < sizeof(temp_dirs) / sizeof(temp_dirs[0]); i++) {
        // Skip duplicates (e.g., if TMPDIR is already /dev/shm).
        if (i > 0 && strcmp(temp_dirs[i], temp_dirs[0]) == 0) {
            continue;
        }

        snprintf(template_path, 512, "%s/socketsecurity-node-XXXXXX", temp_dirs[i]);

        int fd = mkstemp(template_path);
        if (fd != -1) {
            // Make executable.
            if (fchmod(fd, 0700) == -1) {
                fprintf(stderr, "Error: Failed to make temp file executable: %s\n", strerror(errno));
                close(fd);
                unlink(template_path);
                continue;
            }
            return fd;
        }
    }

    fprintf(stderr, "Error: Failed to create temp file in TMPDIR/TMP/TEMP, /dev/shm or /tmp: %s\n", strerror(errno));
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

    // Try multiple methods to open ourselves:
    // 1. SOCKET_SMOL_STUB_PATH env var (for restricted environments without /proc)
    // 2. /proc/self/exe directly (works in most containers)
    // 3. Fail with helpful error
    const char *stub_path = getenv("SOCKET_SMOL_STUB_PATH");
    if (stub_path && stub_path[0] != '\0') {
        source_fd = open(stub_path, O_RDONLY);
        if (source_fd != -1) {
            strncpy(exe_path, stub_path, sizeof(exe_path) - 1);
            exe_path[sizeof(exe_path) - 1] = '\0';
        }
    }

    if (source_fd == -1) {
        // Open /proc/self/exe directly - this is a magic symlink that the kernel handles specially.
        // Unlike readlink + open(path), this works even in containers where the readlink path
        // may not exist in the current filesystem namespace.
        source_fd = open("/proc/self/exe", O_RDONLY);
        if (source_fd != -1) {
            // Get path for cache metadata (best effort - not critical).
            ssize_t path_len = readlink("/proc/self/exe", exe_path, sizeof(exe_path) - 1);
            if (path_len == -1) {
                // Fallback to argv[0] if readlink fails
                strncpy(exe_path, argv[0], sizeof(exe_path) - 1);
                exe_path[sizeof(exe_path) - 1] = '\0';
            } else {
                exe_path[path_len] = '\0';
            }
        }
    }

    if (source_fd == -1) {
        fprintf(stderr, "Error: Failed to open self. Tried:\n");
        fprintf(stderr, "  - SOCKET_SMOL_STUB_PATH env var (not set or invalid)\n");
        fprintf(stderr, "  - /proc/self/exe: %s\n", strerror(errno));
        fprintf(stderr, "Set SOCKET_SMOL_STUB_PATH to the absolute path of this binary.\n");
        goto cleanup;
    }

    // Find compressed data offset using shared marker finder.
    long data_offset = find_marker(source_fd, MAGIC_MARKER_PART1, MAGIC_MARKER_PART2, MAGIC_MARKER_PART3, MAGIC_MARKER_LEN);
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
    if (binflate_calculate_cache_key(compressed_data, compressed_size, cache_key) != 0) {
        fprintf(stderr, "⚠ Failed to calculate cache key\n");
    }

    if (binflate_calculate_sha512_hex(compressed_data, compressed_size, checksum) != 0) {
        fprintf(stderr, "⚠ Failed to calculate checksum\n");
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
            fprintf(stderr, "⚠ Failed to write to cache (will use temp directory)\n");
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
