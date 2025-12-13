/**
 * Windows PE Minimal Self-Extracting Stub
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
 *   2. Decompresses inline using Windows Compression API
 *   3. Writes to cache using shared dlx_cache_common.h
 *   4. Executes decompressed binary
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
 * Windows-compatible read function for file handles
 */
static ssize_t win_read(int fd, void *buf, size_t count) {
    HANDLE handle = (HANDLE)_get_osfhandle(fd);
    if (handle == INVALID_HANDLE_VALUE) {
        return -1;
    }

    DWORD bytes_read;
    if (!ReadFile(handle, buf, (DWORD)count, &bytes_read, NULL)) {
        return -1;
    }
    return (ssize_t)bytes_read;
}

/**
 * Windows-compatible lseek function
 */
static long win_lseek(int fd, long offset, int whence) {
    HANDLE handle = (HANDLE)_get_osfhandle(fd);
    if (handle == INVALID_HANDLE_VALUE) {
        return -1;
    }

    DWORD move_method;
    switch (whence) {
        case SEEK_SET: move_method = FILE_BEGIN; break;
        case SEEK_CUR: move_method = FILE_CURRENT; break;
        case SEEK_END: move_method = FILE_END; break;
        default: return -1;
    }

    LARGE_INTEGER li;
    li.QuadPart = offset;
    li.LowPart = SetFilePointer(handle, li.LowPart, &li.HighPart, move_method);

    if (li.LowPart == INVALID_SET_FILE_POINTER && GetLastError() != NO_ERROR) {
        return -1;
    }

    return (long)li.QuadPart;
}

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
 * Windows-specific marker finder that uses Windows API
 */
static long find_marker_win(int fd, const char *part1, const char *part2, const char *part3, size_t marker_len) {
    // Build the magic marker at runtime
    char magic_marker[128];
    int len = snprintf(magic_marker, sizeof(magic_marker), "%s%s%s", part1, part2, part3);
    if (len < 0 || (size_t)len != marker_len) {
        return -1;
    }

    char buffer[4096];
    long offset = 0;
    ssize_t bytes_read;

    // Seek to beginning
    if (win_lseek(fd, 0, SEEK_SET) == -1) {
        return -1;
    }

    while ((bytes_read = win_read(fd, buffer, sizeof(buffer))) > 0) {
        // Search for marker in current buffer
        for (ssize_t i = 0; i <= bytes_read - (ssize_t)marker_len; i++) {
            if (memcmp(buffer + i, magic_marker, marker_len) == 0) {
                // Found marker - check for overflow before addition
                if (offset > LONG_MAX - i - (long)marker_len) {
                    return -1;  // Overflow would occur
                }
                return offset + i + (long)marker_len;
            }
        }
        offset += bytes_read;

        // Rewind a bit to handle marker split across buffer boundary
        if (bytes_read >= (ssize_t)marker_len) {
            if (win_lseek(fd, offset - (long)marker_len, SEEK_SET) == -1) {
                return -1;
            }
            offset -= (long)marker_len;
        }
    }

    return -1; // Not found
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

    // Find compressed data marker
    long data_offset = find_marker_win(self_fd, MAGIC_MARKER_PART1, MAGIC_MARKER_PART2, MAGIC_MARKER_PART3, MAGIC_MARKER_LEN);
    if (data_offset == -1) {
        fprintf(stderr, "Error: Compressed data marker not found\n");
        return 1;
    }

    // Seek to size headers
    if (win_lseek(self_fd, data_offset, SEEK_SET) == -1) {
        fprintf(stderr, "Error: Failed to seek to size headers\n");
        return 1;
    }

    // Read sizes
    uint64_t compressed_size, uncompressed_size;
    if (win_read(self_fd, &compressed_size, sizeof(compressed_size)) != sizeof(compressed_size)) {
        fprintf(stderr, "Error: Failed to read compressed size\n");
        return 1;
    }
    if (win_read(self_fd, &uncompressed_size, sizeof(uncompressed_size)) != sizeof(uncompressed_size)) {
        fprintf(stderr, "Error: Failed to read uncompressed size\n");
        return 1;
    }

    // Skip cache key (16 bytes) - embedded by builder but recalculated from compressed data
    char cache_key_from_binary[17];
    if (win_read(self_fd, cache_key_from_binary, 16) != 16) {
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
        ssize_t n = win_read(self_fd, compressed_data + total_read, compressed_size - total_read);
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

    // Get the actual cached path that was written
    const char *home = getenv("USERPROFILE");
    if (!home) home = getenv("HOMEDRIVE");
    if (!home) home = "C:";

    int written = snprintf(output_path, sizeof(output_path), "%s\\.socket\\_dlx\\%s\\node-smol-%s-%s.exe",
                          home, cache_key, dlx_get_platform(), dlx_get_arch());
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
