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
            memcpy(&phoff, elf_header + 32, sizeof(phoff));
            memcpy(&phentsize, elf_header + 54, sizeof(phentsize));
            memcpy(&phnum, elf_header + 56, sizeof(phnum));
        } else {
            return -1; // Big-endian not supported
        }
    } else {
        if (is_little_endian) {
            uint32_t phoff32;
            memcpy(&phoff32, elf_header + 28, sizeof(phoff32));
            phoff = phoff32;
            memcpy(&phentsize, elf_header + 42, sizeof(phentsize));
            memcpy(&phnum, elf_header + 44, sizeof(phnum));
        } else {
            return -1; // Big-endian not supported
        }
    }

    // Read program headers
    unsigned char phdr_buf[4096];

    // Check for integer overflow before multiplication
    if (phnum > 0 && phentsize > SIZE_MAX / phnum) {
        return -1;  // Overflow would occur
    }
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

    // Build complete marker once for single memcmp (faster than 3 separate calls)
    char marker[128];
    size_t total_marker_len = (size_t)snprintf(marker, sizeof(marker), "%s%s%s",
                                                marker_part1, marker_part2, marker_part3);
    if (total_marker_len >= sizeof(marker)) {
        return -1;  // Marker too long
    }

    // Pre-compute offsets based on bitness (hoist branch out of loop).
    // 64-bit: p_offset at +8 (8 bytes), p_filesz at +32 (8 bytes)
    // 32-bit: p_offset at +4 (4 bytes), p_filesz at +16 (4 bytes)
    const int offset_pos = is_64bit ? 8 : 4;
    const int filesz_pos = is_64bit ? 32 : 16;

    // Pre-compute marker head for two-level search (hoist out of loops).
    // MAGIC_MARKER is always >= 4 bytes, so this is always valid.
    uint32_t marker_head;
    memcpy(&marker_head, marker, 4);

    // Find max PT_NOTE size to allocate buffer once outside loop
    uint64_t max_note_size = 0;
    for (uint16_t i = 0; i < phnum; i++) {
        unsigned char *phdr = phdr_buf + (i * phentsize);
        uint32_t p_type;
        memcpy(&p_type, phdr + 0, sizeof(p_type));
        if (p_type != 4) continue;  // PT_NOTE = 4

        uint64_t p_filesz;
        if (is_64bit) {
            memcpy(&p_filesz, phdr + filesz_pos, sizeof(p_filesz));
        } else {
            uint32_t p_filesz32;
            memcpy(&p_filesz32, phdr + filesz_pos, sizeof(p_filesz32));
            p_filesz = p_filesz32;
        }
        if (p_filesz > max_note_size) {
            max_note_size = p_filesz;
        }
    }

    // Allocate single reusable buffer for all PT_NOTE segments
    if (max_note_size < total_marker_len || max_note_size > 64 * 1024 * 1024) {
        return -1;  // No valid PT_NOTE or size limit exceeded
    }
    unsigned char *note_buf = malloc(max_note_size);
    if (!note_buf) {
        return -1;
    }

    // Search PT_NOTE segments
    for (uint16_t i = 0; i < phnum; i++) {
        unsigned char *phdr = phdr_buf + (i * phentsize);
        uint32_t p_type;
        memcpy(&p_type, phdr + 0, sizeof(p_type));

        // PT_NOTE = 4
        if (p_type != 4) {
            continue;
        }

        uint64_t p_offset, p_filesz;
        if (is_64bit) {
            memcpy(&p_offset, phdr + offset_pos, sizeof(p_offset));
            memcpy(&p_filesz, phdr + filesz_pos, sizeof(p_filesz));
        } else {
            uint32_t p_offset32, p_filesz32;
            memcpy(&p_offset32, phdr + offset_pos, sizeof(p_offset32));
            memcpy(&p_filesz32, phdr + filesz_pos, sizeof(p_filesz32));
            p_offset = p_offset32;
            p_filesz = p_filesz32;
        }

        // Search this PT_NOTE segment for the marker
        if (p_filesz < total_marker_len) {
            continue;
        }

        // Read PT_NOTE content into reusable buffer
        if (lseek(fd, p_offset, SEEK_SET) == -1) {
            continue;
        }
        if (read(fd, note_buf, p_filesz) != (ssize_t)p_filesz) {
            continue;
        }

        // Two-level search: check first 4 bytes before full memcmp.
        // This is faster because most positions fail early without full comparison.
        const size_t search_limit = p_filesz - total_marker_len;
        for (size_t pos = 0; pos <= search_limit; pos++) {
            // FAST: Check first 4 bytes (single comparison)
            uint32_t buf_head;
            memcpy(&buf_head, note_buf + pos, 4);
            if (buf_head != marker_head) {
                continue;  // Fast rejection
            }
            // SLOW: Full comparison only if prefix matches
            if (memcmp(note_buf + pos, marker, total_marker_len) == 0) {
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
    }

    free(note_buf);
    return -1;
}

#endif /* __linux__ */

#endif /* PTNOTE_FINDER_H */
