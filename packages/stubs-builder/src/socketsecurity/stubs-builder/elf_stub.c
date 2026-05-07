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
 *   [1-byte: algorithm (1=ZSTD)]
 *   [32-byte: integrity hash (SHA-256 of compressed data)]
 *   [1-byte: has_smol_config flag (0=no, 1=yes)]
 *   [1192-byte: smol config binary (if has_smol_config=1)]
 *     - Magic: 0x534D4647 ("SMFG")
 *     - Version: 2
 *     - Config data: update config + fakeArgvEnv + nodeVersion
 *   [Compressed data]
 *
 * At runtime:
 *   1. Finds compressed data using shared marker_finder.h
 *   2. Decompresses inline using ZSTD
 *   3. Writes to cache using shared dlx_cache_common.h
 *   4. Reads embedded update config (if present)
 *   5. Checks for updates (if configured)
 *   6. Executes decompressed binary
 */

#ifdef __GLIBC__
#define _GNU_SOURCE  // Only for glibc-specific extensions
#endif
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

#include "socketsecurity/bin-infra/compression_constants.h"
#include "socketsecurity/bin-infra/decompressor_limits.h"
#include "socketsecurity/bin-infra/marker_finder.h"
#include "socketsecurity/bin-infra/ptnote_finder.h"
#include "socketsecurity/build-infra/dlx_cache_common.h"
#include "socketsecurity/bin-infra/smol_segment_reader.h"
#include "socketsecurity/bin-infra/smol_segment.h"
#include <zstd.h>
#include "socketsecurity/build-infra/debug_common.h"
#include "socketsecurity/build-infra/stdin_redirect.h"
#include "socketsecurity/stubs-builder/update_integration.h"

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
 * Decompress ZSTD data using bundled ZSTD library
 */
static int decompress(const unsigned char *compressed_data, size_t compressed_size,
                      unsigned char *decompressed_data, size_t uncompressed_size) {
    DEBUG_LOG("[STUB ZSTD] Starting decompression\n");
    DEBUG_LOG("[STUB ZSTD]   compressed_data=%p size=%zu\n", (void*)compressed_data, compressed_size);
    DEBUG_LOG("[STUB ZSTD]   decompressed_data=%p size=%zu\n", (void*)decompressed_data, uncompressed_size);

    size_t decompressed_bytes = ZSTD_decompress(
        decompressed_data, uncompressed_size,
        compressed_data, compressed_size
    );

    if (ZSTD_isError(decompressed_bytes)) {
        fprintf(stderr, "[STUB ZSTD] ERROR: ZSTD decompression failed: %s\n",
                ZSTD_getErrorName(decompressed_bytes));
        return -1;
    }

    if (decompressed_bytes != uncompressed_size) {
        fprintf(stderr, "[STUB ZSTD] ERROR: ZSTD decompression size mismatch (got %zu, expected %zu)\n",
                decompressed_bytes, uncompressed_size);
        return -1;
    }

    DEBUG_LOG("[STUB ZSTD] SUCCESS: Decompressed %zu -> %zu bytes\n", compressed_size, decompressed_bytes);
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

    // Read SMOL metadata using optimized ELF PT_NOTE search.
    // This is much faster than scanning the entire file for the magic marker.
    DEBUG_LOG("Searching for compressed data marker...\n");
    smol_metadata_t metadata;
    if (smol_read_metadata_elf(self_fd, &metadata) != 0) {
        fprintf(stderr, "Error: Could not find compressed data marker\n");
        return 1;
    }

    DEBUG_LOG("Found marker, cache key: %s\n", metadata.cache_key);

    // Read embedded smol config if present.
    // The metadata reader skipped it, so we need to seek back and read it manually.
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
            DEBUG_LOG("Loaded embedded smol config\n");

            // Set the fake_argv_env variable if configured.
            if (update_config->fake_argv_env[0] != '\0') {
                // Tell bootstrap which variable name to check.
                setenv("SMOL_FAKE_ARGV_NAME", update_config->fake_argv_env, 1);

                // Check if already set by user (don't override).
                if (getenv(update_config->fake_argv_env) == NULL) {
                    // Not set, so we use auto-detection (set to empty to let bootstrap decide).
                    setenv(update_config->fake_argv_env, "", 0);
                    DEBUG_LOG("Set %s for fake argv control\n", update_config->fake_argv_env);
                }
            }
        } else {
            DEBUG_LOG("Warning: Failed to deserialize smol config binary\n");
        }
    }

    // Seek to compressed data start.
    // The smol config reading may have left the file descriptor at the wrong position
    // (data_offset if config was present, data_offset - 1192 if not).
    if (lseek(self_fd, metadata.data_offset, SEEK_SET) == -1) {
        fprintf(stderr, "Error: Failed to seek to compressed data: %s\n", strerror(errno));
        return 1;
    }

    // Validate metadata using shared limit constant.
    const size_t max_size = DECOMPRESSOR_MAX_UNCOMPRESSED_SIZE;
    if (smol_validate_metadata(&metadata, max_size) != 0) {
        fprintf(stderr, "Error: Metadata validation failed (max allowed size: %zu bytes)\n", max_size);
        fflush(stderr);
        return 1;
    }

    // Copy cache key from metadata BEFORE passing to env (was a bug: setenv
    // happened before memcpy, passing an empty string).
    memcpy(cache_key, metadata.cache_key, 17);

    // Pass stub location and cache key to node-smol via environment variables.
    // These are read during bootstrap and immediately deleted.
    setenv("SMOL_STUB_PATH", exe_path, 1);
    setenv("SMOL_CACHE_KEY", cache_key, 1);

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
        if (n < 0) {
            fprintf(stderr, "Error: Failed to read compressed data: %s\n", strerror(errno));
            goto cleanup;
        }
        if (n == 0) {
            fprintf(stderr, "Error: Unexpected end of file (expected %zu bytes, got %zd)\n",
                    compressed_size, total_read);
            goto cleanup;
        }
        total_read += n;
    }
    DEBUG_LOG("Read %zd bytes of compressed data\n", total_read);

    // Verify integrity of compressed data before any processing.
    DEBUG_LOG("Verifying integrity hash...\n");
    if (smol_verify_integrity(compressed_data, compressed_size, metadata.integrity_hash) != 0) {
        fprintf(stderr, "Error: Compressed data integrity check failed — refusing to execute\n");
        goto cleanup;
    }
    DEBUG_LOG("Integrity verification passed\n");

    // Check if already cached.
    DEBUG_LOG("Checking cache...\n");
    if (dlx_get_cached_binary_path(cache_key, uncompressed_size, output_path, sizeof(output_path)) == 0) {
        // Already cached - execute directly.
        DEBUG_LOG("Cache hit! Executing from: %s\n", output_path);
        free(compressed_data);
        compressed_data = NULL;
        free(decompressed_data);
        decompressed_data = NULL;

        // Check for updates before executing (if enabled).
        char base_dir[512];
        if (dlx_get_cache_base_dir(base_dir, sizeof(base_dir)) == 0) {
            stub_check_for_updates(update_config, base_dir, cache_key, UPDATE_CONFIG_DEFAULT_PATTERN, exe_path);
        }

        // Filter out --update-config arguments before passing to child process.
        stub_filter_update_args(&argc, argv);

        // Close self_fd before execve to prevent inheriting the file descriptor.
        close(self_fd);

        redirect_stdin_if_piped();

        // Forward all command line arguments.
        argv[0] = output_path;
        DEBUG_LOG("Calling execve()...\n");
        execve(output_path, argv, envp);

        fprintf(stderr, "Error: Failed to execute cached binary: %s\n", strerror(errno));
        return 1;
    }
    DEBUG_LOG("Cache miss, decompressing...\n");

    // Decompress using ZSTD
    DEBUG_LOG("Starting ZSTD decompression...\n");
    if (decompress(compressed_data, compressed_size, decompressed_data, uncompressed_size) != 0) {
        fprintf(stderr, "Error: Decompression failed\n");
        fprintf(stderr, "  Compressed size: %llu bytes, expected uncompressed: %llu bytes\n",
                (unsigned long long)compressed_size, (unsigned long long)uncompressed_size);
        /* Check if data starts with SMFG magic (config data instead of compressed data) */
        if (compressed_size >= 4) {
            uint32_t first_word;
            memcpy(&first_word, compressed_data, sizeof(first_word));
            if (first_word == 0x534D4647) {  /* "SMFG" */
                fprintf(stderr, "  Cause: Trying to decompress SMFG config data instead of compressed binary.\n");
                fprintf(stderr, "  This binary may have been created with incompatible tools.\n");
            } else {
                fprintf(stderr, "  Cause: Data does not appear to be ZSTD-compressed (first 4 bytes: 0x%08X)\n", first_word);
            }
        }
        goto cleanup;
    }
    DEBUG_LOG("Decompression complete\n");

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

    // When stdin is not a TTY, redirect to /dev/null to prevent blocking.
    if (!isatty(STDIN_FILENO)) {
        int devnull = open("/dev/null", O_RDONLY);
        if (devnull >= 0) {
            dup2(devnull, STDIN_FILENO);
            close(devnull);
        }
    }

    // Forward all command line arguments.
    argv[0] = output_path;
    DEBUG_LOG("Calling execve()...\n");

    // Retry execve on ETXTBSY — Docker/overlay2 may not have released the write
    // reference even after fsync+close. Brief retries resolve this race condition.
    for (int attempt = 0; attempt < 5; attempt++) {
        execve(output_path, argv, envp);
        if (errno != ETXTBSY || attempt == 4) break;
        usleep(10000 * (attempt + 1));  // 10ms, 20ms, 30ms, 40ms
    }

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
    DEBUG_INIT("smol:stub");

    DEBUG_LOG("Starting self-extracting binary\n");

    // Parse update configuration from command line.
    update_config_t update_config;
    update_config_init(&update_config);

    // Try multiple methods to open ourselves:
    // 1. SMOL_STUB_PATH env var (for restricted environments without /proc)
    // 2. /proc/self/exe directly (works in most containers)
    // 3. Fail with helpful error
    const char *stub_path = getenv("SMOL_STUB_PATH");
    if (stub_path && stub_path[0] != '\0') {
        DEBUG_LOG("Using SMOL_STUB_PATH: %s\n", stub_path);
        self_fd = open(stub_path, O_RDONLY | O_CLOEXEC);
        if (self_fd != -1) {
            snprintf(exe_path, sizeof(exe_path), "%s", stub_path);
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
                snprintf(exe_path, sizeof(exe_path), "%s", argv[0]);
            }
        }
    }

    if (self_fd == -1) {
        fprintf(stderr, "Error: Failed to open self. Tried:\n");
        fprintf(stderr, "  - SMOL_STUB_PATH env var (not set or invalid)\n");
        fprintf(stderr, "  - /proc/self/exe: %s\n", strerror(errno));
        fprintf(stderr, "Set SMOL_STUB_PATH to the absolute path of this binary.\n");
        return 1;
    }
    DEBUG_LOG("Executable path (for metadata): %s\n", exe_path);

    // Extract and execute with forwarded arguments.
    exit_code = extract_and_execute(self_fd, exe_path, argc, argv, envp, &update_config);

    close(self_fd);
    return exit_code;
}
