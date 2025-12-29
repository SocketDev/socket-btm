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
 *   [Compressed data]
 *
 * At runtime:
 *   1. Finds compressed data using shared marker_finder.h
 *   2. Reads metadata using shared smol_segment_reader.h
 *   3. Decompresses inline using Windows Compression API (LZMS)
 *   4. Writes to cache using shared dlx_cache_common.h
 *   5. Executes decompressed binary
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
#include <compressapi.h>

#include "compression_constants.h"
#include "marker_finder.h"
#include "dlx_cache_common.h"
#include "smol_segment_reader.h"

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
 * Decompress LZMS data using Windows Compression API
 */
static int decompress_lzms(const unsigned char *compressed_data, size_t compressed_size,
                           unsigned char *decompressed_data, size_t uncompressed_size) {
    DECOMPRESSOR_HANDLE decompressor = NULL;
    BOOL success = FALSE;
    SIZE_T decompressed_buffer_size = uncompressed_size;

    // Create decompressor
    if (!CreateDecompressor(COMPRESS_ALGORITHM_LZMS, NULL, &decompressor)) {
        fprintf(stderr, "Error: Failed to create LZMS decompressor (error: %lu)\n", GetLastError());
        return -1;
    }

    // Decompress
    success = Decompress(decompressor,
                        (PVOID)compressed_data, compressed_size,
                        (PVOID)decompressed_data, uncompressed_size,
                        &decompressed_buffer_size);

    CloseDecompressor(decompressor);

    if (!success) {
        fprintf(stderr, "Error: LZMS decompression failed (error: %lu)\n", GetLastError());
        return -1;
    }

    if (decompressed_buffer_size != uncompressed_size) {
        fprintf(stderr, "Error: Decompressed size mismatch (got %zu, expected %zu)\n",
                decompressed_buffer_size, uncompressed_size);
        return -1;
    }

    return 0;
}

/**
 * Extract and execute compressed binary
 */
static int extract_and_execute(int self_fd, const char *exe_path, int argc, char *argv[]) {
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

    // Validate metadata (limit to 100MB to prevent memory exhaustion).
    const size_t max_size = 100 * 1024 * 1024;
    if (smol_validate_metadata(&metadata, max_size) != 0) {
        return 1;
    }

    // Copy cache key to local variable for compatibility.
    memcpy(cache_key, metadata.cache_key, 17);

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

    // Check if already cached
    if (dlx_get_cached_binary_path(cache_key, uncompressed_size, output_path, sizeof(output_path)) == 0) {
        // Already cached - execute directly
        free(compressed_data);
        free(decompressed_data);

        // Build command line with arguments (Windows requires quoted exe path + args)
        // Properly escape arguments to prevent command injection
        char cmdline[8192];
        int written = snprintf(cmdline, sizeof(cmdline), "\"%s\"", output_path);
        if (written < 0 || (size_t)written >= sizeof(cmdline)) {
            fprintf(stderr, "Error: Output path too long for command line\n");
            goto cleanup;
        }
        size_t cmdline_pos = (size_t)written;

        for (int i = 1; i < argc && cmdline_pos < sizeof(cmdline) - 100; i++) {
            // Add space separator
            cmdline[cmdline_pos++] = ' ';
            cmdline[cmdline_pos++] = '"';

            // Escape the argument
            const char *arg = argv[i];
            for (size_t j = 0; arg[j] && cmdline_pos < sizeof(cmdline) - 10; j++) {
                if (arg[j] == '"') {
                    // Escape quotes with backslash
                    cmdline[cmdline_pos++] = '\\';
                    cmdline[cmdline_pos++] = '"';
                } else if (arg[j] == '\\') {
                    // Check if backslash is followed by quote or end of string
                    size_t num_backslashes = 1;
                    while (arg[j + num_backslashes] == '\\') {
                        num_backslashes++;
                    }

                    if (arg[j + num_backslashes] == '"' || arg[j + num_backslashes] == '\0') {
                        // Double backslashes before quote or end
                        for (size_t k = 0; k < num_backslashes * 2 && cmdline_pos < sizeof(cmdline) - 2; k++) {
                            cmdline[cmdline_pos++] = '\\';
                        }
                        j += num_backslashes - 1;
                    } else {
                        cmdline[cmdline_pos++] = '\\';
                    }
                } else {
                    cmdline[cmdline_pos++] = arg[j];
                }
            }

            cmdline[cmdline_pos++] = '"';
        }
        cmdline[cmdline_pos] = '\0';

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
        int exit_code = 1;
        if (GetExitCodeProcess(pi.hProcess, &child_exit_code)) {
            exit_code = (int)child_exit_code;
        }

        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);
        return exit_code;
    }

    // Decompress
    if (decompress_lzms(compressed_data, compressed_size, decompressed_data, uncompressed_size) != 0) {
        fprintf(stderr, "Error: Decompression failed\n");
        goto cleanup;
    }

    // Free compressed data (no longer needed)
    free(compressed_data);
    compressed_data = NULL;

    // Write to cache
    if (dlx_write_to_cache(cache_key, decompressed_data, uncompressed_size, compressed_size,
                           exe_path, "", "lzms") != 0) {
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

    // Free decompressed data (written to disk)
    free(decompressed_data);
    decompressed_data = NULL;

    // Build command line with arguments (Windows requires quoted exe path + args)
    // Properly escape arguments to prevent command injection
    char cmdline[8192];
    size_t cmdline_pos;
    written = snprintf(cmdline, sizeof(cmdline), "\"%s\"", output_path);
    if (written < 0 || (size_t)written >= sizeof(cmdline)) {
        fprintf(stderr, "Error: Output path too long for command line\n");
        goto cleanup;
    }
    cmdline_pos = (size_t)written;

    for (int i = 1; i < argc; i++) {
        // Check if we have enough space for: space + opening quote + closing quote + null terminator
        if (cmdline_pos + 3 >= sizeof(cmdline)) {
            fprintf(stderr, "Error: Command line buffer overflow (args too long)\n");
            goto cleanup;
        }

        // Add space separator
        cmdline[cmdline_pos++] = ' ';
        cmdline[cmdline_pos++] = '"';

        // Escape the argument
        const char *arg = argv[i];
        for (size_t j = 0; arg[j]; j++) {
            // Worst case: each char can expand to 2 chars (backslash escape), plus closing quote + null
            if (cmdline_pos + 4 >= sizeof(cmdline)) {
                fprintf(stderr, "Error: Command line buffer overflow (arg too long)\n");
                goto cleanup;
            }

            if (arg[j] == '"') {
                // Escape quotes with backslash
                cmdline[cmdline_pos++] = '\\';
                cmdline[cmdline_pos++] = '"';
            } else if (arg[j] == '\\') {
                // Check if backslash is followed by quote or end of string
                size_t num_backslashes = 1;
                // Count consecutive backslashes, ensuring we don't read past null terminator
                while (arg[j + num_backslashes] != '\0' && arg[j + num_backslashes] == '\\') {
                    num_backslashes++;
                }

                if (arg[j + num_backslashes] == '"' || arg[j + num_backslashes] == '\0') {
                    // Double backslashes before quote or end
                    // Check if we have space for num_backslashes * 2 characters
                    if (cmdline_pos + (num_backslashes * 2) + 2 >= sizeof(cmdline)) {
                        fprintf(stderr, "Error: Command line buffer overflow (backslash escape)\n");
                        goto cleanup;
                    }
                    for (size_t k = 0; k < num_backslashes * 2; k++) {
                        cmdline[cmdline_pos++] = '\\';
                    }
                    j += num_backslashes - 1;
                } else {
                    cmdline[cmdline_pos++] = '\\';
                }
            } else {
                cmdline[cmdline_pos++] = arg[j];
            }
        }

        cmdline[cmdline_pos++] = '"';
    }
    cmdline[cmdline_pos] = '\0';

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
    (void)envp;  // Unused on Windows

    char exe_path[1024];
    int self_fd = -1;
    int exit_code = 1;

    // Get path to current executable
    if (get_executable_path(exe_path, sizeof(exe_path)) != 0) {
        return 1;
    }

    // Open self for reading
    self_fd = _open(exe_path, _O_RDONLY | _O_BINARY);
    if (self_fd == -1) {
        fprintf(stderr, "Error: Failed to open self\n");
        return 1;
    }

    // Extract and execute with command-line arguments
    exit_code = extract_and_execute(self_fd, exe_path, argc, argv);

    _close(self_fd);
    return exit_code;
}
