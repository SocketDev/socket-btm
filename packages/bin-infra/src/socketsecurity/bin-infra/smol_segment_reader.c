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

/**
 * Windows compatibility.
 * posix_compat.h provides POSIX function mappings (read, lseek, etc.)
 * and types (ssize_t, off_t) for Windows.
 */
#ifdef _WIN32
    #include "socketsecurity/build-infra/posix_compat.h"
#else
    #include <unistd.h>
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

    /* Read compressed size (8 bytes). */
    if (read(fd, &metadata->compressed_size, sizeof(metadata->compressed_size))
        != sizeof(metadata->compressed_size)) {
        fprintf(stderr, "Error: Failed to read compressed size\n");
        return -1;
    }

    /* Read uncompressed size (8 bytes). */
    if (read(fd, &metadata->uncompressed_size, sizeof(metadata->uncompressed_size))
        != sizeof(metadata->uncompressed_size)) {
        fprintf(stderr, "Error: Failed to read uncompressed size\n");
        return -1;
    }

    /* Read cache key (16 bytes, not null-terminated in binary). */
    char cache_key_raw[CACHE_KEY_LEN];
    if (read(fd, cache_key_raw, CACHE_KEY_LEN) != CACHE_KEY_LEN) {
        fprintf(stderr, "Error: Failed to read cache key\n");
        return -1;
    }
    /* Copy to output and null-terminate. */
    memcpy(metadata->cache_key, cache_key_raw, CACHE_KEY_LEN);
    metadata->cache_key[CACHE_KEY_LEN] = '\0';

    /* Read platform metadata (PLATFORM_METADATA_LEN bytes: platform, arch, libc). */
    if (read(fd, metadata->platform_metadata, PLATFORM_METADATA_LEN) != PLATFORM_METADATA_LEN) {
        fprintf(stderr, "Error: Failed to read platform metadata\n");
        return -1;
    }

    /* Read has_smol_config flag (SMOL_CONFIG_FLAG_LEN byte). */
    uint8_t has_smol_config;
    if (read(fd, &has_smol_config, SMOL_CONFIG_FLAG_LEN) != SMOL_CONFIG_FLAG_LEN) {
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

    for (size_t i = 0; i <= size - MAGIC_MARKER_LEN; i++) {
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

                    /* Check if this is __PRESSED_DATA */
                    if (strncmp(sectname, "__PRESSED_DATA", 14) == 0) {
                        fclose(fp);
                        return 1;  /* Found it! */
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
 * Extract binary from SMOL compressed stub.
 *
 * Note: This is a placeholder. The actual implementation requires LIEF
 * to properly read the __PRESSED_DATA section and decompress it.
 * The real extraction logic is implemented in binject using LIEF integration.
 */
int smol_extract_binary(const char *stub_path, const char *output_path) {
    (void)stub_path;
    (void)output_path;
    fprintf(stderr, "Error: smol_extract_binary not fully implemented in C\n");
    fprintf(stderr, "Use binject's LIEF-based extraction instead\n");
    return -1;
}

