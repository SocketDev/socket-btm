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
#include <limits.h>
#ifdef _WIN32
#include <process.h>  // For getpid() on Windows
#include <windows.h>  // For MoveFileEx on Windows
#else
#include <unistd.h>   // For getpid() on Unix
#endif
#include "binject.h"
#include "file_utils.h"

/* Shared compression library from bin-infra */
#include "buffer_constants.h"
#include "compression_common.h"
#include "file_io_common.h"

/* Fallback for PATH_MAX if not defined */
#ifndef PATH_MAX
#define PATH_MAX 4096
#endif

/* Maximum PE file size (200MB) - same as ELF for consistency (Node.js binaries) */
#define MAX_PE_SIZE (200 * 1024 * 1024)

/* On Windows, windows.h provides PE structures. On other platforms, define them. */
#ifndef _WIN32
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
#endif /* !_WIN32 */

#define IMAGE_DOS_SIGNATURE 0x5A4D     // MZ
#define IMAGE_NT_SIGNATURE  0x00004550 // PE\0\0

/* File I/O helpers removed - now using file_io_common.h
 * Note: file_io_write() doesn't create parent directories, so we still handle that separately */

/**
 * Align value to specified alignment
 */
static uint32_t align_value(uint32_t value, uint32_t alignment) {
    return (value + alignment - 1) & ~(alignment - 1);
}

/**
 * Validate and parse PE headers with bounds checking.
 * Returns pointers to headers in the provided structure.
 */
typedef struct {
    IMAGE_DOS_HEADER *dos;
    IMAGE_FILE_HEADER *file_hdr;
    IMAGE_OPTIONAL_HEADER64 *opt_hdr;
    IMAGE_SECTION_HEADER *sections;
} pe_headers_t;

static int parse_pe_headers(uint8_t *pe_data, size_t pe_size, pe_headers_t *headers) {
    // Validate minimum PE size
    if (pe_size < sizeof(IMAGE_DOS_HEADER)) {
        fprintf(stderr, "Error: File too small to be a PE\n");
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    // Parse DOS header
    headers->dos = (IMAGE_DOS_HEADER *)pe_data;
    if (headers->dos->e_magic != IMAGE_DOS_SIGNATURE) {
        fprintf(stderr, "Error: Not a valid PE file\n");
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    // Validate e_lfanew is within file bounds
    if (headers->dos->e_lfanew > pe_size - PE_SIGNATURE_SIZE - sizeof(IMAGE_FILE_HEADER) - sizeof(IMAGE_OPTIONAL_HEADER64)) {
        fprintf(stderr, "Error: Invalid e_lfanew offset (0x%x)\n", headers->dos->e_lfanew);
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    // Parse NT signature
    uint32_t *nt_sig = (uint32_t *)(pe_data + headers->dos->e_lfanew);
    if (*nt_sig != IMAGE_NT_SIGNATURE) {
        fprintf(stderr, "Error: Invalid PE signature\n");
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    // Parse file header
    headers->file_hdr = (IMAGE_FILE_HEADER *)(pe_data + headers->dos->e_lfanew + PE_SIGNATURE_SIZE);

    // Validate SizeOfOptionalHeader
    if (headers->file_hdr->SizeOfOptionalHeader < sizeof(IMAGE_OPTIONAL_HEADER64)) {
        fprintf(stderr, "Error: Invalid SizeOfOptionalHeader (%u)\n", headers->file_hdr->SizeOfOptionalHeader);
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    // Validate optional header is within file bounds
    size_t opt_hdr_offset = headers->dos->e_lfanew + PE_SIGNATURE_SIZE + sizeof(IMAGE_FILE_HEADER);
    if (opt_hdr_offset + headers->file_hdr->SizeOfOptionalHeader > pe_size) {
        fprintf(stderr, "Error: Optional header extends beyond file\n");
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    headers->opt_hdr = (IMAGE_OPTIONAL_HEADER64 *)(pe_data + opt_hdr_offset);

    // Validate section headers are within file bounds
    size_t sections_offset = opt_hdr_offset + headers->file_hdr->SizeOfOptionalHeader;
    size_t sections_size = headers->file_hdr->NumberOfSections * sizeof(IMAGE_SECTION_HEADER);

    if (sections_offset > pe_size || sections_size > pe_size - sections_offset) {
        fprintf(stderr, "Error: Section table extends beyond file\n");
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    headers->sections = (IMAGE_SECTION_HEADER *)(pe_data + sections_offset);

    return BINJECT_OK;
}

/**
 * Inject resource into PE binary
 */
int binject_single_pe(const char *executable, const char *output, const char *section_name,
                              const uint8_t *data, size_t size, uint32_t checksum, int is_compressed) {
    uint8_t *pe_data = NULL;
    size_t pe_size = 0;

    // Read PE file
    if (file_io_read(executable, &pe_data, &pe_size) != FILE_IO_OK) {
        return BINJECT_ERROR;
    }

    // Parse and validate PE headers
    pe_headers_t headers;
    int result = parse_pe_headers(pe_data, pe_size, &headers);
    if (result != BINJECT_OK) {
        free(pe_data);
        return result;
    }

    IMAGE_DOS_HEADER *dos = headers.dos;
    uint32_t *nt_sig;
    IMAGE_FILE_HEADER *file_hdr = headers.file_hdr;
    IMAGE_OPTIONAL_HEADER64 *opt_hdr = headers.opt_hdr;
    IMAGE_SECTION_HEADER *sections = headers.sections;

    // Check if section already exists and mark for auto-overwrite
    int existing_section = -1;
    for (int i = 0; i < file_hdr->NumberOfSections; i++) {
        if (strncmp((char *)sections[i].Name, section_name, PE_SECTION_NAME_MAX_LENGTH) == 0) {
            existing_section = i;
            printf("Removing existing section '%s' for auto-overwrite...\n", section_name);
            break;
        }
    }

    // Track size of removed section data to exclude from new buffer
    size_t removed_section_size = 0;

    // If section exists, remove it by zeroing data and shifting headers
    if (existing_section >= 0) {
        IMAGE_SECTION_HEADER *existing_hdr = &sections[existing_section];

        // Validate we can safely remove this section
        if (file_hdr->NumberOfSections <= 1) {
            fprintf(stderr, "Error: Cannot remove the only section\n");
            free(pe_data);
            return BINJECT_ERROR;
        }

        // Track the removed section's data for exclusion from new buffer
        removed_section_size = existing_hdr->SizeOfRawData;

        // Validate and zero out the old section data
        if (existing_hdr->PointerToRawData > 0 && existing_hdr->SizeOfRawData > 0) {
            if (existing_hdr->PointerToRawData >= pe_size ||
                existing_hdr->PointerToRawData > pe_size - existing_hdr->SizeOfRawData) {
                fprintf(stderr, "Error: Section data exceeds file bounds\n");
                free(pe_data);
                return BINJECT_ERROR_INVALID_FORMAT;
            }
            memset(pe_data + existing_hdr->PointerToRawData, 0, existing_hdr->SizeOfRawData);
        }

        // Shift all section headers after the removed section using memmove (handles overlap)
        memmove(&sections[existing_section], &sections[existing_section + 1],
                (file_hdr->NumberOfSections - existing_section - 1) * sizeof(IMAGE_SECTION_HEADER));

        // Clear the last section header
        memset(&sections[file_hdr->NumberOfSections - 1], 0, sizeof(IMAGE_SECTION_HEADER));
        // Decrement section count
        file_hdr->NumberOfSections--;
    }

    // Calculate new section parameters
    if (file_hdr->NumberOfSections == 0) {
        fprintf(stderr, "Error: PE has no sections\n");
        free(pe_data);
        return BINJECT_ERROR_INVALID_FORMAT;
    }

    // NOTE: We'll calculate last_section AFTER buffer reallocation to avoid pointer invalidation
    // But we need its values now, so read them before any reallocation
    IMAGE_SECTION_HEADER *last_hdr = &sections[file_hdr->NumberOfSections - 1];
    uint32_t last_section_vaddr = last_hdr->VirtualAddress;
#ifdef _WIN32
    // Windows SDK uses Misc.VirtualSize
    uint32_t last_section_vsize = last_hdr->Misc.VirtualSize;
#else
    uint32_t last_section_vsize = last_hdr->VirtualSize;
#endif

    // Validate section size doesn't overflow
    if (size > UINT32_MAX) {
        fprintf(stderr, "Error: Section size too large\n");
        free(pe_data);
        return BINJECT_ERROR;
    }

    uint32_t virtual_size = (uint32_t)size;

    // Check for overflow in virtual address calculation
    if (last_section_vaddr > UINT32_MAX - last_section_vsize) {
        fprintf(stderr, "Error: Virtual address overflow\n");
        free(pe_data);
        return BINJECT_ERROR;
    }

    uint32_t base_virtual = last_section_vaddr + last_section_vsize;
    uint32_t virtual_address = align_value(base_virtual, opt_hdr->SectionAlignment);

    // Verify align_value didn't overflow (result should be >= input for valid alignment)
    if (virtual_address < base_virtual) {
        fprintf(stderr, "Error: Virtual address alignment overflow\n");
        free(pe_data);
        return BINJECT_ERROR;
    }

    uint32_t raw_size = align_value((uint32_t)size, opt_hdr->FileAlignment);

    // Verify raw_size alignment didn't overflow
    if (raw_size < (uint32_t)size) {
        fprintf(stderr, "Error: Raw size alignment overflow\n");
        free(pe_data);
        return BINJECT_ERROR;
    }

    // Exclude removed section data from effective PE size
    size_t effective_pe_size = pe_size - removed_section_size;

    // Validate effective_pe_size fits in uint32_t for alignment
    if (effective_pe_size > UINT32_MAX) {
        fprintf(stderr, "Error: PE size too large for alignment\n");
        free(pe_data);
        return BINJECT_ERROR;
    }

    uint32_t raw_address = align_value((uint32_t)effective_pe_size, opt_hdr->FileAlignment);

    // Check for overflow in new PE size calculation
    if (raw_address > SIZE_MAX - raw_size) {
        fprintf(stderr, "Error: New PE size would overflow\n");
        free(pe_data);
        return BINJECT_ERROR;
    }

    // Allocate new PE buffer
    size_t new_pe_size = (size_t)raw_address + raw_size;

    // Validate new size doesn't exceed maximum
    if (new_pe_size > MAX_PE_SIZE) {
        fprintf(stderr, "Error: New PE would exceed maximum size\n");
        free(pe_data);
        return BINJECT_ERROR;
    }

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
    file_hdr = (IMAGE_FILE_HEADER *)(new_pe + dos->e_lfanew + PE_SIGNATURE_SIZE);
    opt_hdr = (IMAGE_OPTIONAL_HEADER64 *)(new_pe + dos->e_lfanew + PE_SIGNATURE_SIZE + sizeof(IMAGE_FILE_HEADER));
    sections = (IMAGE_SECTION_HEADER *)((uint8_t *)opt_hdr + file_hdr->SizeOfOptionalHeader);

    // Add new section header
    IMAGE_SECTION_HEADER *new_section = &sections[file_hdr->NumberOfSections];
    memset(new_section, 0, sizeof(IMAGE_SECTION_HEADER));

    // Set section name (max 8 chars)
    strncpy((char *)new_section->Name, section_name, PE_SECTION_NAME_MAX_LENGTH);

#ifdef _WIN32
    // Windows SDK uses Misc.VirtualSize
    new_section->Misc.VirtualSize = virtual_size;
#else
    new_section->VirtualSize = virtual_size;
#endif
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

    // Write to temporary file first (tmpdir workflow)
    char tmpfile[PATH_MAX];
    snprintf(tmpfile, sizeof(tmpfile), "%s.tmp.%d", output, getpid());

    // Create parent directories if needed (file_io_write doesn't do this)
    if (create_parent_directories(tmpfile) != 0) {
        fprintf(stderr, "Error: Failed to create parent directories for output path: %s\n", tmpfile);
        free(pe_data);
        free(new_pe);
        return BINJECT_ERROR;
    }

    result = (file_io_write(tmpfile, new_pe, new_pe_size) == FILE_IO_OK) ? BINJECT_OK : BINJECT_ERROR;

    free(pe_data);
    free(new_pe);

    if (result != BINJECT_OK) {
        unlink(tmpfile);
        return BINJECT_ERROR_WRITE_FAILED;
    }

    // Make executable (Windows doesn't have chmod but this is cross-platform safe)
#ifndef _WIN32
    if (chmod(tmpfile, 0755) != 0) {
        fprintf(stderr, "Error: Failed to make temp file executable (chmod failed)\n");
        unlink(tmpfile);
        return BINJECT_ERROR_WRITE_FAILED;
    }
#endif

    // Atomic rename to final destination
#ifdef _WIN32
    // On Windows, use MoveFileEx with MOVEFILE_REPLACE_EXISTING for atomic replacement
    if (!MoveFileExA(tmpfile, output, MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
        DWORD err = GetLastError();
        fprintf(stderr, "Error: Failed to move temporary file to output: %s (error code: %lu)\n", output, err);
        unlink(tmpfile);
        return BINJECT_ERROR_WRITE_FAILED;
    }
#else
    // On Unix, remove first then rename (rename() is atomic and replaces existing files)
    remove(output);
    if (rename(tmpfile, output) != 0) {
        fprintf(stderr, "Error: Failed to move temporary file to output: %s\n", output);
        unlink(tmpfile);
        return BINJECT_ERROR_WRITE_FAILED;
    }
#endif

    printf("Successfully injected section '%s' (%zu bytes) into %s\n",
           section_name, size, output);

    return BINJECT_OK;
}

/**
 * List sections in PE binary
 */
int binject_pe_list(const char *executable) {
    uint8_t *pe_data = NULL;
    size_t pe_size = 0;

    if (file_io_read(executable, &pe_data, &pe_size) != FILE_IO_OK) {
        return BINJECT_ERROR;
    }

    // Parse and validate PE headers
    pe_headers_t headers;
    int result = parse_pe_headers(pe_data, pe_size, &headers);
    if (result != BINJECT_OK) {
        free(pe_data);
        return result;
    }

    IMAGE_FILE_HEADER *file_hdr = headers.file_hdr;
    IMAGE_SECTION_HEADER *sections = headers.sections;

    printf("Sections in %s:\n", executable);
    for (int i = 0; i < file_hdr->NumberOfSections; i++) {
        char name[9] = {0};
        strncpy(name, (char *)sections[i].Name, PE_SECTION_NAME_MAX_LENGTH);

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
int binject_pe_extract(const char *executable, const char *section_name,
                       const char *output_file) {
    uint8_t *pe_data = NULL;
    size_t pe_size = 0;

    if (file_io_read(executable, &pe_data, &pe_size) != FILE_IO_OK) {
        return BINJECT_ERROR;
    }

    // Parse and validate PE headers
    pe_headers_t headers;
    int result = parse_pe_headers(pe_data, pe_size, &headers);
    if (result != BINJECT_OK) {
        free(pe_data);
        return result;
    }

    IMAGE_FILE_HEADER *file_hdr = headers.file_hdr;
    IMAGE_SECTION_HEADER *sections = headers.sections;

    // Find section
    for (int i = 0; i < file_hdr->NumberOfSections; i++) {
        char name[9] = {0};
        strncpy(name, (char *)sections[i].Name, PE_SECTION_NAME_MAX_LENGTH);

        if (strcmp(name, section_name) == 0) {
            // Extract section data
            // Create parent directories if needed
            if (create_parent_directories(output_file) != 0) {
                fprintf(stderr, "Error: Failed to create parent directories for output path: %s\n", output_file);
                free(pe_data);
                return BINJECT_ERROR;
            }

            int result = (file_io_write(output_file,
                                       pe_data + sections[i].PointerToRawData,
                                       sections[i].SizeOfRawData) == FILE_IO_OK) ? BINJECT_OK : BINJECT_ERROR;
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
int binject_pe_verify(const char *executable, const char *section_name) {
    uint8_t *pe_data = NULL;
    size_t pe_size = 0;

    if (file_io_read(executable, &pe_data, &pe_size) != FILE_IO_OK) {
        return BINJECT_ERROR;
    }

    // Parse and validate PE headers
    pe_headers_t headers;
    int result = parse_pe_headers(pe_data, pe_size, &headers);
    if (result != BINJECT_OK) {
        free(pe_data);
        return result;
    }

    IMAGE_FILE_HEADER *file_hdr = headers.file_hdr;
    IMAGE_SECTION_HEADER *sections = headers.sections;

    for (int i = 0; i < file_hdr->NumberOfSections; i++) {
        char name[9] = {0};
        strncpy(name, (char *)sections[i].Name, PE_SECTION_NAME_MAX_LENGTH);

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
