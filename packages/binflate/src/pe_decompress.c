/**
 * Windows PE Binary Decompressor
 *
 * Self-extracting decompressor for compressed PE binaries.
 * This decompressor is prepended to compressed data to create a self-extracting binary.
 *
 * Cache Strategy (follows socket-lib dlxBinary):
 *   This implementation follows the exact caching strategy used by socket-lib's dlxBinary.
 *   Matches Unix/macOS behavior for cross-platform consistency.
 *
 *   Cache structure: %SOCKET_DLX_DIR% or %SOCKET_HOME%\_dlx or %USERPROFILE%\.socket\_dlx\<cache_key>\
 *   - cache_key: First 16 hex chars of SHA-512 hash (generateCacheKey behavior)
 *   - binary_name: node.exe (or node on Unix)
 *   - Metadata: .dlx-metadata.json (unified DlxMetadata schema)
 *
 * At runtime:
 *   1. Reads compressed data from its own binary (after this decompressor)
 *   2. Calculates SHA-512 hash of compressed data
 *   3. Derives cache_key from first 16 hex chars of hash
 *   4. Creates cache directory recursively if needed
 *   5. Checks if cached version exists
 *   6. If cached and valid (correct size), executes from cache
 *   7. If cache miss, decompresses to cache with metadata and executes
 *   8. If cache unavailable (permissions, read-only fs), falls back to temp directory
 *   9. If both cache and temp fail, exits with clear error message
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <windows.h>
#include "compression_constants.h"
#include "compression_common.h"
#include "marker_finder.h"
#include "dlx_cache_common.h"

/* find_compressed_data_offset removed - using find_marker_handle from marker_finder.h */

/**
 * Create temp file and return path
 */
static int create_temp_file(char *temp_path, size_t temp_path_size) {
    char temp_dir[MAX_PATH];

    // Get temp directory
    DWORD result = GetTempPathA(sizeof(temp_dir), temp_dir);
    if (result == 0 || result > sizeof(temp_dir)) {
        fprintf(stderr, "Error: Failed to get temp directory: %lu\n", GetLastError());
        return -1;
    }

    // Create unique temp file name
    char temp_file[MAX_PATH];
    if (GetTempFileNameA(temp_dir, "soc", 0, temp_file) == 0) {
        fprintf(stderr, "Error: Failed to create temp file name: %lu\n", GetLastError());
        return -1;
    }

    // Append .exe extension
    snprintf(temp_path, temp_path_size, "%s.exe", temp_file);

    // Delete the temp file created by GetTempFileNameA (we'll create it ourselves)
    DeleteFileA(temp_file);

    return 0;
}

int main(int argc, char *argv[]) {
    int exit_code = 1;
    HANDLE hSelf = INVALID_HANDLE_VALUE;
    HANDLE hTemp = INVALID_HANDLE_VALUE;
    unsigned char *compressed_data = NULL;
    unsigned char *decompressed_data = NULL;
    char exe_path[MAX_PATH];
    char temp_path[MAX_PATH] = {0};
    char cache_key[17] = {0};
    char checksum[129] = {0};
    char cached_path[1024] = {0};
    int cache_hit = 0;
    PROCESS_INFORMATION pi = {0};
    STARTUPINFOA si = {0};

    // Get path to current executable
    DWORD path_len = GetModuleFileNameA(NULL, exe_path, sizeof(exe_path));
    if (path_len == 0 || path_len >= sizeof(exe_path)) {
        fprintf(stderr, "Error: Failed to get executable path: %lu\n", GetLastError());
        goto cleanup;
    }

    // Open self for reading
    hSelf = CreateFileA(exe_path, GENERIC_READ, FILE_SHARE_READ, NULL,
                        OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (hSelf == INVALID_HANDLE_VALUE) {
        fprintf(stderr, "Error: Failed to open self: %lu\n", GetLastError());
        goto cleanup;
    }

    // Find compressed data offset using shared marker finder.
    LONGLONG data_offset = find_marker_handle(hSelf, MAGIC_MARKER_PART1, MAGIC_MARKER_PART2, MAGIC_MARKER_PART3, MAGIC_MARKER_LEN);
    if (data_offset == -1) {
        fprintf(stderr, "Error: Could not find compressed data marker in binary\n");
        goto cleanup;
    }

    // Seek to compressed data
    LARGE_INTEGER seek_pos;
    seek_pos.QuadPart = data_offset;
    if (!SetFilePointerEx(hSelf, seek_pos, NULL, FILE_BEGIN)) {
        fprintf(stderr, "Error: Failed to seek to compressed data: %lu\n", GetLastError());
        goto cleanup;
    }

    // Read sizes
    UINT64 compressed_size, uncompressed_size;
    DWORD bytes_read;

    if (!ReadFile(hSelf, &compressed_size, sizeof(compressed_size), &bytes_read, NULL) ||
        bytes_read != sizeof(compressed_size)) {
        fprintf(stderr, "Error: Failed to read compressed size\n");
        goto cleanup;
    }

    if (!ReadFile(hSelf, &uncompressed_size, sizeof(uncompressed_size), &bytes_read, NULL) ||
        bytes_read != sizeof(uncompressed_size)) {
        fprintf(stderr, "Error: Failed to read uncompressed size\n");
        goto cleanup;
    }

    // Validate sizes
    if (compressed_size == 0 || uncompressed_size == 0 ||
        compressed_size > 500ULL * 1024 * 1024 || uncompressed_size > 500ULL * 1024 * 1024) {
        fprintf(stderr, "Error: Invalid compressed/uncompressed sizes\n");
        goto cleanup;
    }

    // Allocate buffers
    compressed_data = malloc((size_t)compressed_size);
    decompressed_data = malloc((size_t)uncompressed_size);
    if (!compressed_data || !decompressed_data) {
        fprintf(stderr, "Error: Failed to allocate memory\n");
        goto cleanup;
    }

    // Read compressed data.
    DWORD total_read = 0;
    while (total_read < compressed_size) {
        DWORD to_read = (DWORD)min(compressed_size - total_read, 1024 * 1024);
        if (!ReadFile(hSelf, compressed_data + total_read, to_read, &bytes_read, NULL) ||
            bytes_read == 0) {
            fprintf(stderr, "Error: Failed to read compressed data\n");
            goto cleanup;
        }
        total_read += bytes_read;
    }

    // Calculate cache key and checksum from compressed data.
    if (dlx_calculate_cache_key(compressed_data, compressed_size, cache_key) != 0) {
        fprintf(stderr, "⚠ Failed to calculate cache key\n");
    }

    if (dlx_calculate_sha512_hex(compressed_data, compressed_size, checksum) != 0) {
        fprintf(stderr, "⚠ Failed to calculate checksum\n");
    }

    // Check if cached binary exists.
    if (cache_key[0] != '\0' &&
        dlx_get_cached_binary_path(cache_key, uncompressed_size, cached_path, sizeof(cached_path)) == 0) {
        cache_hit = 1;
    }

    if (cache_hit) {
        // Execute from cache.
        CloseHandle(hSelf);
        hSelf = INVALID_HANDLE_VALUE;

        free(compressed_data);
        compressed_data = NULL;
        free(decompressed_data);
        decompressed_data = NULL;

        // Build command line with original arguments.
        char cmd_line[32768];
        int cmd_pos = 0;

        // Quote the executable path.
        cmd_pos += snprintf(cmd_line + cmd_pos, sizeof(cmd_line) - cmd_pos, "\"%s\"", cached_path);

        // Add remaining arguments.
        for (int i = 1; i < argc && cmd_pos < sizeof(cmd_line) - 1; i++) {
            // Check if argument contains spaces.
            if (strchr(argv[i], ' ') != NULL) {
                cmd_pos += snprintf(cmd_line + cmd_pos, sizeof(cmd_line) - cmd_pos, " \"%s\"", argv[i]);
            } else {
                cmd_pos += snprintf(cmd_line + cmd_pos, sizeof(cmd_line) - cmd_pos, " %s", argv[i]);
            }
        }

        // Execute decompressed binary.
        si.cb = sizeof(si);
        if (!CreateProcessA(NULL, cmd_line, NULL, NULL, TRUE, 0, NULL, NULL, &si, &pi)) {
            fprintf(stderr, "Error: Failed to execute cached binary: %lu\n", GetLastError());
            return 1;
        }

        // Wait for child process to complete.
        WaitForSingleObject(pi.hProcess, INFINITE);

        // Get exit code.
        DWORD child_exit_code = 0;
        GetExitCodeProcess(pi.hProcess, &child_exit_code);
        exit_code = (int)child_exit_code;

        // Clean up process handles.
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);

        return exit_code;
    }

    // Cache miss - decompress using LZFSE.
    int decompress_result = decompress_buffer_sized(
        compressed_data, (size_t)compressed_size,
        decompressed_data, (size_t)uncompressed_size
    );

    if (decompress_result != COMPRESS_OK) {
        fprintf(stderr, "Error: LZFSE decompression failed with code %d\n", decompress_result);
        goto cleanup;
    }

    // Free compressed data (no longer needed).
    free(compressed_data);
    compressed_data = NULL;

    // Try to write to cache.
    int cache_written = 0;
    if (cache_key[0] != '\0' && checksum[0] != '\0') {
        if (dlx_write_to_cache(cache_key, decompressed_data, (size_t)uncompressed_size,
                               compressed_size, exe_path, checksum, "lzfse") == 0) {
            cache_written = 1;

            // Execute from cache.
            CloseHandle(hSelf);
            hSelf = INVALID_HANDLE_VALUE;

            free(decompressed_data);
            decompressed_data = NULL;

            if (dlx_get_cached_binary_path(cache_key, uncompressed_size, cached_path, sizeof(cached_path)) == 0) {
                // Build command line with original arguments.
                char cmd_line[32768];
                int cmd_pos = 0;

                // Quote the executable path.
                cmd_pos += snprintf(cmd_line + cmd_pos, sizeof(cmd_line) - cmd_pos, "\"%s\"", cached_path);

                // Add remaining arguments.
                for (int i = 1; i < argc && cmd_pos < sizeof(cmd_line) - 1; i++) {
                    // Check if argument contains spaces.
                    if (strchr(argv[i], ' ') != NULL) {
                        cmd_pos += snprintf(cmd_line + cmd_pos, sizeof(cmd_line) - cmd_pos, " \"%s\"", argv[i]);
                    } else {
                        cmd_pos += snprintf(cmd_line + cmd_pos, sizeof(cmd_line) - cmd_pos, " %s", argv[i]);
                    }
                }

                // Execute decompressed binary.
                si.cb = sizeof(si);
                if (!CreateProcessA(NULL, cmd_line, NULL, NULL, TRUE, 0, NULL, NULL, &si, &pi)) {
                    fprintf(stderr, "Error: Failed to execute cached binary: %lu\n", GetLastError());
                    return 1;
                }

                // Wait for child process to complete.
                WaitForSingleObject(pi.hProcess, INFINITE);

                // Get exit code.
                DWORD child_exit_code = 0;
                GetExitCodeProcess(pi.hProcess, &child_exit_code);
                exit_code = (int)child_exit_code;

                // Clean up process handles.
                CloseHandle(pi.hProcess);
                CloseHandle(pi.hThread);

                return exit_code;
            }

            // If we get here, exec failed.
            fprintf(stderr, "Error: Failed to execute cached binary\n");
            return 1;
        } else {
            fprintf(stderr, "⚠ Failed to write to cache (will use temp directory)\n");
        }
    }

    // Fallback - write to temp and execute.
    if (!cache_written) {
        // Create temp file.
        if (create_temp_file(temp_path, sizeof(temp_path)) != 0) {
            fprintf(stderr, "Error: Cannot execute - cache unavailable and temp directory failed\n");
            goto cleanup;
        }

        hTemp = CreateFileA(temp_path, GENERIC_WRITE, 0, NULL,
                            CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
        if (hTemp == INVALID_HANDLE_VALUE) {
            fprintf(stderr, "Error: Failed to create temp file: %lu\n", GetLastError());
            goto cleanup;
        }

        // Write decompressed data.
        DWORD total_written = 0;
        while (total_written < uncompressed_size) {
            DWORD to_write = (DWORD)min(uncompressed_size - total_written, 1024 * 1024);
            DWORD bytes_written;
            if (!WriteFile(hTemp, decompressed_data + total_written, to_write,
                          &bytes_written, NULL) || bytes_written == 0) {
                fprintf(stderr, "Error: Failed to write decompressed data: %lu\n", GetLastError());
                goto cleanup;
            }
            total_written += bytes_written;
        }

        // Close handles before exec.
        CloseHandle(hSelf);
        hSelf = INVALID_HANDLE_VALUE;
        CloseHandle(hTemp);
        hTemp = INVALID_HANDLE_VALUE;

        // Free memory before exec.
        free(decompressed_data);
        decompressed_data = NULL;

        // Build command line with original arguments.
        char cmd_line[32768];
        int cmd_pos = 0;

        // Quote the executable path.
        cmd_pos += snprintf(cmd_line + cmd_pos, sizeof(cmd_line) - cmd_pos, "\"%s\"", temp_path);

        // Add remaining arguments.
        for (int i = 1; i < argc && cmd_pos < sizeof(cmd_line) - 1; i++) {
            // Check if argument contains spaces.
            if (strchr(argv[i], ' ') != NULL) {
                cmd_pos += snprintf(cmd_line + cmd_pos, sizeof(cmd_line) - cmd_pos, " \"%s\"", argv[i]);
            } else {
                cmd_pos += snprintf(cmd_line + cmd_pos, sizeof(cmd_line) - cmd_pos, " %s", argv[i]);
            }
        }

        // Execute decompressed binary.
        si.cb = sizeof(si);
        if (!CreateProcessA(NULL, cmd_line, NULL, NULL, TRUE, 0, NULL, NULL, &si, &pi)) {
            fprintf(stderr, "Error: Failed to execute decompressed binary: %lu\n", GetLastError());
            DeleteFileA(temp_path);
            return 1;
        }

        // Wait for child process to complete.
        WaitForSingleObject(pi.hProcess, INFINITE);

        // Get exit code.
        DWORD child_exit_code = 0;
        GetExitCodeProcess(pi.hProcess, &child_exit_code);
        exit_code = (int)child_exit_code;

        // Clean up process handles.
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);

        // Clean up temp file.
        DeleteFileA(temp_path);

        return exit_code;
    }

    return exit_code;

cleanup:
    if (hSelf != INVALID_HANDLE_VALUE) CloseHandle(hSelf);
    if (hTemp != INVALID_HANDLE_VALUE) CloseHandle(hTemp);
    if (compressed_data) free(compressed_data);
    if (decompressed_data) free(decompressed_data);
    if (temp_path[0] != '\0' && strstr(temp_path, ".exe") != NULL) {
        DeleteFileA(temp_path);
    }
    return exit_code;
}
