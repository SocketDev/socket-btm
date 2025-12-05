/**
 * ELF binary injection implementation
 *
 * Adds a new section to ELF binaries for resource injection.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <elf.h>
#include <sys/stat.h>
#include <unistd.h>
#include "binject.h"

/* Shared compression library from bin-infra */
#include "compression_common.h"

#define PAGE_SIZE 4096

/**
 * Read entire file into memory
 */
static int read_file(const char *path, uint8_t **data, size_t *size) {
    FILE *fp = fopen(path, "rb");
    if (!fp) {
        fprintf(stderr, "Error: Cannot open file: %s\n", path);
        return BINJECT_ERROR;
    }

    fseek(fp, 0, SEEK_END);
    *size = ftell(fp);
    fseek(fp, 0, SEEK_SET);

    *data = malloc(*size);
    if (!*data) {
        fclose(fp);
        return BINJECT_ERROR;
    }

    if (fread(*data, 1, *size, fp) != *size) {
        free(*data);
        fclose(fp);
        return BINJECT_ERROR;
    }

    fclose(fp);
    return BINJECT_OK;
}

/**
 * Write data to file
 */
static int write_file(const char *path, const uint8_t *data, size_t size) {
    FILE *fp = fopen(path, "wb");
    if (!fp) {
        fprintf(stderr, "Error: Cannot write file: %s\n", path);
        return BINJECT_ERROR;
    }

    size_t written = fwrite(data, 1, size, fp);
    fclose(fp);

    if (written != size) {
        return BINJECT_ERROR;
    }

    return BINJECT_OK;
}

/**
 * Inject resource into ELF binary (64-bit)
 */
int binject_inject_elf(const char *executable, const char *section_name,
                       const uint8_t *data, size_t size, uint32_t checksum, int is_compressed) {
    uint8_t *elf_data = NULL;
    size_t elf_size = 0;

    // Read ELF file
    if (read_file(executable, &elf_data, &elf_size) != BINJECT_OK) {
        return BINJECT_ERROR;
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

    // Get section header table
    Elf64_Shdr *shdr = (Elf64_Shdr *)(elf_data + ehdr->e_shoff);

    // Get string table section
    Elf64_Shdr *shstrtab = &shdr[ehdr->e_shstrndx];
    char *strtab = (char *)(elf_data + shstrtab->sh_offset);

    // Check if section already exists
    for (int i = 0; i < ehdr->e_shnum; i++) {
        char *name = strtab + shdr[i].sh_name;
        if (strcmp(name, section_name) == 0) {
            fprintf(stderr, "Error: Section %s already exists\n", section_name);
            free(elf_data);
            return BINJECT_ERROR_SECTION_EXISTS;
        }
    }

    // Calculate new file size
    size_t aligned_size = (size + 15) & ~15; // 16-byte align
    size_t new_section_name_len = strlen(section_name) + 1;
    size_t new_strtab_size = shstrtab->sh_size + new_section_name_len;
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
    size_t new_shdr_offset = ehdr->e_shoff + (ehdr->e_shnum * sizeof(Elf64_Shdr));
    Elf64_Shdr *new_shdr = (Elf64_Shdr *)(new_elf + new_shdr_offset);

    new_shdr->sh_name = new_name_offset;
    new_shdr->sh_type = SHT_PROGBITS;
    new_shdr->sh_flags = SHF_ALLOC;
    new_shdr->sh_addr = 0;
    new_shdr->sh_offset = section_offset;
    new_shdr->sh_size = size;
    new_shdr->sh_link = 0;
    new_shdr->sh_info = 0;
    new_shdr->sh_addralign = 16;
    new_shdr->sh_entsize = 0;

    // Update ELF header
    ehdr->e_shnum++;

    // Write modified ELF
    int result = write_file(executable, new_elf, new_file_size);

    free(elf_data);
    free(new_elf);

    if (result != BINJECT_OK) {
        return BINJECT_ERROR_WRITE_FAILED;
    }

    // Make executable
    chmod(executable, 0755);

    printf("Successfully injected section '%s' (%zu bytes) into %s\n",
           section_name, size, executable);

    return BINJECT_OK;
}

/**
 * List sections in ELF binary
 */
int binject_list_elf(const char *executable) {
    uint8_t *elf_data = NULL;
    size_t elf_size = 0;

    if (read_file(executable, &elf_data, &elf_size) != BINJECT_OK) {
        return BINJECT_ERROR;
    }

    Elf64_Ehdr *ehdr = (Elf64_Ehdr *)elf_data;

    if (memcmp(ehdr->e_ident, ELFMAG, SELFMAG) != 0) {
        free(elf_data);
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    Elf64_Shdr *shdr = (Elf64_Shdr *)(elf_data + ehdr->e_shoff);
    Elf64_Shdr *shstrtab = &shdr[ehdr->e_shstrndx];
    char *strtab = (char *)(elf_data + shstrtab->sh_offset);

    printf("Sections in %s:\n", executable);
    for (int i = 0; i < ehdr->e_shnum; i++) {
        char *name = strtab + shdr[i].sh_name;
        if (strstr(name, "NODE") || strstr(name, "SOCK")) {
            printf("  %s (offset: 0x%lx, size: %lu bytes)\n",
                   name, shdr[i].sh_offset, shdr[i].sh_size);
        }
    }

    free(elf_data);
    return BINJECT_OK;
}

/**
 * Extract section from ELF binary
 */
int binject_extract_elf(const char *executable, const char *section_name,
                        const char *output_file) {
    uint8_t *elf_data = NULL;
    size_t elf_size = 0;

    if (read_file(executable, &elf_data, &elf_size) != BINJECT_OK) {
        return BINJECT_ERROR;
    }

    Elf64_Ehdr *ehdr = (Elf64_Ehdr *)elf_data;

    if (memcmp(ehdr->e_ident, ELFMAG, SELFMAG) != 0) {
        free(elf_data);
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    Elf64_Shdr *shdr = (Elf64_Shdr *)(elf_data + ehdr->e_shoff);
    Elf64_Shdr *shstrtab = &shdr[ehdr->e_shstrndx];
    char *strtab = (char *)(elf_data + shstrtab->sh_offset);

    // Find section
    for (int i = 0; i < ehdr->e_shnum; i++) {
        char *name = strtab + shdr[i].sh_name;
        if (strcmp(name, section_name) == 0) {
            // Extract section data
            int result = write_file(output_file,
                                   elf_data + shdr[i].sh_offset,
                                   shdr[i].sh_size);
            free(elf_data);

            if (result == BINJECT_OK) {
                printf("Extracted section '%s' to %s (%lu bytes)\n",
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
int binject_verify_elf(const char *executable, const char *section_name) {
    uint8_t *elf_data = NULL;
    size_t elf_size = 0;

    if (read_file(executable, &elf_data, &elf_size) != BINJECT_OK) {
        return BINJECT_ERROR;
    }

    Elf64_Ehdr *ehdr = (Elf64_Ehdr *)elf_data;

    if (memcmp(ehdr->e_ident, ELFMAG, SELFMAG) != 0) {
        free(elf_data);
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    Elf64_Shdr *shdr = (Elf64_Shdr *)(elf_data + ehdr->e_shoff);
    Elf64_Shdr *shstrtab = &shdr[ehdr->e_shstrndx];
    char *strtab = (char *)(elf_data + shstrtab->sh_offset);

    for (int i = 0; i < ehdr->e_shnum; i++) {
        char *name = strtab + shdr[i].sh_name;
        if (strcmp(name, section_name) == 0) {
            printf("Section '%s' found (size: %lu bytes)\n",
                   section_name, shdr[i].sh_size);
            free(elf_data);
            return BINJECT_OK;
        }
    }

    fprintf(stderr, "Section '%s' not found\n", section_name);
    free(elf_data);
    return BINJECT_ERROR_SECTION_NOT_FOUND;
}
