/**
 * PE binary injection implementation
 *
 * Adds a new section to PE binaries for resource injection.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <sys/stat.h>
#include "binject.h"

/* Shared compression library from bin-infra */
#include "compression_common.h"

#pragma pack(push, 1)

// DOS Header
typedef struct {
    uint16_t e_magic;    // MZ signature
    uint16_t e_cblp;
    uint16_t e_cp;
    uint16_t e_crlc;
    uint16_t e_cparhdr;
    uint16_t e_minalloc;
    uint16_t e_maxalloc;
    uint16_t e_ss;
    uint16_t e_sp;
    uint16_t e_csum;
    uint16_t e_ip;
    uint16_t e_cs;
    uint16_t e_lfarlc;
    uint16_t e_ovno;
    uint16_t e_res[4];
    uint16_t e_oemid;
    uint16_t e_oeminfo;
    uint16_t e_res2[10];
    uint32_t e_lfanew;   // Offset to PE header
} IMAGE_DOS_HEADER;

// PE File Header
typedef struct {
    uint16_t Machine;
    uint16_t NumberOfSections;
    uint32_t TimeDateStamp;
    uint32_t PointerToSymbolTable;
    uint32_t NumberOfSymbols;
    uint16_t SizeOfOptionalHeader;
    uint16_t Characteristics;
} IMAGE_FILE_HEADER;

// PE Optional Header (64-bit)
typedef struct {
    uint16_t Magic;
    uint8_t  MajorLinkerVersion;
    uint8_t  MinorLinkerVersion;
    uint32_t SizeOfCode;
    uint32_t SizeOfInitializedData;
    uint32_t SizeOfUninitializedData;
    uint32_t AddressOfEntryPoint;
    uint32_t BaseOfCode;
    uint64_t ImageBase;
    uint32_t SectionAlignment;
    uint32_t FileAlignment;
    uint16_t MajorOperatingSystemVersion;
    uint16_t MinorOperatingSystemVersion;
    uint16_t MajorImageVersion;
    uint16_t MinorImageVersion;
    uint16_t MajorSubsystemVersion;
    uint16_t MinorSubsystemVersion;
    uint32_t Win32VersionValue;
    uint32_t SizeOfImage;
    uint32_t SizeOfHeaders;
    uint32_t CheckSum;
    uint16_t Subsystem;
    uint16_t DllCharacteristics;
    uint64_t SizeOfStackReserve;
    uint64_t SizeOfStackCommit;
    uint64_t SizeOfHeapReserve;
    uint64_t SizeOfHeapCommit;
    uint32_t LoaderFlags;
    uint32_t NumberOfRvaAndSizes;
} IMAGE_OPTIONAL_HEADER64;

// PE Section Header
typedef struct {
    uint8_t  Name[8];
    uint32_t VirtualSize;
    uint32_t VirtualAddress;
    uint32_t SizeOfRawData;
    uint32_t PointerToRawData;
    uint32_t PointerToRelocations;
    uint32_t PointerToLinenumbers;
    uint16_t NumberOfRelocations;
    uint16_t NumberOfLinenumbers;
    uint32_t Characteristics;
} IMAGE_SECTION_HEADER;

#pragma pack(pop)

#define IMAGE_DOS_SIGNATURE 0x5A4D     // MZ
#define IMAGE_NT_SIGNATURE  0x00004550 // PE\0\0

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
 * Align value to specified alignment
 */
static uint32_t align_value(uint32_t value, uint32_t alignment) {
    return (value + alignment - 1) & ~(alignment - 1);
}

/**
 * Inject resource into PE binary
 */
int binject_inject_pe(const char *executable, const char *section_name,
                      const uint8_t *data, size_t size, uint32_t checksum, int is_compressed) {
    uint8_t *pe_data = NULL;
    size_t pe_size = 0;

    // Read PE file
    if (read_file(executable, &pe_data, &pe_size) != BINJECT_OK) {
        return BINJECT_ERROR;
    }

    // Parse DOS header
    IMAGE_DOS_HEADER *dos = (IMAGE_DOS_HEADER *)pe_data;
    if (dos->e_magic != IMAGE_DOS_SIGNATURE) {
        fprintf(stderr, "Error: Not a valid PE file\n");
        free(pe_data);
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    // Parse NT headers
    uint32_t *nt_sig = (uint32_t *)(pe_data + dos->e_lfanew);
    if (*nt_sig != IMAGE_NT_SIGNATURE) {
        fprintf(stderr, "Error: Invalid PE signature\n");
        free(pe_data);
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    IMAGE_FILE_HEADER *file_hdr = (IMAGE_FILE_HEADER *)(pe_data + dos->e_lfanew + 4);
    IMAGE_OPTIONAL_HEADER64 *opt_hdr = (IMAGE_OPTIONAL_HEADER64 *)(pe_data + dos->e_lfanew + 4 + sizeof(IMAGE_FILE_HEADER));

    // Get section headers
    IMAGE_SECTION_HEADER *sections = (IMAGE_SECTION_HEADER *)((uint8_t *)opt_hdr + file_hdr->SizeOfOptionalHeader);

    // Check if section already exists
    for (int i = 0; i < file_hdr->NumberOfSections; i++) {
        if (strncmp((char *)sections[i].Name, section_name, 8) == 0) {
            fprintf(stderr, "Error: Section %s already exists\n", section_name);
            free(pe_data);
            return BINJECT_ERROR_SECTION_EXISTS;
        }
    }

    // Calculate new section parameters
    IMAGE_SECTION_HEADER *last_section = &sections[file_hdr->NumberOfSections - 1];

    uint32_t virtual_size = size;
    uint32_t virtual_address = align_value(
        last_section->VirtualAddress + last_section->VirtualSize,
        opt_hdr->SectionAlignment
    );

    uint32_t raw_size = align_value(size, opt_hdr->FileAlignment);
    uint32_t raw_address = align_value(pe_size, opt_hdr->FileAlignment);

    // Allocate new PE buffer
    size_t new_pe_size = raw_address + raw_size;
    uint8_t *new_pe = calloc(1, new_pe_size);
    if (!new_pe) {
        free(pe_data);
        return BINJECT_ERROR;
    }

    // Copy original PE
    memcpy(new_pe, pe_data, pe_size);

    // Update pointers to new buffer
    dos = (IMAGE_DOS_HEADER *)new_pe;
    nt_sig = (uint32_t *)(new_pe + dos->e_lfanew);
    file_hdr = (IMAGE_FILE_HEADER *)(new_pe + dos->e_lfanew + 4);
    opt_hdr = (IMAGE_OPTIONAL_HEADER64 *)(new_pe + dos->e_lfanew + 4 + sizeof(IMAGE_FILE_HEADER));
    sections = (IMAGE_SECTION_HEADER *)((uint8_t *)opt_hdr + file_hdr->SizeOfOptionalHeader);

    // Add new section header
    IMAGE_SECTION_HEADER *new_section = &sections[file_hdr->NumberOfSections];
    memset(new_section, 0, sizeof(IMAGE_SECTION_HEADER));

    // Set section name (max 8 chars)
    strncpy((char *)new_section->Name, section_name, 8);

    new_section->VirtualSize = virtual_size;
    new_section->VirtualAddress = virtual_address;
    new_section->SizeOfRawData = raw_size;
    new_section->PointerToRawData = raw_address;
    new_section->Characteristics = 0x40000040; // IMAGE_SCN_CNT_INITIALIZED_DATA | IMAGE_SCN_MEM_READ

    // Copy section data
    memcpy(new_pe + raw_address, data, size);

    // Update PE headers
    file_hdr->NumberOfSections++;
    opt_hdr->SizeOfImage = align_value(
        virtual_address + virtual_size,
        opt_hdr->SectionAlignment
    );

    // Write modified PE
    int result = write_file(executable, new_pe, new_pe_size);

    free(pe_data);
    free(new_pe);

    if (result != BINJECT_OK) {
        return BINJECT_ERROR_WRITE_FAILED;
    }

    printf("Successfully injected section '%s' (%zu bytes) into %s\n",
           section_name, size, executable);

    return BINJECT_OK;
}

/**
 * List sections in PE binary
 */
int binject_list_pe(const char *executable) {
    uint8_t *pe_data = NULL;
    size_t pe_size = 0;

    if (read_file(executable, &pe_data, &pe_size) != BINJECT_OK) {
        return BINJECT_ERROR;
    }

    IMAGE_DOS_HEADER *dos = (IMAGE_DOS_HEADER *)pe_data;
    if (dos->e_magic != IMAGE_DOS_SIGNATURE) {
        free(pe_data);
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    uint32_t *nt_sig = (uint32_t *)(pe_data + dos->e_lfanew);
    if (*nt_sig != IMAGE_NT_SIGNATURE) {
        free(pe_data);
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    IMAGE_FILE_HEADER *file_hdr = (IMAGE_FILE_HEADER *)(pe_data + dos->e_lfanew + 4);
    IMAGE_OPTIONAL_HEADER64 *opt_hdr = (IMAGE_OPTIONAL_HEADER64 *)(pe_data + dos->e_lfanew + 4 + sizeof(IMAGE_FILE_HEADER));
    IMAGE_SECTION_HEADER *sections = (IMAGE_SECTION_HEADER *)((uint8_t *)opt_hdr + file_hdr->SizeOfOptionalHeader);

    printf("Sections in %s:\n", executable);
    for (int i = 0; i < file_hdr->NumberOfSections; i++) {
        char name[9] = {0};
        strncpy(name, (char *)sections[i].Name, 8);

        if (strstr(name, "NODE") || strstr(name, "SOCK")) {
            printf("  %s (offset: 0x%x, size: %u bytes)\n",
                   name, sections[i].PointerToRawData, sections[i].SizeOfRawData);
        }
    }

    free(pe_data);
    return BINJECT_OK;
}

/**
 * Extract section from PE binary
 */
int binject_extract_pe(const char *executable, const char *section_name,
                       const char *output_file) {
    uint8_t *pe_data = NULL;
    size_t pe_size = 0;

    if (read_file(executable, &pe_data, &pe_size) != BINJECT_OK) {
        return BINJECT_ERROR;
    }

    IMAGE_DOS_HEADER *dos = (IMAGE_DOS_HEADER *)pe_data;
    if (dos->e_magic != IMAGE_DOS_SIGNATURE) {
        free(pe_data);
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    uint32_t *nt_sig = (uint32_t *)(pe_data + dos->e_lfanew);
    if (*nt_sig != IMAGE_NT_SIGNATURE) {
        free(pe_data);
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    IMAGE_FILE_HEADER *file_hdr = (IMAGE_FILE_HEADER *)(pe_data + dos->e_lfanew + 4);
    IMAGE_OPTIONAL_HEADER64 *opt_hdr = (IMAGE_OPTIONAL_HEADER64 *)(pe_data + dos->e_lfanew + 4 + sizeof(IMAGE_FILE_HEADER));
    IMAGE_SECTION_HEADER *sections = (IMAGE_SECTION_HEADER *)((uint8_t *)opt_hdr + file_hdr->SizeOfOptionalHeader);

    // Find section
    for (int i = 0; i < file_hdr->NumberOfSections; i++) {
        char name[9] = {0};
        strncpy(name, (char *)sections[i].Name, 8);

        if (strcmp(name, section_name) == 0) {
            // Extract section data
            int result = write_file(output_file,
                                   pe_data + sections[i].PointerToRawData,
                                   sections[i].SizeOfRawData);
            free(pe_data);

            if (result == BINJECT_OK) {
                printf("Extracted section '%s' to %s (%u bytes)\n",
                       section_name, output_file, sections[i].SizeOfRawData);
            }
            return result;
        }
    }

    fprintf(stderr, "Error: Section '%s' not found\n", section_name);
    free(pe_data);
    return BINJECT_ERROR_SECTION_NOT_FOUND;
}

/**
 * Verify section exists in PE binary
 */
int binject_verify_pe(const char *executable, const char *section_name) {
    uint8_t *pe_data = NULL;
    size_t pe_size = 0;

    if (read_file(executable, &pe_data, &pe_size) != BINJECT_OK) {
        return BINJECT_ERROR;
    }

    IMAGE_DOS_HEADER *dos = (IMAGE_DOS_HEADER *)pe_data;
    if (dos->e_magic != IMAGE_DOS_SIGNATURE) {
        free(pe_data);
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    uint32_t *nt_sig = (uint32_t *)(pe_data + dos->e_lfanew);
    if (*nt_sig != IMAGE_NT_SIGNATURE) {
        free(pe_data);
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    IMAGE_FILE_HEADER *file_hdr = (IMAGE_FILE_HEADER *)(pe_data + dos->e_lfanew + 4);
    IMAGE_OPTIONAL_HEADER64 *opt_hdr = (IMAGE_OPTIONAL_HEADER64 *)(pe_data + dos->e_lfanew + 4 + sizeof(IMAGE_FILE_HEADER));
    IMAGE_SECTION_HEADER *sections = (IMAGE_SECTION_HEADER *)((uint8_t *)opt_hdr + file_hdr->SizeOfOptionalHeader);

    for (int i = 0; i < file_hdr->NumberOfSections; i++) {
        char name[9] = {0};
        strncpy(name, (char *)sections[i].Name, 8);

        if (strcmp(name, section_name) == 0) {
            printf("Section '%s' found (size: %u bytes)\n",
                   section_name, sections[i].SizeOfRawData);
            free(pe_data);
            return BINJECT_OK;
        }
    }

    fprintf(stderr, "Section '%s' not found\n", section_name);
    free(pe_data);
    return BINJECT_ERROR_SECTION_NOT_FOUND;
}
