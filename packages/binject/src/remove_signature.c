/**
 * @fileoverview Remove Mach-O code signature without corrupting __LINKEDIT.
 *
 * The standard `codesign --remove-signature` tool corrupts the __LINKEDIT segment.
 * This tool removes the signature by zeroing the LC_CODE_SIGNATURE load command.
 */

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
    int fd = open(path, O_RDWR);
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
        fprintf(stderr, "Error: Not a 64-bit Mach-O binary (magic: 0x%x)\n", header->magic);
        munmap(map, st.st_size);
        close(fd);
        return -1;
    }

    // Find LC_CODE_SIGNATURE load command.
    struct load_command *lc = (struct load_command *)((char *)header + sizeof(struct mach_header_64));
    int found = 0;

    for (uint32_t i = 0; i < header->ncmds; i++) {
        if (lc->cmd == LC_CODE_SIGNATURE) {
            printf("Found LC_CODE_SIGNATURE at offset %zu\n", (char *)lc - (char *)map);

            // Zero out the load command to remove signature.
            // Keep the cmdsize but set cmd to 0 to invalidate it.
            memset(lc, 0, lc->cmdsize);
            found = 1;
            break;
        }

        lc = (struct load_command *)((char *)lc + lc->cmdsize);
    }

    if (!found) {
        printf("No code signature found in binary\n");
    } else {
        printf("✓ Code signature removed successfully\n");
    }

    // Sync changes to disk.
    if (msync(map, st.st_size, MS_SYNC) < 0) {
        fprintf(stderr, "Error: Failed to sync changes: %s\n", strerror(errno));
        munmap(map, st.st_size);
        close(fd);
        return -1;
    }

    munmap(map, st.st_size);
    close(fd);

    return found ? 0 : 1;
}

int main(int argc, char **argv) {
    if (argc != 2) {
        fprintf(stderr, "Usage: %s <binary>\n", argv[0]);
        fprintf(stderr, "\n");
        fprintf(stderr, "Removes code signature from Mach-O binary without corrupting __LINKEDIT.\n");
        fprintf(stderr, "\n");
        fprintf(stderr, "Unlike 'codesign --remove-signature', this tool preserves the __LINKEDIT\n");
        fprintf(stderr, "segment structure by only zeroing the LC_CODE_SIGNATURE load command.\n");
        return 1;
    }

    return remove_macho_signature(argv[1]);
}
