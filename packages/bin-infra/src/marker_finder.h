/**
 * @file marker_finder.h
 * @brief Shared marker finding functionality for compressed binaries
 *
 * This header provides utilities to find magic markers in binary files.
 * Used by both the stub (to find binflate) and binflate (to find compressed data).
 */

#ifndef MARKER_FINDER_H
#define MARKER_FINDER_H

#include <string.h>
#include <stdio.h>

#ifdef _WIN32
#include <windows.h>
#else
#include <unistd.h>
#endif

/**
 * Find a magic marker in an open file descriptor
 *
 * @param fd File descriptor to search (must be open for reading)
 * @param part1 First part of the marker
 * @param part2 Second part of the marker
 * @param part3 Third part of the marker
 * @param marker_len Total length of the combined marker
 * @return Offset just after the marker, or -1 if not found
 *
 * The marker is split into three parts to prevent it from appearing
 * in the binary itself. This function reconstructs and searches for it.
 *
 * Example usage:
 *   long offset = find_marker(fd, "__SOCKETSEC_", "BINFLATE_", "MAGIC_MARKER", 33);
 */
static inline long find_marker(int fd, const char *part1, const char *part2, const char *part3, size_t marker_len) {
    // Build the magic marker at runtime to avoid it appearing in the binary
    char magic_marker[128];
    int len = snprintf(magic_marker, sizeof(magic_marker), "%s%s%s", part1, part2, part3);
    if (len < 0 || (size_t)len != marker_len) {
        return -1;
    }

    char buffer[4096];
    long offset = 0;
    ssize_t bytes_read;

    // Seek to beginning
    if (lseek(fd, 0, SEEK_SET) == -1) {
        return -1;
    }

    while ((bytes_read = read(fd, buffer, sizeof(buffer))) > 0) {
        // Search for marker in current buffer
        for (ssize_t i = 0; i <= bytes_read - (ssize_t)marker_len; i++) {
            if (memcmp(buffer + i, magic_marker, marker_len) == 0) {
                // Found marker - return offset just after it
                return offset + i + (long)marker_len;
            }
        }
        offset += bytes_read;

        // Rewind a bit to handle marker split across buffer boundary
        if (bytes_read >= (ssize_t)marker_len) {
            if (lseek(fd, offset - (long)marker_len, SEEK_SET) == -1) {
                return -1;
            }
            offset -= (long)marker_len;
        }
    }

    return -1; // Not found
}

#ifdef _WIN32
/**
 * Find a magic marker in an open Windows file handle
 *
 * @param hFile Windows file handle to search (must be open for reading)
 * @param part1 First part of the marker
 * @param part2 Second part of the marker
 * @param part3 Third part of the marker
 * @param marker_len Total length of the combined marker
 * @return Offset just after the marker, or -1 if not found
 *
 * Windows version of find_marker that uses HANDLE instead of file descriptor.
 */
static inline LONGLONG find_marker_handle(HANDLE hFile, const char *part1, const char *part2, const char *part3, size_t marker_len) {
    // Build the magic marker at runtime to avoid it appearing in the binary
    char magic_marker[128];
    int len = snprintf(magic_marker, sizeof(magic_marker), "%s%s%s", part1, part2, part3);
    if (len < 0 || (size_t)len != marker_len) {
        return -1;
    }

    char buffer[4096];
    LONGLONG offset = 0;
    DWORD bytes_read;

    // Seek to beginning
    LARGE_INTEGER zero;
    zero.QuadPart = 0;
    if (!SetFilePointerEx(hFile, zero, NULL, FILE_BEGIN)) {
        return -1;
    }

    while (ReadFile(hFile, buffer, sizeof(buffer), &bytes_read, NULL) && bytes_read > 0) {
        // Search for marker in current buffer
        for (DWORD i = 0; i <= bytes_read - (DWORD)marker_len; i++) {
            if (memcmp(buffer + i, magic_marker, marker_len) == 0) {
                // Found marker - return offset just after it
                return offset + i + (LONGLONG)marker_len;
            }
        }
        offset += bytes_read;

        // Rewind a bit to handle marker split across buffer boundary
        if (bytes_read >= (DWORD)marker_len) {
            LARGE_INTEGER new_pos;
            new_pos.QuadPart = offset - (LONGLONG)marker_len;
            if (!SetFilePointerEx(hFile, new_pos, NULL, FILE_BEGIN)) {
                return -1;
            }
            offset -= (LONGLONG)marker_len;
        }
    }

    return -1; // Not found
}
#endif

#endif /* MARKER_FINDER_H */
