/**
 * @file ptnote_finder.h
 * @brief Shared PT_NOTE segment finder for ELF binaries
 *
 * This header provides utilities to find magic markers in PT_NOTE segments of ELF binaries.
 * Used by both the stub (to find compressed data) and binflate (to extract data).
 *
 * For ELF binaries on Linux, markers MUST be stored in PT_NOTE segments.
 * This is required because direct marker embedding in ELF binaries does not work reliably.
 */

#ifndef PTNOTE_FINDER_H
#define PTNOTE_FINDER_H

#ifdef __linux__

#include <string.h>
#include <stdio.h>
#include <unistd.h>
#include <stdlib.h>
#include <stdint.h>
#include <elf.h>

/**
 * Find a magic marker in PT_NOTE segments of an ELF binary
 *
 * @param fd File descriptor to search (must be open for reading)
 * @param marker_part1 First part of the marker (to avoid marker in binary)
 * @param marker_part2 Second part of the marker
 * @param marker_part3 Third part of the marker
 * @param return_offset_after If 1, return offset AFTER marker; if 0, return offset AT marker start
 * @return Offset to marker (or after marker, depending on return_offset_after), or -1 if not found
 *
 * This function:
 * 1. Reads and validates ELF header (supports 32-bit and 64-bit)
 * 2. Parses program headers
 * 3. Searches PT_NOTE segments (p_type == 4) for the marker
 * 4. Returns file offset to marker location
 *
 * The marker is split into three parts to prevent it from appearing in the binary itself.
 *
 * Note: Only little-endian ELF binaries are supported. Big-endian will return -1.
 *
 * Example usage:
 *   // For stub (needs to seek past marker to read metadata)
 *   long marker_pos = find_marker_in_ptnote(fd, "__SMOL_", "PRESSED_DATA_", "MAGIC_MARKER", 0);
 *   if (marker_pos >= 0) {
 *       lseek(fd, marker_pos + 32, SEEK_SET);  // Skip marker, read metadata
 *   }
 *
 *   // For decompress (needs offset directly to data after marker)
 *   long data_offset = find_marker_in_ptnote(fd, "__SMOL_", "PRESSED_DATA_", "MAGIC_MARKER", 1);
 *   if (data_offset >= 0) {
 *       lseek(fd, data_offset, SEEK_SET);  // Already past marker
 *   }
 */
static inline long find_marker_in_ptnote(int fd, const char *marker_part1, const char *marker_part2,
                                         const char *marker_part3, int return_offset_after) {
    unsigned char elf_header[64];
    if (lseek(fd, 0, SEEK_SET) == -1) {
        return -1;
    }
    if (read(fd, elf_header, 64) < 16) {
        return -1;
    }

    // Check ELF magic
    if (elf_header[0] != 0x7f || elf_header[1] != 'E' ||
        elf_header[2] != 'L' || elf_header[3] != 'F') {
        return -1;
    }

    int is_64bit = (elf_header[4] == 2);
    int is_little_endian = (elf_header[5] == 1);

    // Read ELF header fields based on bitness
    uint64_t phoff;
    uint16_t phentsize;
    uint16_t phnum;

    if (is_64bit) {
        if (is_little_endian) {
            phoff = *(uint64_t*)(elf_header + 32);
            phentsize = *(uint16_t*)(elf_header + 54);
            phnum = *(uint16_t*)(elf_header + 56);
        } else {
            return -1; // Big-endian not supported
        }
    } else {
        if (is_little_endian) {
            phoff = *(uint32_t*)(elf_header + 28);
            phentsize = *(uint16_t*)(elf_header + 42);
            phnum = *(uint16_t*)(elf_header + 44);
        } else {
            return -1; // Big-endian not supported
        }
    }

    // Read program headers
    unsigned char phdr_buf[4096];
    size_t phdrs_size = (size_t)phnum * phentsize;
    if (phdrs_size > sizeof(phdr_buf)) {
        return -1;
    }

    if (lseek(fd, phoff, SEEK_SET) == -1) {
        return -1;
    }
    if (read(fd, phdr_buf, phdrs_size) != (ssize_t)phdrs_size) {
        return -1;
    }

    // Calculate total marker length
    size_t total_marker_len = strlen(marker_part1) + strlen(marker_part2) + strlen(marker_part3);

    // Search PT_NOTE segments
    for (uint16_t i = 0; i < phnum; i++) {
        unsigned char *phdr = phdr_buf + (i * phentsize);
        uint32_t p_type;
        uint64_t p_offset, p_filesz;

        if (is_64bit) {
            p_type = *(uint32_t*)(phdr + 0);
            p_offset = *(uint64_t*)(phdr + 8);
            p_filesz = *(uint64_t*)(phdr + 32);
        } else {
            p_type = *(uint32_t*)(phdr + 0);
            p_offset = *(uint32_t*)(phdr + 4);
            p_filesz = *(uint32_t*)(phdr + 16);
        }

        // PT_NOTE = 4
        if (p_type != 4) {
            continue;
        }

        // Search this PT_NOTE segment for the marker
        if (p_filesz < total_marker_len) {
            continue;
        }

        // Read PT_NOTE content
        unsigned char *note_buf = malloc(p_filesz);
        if (!note_buf) {
            continue;
        }

        if (lseek(fd, p_offset, SEEK_SET) == -1) {
            free(note_buf);
            continue;
        }
        if (read(fd, note_buf, p_filesz) != (ssize_t)p_filesz) {
            free(note_buf);
            continue;
        }

        // Search for marker in this segment
        for (size_t pos = 0; pos <= p_filesz - total_marker_len; pos++) {
            if (memcmp(note_buf + pos, marker_part1, strlen(marker_part1)) == 0 &&
                memcmp(note_buf + pos + strlen(marker_part1), marker_part2, strlen(marker_part2)) == 0 &&
                memcmp(note_buf + pos + strlen(marker_part1) + strlen(marker_part2), marker_part3, strlen(marker_part3)) == 0) {
                // Found marker
                long marker_offset;
                if (return_offset_after) {
                    // Return offset AFTER the marker (for direct data access)
                    marker_offset = p_offset + pos + total_marker_len;
                } else {
                    // Return offset AT the marker start (caller will skip marker manually)
                    marker_offset = p_offset + pos;
                }
                free(note_buf);
                return marker_offset;
            }
        }

        free(note_buf);
    }

    return -1;
}

#endif /* __linux__ */

#endif /* PTNOTE_FINDER_H */
