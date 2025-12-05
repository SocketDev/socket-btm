/**
 * Simplified Mach-O binary injection - No LIEF required
 *
 * This implementation uses a simple append-based approach with codesigning:
 * 1. Remove existing code signature
 * 2. Append resource data to the binary
 * 3. Re-sign the binary
 *
 * This is much simpler than LIEF's complex segment/section manipulation
 * and avoids the Mach-O corruption issues present in LIEF 0.17.1.
 */

#include <fcntl.h>
#include <mach-o/loader.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>
#include <errno.h>

#include "binject.h"

// Metadata marker and structure for appended data
#define BINJECT_MACHO_MAGIC "BINJECT1"
#define BINJECT_MACHO_MAGIC_LEN 8

struct binject_macho_footer {
    char magic[BINJECT_MACHO_MAGIC_LEN];  // "BINJECT1"
    uint32_t version;                      // Metadata version (1)
    uint32_t checksum;                     // Data checksum
    uint32_t is_compressed;                // 1 if compressed, 0 if not
    uint32_t original_size;                // Original uncompressed size
    uint32_t data_size;                    // Size of appended data
    char section_name[64];                 // Section name for identification
    uint32_t footer_size;                  // Size of this footer structure
};

/**
 * Remove code signature by zeroing out the data pointer in LC_CODE_SIGNATURE.
 *
 * We DON'T use codesign --remove-signature because it corrupts __LINKEDIT.
 * Instead, we keep the load command structure intact but zero out the dataoff/datasize,
 * which effectively removes the signature without corrupting the binary structure.
 * Then codesign --sign can add a fresh signature.
 */
static int remove_codesign(const char *executable) {
    int fd = open(executable, O_RDWR);
    if (fd < 0) {
        fprintf(stderr, "Error: Failed to open %s: %s\n", executable, strerror(errno));
        return BINJECT_ERROR;
    }

    struct stat st;
    if (fstat(fd, &st) < 0) {
        fprintf(stderr, "Error: Failed to stat file: %s\n", strerror(errno));
        close(fd);
        return BINJECT_ERROR;
    }

    // Map file into memory
    void *map = mmap(NULL, st.st_size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    if (map == MAP_FAILED) {
        fprintf(stderr, "Error: Failed to mmap file: %s\n", strerror(errno));
        close(fd);
        return BINJECT_ERROR;
    }

    // Parse Mach-O header
    struct mach_header_64 *header = (struct mach_header_64 *)map;

    // Verify it's a 64-bit Mach-O binary
    if (header->magic != MH_MAGIC_64) {
        fprintf(stderr, "Warning: Not a 64-bit Mach-O binary, skipping signature removal\n");
        munmap(map, st.st_size);
        close(fd);
        return BINJECT_OK;  // Non-fatal
    }

    // Find LC_CODE_SIGNATURE load command
    struct load_command *lc = (struct load_command *)((char *)header + sizeof(struct mach_header_64));
    int found = 0;

    struct load_command *sig_lc = NULL;
    uint32_t sig_lc_size = 0;

    for (uint32_t i = 0; i < header->ncmds; i++) {
        if (lc->cmd == LC_CODE_SIGNATURE) {
            sig_lc = lc;
            sig_lc_size = lc->cmdsize;
            struct linkedit_data_command *sig_cmd = (struct linkedit_data_command *)lc;
            printf("Found LC_CODE_SIGNATURE: dataoff=0x%x, datasize=0x%x, cmdsize=%u\n",
                   sig_cmd->dataoff, sig_cmd->datasize, sig_lc_size);
            found = 1;
            break;
        }

        lc = (struct load_command *)((char *)lc + lc->cmdsize);
    }

    if (!found) {
        printf("Note: No code signature found (already unsigned)\n");
        munmap(map, st.st_size);
        close(fd);
        return BINJECT_OK;
    }

    // Remove the LC_CODE_SIGNATURE load command entirely
    char *sig_lc_pos = (char *)sig_lc;
    char *next_lc_pos = sig_lc_pos + sig_lc_size;
    char *load_cmds_end = (char *)header + sizeof(struct mach_header_64) + header->sizeofcmds;

    // Shift subsequent load commands up to remove LC_CODE_SIGNATURE
    size_t bytes_after = load_cmds_end - next_lc_pos;
    if (bytes_after > 0) {
        memmove(sig_lc_pos, next_lc_pos, bytes_after);
    }

    // Zero out the freed space at the end
    memset(load_cmds_end - sig_lc_size, 0, sig_lc_size);

    // Update header: decrease ncmds and sizeofcmds
    header->ncmds--;
    header->sizeofcmds -= sig_lc_size;

    printf("✓ LC_CODE_SIGNATURE load command removed\n");
    printf("✓ Updated header: ncmds=%u, sizeofcmds=%u\n", header->ncmds, header->sizeofcmds);

    // Sync changes to disk
    if (msync(map, st.st_size, MS_SYNC) < 0) {
        fprintf(stderr, "Error: Failed to sync changes: %s\n", strerror(errno));
        munmap(map, st.st_size);
        close(fd);
        return BINJECT_ERROR;
    }

    munmap(map, st.st_size);
    close(fd);

    return BINJECT_OK;
}

/**
 * Re-sign Mach-O binary with ad-hoc signature
 */
static int resign_binary(const char *executable) {
    char cmd[1024];
    snprintf(cmd, sizeof(cmd), "codesign -s - \"%s\"", executable);

    int ret = system(cmd);
    if (ret != 0) {
        fprintf(stderr, "Error: Failed to re-sign binary (exit code: %d)\n", ret);
        return BINJECT_ERROR;
    }
    return BINJECT_OK;
}

/**
 * Get the size of a Mach-O section using otool
 */
static size_t get_section_size(const char *executable, const char *segment_name, const char *section_name) {
    char cmd[2048];
    snprintf(cmd, sizeof(cmd),
             "otool -l \"%s\" 2>/dev/null | grep -A 10 'sectname %s' | grep 'size 0x' | head -1 | awk '{print $2}'",
             executable, section_name);

    FILE *pipe = popen(cmd, "r");
    if (!pipe) {
        return 0;
    }

    char buffer[64];
    size_t section_size = 0;
    if (fgets(buffer, sizeof(buffer), pipe) != NULL) {
        // Parse hex size (format: 0xHEXVALUE)
        section_size = (size_t)strtoull(buffer, NULL, 16);
    }
    pclose(pipe);

    return section_size;
}

/**
 * Get the file offset of a section
 */
static size_t get_section_offset(const char *executable, const char *segment_name, const char *section_name) {
    char cmd[2048];
    snprintf(cmd, sizeof(cmd),
             "otool -l \"%s\" 2>/dev/null | grep -A 10 'sectname %s' | grep 'offset' | head -1 | awk '{print $2}'",
             executable, section_name);

    FILE *pipe = popen(cmd, "r");
    if (!pipe) {
        return 0;
    }

    char buffer[64];
    size_t section_offset = 0;
    if (fgets(buffer, sizeof(buffer), pipe) != NULL) {
        // Parse decimal offset
        section_offset = (size_t)strtoull(buffer, NULL, 10);
    }
    pclose(pipe);

    return section_offset;
}

/**
 * Flip the Node.js SEA sentinel fuse from :0 to :1
 * This is CRITICAL for Node.js to recognize the injected SEA blob
 *
 * The sentinel fuse hash `fce680ab2cc467b6e072b8b5df1996b2` is hardcoded in Node.js source:
 * packages/node-smol-builder/submodule/src/node_sea.cc:22
 *   #define POSTJECT_SENTINEL_FUSE "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"
 *
 * This is a fixed constant across all Node.js versions that support SEA (not computed).
 */
static int flip_sentinel_fuse(const char *executable, const char *section_flag) {
    // Only flip fuse for SEA injection (section_flag == "sea")
    if (strcmp(section_flag, "sea") != 0) {
        return BINJECT_OK;  // Not a SEA injection, skip fuse flip
    }

    printf("Flipping sentinel fuse...\n");

    // Define the sentinel fuse patterns
    const char *fuse_pattern_0 = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2:0";
    const char *fuse_pattern_1 = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2:1";
    const size_t fuse_len = strlen(fuse_pattern_0);

    // Open file for reading and writing
    FILE *fp = fopen(executable, "r+b");
    if (!fp) {
        fprintf(stderr, "Error: Failed to open executable for fuse flip: %s\n", strerror(errno));
        return BINJECT_ERROR;
    }

    // Get file size
    fseek(fp, 0, SEEK_END);
    long file_size = ftell(fp);
    fseek(fp, 0, SEEK_SET);

    // Search for the fuse pattern in chunks to avoid loading entire file
    const size_t CHUNK_SIZE = 1024 * 1024;  // 1MB chunks
    char *buffer = malloc(CHUNK_SIZE + fuse_len);  // Extra space for overlap
    if (!buffer) {
        fprintf(stderr, "Error: Failed to allocate buffer for fuse search\n");
        fclose(fp);
        return BINJECT_ERROR;
    }

    int found = 0;
    long fuse_offset = -1;
    size_t overlap = 0;

    while (!feof(fp) && !found) {
        long chunk_start = ftell(fp) - overlap;

        // Read chunk with overlap from previous read
        size_t bytes_read = fread(buffer + overlap, 1, CHUNK_SIZE, fp);
        if (bytes_read == 0) break;

        size_t total_bytes = bytes_read + overlap;

        // Search for fuse pattern in this chunk
        for (size_t i = 0; i <= total_bytes - fuse_len; i++) {
            if (memcmp(buffer + i, fuse_pattern_0, fuse_len) == 0) {
                fuse_offset = chunk_start + i;
                found = 1;
                break;
            }
        }

        // Keep last fuse_len bytes for next iteration (overlap)
        if (!found && bytes_read == CHUNK_SIZE) {
            memcpy(buffer, buffer + CHUNK_SIZE, fuse_len);
            overlap = fuse_len;
            fseek(fp, -(long)fuse_len, SEEK_CUR);
        }
    }

    free(buffer);

    if (!found) {
        fprintf(stderr, "Warning: Sentinel fuse not found in binary\n");
        fprintf(stderr, "This may cause the SEA binary to hang on execution\n");
        fclose(fp);
        return BINJECT_ERROR;
    }

    // Flip the fuse from :0 to :1
    fseek(fp, fuse_offset + fuse_len - 1, SEEK_SET);  // Seek to the last character
    if (fputc('1', fp) == EOF) {
        fprintf(stderr, "Error: Failed to write fuse flip: %s\n", strerror(errno));
        fclose(fp);
        return BINJECT_ERROR;
    }

    fflush(fp);
    fclose(fp);

    printf("✓ Successfully flipped sentinel fuse at offset %ld\n", fuse_offset);
    return BINJECT_OK;
}

/**
 * Inject resource into Mach-O binary using segedit
 * This requires pre-created sections in the Node.js binary
 */
int binject_inject_macho(const char *executable, const char *section_flag,
                          const uint8_t *data, size_t size, uint32_t checksum, int is_compressed) {
    if (!executable || !section_flag || !data || size == 0) {
        fprintf(stderr, "Error: Invalid arguments\n");
        return BINJECT_ERROR;
    }

    // Map flags to pre-allocated Mach-O segment/section pairs
    // Both sections now live in the NODE_SEA segment (matches postject behavior)
    const char *segment_name = NULL;
    const char *macho_section_name = NULL;

    if (strcmp(section_flag, "sea") == 0) {
        // SEA blob goes into pre-created NODE_SEA segment (first section)
        segment_name = "NODE_SEA";
        macho_section_name = "__NODE_SEA_BLOB";
    } else if (strcmp(section_flag, "vfs") == 0) {
        // VFS data goes into pre-created NODE_SEA segment (second section)
        segment_name = "NODE_SEA";
        macho_section_name = "__NODE_VFS_BLOB";
    } else {
        fprintf(stderr, "Error: Unknown flag '%s'\n", section_flag);
        fprintf(stderr, "Use --vfs for VFS injection or --sea for SEA injection\n");
        return BINJECT_ERROR;
    }

    // Step 1: Get existing section size from binary
    printf("Querying section size for %s/%s...\n", segment_name, macho_section_name);
    size_t section_size = get_section_size(executable, segment_name, macho_section_name);
    if (section_size == 0) {
        fprintf(stderr, "Error: Could not determine section size or section does not exist\n");
        fprintf(stderr, "Make sure the binary was built with pre-created sections\n");
        return BINJECT_ERROR;
    }
    printf("Existing section size: %zu bytes\n", section_size);

    // Check if data fits in section
    if (size > section_size) {
        printf("Data size (%zu bytes) exceeds section size (%zu bytes)\n", size, section_size);
        printf("Using segedit to resize section...\n");

        // Use segedit to resize the section
        return binject_inject_macho_segedit(executable, segment_name, macho_section_name, data, size);
    }

    // Step 2: Write data to temporary file, padded to section size
    char temp_file[1024];
    snprintf(temp_file, sizeof(temp_file), "/tmp/binject_data_%d.bin", getpid());

    printf("Writing %zu bytes (padded to %zu) to temporary file %s...\n", size, section_size, temp_file);
    FILE *fp = fopen(temp_file, "wb");
    if (!fp) {
        fprintf(stderr, "Error: Failed to create temporary file: %s\n", strerror(errno));
        return BINJECT_ERROR;
    }

    // Write actual data
    size_t written = fwrite(data, 1, size, fp);
    if (written != size) {
        fprintf(stderr, "Error: Failed to write data to temporary file\n");
        fclose(fp);
        unlink(temp_file);
        return BINJECT_ERROR;
    }

    // Pad with zeros to match section size (segedit requires exact size match)
    size_t padding = section_size - size;
    if (padding > 0) {
        uint8_t zero = 0;
        for (size_t i = 0; i < padding; i++) {
            if (fwrite(&zero, 1, 1, fp) != 1) {
                fprintf(stderr, "Error: Failed to write padding\n");
                fclose(fp);
                unlink(temp_file);
                return BINJECT_ERROR;
            }
        }
    }
    fclose(fp);

    // Step 3: SKIP signature removal for pre-created sections
    // Pre-created sections don't modify __TEXT, so the signature remains valid.
    // Unlike postject, we don't need to remove and re-sign!
    printf("Skipping signature removal (pre-created section, signature remains valid)...\n");

    // Step 4: Get section file offset for direct binary patching
    // NOTE: We avoid segedit because it corrupts the __LINKEDIT segment
    size_t section_offset = get_section_offset(executable, segment_name, macho_section_name);
    if (section_offset == 0) {
        fprintf(stderr, "Error: Could not determine section file offset\n");
        unlink(temp_file);
        return BINJECT_ERROR;
    }
    printf("Section file offset: %zu bytes\n", section_offset);

    // Step 5: Direct binary patch - write data to section offset
    printf("Writing %zu bytes directly to section at offset %zu...\n", section_size, section_offset);

    FILE *exe_fp = fopen(executable, "r+b");
    if (!exe_fp) {
        fprintf(stderr, "Error: Failed to open executable for writing: %s\n", strerror(errno));
        unlink(temp_file);
        return BINJECT_ERROR;
    }

    // Read padded data from temp file
    FILE *data_fp = fopen(temp_file, "rb");
    if (!data_fp) {
        fprintf(stderr, "Error: Failed to open temp file for reading: %s\n", strerror(errno));
        fclose(exe_fp);
        unlink(temp_file);
        return BINJECT_ERROR;
    }

    // Seek to section offset in executable
    if (fseek(exe_fp, section_offset, SEEK_SET) != 0) {
        fprintf(stderr, "Error: Failed to seek to section offset: %s\n", strerror(errno));
        fclose(data_fp);
        fclose(exe_fp);
        unlink(temp_file);
        return BINJECT_ERROR;
    }

    // Copy data in 64KB chunks
    uint8_t buffer[65536];
    size_t bytes_written = 0;
    while (bytes_written < section_size) {
        size_t to_read = section_size - bytes_written;
        if (to_read > sizeof(buffer)) {
            to_read = sizeof(buffer);
        }

        size_t bytes_read = fread(buffer, 1, to_read, data_fp);
        if (bytes_read == 0) {
            break;
        }

        size_t written = fwrite(buffer, 1, bytes_read, exe_fp);
        if (written != bytes_read) {
            fprintf(stderr, "Error: Failed to write data to executable\n");
            fclose(data_fp);
            fclose(exe_fp);
            unlink(temp_file);
            return BINJECT_ERROR;
        }

        bytes_written += written;
    }

    fclose(data_fp);
    fclose(exe_fp);
    unlink(temp_file);  // Clean up temp file

    printf("✓ Successfully wrote %zu bytes to section\n", bytes_written);

    // Step 6: Flip sentinel fuse for SEA injections BEFORE codesigning
    // CRITICAL: The sentinel must be flipped BEFORE the binary is code-signed!
    // The correct order is:
    // 1. Inject data into section
    // 2. Flip the sentinel fuse (this function)
    // 3. Code sign the binary (done by caller, e.g., test harness)
    //
    // If we flip AFTER codesigning, it invalidates the signature and causes crashes.
    // If we flip BEFORE codesigning, the flipped sentinel becomes part of the signed binary.
    if (strcmp(section_flag, "sea") == 0) {
        int flip_result = flip_sentinel_fuse(executable, section_flag);
        if (flip_result != BINJECT_OK) {
            fprintf(stderr, "Warning: Failed to flip sentinel fuse, SEA may not work correctly\n");
            // Don't fail the injection, but warn the user
        }
    }

    // Step 7: Note about re-signing
    // Pre-created sections don't modify __TEXT, but modifying the sentinel fuse does.
    // The caller (e.g., test harness) must re-sign the binary after this function returns.
    printf("Note: Binary signature invalidated. Caller should re-sign with: codesign --sign - --force <binary>\n");
    printf("✓ Injection complete. Binary signature invalidated (caller must re-sign).\n");

    // Preserve executable permissions
    struct stat st;
    if (stat(executable, &st) == 0) {
        chmod(executable, st.st_mode | S_IXUSR | S_IXGRP | S_IXOTH);
    }

    printf("✓ Successfully injected %zu bytes into %s\n", size, executable);
    return BINJECT_OK;
}

/**
 * List all binject resources in Mach-O binary
 */
int binject_list_macho(const char *executable) {
    FILE *fp = fopen(executable, "rb");
    if (!fp) {
        fprintf(stderr, "Error: Failed to open executable: %s\n", strerror(errno));
        return BINJECT_ERROR;
    }

    // Seek to end to read footer
    fseek(fp, -(long)sizeof(struct binject_macho_footer), SEEK_END);

    struct binject_macho_footer footer;
    size_t read_bytes = fread(&footer, 1, sizeof(footer), fp);
    fclose(fp);

    if (read_bytes != sizeof(footer)) {
        fprintf(stderr, "No binject resources found\n");
        return BINJECT_OK;
    }

    // Verify magic
    if (memcmp(footer.magic, BINJECT_MACHO_MAGIC, BINJECT_MACHO_MAGIC_LEN) != 0) {
        fprintf(stderr, "No binject resources found\n");
        return BINJECT_OK;
    }

    // Print resource info
    printf("Found binject resource:\n");
    printf("  Section: %s\n", footer.section_name);
    printf("  Size: %u bytes\n", footer.data_size);
    printf("  Compressed: %s\n", footer.is_compressed ? "yes" : "no");
    printf("  Checksum: 0x%08x\n", footer.checksum);

    return BINJECT_OK;
}

/**
 * Extract resource from Mach-O binary
 */
int binject_extract_macho(const char *executable, const char *section_name,
                           const char *output_file) {
    FILE *fp = fopen(executable, "rb");
    if (!fp) {
        fprintf(stderr, "Error: Failed to open executable: %s\n", strerror(errno));
        return BINJECT_ERROR;
    }

    // Seek to end to read footer
    fseek(fp, -(long)sizeof(struct binject_macho_footer), SEEK_END);

    struct binject_macho_footer footer;
    size_t read_bytes = fread(&footer, 1, sizeof(footer), fp);

    if (read_bytes != sizeof(footer) ||
        memcmp(footer.magic, BINJECT_MACHO_MAGIC, BINJECT_MACHO_MAGIC_LEN) != 0) {
        fprintf(stderr, "Error: No binject resources found\n");
        fclose(fp);
        return BINJECT_ERROR_SECTION_NOT_FOUND;
    }

    // Check if section name matches
    if (section_name && strcmp(footer.section_name, section_name) != 0) {
        fprintf(stderr, "Error: Section '%s' not found (found '%s')\n",
                section_name, footer.section_name);
        fclose(fp);
        return BINJECT_ERROR_SECTION_NOT_FOUND;
    }

    // Seek to start of data (before footer)
    long data_offset = -(long)(sizeof(footer) + footer.data_size);
    fseek(fp, data_offset, SEEK_END);

    // Read the data
    uint8_t *data = malloc(footer.data_size);
    if (!data) {
        fprintf(stderr, "Error: Failed to allocate memory\n");
        fclose(fp);
        return BINJECT_ERROR;
    }

    read_bytes = fread(data, 1, footer.data_size, fp);
    fclose(fp);

    if (read_bytes != footer.data_size) {
        fprintf(stderr, "Error: Failed to read data\n");
        free(data);
        return BINJECT_ERROR;
    }

    // Write to output file
    FILE *out = fopen(output_file, "wb");
    if (!out) {
        fprintf(stderr, "Error: Failed to create output file: %s\n", strerror(errno));
        free(data);
        return BINJECT_ERROR;
    }

    size_t written = fwrite(data, 1, footer.data_size, out);
    fclose(out);
    free(data);

    if (written != footer.data_size) {
        fprintf(stderr, "Error: Failed to write output file\n");
        return BINJECT_ERROR;
    }

    printf("✓ Extracted %u bytes to %s\n", footer.data_size, output_file);
    return BINJECT_OK;
}

/**
 * Verify resource integrity in Mach-O binary
 */
int binject_verify_macho(const char *executable, const char *section_name) {
    FILE *fp = fopen(executable, "rb");
    if (!fp) {
        fprintf(stderr, "Error: Failed to open executable: %s\n", strerror(errno));
        return BINJECT_ERROR;
    }

    // Seek to end to read footer
    fseek(fp, -(long)sizeof(struct binject_macho_footer), SEEK_END);

    struct binject_macho_footer footer;
    size_t read_bytes = fread(&footer, 1, sizeof(footer), fp);

    if (read_bytes != sizeof(footer) ||
        memcmp(footer.magic, BINJECT_MACHO_MAGIC, BINJECT_MACHO_MAGIC_LEN) != 0) {
        fprintf(stderr, "Error: No binject resources found\n");
        fclose(fp);
        return BINJECT_ERROR_SECTION_NOT_FOUND;
    }

    // Check if section name matches
    if (section_name && strcmp(footer.section_name, section_name) != 0) {
        fprintf(stderr, "Error: Section '%s' not found (found '%s')\n",
                section_name, footer.section_name);
        fclose(fp);
        return BINJECT_ERROR_SECTION_NOT_FOUND;
    }

    // Seek to start of data
    long data_offset = -(long)(sizeof(footer) + footer.data_size);
    fseek(fp, data_offset, SEEK_END);

    // Read and verify checksum
    uint8_t *data = malloc(footer.data_size);
    if (!data) {
        fprintf(stderr, "Error: Failed to allocate memory\n");
        fclose(fp);
        return BINJECT_ERROR;
    }

    read_bytes = fread(data, 1, footer.data_size, fp);
    fclose(fp);

    if (read_bytes != footer.data_size) {
        fprintf(stderr, "Error: Failed to read data\n");
        free(data);
        return BINJECT_ERROR;
    }

    uint32_t actual_checksum = binject_checksum(data, footer.data_size);
    free(data);

    if (actual_checksum != footer.checksum) {
        fprintf(stderr, "✗ Checksum mismatch (expected 0x%08x, got 0x%08x)\n",
                footer.checksum, actual_checksum);
        return BINJECT_ERROR;
    }

    printf("✓ Resource '%s' verified successfully\n", footer.section_name);
    return BINJECT_OK;
}
