/**
 * Windows PE Minimal Self-Extracting Stub
 *
 * Ultra-minimal launcher that decompresses embedded data inline without extracting binflate.
 * Uses shared code from bin-infra to minimize duplication across platforms.
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
 *   2. Reads metadata using shared smol_segment_reader.h
 *   3. Decompresses inline using LZFSE
 *   4. Writes to cache using shared dlx_cache_common.h
 *   5. Reads embedded update config (if present)
 *   6. Checks for updates (if configured)
 *   7. Executes decompressed binary
 *
 * Cross-platform compatibility:
 *   - Uses Windows CRT functions (_read/_lseek) via marker_finder.h defines
 *   - File I/O works with file descriptors from _open()
 *   - Shares metadata reading/validation logic with Linux/macOS stubs
 */

#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <limits.h>
#include <fcntl.h>
#include <io.h>
#include <windows.h>

#include "socketsecurity/bin-infra/compression_constants.h"
#include "socketsecurity/bin-infra/decompressor_limits.h"
#include "socketsecurity/bin-infra/marker_finder.h"
#include "socketsecurity/build-infra/dlx_cache_common.h"
#include "socketsecurity/bin-infra/smol_segment_reader.h"
#include "socketsecurity/bin-infra/lzfse.h"
#include "socketsecurity/build-infra/debug_common.h"
#include "socketsecurity/bin-stubs/update_integration.h"

/**
 * Get path to current executable
 */
static int get_executable_path(char *buf, size_t size) {
    DWORD len = GetModuleFileNameA(NULL, buf, (DWORD)size);
    if (len == 0 || len >= size) {
        fprintf(stderr, "Error: Failed to get executable path\n");
        return -1;
    }
    return 0;
}

/**
 * Note: We use standard C runtime functions (read/lseek) which are
 * automatically mapped to _read/_lseek on Windows via marker_finder.h.
 * These work correctly with file descriptors from _open().
 */

/**
 * Decompress LZFSE data using bundled LZFSE library
 */
static int decompress_lzfse(const unsigned char *compressed_data, size_t compressed_size,
                            unsigned char *decompressed_data, size_t uncompressed_size) {
    // Allocate scratch buffer on heap with explicit error checking
    size_t scratch_size = lzfse_decode_scratch_size();
    DEBUG_LOG("LZFSE scratch buffer size: %zu bytes\n", scratch_size);

    unsigned char *scratch_buffer = malloc(scratch_size);
    if (!scratch_buffer) {
        fprintf(stderr, "Error: Failed to allocate %zu bytes for LZFSE scratch buffer\n", scratch_size);
        return -1;
    }

    DEBUG_LOG("Calling lzfse_decode_buffer: src=%p dst=%p scratch=%p\n",
              (void*)compressed_data, (void*)decompressed_data, (void*)scratch_buffer);
    DEBUG_LOG("  compressed_size=%zu uncompressed_size=%zu\n",
              compressed_size, uncompressed_size);

    size_t decompressed_bytes = lzfse_decode_buffer(
        decompressed_data, uncompressed_size,
        compressed_data, compressed_size,
        scratch_buffer
    );

    DEBUG_LOG("lzfse_decode_buffer returned: %zu bytes\n", decompressed_bytes);
    free(scratch_buffer);

    if (decompressed_bytes == 0 || decompressed_bytes != uncompressed_size) {
        fprintf(stderr, "Error: LZFSE decompression failed (got %zu, expected %zu)\n",
                decompressed_bytes, uncompressed_size);
        return -1;
    }

    return 0;
}

/**
 * Build Windows command line with proper argument escaping.
 * Prevents command injection by properly escaping quotes and backslashes.
 *
 * @param cmdline - Output buffer for command line
 * @param cmdline_size - Size of output buffer
 * @param output_path - Path to executable (will be quoted)
 * @param argc - Argument count
 * @param argv - Argument vector
 * @return 0 on success, -1 on error (buffer overflow)
 */
static int build_windows_cmdline(char *cmdline, size_t cmdline_size,
                                  const char *output_path,
                                  int argc, char *argv[]) {
    // Start with quoted executable path
    int written = snprintf(cmdline, cmdline_size, "\"%s\"", output_path);
    if (written < 0 || (size_t)written >= cmdline_size) {
        fprintf(stderr, "Error: Output path too long for command line\n");
        return -1;
    }
    size_t cmdline_pos = (size_t)written;

    // Add arguments with proper escaping
    for (int i = 1; i < argc; i++) {
        // Check space for: space + opening quote + closing quote + null terminator
        if (cmdline_pos + 3 >= cmdline_size) {
            fprintf(stderr, "Error: Command line buffer overflow (args too long)\n");
            return -1;
        }

        // Add space separator and opening quote
        cmdline[cmdline_pos++] = ' ';
        cmdline[cmdline_pos++] = '"';

        // Escape the argument
        const char *arg = argv[i];
        for (size_t j = 0; arg[j]; j++) {
            // Worst case: each char expands to 2 chars (backslash escape)
            // + closing quote + null terminator
            if (cmdline_pos + 4 >= cmdline_size) {
                fprintf(stderr, "Error: Command line buffer overflow (arg too long)\n");
                return -1;
            }

            if (arg[j] == '"') {
                // Escape quotes with backslash
                cmdline[cmdline_pos++] = '\\';
                cmdline[cmdline_pos++] = '"';
            } else if (arg[j] == '\\') {
                // Count consecutive backslashes
                size_t num_backslashes = 1;
                while (arg[j + num_backslashes] != '\0' && arg[j + num_backslashes] == '\\') {
                    num_backslashes++;
                }

                // Check if backslash is followed by quote or end of string
                if (arg[j + num_backslashes] == '"' || arg[j + num_backslashes] == '\0') {
                    // Double backslashes before quote or end
                    // Check space for num_backslashes * 2 + closing quote + null
                    if (cmdline_pos + (num_backslashes * 2) + 2 >= cmdline_size) {
                        fprintf(stderr, "Error: Command line buffer overflow (backslash escape)\n");
                        return -1;
                    }
                    for (size_t k = 0; k < num_backslashes * 2; k++) {
                        cmdline[cmdline_pos++] = '\\';
                    }
                    j += num_backslashes - 1;
                } else {
                    // Single backslash (not before quote)
                    cmdline[cmdline_pos++] = '\\';
                }
            } else {
                // Regular character
                cmdline[cmdline_pos++] = arg[j];
            }
        }

        // Add closing quote
        cmdline[cmdline_pos++] = '"';
    }

    // Null terminate
    cmdline[cmdline_pos] = '\0';
    return 0;
}

/**
 * Windows setenv wrapper (Windows uses _putenv_s instead of setenv).
 * Returns 0 on success, -1 on error.
 */
static int win_setenv(const char *name, const char *value, int overwrite) {
    if (!name || !value) return -1;

    /* Check if variable exists if overwrite is 0. */
    if (!overwrite && getenv(name) != NULL) {
        return 0;
    }

    /* Use _putenv_s to set the variable. */
    if (_putenv_s(name, value) != 0) {
        return -1;
    }
    return 0;
}

/**
 * Extract and execute compressed binary
 */
static int extract_and_execute(int self_fd, const char *exe_path, int argc, char *argv[],
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
                win_setenv("SMOL_FAKE_ARGV_NAME", update_config->fake_argv_env, 1);

                // Check if already set by user (don't override).
                if (getenv(update_config->fake_argv_env) == NULL) {
                    // Not set, so we use auto-detection (set to empty to let bootstrap decide).
                    win_setenv(update_config->fake_argv_env, "", 0);
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
    win_setenv("SMOL_STUB_PATH", exe_path, 1);
    win_setenv("SMOL_CACHE_KEY", cache_key, 1);

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

        // Build command line with arguments (Windows requires quoted exe path + args).
        char cmdline[8192];
        if (build_windows_cmdline(cmdline, sizeof(cmdline), output_path, argc, argv) != 0) {
            goto cleanup;
        }

        // Close self_fd before CreateProcessA to prevent fd inheritance
        _close(self_fd);

        // Execute cached binary and wait for it to complete
        // Inherit stdin/stdout/stderr from parent process
        STARTUPINFOA si = {0};
        PROCESS_INFORMATION pi = {0};
        si.cb = sizeof(si);
        si.dwFlags = STARTF_USESTDHANDLES;
        si.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
        si.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
        si.hStdError = GetStdHandle(STD_ERROR_HANDLE);

        // Pass cmdline as second parameter (must be mutable on Windows)
        // bInheritHandles = TRUE to allow child to use our stdin/stdout/stderr
        if (!CreateProcessA(NULL, cmdline, NULL, NULL, TRUE, 0, NULL, NULL, &si, &pi)) {
            fprintf(stderr, "Error: Failed to execute cached binary (error: %lu)\n", GetLastError());
            return 1;
        }

        // Wait for the child process to complete
        WaitForSingleObject(pi.hProcess, INFINITE);

        // Get exit code from child process
        DWORD child_exit_code = 0;
        exit_code = 1;
        if (GetExitCodeProcess(pi.hProcess, &child_exit_code)) {
            exit_code = (int)child_exit_code;
        }

        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);
        return exit_code;
    }

    // Decompress using LZFSE (universal compression algorithm)
    if (decompress_lzfse(compressed_data, compressed_size, decompressed_data, uncompressed_size) != 0) {
        fprintf(stderr, "Error: LZFSE decompression failed\n");
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
    int written = snprintf(output_path, sizeof(output_path), "%s\\%s\\%s",
                          base_dir, cache_key, binary_name);
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

    // Build command line with arguments (Windows requires quoted exe path + args).
    char cmdline[8192];
    if (build_windows_cmdline(cmdline, sizeof(cmdline), output_path, argc, argv) != 0) {
        goto cleanup;
    }

    // Close self_fd before CreateProcessA to prevent fd inheritance
    _close(self_fd);

    // Execute cached binary and wait for it to complete
    // Inherit stdin/stdout/stderr from parent process
    STARTUPINFOA si = {0};
    PROCESS_INFORMATION pi = {0};
    si.cb = sizeof(si);
    si.dwFlags = STARTF_USESTDHANDLES;
    si.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
    si.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
    si.hStdError = GetStdHandle(STD_ERROR_HANDLE);

    // Pass cmdline as second parameter (must be mutable on Windows)
    // bInheritHandles = TRUE to allow child to use our stdin/stdout/stderr
    if (!CreateProcessA(NULL, cmdline, NULL, NULL, TRUE, 0, NULL, NULL, &si, &pi)) {
        fprintf(stderr, "Error: Failed to execute binary (error: %lu)\n", GetLastError());
        exit_code = 1;
        goto cleanup;
    }

    // Wait for the child process to complete
    WaitForSingleObject(pi.hProcess, INFINITE);

    // Get exit code from child process
    DWORD child_exit_code = 0;
    if (GetExitCodeProcess(pi.hProcess, &child_exit_code)) {
        exit_code = (int)child_exit_code;
    } else {
        exit_code = 1;
    }

    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);

cleanup:
    if (compressed_data) free(compressed_data);
    if (decompressed_data) free(decompressed_data);
    return exit_code;
}

int main(int argc, char *argv[], char *envp[]) {
    (void)envp;  // Unused on Windows.

    // Initialize debug mode from DEBUG environment variable.
    DEBUG_INIT("smol:stub");
    DEBUG_LOG("Starting self-extracting binary\n");

    // Initialize update configuration.
    update_config_t update_config;
    update_config_init(&update_config);

    char exe_path[1024];
    int self_fd = -1;
    int exit_code = 1;

    // Get path to current executable.
    if (get_executable_path(exe_path, sizeof(exe_path)) != 0) {
        return 1;
    }
    DEBUG_LOG("Executable path: %s\n", exe_path);

    // Open self for reading.
    self_fd = _open(exe_path, _O_RDONLY | _O_BINARY | _O_NOINHERIT);
    if (self_fd == -1) {
        fprintf(stderr, "Error: Failed to open self\n");
        return 1;
    }

    // Extract and execute with command-line arguments.
    exit_code = extract_and_execute(self_fd, exe_path, argc, argv, &update_config);

    _close(self_fd);
    return exit_code;
}
