/**
 * macOS Mach-O Minimal Self-Extracting Stub (Shared Code Version)
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
 *   [1-byte: has_smol_config flag (0=no, 1=yes)]
 *   [1176-byte: smol config binary (if has_smol_config=1)]
 *     - Magic: 0x534D4647 ("SMFG")
 *     - Version: 1
 *     - Config data: update config + fakeArgvEnv
 *   [Compressed data]
 *
 * At runtime:
 *   1. Finds compressed data using shared marker_finder.h
 *   2. Decompresses inline using Apple Compression framework
 *   3. Writes to cache using shared dlx_cache_common.h
 *   4. Reads embedded update config (if present)
 *   5. Checks for updates (if configured)
 *   6. Executes decompressed binary
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

#include "socketsecurity/bin-infra/compression_constants.h"
#include "socketsecurity/bin-infra/decompressor_limits.h"
#include "socketsecurity/bin-infra/marker_finder.h"
#include "socketsecurity/build-infra/dlx_cache_common.h"
#include "socketsecurity/bin-infra/smol_segment_reader.h"
#include "socketsecurity/build-infra/debug_common.h"
#include "socketsecurity/bin-stubs/update_integration.h"

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
static int extract_and_execute(int self_fd, const char *exe_path, int argc, char *argv[], char *envp[],
                                update_config_t *update_config) {
    int exit_code = 1;
    unsigned char *compressed_data = NULL;
    unsigned char *decompressed_data = NULL;
    char cache_key[33] = {0};
    char output_path[1024];

    // Read SMOL metadata using shared reader.
    smol_metadata_t metadata;
    if (smol_read_metadata(self_fd, &metadata) != 0) {
        return 1;
    }

    // Validate metadata using shared limit constant.
    const size_t max_size = DECOMPRESSOR_MAX_UNCOMPRESSED_SIZE;
    if (smol_validate_metadata(&metadata, max_size) != 0) {
        fprintf(stderr, "Error: Metadata validation failed (max allowed size: %zu bytes)\n", max_size);
        fflush(stderr);
        return 1;
    }

    memcpy(cache_key, metadata.cache_key, 17);

    // Read embedded smol config if present.
    long config_offset = metadata.data_offset - SMOL_CONFIG_BINARY_LEN;
    if (lseek(self_fd, config_offset - SMOL_CONFIG_FLAG_LEN, SEEK_SET) == -1) {
        fprintf(stderr, "Error: Failed to seek to smol config flag\n");
        return 1;
    }

    uint8_t has_smol_config;
    if (read(self_fd, &has_smol_config, SMOL_CONFIG_FLAG_LEN) != SMOL_CONFIG_FLAG_LEN) {
        fprintf(stderr, "Error: Failed to read has_smol_config flag\n");
        return 1;
    }

    if (has_smol_config != 0) {
        uint8_t smol_config_binary[SMOL_CONFIG_BINARY_LEN];
        if (read(self_fd, smol_config_binary, SMOL_CONFIG_BINARY_LEN) != SMOL_CONFIG_BINARY_LEN) {
            fprintf(stderr, "Error: Failed to read smol config binary\n");
            return 1;
        }

        if (update_config_from_binary(update_config, smol_config_binary, SMOL_CONFIG_BINARY_LEN) == 0) {
            // Set the fake_argv_env variable if configured.
            if (update_config->fake_argv_env[0] != '\0') {
                // Tell bootstrap which variable name to check.
                setenv("SMOL_FAKE_ARGV_NAME", update_config->fake_argv_env, 1);

                // Check if already set by user (don't override).
                if (getenv(update_config->fake_argv_env) == NULL) {
                    // Not set, so we use auto-detection (set to empty to let bootstrap decide).
                    setenv(update_config->fake_argv_env, "", 0);
                }
            }
        }
    }

    // Seek to compressed data start.
    // The smol config reading may have left the file descriptor at the wrong position
    // (data_offset if config was present, data_offset - 1176 if not).
    if (lseek(self_fd, metadata.data_offset, SEEK_SET) == -1) {
        fprintf(stderr, "Error: Failed to seek to compressed data: %s\n", strerror(errno));
        return 1;
    }

    // Pass stub location and cache key to node-smol via environment variables.
    // These are read during bootstrap and immediately deleted.
    setenv("SMOL_STUB_PATH", exe_path, 1);
    setenv("SMOL_CACHE_KEY", cache_key, 1);

    // Extract sizes for local use.
    uint64_t compressed_size = metadata.compressed_size;
    uint64_t uncompressed_size = metadata.uncompressed_size;
    unsigned char *platform_metadata = metadata.platform_metadata;

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

    // Check if already cached.
    if (dlx_get_cached_binary_path(cache_key, uncompressed_size, output_path, sizeof(output_path)) == 0) {
        // Already cached - execute directly.
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
        execve(output_path, argv, envp);

        fprintf(stderr, "Error: Failed to execute cached binary: %s\n", strerror(errno));
        return 1;
    }

    // Decompress using LZFSE via Apple Compression framework
    size_t decompressed_bytes = compression_decode_buffer(
        decompressed_data, uncompressed_size,
        compressed_data, compressed_size,
        NULL, // scratch buffer (optional)
        COMPRESSION_LZFSE
    );

    if (decompressed_bytes != uncompressed_size) {
        fprintf(stderr, "Error: Decompression failed (got %zu bytes, expected %llu bytes)\n",
                decompressed_bytes, (unsigned long long)uncompressed_size);
        fprintf(stderr, "Compressed size: %llu bytes\n", (unsigned long long)compressed_size);
        goto cleanup;
    }

    free(compressed_data);
    compressed_data = NULL;

    // Calculate integrity hash of decompressed data.
    char integrity[128];
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
    if (dlx_write_to_cache(cache_key, decompressed_data, uncompressed_size,
                           exe_path, integrity, &update_check) != 0) {
        fprintf(stderr, "Error: Failed to write to cache\n");
        goto cleanup;
    }

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

    // Free decompressed data (written to disk).
    free(decompressed_data);
    decompressed_data = NULL;

    // Check for updates before executing (if enabled).
    stub_check_for_updates(update_config, base_dir, cache_key, UPDATE_CONFIG_DEFAULT_PATTERN, exe_path);

    // Filter out --update-config arguments before passing to child process.
    stub_filter_update_args(&argc, argv);

    // Close self_fd before execve to prevent inheriting the file descriptor.
    close(self_fd);

    // Execute cached binary with forwarded arguments.
    argv[0] = output_path;
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
    DEBUG_INIT("smol:stub");
    char exe_path[1024];
    int self_fd = -1;
    int exit_code = 1;

    // Initialize update configuration.
    update_config_t update_config;
    update_config_init(&update_config);

    // Get path to current executable.
    if (get_executable_path(exe_path, sizeof(exe_path)) != 0) {
        return 1;
    }

    // Open self for reading with O_CLOEXEC to prevent fd leak.
    self_fd = open(exe_path, O_RDONLY | O_CLOEXEC);
    if (self_fd == -1) {
        fprintf(stderr, "Error: Failed to open self: %s\n", strerror(errno));
        return 1;
    }

    // Extract and execute with forwarded arguments.
    exit_code = extract_and_execute(self_fd, exe_path, argc, argv, envp, &update_config);

    close(self_fd);
    return exit_code;
}
