/**
 * Windows PE Binary Decompressor
 *
 * Self-extracting decompressor for compressed PE binaries.
 * This decompressor is prepended to compressed data to create a self-extracting binary.
 *
 * At runtime:
 *   1. Reads compressed data from its own binary (after this decompressor)
 *   2. Decompresses to temp directory (%TEMP%)
 *   3. Executes decompressed binary with original arguments
 *   4. Cleans up temp file after child exits
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <windows.h>
#include <compressapi.h>
#include "compression_constants.h"

/**
 * Find magic marker in file and return offset to compressed data
 */
static LONGLONG find_compressed_data_offset(HANDLE hFile) {
    // Build the magic marker at runtime to avoid it appearing in the binary
    char magic_marker[MAGIC_MARKER_LEN + 1];
    snprintf(magic_marker, sizeof(magic_marker), "%s%s", MAGIC_MARKER_PART1, MAGIC_MARKER_PART2);

    char buffer[4096];
    LONGLONG offset = 0;
    DWORD bytes_read;

    // Reset file pointer to beginning
    SetFilePointer(hFile, 0, NULL, FILE_BEGIN);

    while (ReadFile(hFile, buffer, sizeof(buffer), &bytes_read, NULL) && bytes_read > 0) {
        for (DWORD i = 0; i < bytes_read - MAGIC_MARKER_LEN; i++) {
            if (memcmp(buffer + i, magic_marker, MAGIC_MARKER_LEN) == 0) {
                // Found marker - return offset just after it
                return offset + i + MAGIC_MARKER_LEN;
            }
        }
        offset += bytes_read;

        // Rewind a bit to handle marker split across buffer boundary
        if (bytes_read == sizeof(buffer)) {
            LARGE_INTEGER new_pos;
            new_pos.QuadPart = offset - MAGIC_MARKER_LEN;
            SetFilePointerEx(hFile, new_pos, NULL, FILE_BEGIN);
            offset -= MAGIC_MARKER_LEN;
        }
    }

    return -1; // Not found
}

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
    COMPRESSOR_HANDLE hCompressor = NULL;
    char exe_path[MAX_PATH];
    char temp_path[MAX_PATH];
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

    // Find compressed data offset
    LONGLONG data_offset = find_compressed_data_offset(hSelf);
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

    // Read compressed data
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

    // Create decompressor
    if (!CreateDecompressor(COMPRESS_ALGORITHM_LZMS, NULL, &hCompressor)) {
        fprintf(stderr, "Error: Failed to create decompressor: %lu\n", GetLastError());
        goto cleanup;
    }

    // Decompress data
    SIZE_T decompressed_bytes;
    if (!Decompress(hCompressor, compressed_data, (SIZE_T)compressed_size,
                    decompressed_data, (SIZE_T)uncompressed_size,
                    &decompressed_bytes)) {
        fprintf(stderr, "Error: Decompression failed: %lu\n", GetLastError());
        goto cleanup;
    }

    if (decompressed_bytes != uncompressed_size) {
        fprintf(stderr, "Error: Decompressed size mismatch (got %zu, expected %llu)\n",
                (size_t)decompressed_bytes, uncompressed_size);
        goto cleanup;
    }

    // Create temp file
    if (create_temp_file(temp_path, sizeof(temp_path)) != 0) {
        goto cleanup;
    }

    hTemp = CreateFileA(temp_path, GENERIC_WRITE, 0, NULL,
                        CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (hTemp == INVALID_HANDLE_VALUE) {
        fprintf(stderr, "Error: Failed to create temp file: %lu\n", GetLastError());
        goto cleanup;
    }

    // Write decompressed data
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

    // Close handles before exec
    CloseHandle(hSelf);
    hSelf = INVALID_HANDLE_VALUE;
    CloseHandle(hTemp);
    hTemp = INVALID_HANDLE_VALUE;

    if (hCompressor) {
        CloseDecompressor(hCompressor);
        hCompressor = NULL;
    }

    // Free memory before exec
    free(compressed_data);
    compressed_data = NULL;
    free(decompressed_data);
    decompressed_data = NULL;

    // Build command line with original arguments
    char cmd_line[32768];
    int cmd_pos = 0;

    // Quote the executable path
    cmd_pos += snprintf(cmd_line + cmd_pos, sizeof(cmd_line) - cmd_pos, "\"%s\"", temp_path);

    // Add remaining arguments
    for (int i = 1; i < argc && cmd_pos < sizeof(cmd_line) - 1; i++) {
        // Check if argument contains spaces
        if (strchr(argv[i], ' ') != NULL) {
            cmd_pos += snprintf(cmd_line + cmd_pos, sizeof(cmd_line) - cmd_pos, " \"%s\"", argv[i]);
        } else {
            cmd_pos += snprintf(cmd_line + cmd_pos, sizeof(cmd_line) - cmd_pos, " %s", argv[i]);
        }
    }

    // Execute decompressed binary
    si.cb = sizeof(si);
    if (!CreateProcessA(NULL, cmd_line, NULL, NULL, TRUE, 0, NULL, NULL, &si, &pi)) {
        fprintf(stderr, "Error: Failed to execute decompressed binary: %lu\n", GetLastError());
        DeleteFileA(temp_path);
        return 1;
    }

    // Wait for child process to complete
    WaitForSingleObject(pi.hProcess, INFINITE);

    // Get exit code
    DWORD child_exit_code = 0;
    GetExitCodeProcess(pi.hProcess, &child_exit_code);
    exit_code = (int)child_exit_code;

    // Clean up process handles
    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);

    // Clean up temp file
    DeleteFileA(temp_path);

    return exit_code;

cleanup:
    if (hSelf != INVALID_HANDLE_VALUE) CloseHandle(hSelf);
    if (hTemp != INVALID_HANDLE_VALUE) CloseHandle(hTemp);
    if (hCompressor) CloseDecompressor(hCompressor);
    if (compressed_data) free(compressed_data);
    if (decompressed_data) free(decompressed_data);
    if (temp_path[0] != '\0' && strstr(temp_path, ".exe") != NULL) {
        DeleteFileA(temp_path);
    }
    return exit_code;
}
