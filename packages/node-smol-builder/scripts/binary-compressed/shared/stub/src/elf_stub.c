/**
 * Linux ELF Minimal Self-Extracting Stub
 *
 * Ultra-minimal launcher that decompresses embedded data inline without extracting binflate.
 * Uses shared code from bin-infra to minimize duplication.
 *
 * Binary format:
 *   [This stub code (~8-10KB)]
 *   [__SMOL_PRESSED_DATA_MAGIC_MARKER]
 *   [8-byte header: compressed size (uint64_t)]
 *   [8-byte header: uncompressed size (uint64_t)]
 *   [16-byte: cache key (hex string)]
 *   [3-byte: platform metadata (platform, arch, libc)]
 *   [1-byte: has_update_config flag (0=no, 1=yes)]
 *   [1112-byte: update config binary (if has_update_config=1)]
 *     - Magic: 0x55504446 ("UPDF")
 *     - Version: 1
 *     - Config data (validated at build time)
 *   [Compressed data]
 *
 * At runtime:
 *   1. Finds compressed data using shared marker_finder.h
 *   2. Decompresses inline using LZFSE
 *   3. Writes to cache using shared dlx_cache_common.h
 *   4. Reads embedded update config (if present)
 *   5. Checks for updates (if configured)
 *   6. Executes decompressed binary
 */

#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <errno.h>

#ifdef __linux__
#include <elf.h>
#endif

#include "compression_constants.h"
#include "decompressor_limits.h"
#include "marker_finder.h"
#include "ptnote_finder.h"
#include "dlx_cache_common.h"
#include "smol_segment_reader.h"
#include "lzfse.h"
#include "debug.h"
#include "update_integration.h"

/**
 * Get path to current executable
 */
static int get_executable_path(char *buf, size_t size) {
    ssize_t len = readlink("/proc/self/exe", buf, size - 1);
    if (len == -1) {
        fprintf(stderr, "Error: Failed to get executable path: %s\n", strerror(errno));
        return -1;
    }
    buf[len] = '\0';
    return 0;
}

/**
 * Decompress LZFSE data using bundled LZFSE library
 */
static int decompress_lzfse(const unsigned char *compressed_data, size_t compressed_size,
                            unsigned char *decompressed_data, size_t uncompressed_size) {
    // Allocate scratch buffer on heap with explicit error checking
    size_t scratch_size = lzfse_decode_scratch_size();
    DEBUG_LOG("[STUB LZFSE] Starting decompression\n");
    DEBUG_LOG("[STUB LZFSE]   LZFSE scratch buffer size: %zu bytes\n", scratch_size);
    DEBUG_LOG("[STUB LZFSE]   compressed_data=%p size=%zu\n", (void*)compressed_data, compressed_size);
    DEBUG_LOG("[STUB LZFSE]   decompressed_data=%p size=%zu\n", (void*)decompressed_data, uncompressed_size);

    // Show first 32 bytes of compressed data (debug only)
    if (_debug_enabled) {
        DEBUG_LOG("[STUB LZFSE]   First 32 bytes of compressed data: ");
        for (size_t i = 0; i < 32 && i < compressed_size; i++) {
            fprintf(stderr, "%02x ", compressed_data[i]);
        }
        fprintf(stderr, "\n");
    }

    unsigned char *scratch_buffer = malloc(scratch_size);
    if (!scratch_buffer) {
        fprintf(stderr, "[STUB LZFSE] ERROR: Failed to allocate %zu bytes for LZFSE scratch buffer\n", scratch_size);
        return -1;
    }
    DEBUG_LOG("[STUB LZFSE]   Allocated scratch_buffer=%p\n", (void*)scratch_buffer);

    DEBUG_LOG("[STUB LZFSE]   Calling lzfse_decode_buffer...\n");
    size_t decompressed_bytes = lzfse_decode_buffer(
        decompressed_data, uncompressed_size,
        compressed_data, compressed_size,
        scratch_buffer
    );

    DEBUG_LOG("[STUB LZFSE]   lzfse_decode_buffer returned: %zu bytes\n", decompressed_bytes);
    free(scratch_buffer);

    if (decompressed_bytes == 0 || decompressed_bytes != uncompressed_size) {
        fprintf(stderr, "[STUB LZFSE] ERROR: LZFSE decompression failed (got %zu, expected %zu)\n",
                decompressed_bytes, uncompressed_size);
        return -1;
    }

    // Show first 32 bytes of decompressed data (debug only)
    if (_debug_enabled) {
        DEBUG_LOG("[STUB LZFSE]   First 32 bytes of decompressed data: ");
        for (size_t i = 0; i < 32 && i < decompressed_bytes; i++) {
            fprintf(stderr, "%02x ", decompressed_data[i]);
        }
        fprintf(stderr, "\n");
    }

    DEBUG_LOG("[STUB LZFSE] SUCCESS: Decompressed %zu -> %zu bytes\n", compressed_size, decompressed_bytes);
    return 0;
}

/**
 * Extract and execute compressed binary
 */
static int extract_and_execute(int self_fd, const char *exe_path, int argc, char *argv[], char *envp[],
                                const update_config_t *update_config) {
    int exit_code = 1;
    unsigned char *compressed_data = NULL;
    unsigned char *decompressed_data = NULL;
    char cache_key[33] = {0};
    char output_path[1024];

    // Read SMOL metadata.
    // For ELF binaries (Linux), PT_NOTE search is REQUIRED.
    // Direct marker embedding does not work for ELF binaries.
    DEBUG_LOG("Searching for compressed data marker...\n");
    smol_metadata_t metadata;

#ifdef __linux__
    // Use PT_NOTE-aware search on Linux (required for ELF binaries)
    long marker_pos = find_marker_in_ptnote(self_fd, MAGIC_MARKER_PART1, MAGIC_MARKER_PART2, MAGIC_MARKER_PART3, 0);
    if (marker_pos < 0) {
        fprintf(stderr, "Error: Could not find compressed data marker in PT_NOTE segments\n");
        return 1;
    }
    DEBUG_LOG("Found marker in PT_NOTE segment at offset %ld\n", marker_pos);

    // Seek past the marker to the metadata
    if (lseek(self_fd, marker_pos + 32, SEEK_SET) == -1) {
        fprintf(stderr, "Error: Failed to seek to metadata after PT_NOTE marker\n");
        return 1;
    }

    // Read metadata manually
    if (read(self_fd, &metadata.compressed_size, 8) != 8 ||
        read(self_fd, &metadata.uncompressed_size, 8) != 8 ||
        read(self_fd, metadata.cache_key, 16) != 16 ||
        read(self_fd, metadata.platform_metadata, 3) != 3) {
        fprintf(stderr, "Error: Failed to read metadata after PT_NOTE marker\n");
        return 1;
    }
    metadata.cache_key[16] = '\0';
    metadata.data_offset = lseek(self_fd, 0, SEEK_CUR);
#else
    // Non-Linux platforms use standard linear search
    if (smol_read_metadata(self_fd, &metadata) != 0) {
        return 1;
    }
#endif

    DEBUG_LOG("Found marker, cache key: %s\n", metadata.cache_key);

    // Validate metadata using shared limit constant.
    const size_t max_size = DECOMPRESSOR_MAX_UNCOMPRESSED_SIZE;
    if (smol_validate_metadata(&metadata, max_size) != 0) {
        fprintf(stderr, "Error: Metadata validation failed (max allowed size: %zu bytes)\n", max_size);
        fflush(stderr);
        return 1;
    }

    // Copy cache key to local variable for compatibility.
    memcpy(cache_key, metadata.cache_key, 17);

    // Extract sizes and platform metadata for local use.
    uint64_t compressed_size = metadata.compressed_size;
    uint64_t uncompressed_size = metadata.uncompressed_size;
    unsigned char *platform_metadata = metadata.platform_metadata;

    DEBUG_LOG("Sizes: compressed=%lu, uncompressed=%lu\n",
              (unsigned long)compressed_size, (unsigned long)uncompressed_size);

    // Allocate buffers
    DEBUG_LOG("Allocating buffers...\n");
    compressed_data = malloc(compressed_size);
    decompressed_data = malloc(uncompressed_size);
    if (!compressed_data || !decompressed_data) {
        fprintf(stderr, "Error: Failed to allocate memory\n");
        goto cleanup;
    }

    // Read compressed data
    DEBUG_LOG("Reading compressed data...\n");
    ssize_t total_read = 0;
    while (total_read < (ssize_t)compressed_size) {
        ssize_t n = read(self_fd, compressed_data + total_read, compressed_size - total_read);
        if (n <= 0) {
            fprintf(stderr, "Error: Failed to read compressed data\n");
            goto cleanup;
        }
        total_read += n;
    }
    DEBUG_LOG("Read %zd bytes of compressed data\n", total_read);

    // Check if already cached.
    DEBUG_LOG("Checking cache...\n");
    if (dlx_get_cached_binary_path(cache_key, uncompressed_size, output_path, sizeof(output_path)) == 0) {
        // Already cached - execute directly.
        DEBUG_LOG("Cache hit! Executing from: %s\n", output_path);
        free(compressed_data);
        free(decompressed_data);

        // Check for updates before executing (if enabled).
        char base_dir[512];
        if (dlx_get_cache_base_dir(base_dir, sizeof(base_dir)) == 0) {
            stub_check_for_updates(update_config, base_dir, cache_key, UPDATE_CONFIG_DEFAULT_PATTERN, exe_path);
        }

        // Filter out --update-config arguments before passing to child process.
        stub_filter_update_args(&argc, argv);

        // Close self_fd before execve to prevent inheriting the file descriptor.
        close(self_fd);

        // Forward all command line arguments.
        argv[0] = output_path;
        DEBUG_LOG("Calling execve()...\n");
        execve(output_path, argv, envp);

        fprintf(stderr, "Error: Failed to execute cached binary: %s\n", strerror(errno));
        return 1;
    }
    DEBUG_LOG("Cache miss, decompressing...\n");

    // Decompress using LZFSE (universal compression algorithm)
    DEBUG_LOG("Starting LZFSE decompression...\n");
    if (decompress_lzfse(compressed_data, compressed_size, decompressed_data, uncompressed_size) != 0) {
        fprintf(stderr, "Error: LZFSE decompression failed\n");
        goto cleanup;
    }
    DEBUG_LOG("Decompression complete\n");

    // Free compressed data (no longer needed).
    free(compressed_data);
    compressed_data = NULL;

    // Calculate integrity hash of decompressed data.
    char integrity[128];
    DEBUG_LOG("Calculating integrity hash...\n");
    if (dlx_calculate_integrity(decompressed_data, uncompressed_size, integrity) != 0) {
        fprintf(stderr, "Error: Failed to calculate integrity hash\n");
        goto cleanup;
    }

    // Create update_check with initial values (not yet checked for updates).
    dlx_update_check_t update_check = {
        .last_check = 0,
        .last_notification = 0,
        .latest_known = "",
    };

    // Write to cache.
    DEBUG_LOG("Writing to cache...\n");
    if (dlx_write_to_cache(cache_key, decompressed_data, uncompressed_size,
                           exe_path, integrity, &update_check) != 0) {
        fprintf(stderr, "Error: Failed to write to cache\n");
        goto cleanup;
    }
    DEBUG_LOG("Cache write complete\n");

    // Get the actual cached path that was written.
    // Respects SOCKET_DLX_DIR and SOCKET_HOME environment variables.
    char base_dir[512];
    if (dlx_get_cache_base_dir(base_dir, sizeof(base_dir)) != 0) {
        fprintf(stderr, "Error: Failed to get cache base directory\n");
        goto cleanup;
    }
    const char *binary_name = (platform_metadata[0] == 2) ? "node.exe" : "node";
    int written = snprintf(output_path, sizeof(output_path), "%s/%s/%s",
                          base_dir,
                          cache_key,
                          binary_name);
    if (written < 0 || (size_t)written >= sizeof(output_path)) {
        fprintf(stderr, "Error: Cache path too long\n");
        goto cleanup;
    }
    DEBUG_LOG("Cached binary path: %s\n", output_path);

    // Free decompressed data (written to disk).
    free(decompressed_data);
    decompressed_data = NULL;

    // Check for updates before executing (if enabled).
    stub_check_for_updates(update_config, base_dir, cache_key, UPDATE_CONFIG_DEFAULT_PATTERN, exe_path);

    // Filter out --update-config arguments before passing to child process.
    stub_filter_update_args(&argc, argv);

    // Close self_fd before execve to prevent inheriting the file descriptor.
    close(self_fd);

    // Forward all command line arguments.
    argv[0] = output_path;
    DEBUG_LOG("Calling execve()...\n");
    execve(output_path, argv, envp);

    // If we get here, exec failed.
    fprintf(stderr, "Error: Failed to execute binary: %s\n", strerror(errno));
    fflush(stderr);  // Ensure error message is printed before _exit.
    // Use _exit to avoid cleanup that would double-free already-freed memory.
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

    // Initialize debug mode from DEBUG environment variable.
    INIT_DEBUG();

    DEBUG_LOG("Starting self-extracting binary\n");

    // Parse update configuration from command line.
    update_config_t update_config;
    update_config_from_argv(&update_config, argc, argv);

    // Try multiple methods to open ourselves:
    // 1. SOCKET_SMOL_STUB_PATH env var (for restricted environments without /proc)
    // 2. /proc/self/exe directly (works in most containers)
    // 3. Fail with helpful error
    const char *stub_path = getenv("SOCKET_SMOL_STUB_PATH");
    if (stub_path && stub_path[0] != '\0') {
        DEBUG_LOG("Using SOCKET_SMOL_STUB_PATH: %s\n", stub_path);
        self_fd = open(stub_path, O_RDONLY | O_CLOEXEC);
        if (self_fd != -1) {
            strncpy(exe_path, stub_path, sizeof(exe_path) - 1);
            exe_path[sizeof(exe_path) - 1] = '\0';
        }
    }

    if (self_fd == -1) {
        // Open /proc/self/exe directly - this is a magic symlink that the kernel handles specially.
        // Unlike readlink + open(path), this works even in containers where the readlink path
        // may not exist in the current filesystem namespace.
        self_fd = open("/proc/self/exe", O_RDONLY | O_CLOEXEC);
        if (self_fd != -1) {
            DEBUG_LOG("Opened /proc/self/exe directly (fd=%d)\n", self_fd);
            // Get the path for cache metadata (best effort - not critical)
            if (get_executable_path(exe_path, sizeof(exe_path)) != 0) {
                // Fallback to argv[0] if readlink fails
                strncpy(exe_path, argv[0], sizeof(exe_path) - 1);
                exe_path[sizeof(exe_path) - 1] = '\0';
            }
        }
    }

    if (self_fd == -1) {
        fprintf(stderr, "Error: Failed to open self. Tried:\n");
        fprintf(stderr, "  - SOCKET_SMOL_STUB_PATH env var (not set or invalid)\n");
        fprintf(stderr, "  - /proc/self/exe: %s\n", strerror(errno));
        fprintf(stderr, "Set SOCKET_SMOL_STUB_PATH to the absolute path of this binary.\n");
        return 1;
    }
    DEBUG_LOG("Executable path (for metadata): %s\n", exe_path);

    // Extract and execute with forwarded arguments.
    exit_code = extract_and_execute(self_fd, exe_path, argc, argv, envp, &update_config);

    close(self_fd);
    return exit_code;
}
