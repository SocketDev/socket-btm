/**
 * ELF binary injection implementation
 *
 * Adds a new section to ELF binaries for resource injection.
 */

#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <inttypes.h>
#include <errno.h>
#include <elf.h>
#include <sys/stat.h>
#include <unistd.h>
#include <limits.h>
#include "binject.h"
#include "file_utils.h"

/* Shared compression library from bin-infra */
#include "buffer_constants.h"
#include "compression_common.h"
#include "file_io_common.h"

#define PAGE_SIZE 4096
#define MAX_ELF_SIZE (200 * 1024 * 1024) // 200MB max for ELF files (Node.js binaries)

/* File I/O helpers removed - now using file_io_common.h
 * Note: file_io_write() doesn't create parent directories, so we still handle that separately */

/**
 * Inject resource into ELF binary (64-bit)
 */
int binject_single_elf(const char *executable, const char *output, const char *section_name,
                               const uint8_t *data, size_t size, uint32_t checksum, int is_compressed) {
    /* Mark unused parameters to suppress warnings */
    (void)checksum;
    (void)is_compressed;

    uint8_t *elf_data = NULL;
    size_t elf_size = 0;

    // Read ELF file
    if (file_io_read(executable, &elf_data, &elf_size) != FILE_IO_OK) {
        return BINJECT_ERROR;
    }

    // Validate minimum ELF size
    if (elf_size < sizeof(Elf64_Ehdr)) {
        fprintf(stderr, "Error: File too small to be valid ELF (need %zu bytes, got %zu)\n",
                sizeof(Elf64_Ehdr), elf_size);
        free(elf_data);
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    // Parse ELF header
    Elf64_Ehdr *ehdr = (Elf64_Ehdr *)elf_data;

    // Verify ELF magic
    if (memcmp(ehdr->e_ident, ELFMAG, SELFMAG) != 0) {
        fprintf(stderr, "Error: Not a valid ELF file\n");
        free(elf_data);
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    // Only support 64-bit for now
    if (ehdr->e_ident[EI_CLASS] != ELFCLASS64) {
        fprintf(stderr, "Error: Only 64-bit ELF supported\n");
        free(elf_data);
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    // Validate section header table offset and size
    if (ehdr->e_shoff < sizeof(Elf64_Ehdr) || ehdr->e_shoff >= elf_size) {
        fprintf(stderr, "Error: Invalid section header offset\n");
        free(elf_data);
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    // Check for section header table overflow
    if (ehdr->e_shnum > 0) {
        size_t shdr_table_size = (size_t)ehdr->e_shnum * sizeof(Elf64_Shdr);
        if (ehdr->e_shoff > elf_size - shdr_table_size) {
            fprintf(stderr, "Error: Section header table exceeds file size\n");
            free(elf_data);
            return BINJECT_ERROR_INVALID_FORMAT;
        }
    }

    // Validate string table section index
    if (ehdr->e_shstrndx >= ehdr->e_shnum) {
        fprintf(stderr, "Error: Invalid string table section index (%u >= %u)\n",
                ehdr->e_shstrndx, ehdr->e_shnum);
        free(elf_data);
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    // Validate section header entry size
    if (ehdr->e_shentsize != sizeof(Elf64_Shdr)) {
        fprintf(stderr, "Error: Invalid section header entry size (expected %zu, got %u)\n",
                sizeof(Elf64_Shdr), ehdr->e_shentsize);
        free(elf_data);
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    // Get section header table
    Elf64_Shdr *shdr = (Elf64_Shdr *)(elf_data + ehdr->e_shoff);

    // Get string table section
    Elf64_Shdr *shstrtab = &shdr[ehdr->e_shstrndx];

    // Validate string table section offset and size
    if (shstrtab->sh_offset >= elf_size ||
        shstrtab->sh_offset > elf_size - shstrtab->sh_size) {
        fprintf(stderr, "Error: String table section exceeds file bounds\n");
        free(elf_data);
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    char *strtab = (char *)(elf_data + shstrtab->sh_offset);

    // Validate section name length (must be reasonable)
    size_t section_name_len = strlen(section_name);
    if (section_name_len == 0 || section_name_len > 255) {
        fprintf(stderr, "Error: Section name length invalid (must be 1-255 bytes)\n");
        free(elf_data);
        return BINJECT_ERROR_INVALID_ARGS;
    }

    // Validate section name contains only safe characters (alphanumeric, underscore, dot, dash)
    for (size_t i = 0; i < section_name_len; i++) {
        char c = section_name[i];
        int is_valid = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
                       (c >= '0' && c <= '9') || c == '_' || c == '.' || c == '-';
        if (!is_valid) {
            fprintf(stderr, "Error: Section name contains invalid character at position %zu: '%c'\n", i, c);
            fprintf(stderr, "Section names must contain only alphanumeric, underscore, dot, or dash\n");
            free(elf_data);
            return BINJECT_ERROR_INVALID_ARGS;
        }
    }

    // Check if section already exists and remove it (auto-overwrite)
    int existing_section = -1;
    for (uint16_t i = 0; i < ehdr->e_shnum; i++) {
        // Validate section name offset is within string table bounds
        if (shdr[i].sh_name >= shstrtab->sh_size) {
            continue; // Skip sections with invalid name offsets
        }

        char *name = strtab + shdr[i].sh_name;

        // Verify null termination within string table bounds
        size_t max_len = shstrtab->sh_size - shdr[i].sh_name;
        size_t name_len = strnlen(name, max_len);
        if (name_len == max_len) {
            continue; // No null terminator found, skip this section
        }

        if (strcmp(name, section_name) == 0) {
            existing_section = i;
            printf("Removing existing section '%s' for auto-overwrite...\n", name);
            break;
        }
    }

    // If section exists, remove it by shifting sections
    if (existing_section >= 0) {
        Elf64_Shdr *existing_shdr = &shdr[existing_section];

        // Validate section data is within file bounds before zeroing
        if (existing_shdr->sh_offset > 0 && existing_shdr->sh_size > 0) {
            if (existing_shdr->sh_offset >= elf_size ||
                existing_shdr->sh_offset > elf_size - existing_shdr->sh_size) {
                fprintf(stderr, "Error: Section data exceeds file bounds\n");
                free(elf_data);
                return BINJECT_ERROR_INVALID_FORMAT;
            }
            memset(elf_data + existing_shdr->sh_offset, 0, existing_shdr->sh_size);
        }

        // Validate we can safely remove this section
        // We can remove any section except when it's the only one
        if (ehdr->e_shnum <= 1) {
            fprintf(stderr, "Error: Cannot remove the only section\n");
            free(elf_data);
            return BINJECT_ERROR;
        }

        // Shift section headers down to remove the entry
        memmove(&shdr[existing_section], &shdr[existing_section + 1],
                (ehdr->e_shnum - existing_section - 1) * sizeof(Elf64_Shdr));

        // Decrement section count
        ehdr->e_shnum--;

        // Update string table section index if it was after the removed section
        if (ehdr->e_shstrndx > existing_section) {
            ehdr->e_shstrndx--;
        }

        // Update pointers after modification
        shdr = (Elf64_Shdr *)(elf_data + ehdr->e_shoff);
        shstrtab = &shdr[ehdr->e_shstrndx];
        strtab = (char *)(elf_data + shstrtab->sh_offset);

        printf("Successfully removed existing section %s\n", section_name);
    }

    // Calculate new file size with overflow checks
    // Check alignment won't overflow
    if (size > SIZE_MAX - (ALIGNMENT_16_BYTE - 1)) {
        fprintf(stderr, "Error: Section size too large for alignment\n");
        free(elf_data);
        return BINJECT_ERROR;
    }
    size_t aligned_size = ALIGN_16(size);

    size_t new_section_name_len = strlen(section_name) + 1;

    // Check string table size won't overflow
    if (shstrtab->sh_size > SIZE_MAX - new_section_name_len) {
        fprintf(stderr, "Error: String table size overflow\n");
        free(elf_data);
        return BINJECT_ERROR;
    }
    size_t new_strtab_size = shstrtab->sh_size + new_section_name_len;

    // Check file size additions won't overflow
    if (elf_size > SIZE_MAX - aligned_size - sizeof(Elf64_Shdr) - new_section_name_len) {
        fprintf(stderr, "Error: New file size would overflow\n");
        free(elf_data);
        return BINJECT_ERROR;
    }
    size_t new_file_size = elf_size + aligned_size + sizeof(Elf64_Shdr) + new_section_name_len;

    // Allocate new file buffer
    uint8_t *new_elf = calloc(1, new_file_size);
    if (!new_elf) {
        free(elf_data);
        return BINJECT_ERROR;
    }

    // Copy original data
    memcpy(new_elf, elf_data, elf_size);

    // Update pointers to new buffer
    ehdr = (Elf64_Ehdr *)new_elf;
    shdr = (Elf64_Shdr *)(new_elf + ehdr->e_shoff);
    shstrtab = &shdr[ehdr->e_shstrndx];
    strtab = (char *)(new_elf + shstrtab->sh_offset);

    // Append section data at end of file
    size_t section_offset = elf_size;
    memcpy(new_elf + section_offset, data, size);

    // Append new section name to string table
    size_t new_name_offset = shstrtab->sh_size;
    memcpy(new_elf + shstrtab->sh_offset + new_name_offset, section_name, new_section_name_len);
    shstrtab->sh_size = new_strtab_size;

    // Add new section header at end of section header table
    // Check for multiplication overflow
    if (ehdr->e_shnum > SIZE_MAX / sizeof(Elf64_Shdr)) {
        fprintf(stderr, "Error: Section header count overflow\n");
        free(elf_data);
        free(new_elf);
        return BINJECT_ERROR;
    }
    size_t shdr_table_size = ehdr->e_shnum * sizeof(Elf64_Shdr);

    // Check for addition overflow
    if (ehdr->e_shoff > SIZE_MAX - shdr_table_size) {
        fprintf(stderr, "Error: Section header offset overflow\n");
        free(elf_data);
        free(new_elf);
        return BINJECT_ERROR;
    }
    size_t new_shdr_offset = ehdr->e_shoff + shdr_table_size;

    // Verify offset is within new file bounds
    if (new_shdr_offset > new_file_size - sizeof(Elf64_Shdr)) {
        fprintf(stderr, "Error: New section header exceeds file size\n");
        free(elf_data);
        free(new_elf);
        return BINJECT_ERROR;
    }

    Elf64_Shdr *new_shdr = (Elf64_Shdr *)(new_elf + new_shdr_offset);

    new_shdr->sh_name = new_name_offset;
    new_shdr->sh_type = SHT_PROGBITS;
    new_shdr->sh_flags = 0;  // Pure data section, not loaded into memory
    new_shdr->sh_addr = 0;
    new_shdr->sh_offset = section_offset;
    new_shdr->sh_size = size;
    new_shdr->sh_link = 0;
    new_shdr->sh_info = 0;
    new_shdr->sh_addralign = ALIGNMENT_16_BYTE;
    new_shdr->sh_entsize = 0;

    // Update ELF header - check for overflow
    if (ehdr->e_shnum >= UINT16_MAX) {
        fprintf(stderr, "Error: Maximum number of sections reached (%" PRIu16 ")\n", ehdr->e_shnum);
        free(elf_data);
        free(new_elf);
        return BINJECT_ERROR;
    }
    ehdr->e_shnum++;

    // Write modified ELF using tmpdir workflow to avoid file locking issues
    // Step 1: Write to temporary file
    char tmpfile[PATH_MAX];
    snprintf(tmpfile, sizeof(tmpfile), "%s.tmp.%d", output, getpid());

    // Create parent directories if needed (file_io_write doesn't do this)
    if (create_parent_directories(tmpfile) != 0) {
        fprintf(stderr, "Error: Failed to create parent directories for output path: %s\n", tmpfile);
        free(elf_data);
        free(new_elf);
        return BINJECT_ERROR;
    }

    int result = (file_io_write(tmpfile, new_elf, new_file_size) == FILE_IO_OK) ? BINJECT_OK : BINJECT_ERROR;

    free(elf_data);
    free(new_elf);

    if (result != BINJECT_OK) {
        unlink(tmpfile);  // Clean up temp file on failure
        return BINJECT_ERROR_WRITE_FAILED;
    }

    // Make temporary file executable before moving
#ifndef _WIN32
    if (chmod(tmpfile, 0755) != 0) {
        fprintf(stderr, "Error: Failed to make temp file executable (chmod failed)\n");
        unlink(tmpfile);
        return BINJECT_ERROR_WRITE_FAILED;
    }
#endif

    // Step 2: Atomic rename to final destination
    // Remove existing output file first (required on Windows)
    remove(output);
    if (rename(tmpfile, output) != 0) {
        fprintf(stderr, "Error: Failed to move temporary file to output: %s\n", output);
        unlink(tmpfile);  // Clean up temp file on failure
        return BINJECT_ERROR_WRITE_FAILED;
    }

    printf("Successfully injected section '%s' (%zu bytes) into %s\n",
           section_name, size, output);

    return BINJECT_OK;
}

/**
 * List sections in ELF binary
 */
int binject_elf_list(const char *executable) {
    uint8_t *elf_data = NULL;
    size_t elf_size = 0;

    if (file_io_read(executable, &elf_data, &elf_size) != FILE_IO_OK) {
        return BINJECT_ERROR;
    }

    // Validate minimum ELF size
    if (elf_size < sizeof(Elf64_Ehdr)) {
        free(elf_data);
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    Elf64_Ehdr *ehdr = (Elf64_Ehdr *)elf_data;

    if (memcmp(ehdr->e_ident, ELFMAG, SELFMAG) != 0) {
        free(elf_data);
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    // Validate section header table
    if (ehdr->e_shoff < sizeof(Elf64_Ehdr) || ehdr->e_shoff >= elf_size) {
        free(elf_data);
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    if (ehdr->e_shnum > 0) {
        size_t shdr_table_size = (size_t)ehdr->e_shnum * sizeof(Elf64_Shdr);
        if (ehdr->e_shoff > elf_size - shdr_table_size) {
            free(elf_data);
            return BINJECT_ERROR_INVALID_FORMAT;
        }
    }

    // Validate string table index
    if (ehdr->e_shstrndx >= ehdr->e_shnum) {
        free(elf_data);
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    // Validate section entry size
    if (ehdr->e_shentsize != sizeof(Elf64_Shdr)) {
        free(elf_data);
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    Elf64_Shdr *shdr = (Elf64_Shdr *)(elf_data + ehdr->e_shoff);
    Elf64_Shdr *shstrtab = &shdr[ehdr->e_shstrndx];

    // Validate string table bounds
    if (shstrtab->sh_offset >= elf_size ||
        shstrtab->sh_offset > elf_size - shstrtab->sh_size) {
        free(elf_data);
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    char *strtab = (char *)(elf_data + shstrtab->sh_offset);

    printf("Sections in %s:\n", executable);
    for (int i = 0; i < (int)ehdr->e_shnum; i++) {
        // Validate name offset
        if (shdr[i].sh_name >= shstrtab->sh_size) {
            continue;
        }

        char *name = strtab + shdr[i].sh_name;

        // Verify null termination
        size_t max_len = shstrtab->sh_size - shdr[i].sh_name;
        if (strnlen(name, max_len) == max_len) {
            continue;
        }

        if (strstr(name, "NODE") || strstr(name, "SOCK")) {
            printf("  %s (offset: 0x%" PRIx64 ", size: %" PRIu64 " bytes)\n",
                   name, shdr[i].sh_offset, shdr[i].sh_size);
        }
    }

    free(elf_data);
    return BINJECT_OK;
}

/**
 * Extract section from ELF binary
 */
int binject_elf_extract(const char *executable, const char *section_name,
                        const char *output_file) {
    uint8_t *elf_data = NULL;
    size_t elf_size = 0;

    if (file_io_read(executable, &elf_data, &elf_size) != FILE_IO_OK) {
        return BINJECT_ERROR;
    }

    // Validate minimum ELF size
    if (elf_size < sizeof(Elf64_Ehdr)) {
        free(elf_data);
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    Elf64_Ehdr *ehdr = (Elf64_Ehdr *)elf_data;

    if (memcmp(ehdr->e_ident, ELFMAG, SELFMAG) != 0) {
        free(elf_data);
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    // Validate section header table
    if (ehdr->e_shoff < sizeof(Elf64_Ehdr) || ehdr->e_shoff >= elf_size ||
        ehdr->e_shentsize != sizeof(Elf64_Shdr) ||
        ehdr->e_shstrndx >= ehdr->e_shnum) {
        free(elf_data);
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    if (ehdr->e_shnum > 0) {
        size_t shdr_table_size = (size_t)ehdr->e_shnum * sizeof(Elf64_Shdr);
        if (ehdr->e_shoff > elf_size - shdr_table_size) {
            free(elf_data);
            return BINJECT_ERROR_INVALID_FORMAT;
        }
    }

    Elf64_Shdr *shdr = (Elf64_Shdr *)(elf_data + ehdr->e_shoff);
    Elf64_Shdr *shstrtab = &shdr[ehdr->e_shstrndx];

    // Validate string table bounds
    if (shstrtab->sh_offset >= elf_size ||
        shstrtab->sh_offset > elf_size - shstrtab->sh_size) {
        free(elf_data);
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    char *strtab = (char *)(elf_data + shstrtab->sh_offset);

    // Find section
    for (int i = 0; i < (int)ehdr->e_shnum; i++) {
        // Validate name offset
        if (shdr[i].sh_name >= shstrtab->sh_size) {
            continue;
        }

        char *name = strtab + shdr[i].sh_name;

        // Verify null termination
        size_t max_len = shstrtab->sh_size - shdr[i].sh_name;
        if (strnlen(name, max_len) == max_len) {
            continue;
        }

        if (strcmp(name, section_name) == 0) {
            // Validate section data bounds
            if (shdr[i].sh_offset >= elf_size ||
                shdr[i].sh_offset > elf_size - shdr[i].sh_size) {
                fprintf(stderr, "Error: Section data exceeds file bounds\n");
                free(elf_data);
                return BINJECT_ERROR_INVALID_FORMAT;
            }

            // Extract section data
            // Create parent directories if needed
            if (create_parent_directories(output_file) != 0) {
                fprintf(stderr, "Error: Failed to create parent directories for output path: %s\n", output_file);
                free(elf_data);
                return BINJECT_ERROR;
            }

            int result = (file_io_write(output_file,
                                       elf_data + shdr[i].sh_offset,
                                       shdr[i].sh_size) == FILE_IO_OK) ? BINJECT_OK : BINJECT_ERROR;
            free(elf_data);

            if (result == BINJECT_OK) {
                printf("Extracted section '%s' to %s (%" PRIu64 " bytes)\n",
                       section_name, output_file, shdr[i].sh_size);
            }
            return result;
        }
    }

    fprintf(stderr, "Error: Section '%s' not found\n", section_name);
    free(elf_data);
    return BINJECT_ERROR_SECTION_NOT_FOUND;
}

/**
 * Verify section exists in ELF binary
 */
int binject_elf_verify(const char *executable, const char *section_name) {
    uint8_t *elf_data = NULL;
    size_t elf_size = 0;

    if (file_io_read(executable, &elf_data, &elf_size) != FILE_IO_OK) {
        return BINJECT_ERROR;
    }

    // Validate minimum ELF size
    if (elf_size < sizeof(Elf64_Ehdr)) {
        free(elf_data);
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    Elf64_Ehdr *ehdr = (Elf64_Ehdr *)elf_data;

    if (memcmp(ehdr->e_ident, ELFMAG, SELFMAG) != 0) {
        free(elf_data);
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    // Validate section header table
    if (ehdr->e_shoff < sizeof(Elf64_Ehdr) || ehdr->e_shoff >= elf_size ||
        ehdr->e_shentsize != sizeof(Elf64_Shdr) ||
        ehdr->e_shstrndx >= ehdr->e_shnum) {
        free(elf_data);
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    if (ehdr->e_shnum > 0) {
        size_t shdr_table_size = (size_t)ehdr->e_shnum * sizeof(Elf64_Shdr);
        if (ehdr->e_shoff > elf_size - shdr_table_size) {
            free(elf_data);
            return BINJECT_ERROR_INVALID_FORMAT;
        }
    }

    Elf64_Shdr *shdr = (Elf64_Shdr *)(elf_data + ehdr->e_shoff);
    Elf64_Shdr *shstrtab = &shdr[ehdr->e_shstrndx];

    // Validate string table bounds
    if (shstrtab->sh_offset >= elf_size ||
        shstrtab->sh_offset > elf_size - shstrtab->sh_size) {
        free(elf_data);
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    char *strtab = (char *)(elf_data + shstrtab->sh_offset);

    for (int i = 0; i < (int)ehdr->e_shnum; i++) {
        // Validate name offset
        if (shdr[i].sh_name >= shstrtab->sh_size) {
            continue;
        }

        char *name = strtab + shdr[i].sh_name;

        // Verify null termination
        size_t max_len = shstrtab->sh_size - shdr[i].sh_name;
        if (strnlen(name, max_len) == max_len) {
            continue;
        }

        if (strcmp(name, section_name) == 0) {
            printf("Section '%s' found (size: %" PRIu64 " bytes)\n",
                   section_name, shdr[i].sh_size);
            free(elf_data);
            return BINJECT_OK;
        }
    }

    fprintf(stderr, "Section '%s' not found\n", section_name);
    free(elf_data);
    return BINJECT_ERROR_SECTION_NOT_FOUND;
}
