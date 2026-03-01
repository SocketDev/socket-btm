/**
 * @file smol_segment_reader.c
 * @brief Shared SMOL segment reading utilities implementation.
 *
 * Cross-platform support for Windows, macOS, and Linux.
 */

#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <limits.h>
#include <errno.h>
#include "socketsecurity/bin-infra/smol_segment_reader.h"
#include "socketsecurity/bin-infra/marker_finder.h"
#include "socketsecurity/bin-infra/compression_constants.h"
#include "socketsecurity/build-infra/path_utils.h"
#include "socketsecurity/build-infra/file_io_common.h"

/**
 * Windows compatibility.
 * posix_compat.h provides POSIX function mappings (read, lseek, etc.)
 * and types (ssize_t, off_t) for Windows.
 */
#ifdef _WIN32
    #include "socketsecurity/build-infra/posix_compat.h"
#else
    #include <unistd.h>
    #include <fcntl.h>  /* For O_RDONLY */
#endif

/**
 * Read SMOL metadata after marker position.
 *
 * Assumes file descriptor is positioned immediately after the magic marker.
 * This is extracted as a shared helper to avoid code duplication between
 * platforms with different marker-finding strategies.
 */
int smol_read_metadata_after_marker(int fd, smol_metadata_t *metadata) {
    if (fd < 0 || !metadata) {
        fprintf(stderr, "Error: Invalid arguments to smol_read_metadata_after_marker\n");
        return -1;
    }

    /* Initialize metadata structure. */
    memset(metadata, 0, sizeof(smol_metadata_t));

    /* Read compressed size (8 bytes). Use read_eintr for signal safety. */
    if (read_eintr(fd, &metadata->compressed_size, sizeof(metadata->compressed_size))
        != sizeof(metadata->compressed_size)) {
        fprintf(stderr, "Error: Failed to read compressed size\n");
        return -1;
    }

    /* Read uncompressed size (8 bytes). */
    if (read_eintr(fd, &metadata->uncompressed_size, sizeof(metadata->uncompressed_size))
        != sizeof(metadata->uncompressed_size)) {
        fprintf(stderr, "Error: Failed to read uncompressed size\n");
        return -1;
    }

    /* Read cache key (16 bytes, not null-terminated in binary). */
    char cache_key_raw[CACHE_KEY_LEN];
    if (read_eintr(fd, cache_key_raw, CACHE_KEY_LEN) != CACHE_KEY_LEN) {
        fprintf(stderr, "Error: Failed to read cache key\n");
        return -1;
    }
    /* Copy to output and null-terminate. */
    memcpy(metadata->cache_key, cache_key_raw, CACHE_KEY_LEN);
    metadata->cache_key[CACHE_KEY_LEN] = '\0';

    /* Read platform metadata (PLATFORM_METADATA_LEN bytes: platform, arch, libc). */
    if (read_eintr(fd, metadata->platform_metadata, PLATFORM_METADATA_LEN) != PLATFORM_METADATA_LEN) {
        fprintf(stderr, "Error: Failed to read platform metadata\n");
        return -1;
    }

    /* Read has_smol_config flag (SMOL_CONFIG_FLAG_LEN byte). */
    uint8_t has_smol_config;
    if (read_eintr(fd, &has_smol_config, SMOL_CONFIG_FLAG_LEN) != SMOL_CONFIG_FLAG_LEN) {
        fprintf(stderr, "Error: Failed to read has_smol_config flag\n");
        return -1;
    }

    /* Skip smol config binary if present (SMOL_CONFIG_BINARY_LEN bytes). */
    if (has_smol_config != 0) {
        /* Smol config binary is present, skip it. */
        if (lseek(fd, SMOL_CONFIG_BINARY_LEN, SEEK_CUR) == -1) {
            fprintf(stderr, "Error: Failed to skip smol config binary: %s\n", strerror(errno));
            return -1;
        }
    }

    /* Record offset to compressed data (current position). */
    metadata->data_offset = lseek(fd, 0, SEEK_CUR);
    if (metadata->data_offset == -1) {
        fprintf(stderr, "Error: Failed to get data offset: %s\n", strerror(errno));
        return -1;
    }

    return 0;
}

/**
 * Read SMOL metadata from file descriptor.
 */
int smol_read_metadata(int fd, smol_metadata_t *metadata) {
    if (fd < 0 || !metadata) {
        fprintf(stderr, "Error: Invalid arguments to smol_read_metadata\n");
        return -1;
    }

    /* Find compressed data marker. */
    int64_t data_offset = find_marker(fd, MAGIC_MARKER_PART1, MAGIC_MARKER_PART2,
                                      MAGIC_MARKER_PART3, MAGIC_MARKER_LEN);
    if (data_offset == -1) {
        fprintf(stderr, "Error: Could not find compressed data marker\n");
        return -1;
    }

    /* Seek to metadata (find_marker returns offset AFTER marker). */
    if (lseek(fd, data_offset, SEEK_SET) == -1) {
        fprintf(stderr, "Error: Failed to seek to metadata: %s\n", strerror(errno));
        return -1;
    }

    /* Use shared helper to read metadata. */
    return smol_read_metadata_after_marker(fd, metadata);
}

/**
 * Validate SMOL metadata.
 */
int smol_validate_metadata(const smol_metadata_t *metadata, size_t max_size) {
    if (!metadata) {
        fprintf(stderr, "Error: NULL metadata pointer\n");
        return -1;
    }

    /* Validate sizes are non-zero. */
    if (metadata->compressed_size == 0 || metadata->uncompressed_size == 0) {
        fprintf(stderr, "Error: Invalid sizes (compressed=%llu, uncompressed=%llu)\n",
                (unsigned long long)metadata->compressed_size,
                (unsigned long long)metadata->uncompressed_size);
        return -1;
    }

    /* Validate sizes against max_size limit (if specified). */
    if (max_size > 0) {
        if (metadata->compressed_size > max_size) {
            fprintf(stderr, "Error: Compressed size %llu exceeds limit %zu\n",
                    (unsigned long long)metadata->compressed_size, max_size);
            return -1;
        }
        if (metadata->uncompressed_size > max_size) {
            fprintf(stderr, "Error: Uncompressed size %llu exceeds limit %zu\n",
                    (unsigned long long)metadata->uncompressed_size, max_size);
            return -1;
        }
    }

    /* Validate cache key is exactly 16 hex characters. */
    if (strlen(metadata->cache_key) != CACHE_KEY_LEN) {
        fprintf(stderr, "Error: Cache key must be exactly %d characters (got %zu)\n",
                CACHE_KEY_LEN, strlen(metadata->cache_key));
        return -1;
    }

    for (int i = 0; i < CACHE_KEY_LEN; i++) {
        char c = metadata->cache_key[i];
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))) {
            fprintf(stderr, "Error: Invalid cache key format (must be hex)\n");
            return -1;
        }
    }

    /* Validate platform metadata values are in valid ranges. */
    uint8_t platform = metadata->platform_metadata[0];
    uint8_t arch = metadata->platform_metadata[1];
    uint8_t libc = metadata->platform_metadata[2];

    if (platform > PLATFORM_WIN32) {
        fprintf(stderr, "Error: Invalid platform value: %u (expected 0-2)\n", platform);
        return -1;
    }
    if (arch > ARCH_ARM) {
        fprintf(stderr, "Error: Invalid architecture value: %u (expected 0-3)\n", arch);
        return -1;
    }
    if (libc != LIBC_GLIBC && libc != LIBC_MUSL && libc != LIBC_NA) {
        fprintf(stderr, "Error: Invalid libc value: %u (expected 0, 1, or 255)\n", libc);
        return -1;
    }

    return 0;
}

/**
 * Search for SMOL marker in memory buffer.
 */
int smol_find_marker_in_buffer(const uint8_t *buffer, size_t size, size_t *offset_out) {
    if (!buffer || !offset_out || size == 0) {
        return -1;
    }

    /* Build marker at runtime to avoid false positives. */
    char marker[MAGIC_MARKER_LEN + 1];
    int marker_len = snprintf(marker, sizeof(marker), "%s%s%s",
                             MAGIC_MARKER_PART1, MAGIC_MARKER_PART2, MAGIC_MARKER_PART3);

    if (marker_len != (int)MAGIC_MARKER_LEN) {
        return -1;
    }

    /* Search for marker in buffer. */
    if (size < MAGIC_MARKER_LEN) {
        return -1;
    }

    /* Two-level search: check first 4 bytes before full memcmp.
     * This is faster because most positions fail early without full comparison. */
    uint32_t marker_head = 0;
    memcpy(&marker_head, marker, 4);

    const size_t search_limit = size - MAGIC_MARKER_LEN;
    for (size_t i = 0; i <= search_limit; i++) {
        /* FAST: Check first 4 bytes (single comparison). */
        uint32_t buf_head;
        memcpy(&buf_head, buffer + i, 4);
        if (buf_head != marker_head) {
            continue;  /* Fast rejection. */
        }
        /* SLOW: Full comparison only if prefix matches. */
        if (memcmp(buffer + i, marker, MAGIC_MARKER_LEN) == 0) {
            *offset_out = i;
            return 0;
        }
    }

    return -1;
}

/* Mach-O magic numbers */
#define MH_MAGIC_64 0xfeedfacf
#define MH_CIGAM_64 0xcffaedfe
#define MH_MAGIC    0xfeedface
#define MH_CIGAM    0xcefaedfe
#define FAT_MAGIC   0xcafebabe
#define FAT_CIGAM   0xbebafeca
#define FAT_MAGIC_64 0xcafebabf
#define FAT_CIGAM_64 0xbfbafeca

/* Load command types */
#define LC_SEGMENT    0x1
#define LC_SEGMENT_64 0x19

/* Mach-O header offsets */
#define MACHO_HEADER_NCMDS_OFFSET 16  /* Offset of ncmds field in both mach_header and mach_header_64 */

#if defined(__APPLE__)
/**
 * Find SMOL segment offset directly from Mach-O headers.
 * This is MUCH faster than scanning the entire file for the magic marker.
 *
 * Instead of reading potentially 20MB+ of file data to find the marker,
 * this reads only ~4-8KB of Mach-O headers to find the segment offset directly.
 *
 * @param fd File descriptor (must be open for reading, seekable)
 * @param section_fileoff_out Output: file offset to __PRESSED_DATA section data
 * @return 0 on success, -1 on error
 */
static int smol_find_pressed_data_offset_macho(int fd, int64_t *section_fileoff_out) {
    if (fd < 0 || !section_fileoff_out) {
        return -1;
    }

    /* Seek to beginning. */
    if (lseek(fd, 0, SEEK_SET) == -1) {
        return -1;
    }

    /* Read magic number. */
    uint32_t magic;
    if (read_eintr(fd, &magic, sizeof(magic)) != sizeof(magic)) {
        return -1;
    }

    /* Check if it's a Mach-O file. */
    int is_64bit;
    if (magic == MH_MAGIC_64 || magic == MH_CIGAM_64) {
        is_64bit = 1;
    } else if (magic == MH_MAGIC || magic == MH_CIGAM) {
        is_64bit = 0;
    } else {
        return -1;  /* Not a Mach-O file. */
    }

    /* Read ncmds. */
    if (lseek(fd, MACHO_HEADER_NCMDS_OFFSET, SEEK_SET) == -1) {
        return -1;
    }

    uint32_t ncmds;
    if (read_eintr(fd, &ncmds, sizeof(ncmds)) != sizeof(ncmds)) {
        return -1;
    }

    /* Validate ncmds. */
    #define MAX_REASONABLE_NCMDS_FD 10000
    if (ncmds > MAX_REASONABLE_NCMDS_FD) {
        return -1;
    }

    /* Position after header. */
    off_t load_cmd_offset = is_64bit ? 32 : 28;
    if (lseek(fd, load_cmd_offset, SEEK_SET) == -1) {
        return -1;
    }

    /* Iterate through load commands looking for SMOL segment. */
    for (uint32_t i = 0; i < ncmds; i++) {
        off_t cmd_start = lseek(fd, 0, SEEK_CUR);
        if (cmd_start == -1) {
            return -1;
        }

        uint32_t cmd, cmdsize;
        if (read_eintr(fd, &cmd, sizeof(cmd)) != sizeof(cmd) ||
            read_eintr(fd, &cmdsize, sizeof(cmdsize)) != sizeof(cmdsize)) {
            return -1;
        }

        if (cmd == (uint32_t)(is_64bit ? LC_SEGMENT_64 : LC_SEGMENT)) {
            char segname[16];
            if (read_eintr(fd, segname, 16) != 16) {
                return -1;
            }

            /* Check if this is the SMOL segment. */
            if (strncmp(segname, "SMOL", 4) == 0) {
                /* Read segment fields to find sections.
                 * 64-bit: vmaddr(8), vmsize(8), fileoff(8), filesize(8), maxprot(4), initprot(4), nsects(4)
                 * 32-bit: vmaddr(4), vmsize(4), fileoff(4), filesize(4), maxprot(4), initprot(4), nsects(4)
                 */
                uint64_t seg_fileoff;
                uint32_t nsects;

                if (is_64bit) {
                    /* Skip vmaddr, vmsize. */
                    if (lseek(fd, 16, SEEK_CUR) == -1) {
                        return -1;
                    }
                    /* Read fileoff. */
                    if (read_eintr(fd, &seg_fileoff, 8) != 8) {
                        return -1;
                    }
                    /* Skip filesize, maxprot, initprot. */
                    if (lseek(fd, 8 + 4 + 4, SEEK_CUR) == -1) {
                        return -1;
                    }
                } else {
                    uint32_t fileoff32;
                    /* Skip vmaddr, vmsize. */
                    if (lseek(fd, 8, SEEK_CUR) == -1) {
                        return -1;
                    }
                    /* Read fileoff. */
                    if (read_eintr(fd, &fileoff32, 4) != 4) {
                        return -1;
                    }
                    seg_fileoff = fileoff32;
                    /* Skip filesize, maxprot, initprot. */
                    if (lseek(fd, 4 + 4 + 4, SEEK_CUR) == -1) {
                        return -1;
                    }
                }

                /* Read nsects. */
                if (read_eintr(fd, &nsects, sizeof(nsects)) != sizeof(nsects)) {
                    return -1;
                }

                #define MAX_REASONABLE_NSECTS_FD 1000
                if (nsects > MAX_REASONABLE_NSECTS_FD) {
                    return -1;
                }

                /* Skip flags (4 bytes). */
                if (lseek(fd, 4, SEEK_CUR) == -1) {
                    return -1;
                }

                /* Iterate through sections looking for __PRESSED_DATA. */
                for (uint32_t j = 0; j < nsects; j++) {
                    char sectname[16];
                    if (read_eintr(fd, sectname, 16) != 16) {
                        return -1;
                    }

                    /* Check if this is __PRESSED_DATA. */
                    if (sectname[0] == '_' && sectname[1] == '_' &&
                        strncmp(sectname, "__PRESSED_DATA", 14) == 0) {
                        /* Skip segname (16 bytes). */
                        if (lseek(fd, 16, SEEK_CUR) == -1) {
                            return -1;
                        }

                        /* Read section offset.
                         * 64-bit section: addr(8), size(8), offset(4)
                         * 32-bit section: addr(4), size(4), offset(4)
                         */
                        uint32_t section_offset;
                        if (is_64bit) {
                            /* Skip addr, size. */
                            if (lseek(fd, 16, SEEK_CUR) == -1) {
                                return -1;
                            }
                        } else {
                            /* Skip addr, size. */
                            if (lseek(fd, 8, SEEK_CUR) == -1) {
                                return -1;
                            }
                        }
                        if (read_eintr(fd, &section_offset, sizeof(section_offset)) != sizeof(section_offset)) {
                            return -1;
                        }

                        *section_fileoff_out = section_offset;
                        return 0;
                    }

                    /* Skip rest of section structure.
                     * 64-bit: sectname(16) + segname(16) + addr(8) + size(8) + offset(4) + align(4) + reloff(4) + nreloc(4) + flags(4) + reserved1(4) + reserved2(4) + reserved3(4) = 80 bytes
                     * 32-bit: sectname(16) + segname(16) + addr(4) + size(4) + offset(4) + align(4) + reloff(4) + nreloc(4) + flags(4) + reserved1(4) + reserved2(4) = 68 bytes
                     * We already read sectname (16 bytes), so skip remaining.
                     */
                    if (lseek(fd, is_64bit ? 64 : 52, SEEK_CUR) == -1) {
                        return -1;
                    }
                }

                /* SMOL segment found but no __PRESSED_DATA section. */
                return -1;
            }
        }

        /* Move to next load command. */
        if (cmdsize == 0 || cmdsize > INT32_MAX) {
            return -1;
        }
        if (lseek(fd, cmd_start + cmdsize, SEEK_SET) == -1) {
            return -1;
        }
    }

    return -1;  /* SMOL segment not found. */
}

/**
 * Read SMOL metadata using optimized Mach-O header parsing.
 * This is much faster than scanning the entire file for the magic marker.
 *
 * @param fd File descriptor (must be open for reading, seekable)
 * @param metadata Output structure (caller-allocated)
 * @return 0 on success, -1 on error
 */
int smol_read_metadata_macho(int fd, smol_metadata_t *metadata) {
    if (fd < 0 || !metadata) {
        fprintf(stderr, "Error: Invalid arguments to smol_read_metadata_macho\n");
        return -1;
    }

    /* Find __PRESSED_DATA section offset via Mach-O headers. */
    int64_t section_offset;
    if (smol_find_pressed_data_offset_macho(fd, &section_offset) != 0) {
        /* Fallback to slow marker search. */
        return smol_read_metadata(fd, metadata);
    }

    /* Seek to section data (which starts with magic marker). */
    if (lseek(fd, section_offset + MAGIC_MARKER_LEN, SEEK_SET) == -1) {
        fprintf(stderr, "Error: Failed to seek to section data: %s\n", strerror(errno));
        return -1;
    }

    /* Use shared helper to read metadata. */
    return smol_read_metadata_after_marker(fd, metadata);
}
#endif /* __APPLE__ */

#if defined(__linux__)
#include "socketsecurity/bin-infra/ptnote_finder.h"

/**
 * Find SMOL data offset directly from ELF PT_NOTE headers.
 * This is MUCH faster than scanning the entire file for the magic marker.
 *
 * Instead of reading potentially 20MB+ of file data to find the marker,
 * this reads only ELF headers (~4-8KB) to find the PT_NOTE with our marker.
 *
 * @param fd File descriptor (must be open for reading, seekable)
 * @param section_offset_out Output: file offset to PRESSED_DATA content (at marker start)
 * @return 0 on success, -1 on error
 */
static int smol_find_pressed_data_offset_elf(int fd, int64_t *section_offset_out) {
    if (fd < 0 || !section_offset_out) {
        return -1;
    }

    /* Use PT_NOTE finder which returns offset AT marker start. */
    long marker_pos = find_marker_in_ptnote(fd, MAGIC_MARKER_PART1, MAGIC_MARKER_PART2,
                                            MAGIC_MARKER_PART3, 0);
    if (marker_pos < 0) {
        return -1;
    }

    *section_offset_out = marker_pos;
    return 0;
}

/**
 * Read SMOL metadata using optimized ELF PT_NOTE search.
 * This is much faster than scanning the entire file for the magic marker.
 *
 * @param fd File descriptor (must be open for reading, seekable)
 * @param metadata Output structure (caller-allocated)
 * @return 0 on success, -1 on error
 */
int smol_read_metadata_elf(int fd, smol_metadata_t *metadata) {
    if (fd < 0 || !metadata) {
        fprintf(stderr, "Error: Invalid arguments to smol_read_metadata_elf\n");
        return -1;
    }

    /* Find marker in PT_NOTE segments (returns offset AT marker start). */
    long marker_pos = find_marker_in_ptnote(fd, MAGIC_MARKER_PART1, MAGIC_MARKER_PART2,
                                            MAGIC_MARKER_PART3, 0);
    if (marker_pos < 0) {
        /* Fallback to slow marker search. */
        return smol_read_metadata(fd, metadata);
    }

    /* Seek past the marker to the metadata. */
    if (lseek(fd, marker_pos + MAGIC_MARKER_LEN, SEEK_SET) == -1) {
        fprintf(stderr, "Error: Failed to seek to metadata after PT_NOTE marker: %s\n",
                strerror(errno));
        return -1;
    }

    /* Use shared helper to read metadata. */
    return smol_read_metadata_after_marker(fd, metadata);
}
#endif /* __linux__ */

#if defined(_WIN32)
/**
 * Find SMOL section offset directly from PE headers.
 * This is MUCH faster than scanning the entire file for the magic marker.
 *
 * Instead of reading potentially 20MB+ of file data to find the marker,
 * this reads only the PE headers (~1-2KB) to find the section offset directly.
 *
 * @param fd File descriptor (must be open for reading, seekable)
 * @param section_offset_out Output: file offset to .PRESSED_DATA section data
 * @return 0 on success, -1 on error
 */
static int smol_find_pressed_data_offset_pe(int fd, int64_t *section_offset_out) {
    if (fd < 0 || !section_offset_out) {
        return -1;
    }

    /* Seek to beginning. */
    if (lseek(fd, 0, SEEK_SET) == -1) {
        return -1;
    }

    /* Read DOS header (first 64 bytes). */
    unsigned char dos_header[64];
    if (read_eintr(fd, dos_header, 64) != 64) {
        return -1;
    }

    /* Check DOS magic ("MZ"). */
    if (dos_header[0] != 'M' || dos_header[1] != 'Z') {
        return -1;  /* Not a PE file. */
    }

    /* Get PE header offset from e_lfanew (offset 0x3C, 4 bytes). */
    uint32_t pe_offset;
    memcpy(&pe_offset, dos_header + 0x3C, 4);

    /* Seek to PE header. */
    if (lseek(fd, pe_offset, SEEK_SET) == -1) {
        return -1;
    }

    /* Read PE signature + COFF header (24 bytes). */
    unsigned char pe_header[24];
    if (read_eintr(fd, pe_header, 24) != 24) {
        return -1;
    }

    /* Check PE signature ("PE\0\0"). */
    if (pe_header[0] != 'P' || pe_header[1] != 'E' ||
        pe_header[2] != 0 || pe_header[3] != 0) {
        return -1;  /* Not a PE file. */
    }

    /* Parse COFF header (starts at offset 4 in pe_header).
     * NumberOfSections: offset 2 (2 bytes)
     * SizeOfOptionalHeader: offset 16 (2 bytes)
     */
    uint16_t number_of_sections;
    uint16_t size_of_optional_header;
    memcpy(&number_of_sections, pe_header + 4 + 2, 2);
    memcpy(&size_of_optional_header, pe_header + 4 + 16, 2);

    /* Validate number of sections. */
    #define MAX_REASONABLE_SECTIONS 200
    if (number_of_sections > MAX_REASONABLE_SECTIONS) {
        return -1;
    }

    /* Calculate section table offset.
     * Section table starts immediately after optional header.
     * Section table offset = pe_offset + 24 (signature + COFF header) + SizeOfOptionalHeader
     */
    long section_table_offset = pe_offset + 24 + size_of_optional_header;

    /* Seek to section table. */
    if (lseek(fd, section_table_offset, SEEK_SET) == -1) {
        return -1;
    }

    /* Each section header is 40 bytes.
     * Name: offset 0 (8 bytes, null-padded)
     * PointerToRawData: offset 20 (4 bytes) - file offset
     */
    for (uint16_t i = 0; i < number_of_sections; i++) {
        unsigned char section_header[40];
        if (read_eintr(fd, section_header, 40) != 40) {
            return -1;
        }

        /* Check if this is .PRESSED_DATA section. */
        /* Section name is 8 bytes, null-padded. */
        if (section_header[0] == '.' &&
            section_header[1] == 'P' &&
            section_header[2] == 'R' &&
            section_header[3] == 'E' &&
            section_header[4] == 'S' &&
            section_header[5] == 'S' &&
            section_header[6] == 'E' &&
            section_header[7] == 'D') {
            /* Found it! Get PointerToRawData. */
            uint32_t pointer_to_raw_data;
            memcpy(&pointer_to_raw_data, section_header + 20, 4);
            *section_offset_out = pointer_to_raw_data;
            return 0;
        }
    }

    return -1;  /* Section not found. */
}

/**
 * Read SMOL metadata using optimized PE header parsing.
 * This is much faster than scanning the entire file for the magic marker.
 *
 * @param fd File descriptor (must be open for reading, seekable)
 * @param metadata Output structure (caller-allocated)
 * @return 0 on success, -1 on error
 */
int smol_read_metadata_pe(int fd, smol_metadata_t *metadata) {
    if (fd < 0 || !metadata) {
        fprintf(stderr, "Error: Invalid arguments to smol_read_metadata_pe\n");
        return -1;
    }

    /* Find .PRESSED_DATA section offset via PE headers. */
    int64_t section_offset;
    if (smol_find_pressed_data_offset_pe(fd, &section_offset) != 0) {
        /* Fallback to slow marker search. */
        return smol_read_metadata(fd, metadata);
    }

    /* Seek to section data (which starts with magic marker). */
    if (lseek(fd, section_offset + MAGIC_MARKER_LEN, SEEK_SET) == -1) {
        fprintf(stderr, "Error: Failed to seek to section data: %s\n", strerror(errno));
        return -1;
    }

    /* Use shared helper to read metadata. */
    return smol_read_metadata_after_marker(fd, metadata);
}
#endif /* _WIN32 */

/**
 * Check if Mach-O binary has __PRESSED_DATA section in SMOL segment.
 *
 * Internal implementation - pure C, no LIEF dependency.
 * Called by binject directly via smol_detect.h.
 */
int smol_has_pressed_data_macho_impl(const char *path) {
    if (!path) {
        return -1;
    }

    /* Resolve relative paths to absolute paths to avoid fopen() issues with relative paths. */
    char resolved_path[PATH_MAX];
    const char *path_to_open = resolve_absolute_path(path, resolved_path);

    FILE *fp = fopen(path_to_open, "rb");
    if (!fp) {
        return 0;  /* File not found = not a SMOL stub */
    }

    uint32_t magic;
    if (fread(&magic, sizeof(magic), 1, fp) != 1) {
        fclose(fp);
        return 0;
    }

    /* Check if it's a Mach-O file */
    int is_64bit = 0;
    if (magic == MH_MAGIC_64 || magic == MH_CIGAM_64) {
        is_64bit = 1;
    } else if (magic == MH_MAGIC || magic == MH_CIGAM) {
        is_64bit = 0;
    } else {
        fclose(fp);
        return 0;  /* Not a Mach-O file */
    }

    /* Read ncmds and sizeofcmds from mach_header */
    /* mach_header: magic(4), cputype(4), cpusubtype(4), filetype(4), ncmds(4), sizeofcmds(4), flags(4) */
    /* mach_header_64: same as mach_header + reserved(4) */
    /* ncmds is at offset 16 (both 32-bit and 64-bit) */
    uint32_t ncmds, sizeofcmds;
    if (fseek(fp, MACHO_HEADER_NCMDS_OFFSET, SEEK_SET) != 0) {
        fclose(fp);
        return 0;
    }

    if (fread(&ncmds, sizeof(ncmds), 1, fp) != 1 ||
        fread(&sizeofcmds, sizeof(sizeofcmds), 1, fp) != 1) {
        fclose(fp);
        return 0;
    }

    /* Validate ncmds against sizeofcmds to prevent DoS attacks
     * Each load command is at least 8 bytes (cmd + cmdsize)
     * Reasonable upper bound: 10000 load commands */
    #define MIN_LOAD_COMMAND_SIZE 8
    #define MAX_REASONABLE_NCMDS 10000
    if (ncmds > MAX_REASONABLE_NCMDS || ncmds > sizeofcmds / MIN_LOAD_COMMAND_SIZE) {
        fclose(fp);
        return 0;
    }

    /* Position after header */
    long load_cmd_offset = is_64bit ? 32 : 28;
    if (fseek(fp, load_cmd_offset, SEEK_SET) != 0) {
        fclose(fp);
        return 0;
    }

    /* Iterate through load commands looking for SMOL segment with __PRESSED_DATA section */
    for (uint32_t i = 0; i < ncmds; i++) {
        uint32_t cmd, cmdsize;
        long cmd_start = ftell(fp);

        if (fread(&cmd, sizeof(cmd), 1, fp) != 1 ||
            fread(&cmdsize, sizeof(cmdsize), 1, fp) != 1) {
            break;
        }

        if (cmd == (is_64bit ? LC_SEGMENT_64 : LC_SEGMENT)) {
            char segname[16];
            if (fread(segname, 16, 1, fp) != 1) {
                break;
            }

            /* Check if this is the SMOL segment */
            if (strncmp(segname, "SMOL", 4) == 0) {
                /* Read nsects field (skip vmaddr, vmsize, fileoff, filesize, maxprot, initprot) */
                /* 64-bit: 8+8+8+8+4+4 = 40 bytes, 32-bit: 4+4+4+4+4+4 = 24 bytes */
                if (fseek(fp, is_64bit ? 40 : 24, SEEK_CUR) != 0) {
                    break;
                }

                uint32_t nsects;
                if (fread(&nsects, sizeof(nsects), 1, fp) != 1) {
                    break;
                }

                /* Validate nsects to prevent DoS attacks
                 * Reasonable upper bound: 1000 sections per segment */
                #define MAX_REASONABLE_NSECTS 1000
                if (nsects > MAX_REASONABLE_NSECTS) {
                    break;
                }

                /* Skip flags */
                if (fseek(fp, 4, SEEK_CUR) != 0) {
                    break;
                }

                /* Iterate through sections */
                for (uint32_t j = 0; j < nsects; j++) {
                    char sectname[16];
                    if (fread(sectname, 16, 1, fp) != 1) {
                        break;
                    }

                    /* Check if this is __PRESSED_DATA using two-level comparison:
                     * 1. FAST: Check first 2 bytes ("__") - most sections have this
                     * 2. SLOW: Full comparison only if prefix matches */
                    if (sectname[0] == '_' && sectname[1] == '_') {
                        if (strncmp(sectname, "__PRESSED_DATA", 14) == 0) {
                            fclose(fp);
                            return 1;  /* Found it! */
                        }
                    }

                    /* Skip rest of section structure (different sizes for 32/64-bit) */
                    if (fseek(fp, is_64bit ? 64 : 52, SEEK_CUR) != 0) {
                        break;
                    }
                }
            }
        }

        /* Move to next load command - validate cmdsize to prevent integer overflow */
        if (cmdsize == 0 || cmdsize > INT32_MAX) {
            break;  /* Invalid or malicious cmdsize */
        }
        /* Check for overflow in addition */
        if (cmd_start > LONG_MAX - (long)cmdsize) {
            break;  /* Would overflow */
        }
        if (fseek(fp, cmd_start + cmdsize, SEEK_SET) != 0) {
            break;
        }
    }

    fclose(fp);
    return 0;  /* Not found */
}

/**
 * SMFG config offsets and constants.
 * nodeVersion is at offset 1176 in the 1192-byte SMFG v2 binary.
 * Format: length byte (1) + version string (up to 15 chars).
 */
#define SMFG_MAGIC 0x534D4647  /* "SMFG" */
#define SMFG_VERSION_OFFSET 4
#define SMFG_NODE_VERSION_OFFSET 1176
#define SMFG_NODE_VERSION_MAX_LEN 15

/**
 * Extract Node.js version from SMFG config binary.
 *
 * @param smfg_config 1192-byte SMFG config binary
 * @return Version string (caller must free), or NULL if not found/invalid
 */
static char* extract_version_from_smfg(const uint8_t *smfg_config) {
    if (!smfg_config) {
        return NULL;
    }

    /* Verify SMFG magic. */
    uint32_t magic;
    memcpy(&magic, smfg_config, sizeof(magic));
    if (magic != SMFG_MAGIC) {
        return NULL;
    }

    /* Verify SMFG version >= 2 (v2 added nodeVersion field). */
    uint16_t version;
    memcpy(&version, smfg_config + SMFG_VERSION_OFFSET, sizeof(version));
    if (version < 2) {
        return NULL;
    }

    /* Read nodeVersion: length byte + string. */
    uint8_t len = smfg_config[SMFG_NODE_VERSION_OFFSET];
    if (len == 0 || len > SMFG_NODE_VERSION_MAX_LEN) {
        return NULL;
    }

    char *result = (char *)malloc(len + 1);
    if (!result) {
        return NULL;
    }

    memcpy(result, smfg_config + SMFG_NODE_VERSION_OFFSET + 1, len);
    result[len] = '\0';

    return result;
}

/**
 * Read SMOL metadata and SMFG config from file descriptor.
 *
 * Similar to smol_read_metadata_after_marker but also reads the SMFG config
 * binary (if present) instead of skipping it.
 *
 * @param fd File descriptor positioned immediately after magic marker
 * @param metadata Output: metadata structure (caller-allocated)
 * @param smfg_config_out Output: SMFG config buffer (caller must free), or NULL if not present
 * @return 0 on success, -1 on error
 */
static int smol_read_metadata_with_config(int fd, smol_metadata_t *metadata, uint8_t **smfg_config_out) {
    if (fd < 0 || !metadata || !smfg_config_out) {
        return -1;
    }

    *smfg_config_out = NULL;

    /* Initialize metadata structure. */
    memset(metadata, 0, sizeof(smol_metadata_t));

    /* Read compressed size (8 bytes). */
    if (read_eintr(fd, &metadata->compressed_size, sizeof(metadata->compressed_size))
        != sizeof(metadata->compressed_size)) {
        return -1;
    }

    /* Read uncompressed size (8 bytes). */
    if (read_eintr(fd, &metadata->uncompressed_size, sizeof(metadata->uncompressed_size))
        != sizeof(metadata->uncompressed_size)) {
        return -1;
    }

    /* Read cache key (16 bytes). */
    char cache_key_raw[CACHE_KEY_LEN];
    if (read_eintr(fd, cache_key_raw, CACHE_KEY_LEN) != CACHE_KEY_LEN) {
        return -1;
    }
    memcpy(metadata->cache_key, cache_key_raw, CACHE_KEY_LEN);
    metadata->cache_key[CACHE_KEY_LEN] = '\0';

    /* Read platform metadata (3 bytes). */
    if (read_eintr(fd, metadata->platform_metadata, PLATFORM_METADATA_LEN) != PLATFORM_METADATA_LEN) {
        return -1;
    }

    /* Read has_smol_config flag (1 byte). */
    uint8_t has_smol_config;
    if (read_eintr(fd, &has_smol_config, SMOL_CONFIG_FLAG_LEN) != SMOL_CONFIG_FLAG_LEN) {
        return -1;
    }

    /* Read SMFG config binary if present. */
    if (has_smol_config != 0) {
        uint8_t *config = (uint8_t *)malloc(SMOL_CONFIG_BINARY_LEN);
        if (!config) {
            return -1;
        }
        if (read_eintr(fd, config, SMOL_CONFIG_BINARY_LEN) != SMOL_CONFIG_BINARY_LEN) {
            free(config);
            return -1;
        }
        *smfg_config_out = config;
    }

    /* Record offset to compressed data. */
    metadata->data_offset = lseek(fd, 0, SEEK_CUR);
    if (metadata->data_offset == -1) {
        if (*smfg_config_out) {
            free(*smfg_config_out);
            *smfg_config_out = NULL;
        }
        return -1;
    }

    return 0;
}

/**
 * Extract Node.js version from SMOL binary using fast native parsing.
 *
 * This is much faster than the LIEF-based smol_extract_node_version() because
 * it uses platform-specific header parsing instead of full binary analysis.
 *
 * Works for:
 * - SMOL stubs (compressed binaries with PRESSED_DATA section)
 * - node-smol binaries (with SMFG config in PRESSED_DATA)
 *
 * Does NOT work for:
 * - Plain Node.js binaries (no SMOL sections)
 * - PE VS_VERSION_INFO extraction (use LIEF version for that)
 *
 * @param binary_path Path to binary file
 * @return Version string (e.g., "25.5.0"), or NULL if not found.
 *         Caller must free() the returned string.
 */
char* smol_extract_node_version_fast(const char *binary_path) {
    if (!binary_path) {
        return NULL;
    }

#ifdef _WIN32
    int fd = _open(binary_path, _O_RDONLY | _O_BINARY);
#else
    int fd = open(binary_path, O_RDONLY);
#endif
    if (fd < 0) {
        return NULL;
    }

    smol_metadata_t metadata;
    uint8_t *smfg_config = NULL;
    char *version = NULL;

    /* Try platform-optimized marker finding first. */
#if defined(__APPLE__)
    int64_t section_offset;
    if (smol_find_pressed_data_offset_macho(fd, &section_offset) == 0 && section_offset > 0) {
        /* Seek past the magic marker. */
        if (lseek(fd, section_offset + MAGIC_MARKER_LEN, SEEK_SET) != -1) {
            if (smol_read_metadata_with_config(fd, &metadata, &smfg_config) == 0 && smfg_config) {
                version = extract_version_from_smfg(smfg_config);
                free(smfg_config);
            }
        }
    }
#elif defined(__linux__)
    int64_t section_offset;
    if (smol_find_pressed_data_offset_elf(fd, &section_offset) == 0 && section_offset > 0) {
        /* Seek past the magic marker. */
        if (lseek(fd, section_offset + MAGIC_MARKER_LEN, SEEK_SET) != -1) {
            if (smol_read_metadata_with_config(fd, &metadata, &smfg_config) == 0 && smfg_config) {
                version = extract_version_from_smfg(smfg_config);
                free(smfg_config);
            }
        }
    }
#elif defined(_WIN32)
    int64_t section_offset;
    if (smol_find_pressed_data_offset_pe(fd, &section_offset) == 0 && section_offset > 0) {
        /* Seek past the magic marker. */
        if (lseek(fd, section_offset + MAGIC_MARKER_LEN, SEEK_SET) != -1) {
            if (smol_read_metadata_with_config(fd, &metadata, &smfg_config) == 0 && smfg_config) {
                version = extract_version_from_smfg(smfg_config);
                free(smfg_config);
            }
        }
    }
#endif

    /* Fallback to slow marker search if platform-specific search failed. */
    if (!version) {
        int64_t marker_offset = find_marker(fd, MAGIC_MARKER_PART1, MAGIC_MARKER_PART2,
                                            MAGIC_MARKER_PART3, MAGIC_MARKER_LEN);
        if (marker_offset > 0) {
            if (lseek(fd, marker_offset, SEEK_SET) != -1) {
                if (smol_read_metadata_with_config(fd, &metadata, &smfg_config) == 0 && smfg_config) {
                    version = extract_version_from_smfg(smfg_config);
                    free(smfg_config);
                }
            }
        }
    }

    close(fd);
    return version;
}


