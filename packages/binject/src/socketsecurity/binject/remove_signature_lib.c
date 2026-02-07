/**
 * @fileoverview Remove Mach-O code signature library function.
 *
 * Extracted from remove_signature.c to provide just the function
 * without the main() entry point for use in other tools.
 *
 * Note: This is macOS-specific and only compiled on __APPLE__.
 */

#ifdef __APPLE__

#include <errno.h>
#include <fcntl.h>
#include <mach-o/loader.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

/**
 * Remove code signature from Mach-O binary.
 * Returns 0 on success, -1 on error.
 */
int remove_macho_signature(const char *path) {
    int fd = open(path, O_RDWR | O_CLOEXEC);
    if (fd < 0) {
        fprintf(stderr, "Error: Failed to open %s: %s\n", path, strerror(errno));
        return -1;
    }

    struct stat st;
    if (fstat(fd, &st) < 0) {
        fprintf(stderr, "Error: Failed to stat file: %s\n", strerror(errno));
        close(fd);
        return -1;
    }

    // Validate file size is large enough for Mach-O header
    if (st.st_size < (off_t)sizeof(struct mach_header_64)) {
        fprintf(stderr, "Error: File too small to be a Mach-O binary\n");
        close(fd);
        return -1;
    }

    // Map file into memory.
    void *map = mmap(NULL, st.st_size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    if (map == MAP_FAILED) {
        fprintf(stderr, "Error: Failed to mmap file: %s\n", strerror(errno));
        close(fd);
        return -1;
    }

    // Parse Mach-O header.
    struct mach_header_64 *header = (struct mach_header_64 *)map;

    // Verify it's a 64-bit Mach-O binary.
    if (header->magic != MH_MAGIC_64) {
        // Provide helpful error message for different binary types
        if (header->magic == 0xfeedface) {
            fprintf(stderr, "Error: 32-bit Mach-O binary detected (not supported)\n");
        } else if (header->magic == 0xcafebabe || header->magic == 0xbebafeca) {
            fprintf(stderr, "Error: Universal/fat binary detected (process individual architectures instead)\n");
        } else {
            fprintf(stderr, "Error: Not a valid Mach-O binary (magic: 0x%x)\n", header->magic);
        }
        munmap(map, st.st_size);
        close(fd);
        return -1;
    }

    // Validate ncmds is reasonable (prevent infinite loop or excessive memory access)
    if (header->ncmds > 10000) {
        fprintf(stderr, "Error: Unreasonable number of load commands: %u\n", header->ncmds);
        munmap(map, st.st_size);
        close(fd);
        return -1;
    }

    // Find LC_CODE_SIGNATURE load command with bounds checking
    struct load_command *lc = (struct load_command *)((char *)header + sizeof(struct mach_header_64));
    char *map_end = (char *)map + st.st_size;
    int found = 0;

    for (uint32_t i = 0; i < header->ncmds; i++) {
        // Validate load command is within file bounds
        if ((char *)lc + sizeof(struct load_command) > map_end) {
            fprintf(stderr, "Error: Load command extends beyond file\n");
            munmap(map, st.st_size);
            close(fd);
            return -1;
        }

        // Validate cmdsize is reasonable
        if (lc->cmdsize < sizeof(struct load_command) || lc->cmdsize > 65536) {
            fprintf(stderr, "Error: Invalid load command size: %u\n", lc->cmdsize);
            munmap(map, st.st_size);
            close(fd);
            return -1;
        }

        // Validate full load command is within file bounds
        if ((char *)lc + lc->cmdsize > map_end) {
            fprintf(stderr, "Error: Load command data extends beyond file\n");
            munmap(map, st.st_size);
            close(fd);
            return -1;
        }

        if (lc->cmd == LC_CODE_SIGNATURE) {
#ifdef DEBUG
            printf("Found LC_CODE_SIGNATURE at offset %zu\n", (char *)lc - (char *)map);
#endif

            // Zero out the load command to remove signature.
            // Keep the cmdsize but set cmd to 0 to invalidate it.
            memset(lc, 0, lc->cmdsize);
            found = 1;
            break;
        }

        // Calculate next LC position and validate BEFORE incrementing.
        // This prevents advancing the pointer past map_end if cmdsize is corrupted.
        struct load_command *next_lc = (struct load_command *)((char *)lc + lc->cmdsize);
        if (i + 1 < header->ncmds && (char *)next_lc >= map_end) {
            fprintf(stderr, "Error: Next load command would exceed file bounds\n");
            munmap(map, st.st_size);
            close(fd);
            return -1;
        }
        lc = next_lc;
    }

    if (!found) {
        printf("No code signature found in binary\n");
    } else {
        printf("✓ Code signature removed successfully\n");
    }

    // Sync changes to disk.
    if (msync(map, st.st_size, MS_SYNC) < 0) {
        fprintf(stderr, "Error: Failed to sync memory map: %s\n", strerror(errno));
        munmap(map, st.st_size);
        close(fd);
        return -1;
    }

    munmap(map, st.st_size);

    // Ensure file metadata is also synced (required on macOS).
    // msync() syncs the memory-mapped region but doesn't guarantee the underlying
    // file metadata is flushed. On macOS, the unified buffer cache (UBC) can delay
    // writes even after msync(MS_SYNC). Without fsync(), a system crash or power
    // failure could result in a partially written signature removal, creating a
    // corrupted binary. This is critical because we zero out load commands in-place.
    if (fsync(fd) < 0) {
        fprintf(stderr, "Error: Failed to sync file: %s\n", strerror(errno));
        close(fd);
        return -1;
    }

    close(fd);

    return found ? 0 : 1;
}

#else /* !__APPLE__ */

#include <stdio.h>

/**
 * Stub for non-macOS platforms.
 * Mach-O signatures only exist on macOS.
 */
int remove_macho_signature(const char *path) {
    (void)path;  // Unused
    fprintf(stderr, "Error: remove_macho_signature is only supported on macOS\n");
    return -1;
}

#endif /* __APPLE__ */
