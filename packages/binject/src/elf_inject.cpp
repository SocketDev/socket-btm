/**
 * ELF binary injection implementation using LIEF
 *
 * Injects resources into ELF (Linux) binaries by adding a new section
 * containing the resource data. Uses LIEF library for robust binary manipulation.
 */

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <vector>

#include <LIEF/LIEF.hpp>

extern "C" {
#include "binject.h"
}

// Section name prefix for binject sections
#define BINJECT_SECTION_PREFIX ".binject"
#define BINJECT_META_SUFFIX "_meta"

// Metadata structure (stored in a separate section)
struct binject_metadata {
    uint32_t magic;          // 0x424A5421 ("BJT!")
    uint32_t version;        // Metadata version
    uint32_t checksum;       // Original data checksum
    uint32_t is_compressed;  // 1 if compressed, 0 if not
    uint32_t original_size;  // Original uncompressed size
    uint32_t data_size;      // Size of data in main section
    char section_name[56];   // Name of data section (for verification)
};

#define BINJECT_MAGIC 0x424A5421  // "BJT!"
#define BINJECT_VERSION 1

/**
 * Inject resource into ELF binary using LIEF
 */
int binject_inject_elf(const char *executable, const char *section_name,
                       const uint8_t *data, size_t size, uint32_t checksum, int is_compressed) {
    if (!executable || !section_name || !data || size == 0) {
        fprintf(stderr, "Error: Invalid arguments\n");
        return BINJECT_ERROR;
    }

    try {
        // Parse the ELF binary
        std::unique_ptr<LIEF::ELF::Binary> binary = LIEF::ELF::Parser::parse(executable);

        if (!binary) {
            fprintf(stderr, "Error: Failed to parse ELF binary: %s\n", executable);
            return BINJECT_ERROR_INVALID_FORMAT;
        }

        // Create section name with prefix
        std::string full_section_name = std::string(BINJECT_SECTION_PREFIX) + "_" + section_name;
        std::string meta_section_name = full_section_name + BINJECT_META_SUFFIX;

        // Check if section already exists
        if (binary->has_section(full_section_name)) {
            fprintf(stderr, "Error: Section %s already exists\n", full_section_name.c_str());
            return BINJECT_ERROR_SECTION_EXISTS;
        }

        // Create metadata
        binject_metadata meta = {};
        meta.magic = BINJECT_MAGIC;
        meta.version = BINJECT_VERSION;
        meta.checksum = checksum;
        meta.is_compressed = is_compressed ? 1 : 0;
        meta.original_size = is_compressed ? 0 : static_cast<uint32_t>(size);
        meta.data_size = static_cast<uint32_t>(size);
        strncpy(meta.section_name, section_name, sizeof(meta.section_name) - 1);

        // Create data section
        LIEF::ELF::Section data_section(full_section_name, LIEF::ELF::Section::TYPE::PROGBITS);
        data_section.content(std::vector<uint8_t>(data, data + size));
        data_section.flags(static_cast<uint64_t>(LIEF::ELF::Section::FLAGS::ALLOC));
        binary->add(data_section, false);

        // Create metadata section
        LIEF::ELF::Section meta_section(meta_section_name, LIEF::ELF::Section::TYPE::PROGBITS);
        meta_section.content(std::vector<uint8_t>(
            reinterpret_cast<uint8_t*>(&meta),
            reinterpret_cast<uint8_t*>(&meta) + sizeof(meta)
        ));
        meta_section.flags(static_cast<uint64_t>(LIEF::ELF::Section::FLAGS::ALLOC));
        binary->add(meta_section, false);

        // Write the modified binary
        binary->write(executable);

        printf("✓ Successfully injected %zu bytes into %s\n", size, executable);
        return BINJECT_OK;

    } catch (const std::exception& e) {
        fprintf(stderr, "Error: LIEF exception: %s\n", e.what());
        return BINJECT_ERROR;
    } catch (...) {
        fprintf(stderr, "Error: Unknown exception during injection\n");
        return BINJECT_ERROR;
    }
}

/**
 * List all binject resources in ELF binary
 */
int binject_list_elf(const char *executable) {
    try {
        std::unique_ptr<LIEF::ELF::Binary> binary = LIEF::ELF::Parser::parse(executable);

        if (!binary) {
            fprintf(stderr, "Error: Failed to parse ELF binary\n");
            return BINJECT_ERROR_INVALID_FORMAT;
        }

        bool found_any = false;
        std::string prefix = BINJECT_SECTION_PREFIX;

        for (const auto& section : binary->sections()) {
            std::string name = section.name();

            // Check if this is a binject data section (not metadata)
            if (name.find(prefix) == 0 && name.find(BINJECT_META_SUFFIX) == std::string::npos) {
                // Extract the actual section name (remove prefix and underscore)
                std::string actual_name = name.substr(prefix.length() + 1);

                // Look for corresponding metadata section
                std::string meta_name = name + BINJECT_META_SUFFIX;
                bool has_meta = binary->has_section(meta_name);

                printf("Section: %s\n", actual_name.c_str());
                printf("  Size: %llu bytes\n", static_cast<unsigned long long>(section.size()));

                if (has_meta) {
                    LIEF::ELF::Section* meta_section_ptr = binary->get_section(meta_name);
                    if (!meta_section_ptr) continue;
                    auto meta_content = meta_section_ptr->content();
                    std::vector<uint8_t> meta_data(meta_content.begin(), meta_content.end());

                    if (meta_data.size() >= sizeof(binject_metadata)) {
                        binject_metadata* meta = reinterpret_cast<binject_metadata*>(meta_data.data());

                        if (meta->magic == BINJECT_MAGIC) {
                            printf("  Compressed: %s\n", meta->is_compressed ? "yes" : "no");
                            printf("  Checksum: 0x%08x\n", meta->checksum);
                            if (meta->original_size > 0) {
                                printf("  Original size: %u bytes\n", meta->original_size);
                            }
                        }
                    }
                }

                printf("\n");
                found_any = true;
            }
        }

        if (!found_any) {
            printf("No binject resources found.\n");
        }

        return BINJECT_OK;

    } catch (const std::exception& e) {
        fprintf(stderr, "Error: LIEF exception: %s\n", e.what());
        return BINJECT_ERROR;
    } catch (...) {
        fprintf(stderr, "Error: Unknown exception\n");
        return BINJECT_ERROR;
    }
}

/**
 * Extract resource from ELF binary
 */
int binject_extract_elf(const char *executable, const char *section_name,
                        const char *output_file) {
    try {
        std::unique_ptr<LIEF::ELF::Binary> binary = LIEF::ELF::Parser::parse(executable);

        if (!binary) {
            fprintf(stderr, "Error: Failed to parse ELF binary\n");
            return BINJECT_ERROR_INVALID_FORMAT;
        }

        // Construct full section name
        std::string full_section_name = std::string(BINJECT_SECTION_PREFIX) + "_" + section_name;

        if (!binary->has_section(full_section_name)) {
            fprintf(stderr, "Error: Section '%s' not found\n", section_name);
            return BINJECT_ERROR_SECTION_NOT_FOUND;
        }

        // Get section data
        LIEF::ELF::Section* section = binary->get_section(full_section_name);
        if (!section) {
            fprintf(stderr, "Error: Failed to get section\n");
            return BINJECT_ERROR;
        }
        auto content = section->content();
        std::vector<uint8_t> data(content.begin(), content.end());

        // Check for metadata
        std::string meta_name = full_section_name + BINJECT_META_SUFFIX;
        bool is_compressed = false;

        if (binary->has_section(meta_name)) {
            LIEF::ELF::Section* meta_section = binary->get_section(meta_name);
            if (meta_section) {
                auto meta_content = meta_section->content();
                std::vector<uint8_t> meta_data(meta_content.begin(), meta_content.end());

            if (meta_data.size() >= sizeof(binject_metadata)) {
                binject_metadata* meta = reinterpret_cast<binject_metadata*>(meta_data.data());
                    if (meta->magic == BINJECT_MAGIC) {
                        is_compressed = (meta->is_compressed != 0);
                    }
                }
            }
        }

        // Decompress if needed
        uint8_t *final_data = data.data();
        size_t final_size = data.size();
        uint8_t *decompressed = nullptr;

        if (is_compressed) {
            printf("  Decompressing data...\n");
            size_t decompressed_size = 0;
            int rc = binject_decompress(data.data(), data.size(), &decompressed, &decompressed_size);
            if (rc == BINJECT_OK) {
                final_data = decompressed;
                final_size = decompressed_size;
                printf("  Decompressed to %zu bytes\n", decompressed_size);
            } else {
                fprintf(stderr, "Warning: Decompression failed, writing compressed data\n");
            }
        }

        // Write to output file
        FILE *fp = fopen(output_file, "wb");
        if (!fp) {
            if (decompressed) free(decompressed);
            fprintf(stderr, "Error: Cannot create output file: %s\n", output_file);
            return BINJECT_ERROR_WRITE_FAILED;
        }

        size_t written = fwrite(final_data, 1, final_size, fp);
        fclose(fp);

        if (decompressed) {
            free(decompressed);
        }

        if (written != final_size) {
            fprintf(stderr, "Error: Failed to write complete data\n");
            return BINJECT_ERROR_WRITE_FAILED;
        }

        printf("✓ Successfully extracted %zu bytes to %s\n", final_size, output_file);
        return BINJECT_OK;

    } catch (const std::exception& e) {
        fprintf(stderr, "Error: LIEF exception: %s\n", e.what());
        return BINJECT_ERROR;
    } catch (...) {
        fprintf(stderr, "Error: Unknown exception\n");
        return BINJECT_ERROR;
    }
}

/**
 * Verify resource integrity in ELF binary
 */
int binject_verify_elf(const char *executable, const char *section_name) {
    try {
        std::unique_ptr<LIEF::ELF::Binary> binary = LIEF::ELF::Parser::parse(executable);

        if (!binary) {
            fprintf(stderr, "Error: Failed to parse ELF binary\n");
            return BINJECT_ERROR_INVALID_FORMAT;
        }

        // Construct full section name
        std::string full_section_name = std::string(BINJECT_SECTION_PREFIX) + "_" + section_name;
        std::string meta_name = full_section_name + BINJECT_META_SUFFIX;

        if (!binary->has_section(full_section_name)) {
            fprintf(stderr, "Error: Section '%s' not found\n", section_name);
            return BINJECT_ERROR_SECTION_NOT_FOUND;
        }

        if (!binary->has_section(meta_name)) {
            fprintf(stderr, "Error: Metadata section not found\n");
            return BINJECT_ERROR;
        }

        // Read metadata
        LIEF::ELF::Section* meta_section = binary->get_section(meta_name);
        if (!meta_section) {
            fprintf(stderr, "Error: Failed to get metadata section\n");
            return BINJECT_ERROR;
        }
        auto meta_content = meta_section->content();
        std::vector<uint8_t> meta_data(meta_content.begin(), meta_content.end());

        if (meta_data.size() < sizeof(binject_metadata)) {
            fprintf(stderr, "Error: Invalid metadata size\n");
            return BINJECT_ERROR;
        }

        binject_metadata* meta = reinterpret_cast<binject_metadata*>(meta_data.data());

        if (meta->magic != BINJECT_MAGIC) {
            fprintf(stderr, "Error: Invalid metadata magic\n");
            return BINJECT_ERROR;
        }

        // Read section data
        LIEF::ELF::Section* section = binary->get_section(full_section_name);
        if (!section) {
            fprintf(stderr, "Error: Failed to get section\n");
            return BINJECT_ERROR;
        }
        auto content = section->content();
        std::vector<uint8_t> data(content.begin(), content.end());

        printf("  Section size: %zu bytes\n", data.size());
        printf("  Compressed: %s\n", meta->is_compressed ? "yes" : "no");
        printf("  Stored checksum: 0x%08x\n", meta->checksum);

        // Decompress if needed
        uint8_t *verify_data = data.data();
        size_t verify_size = data.size();
        uint8_t *decompressed = nullptr;

        if (meta->is_compressed) {
            size_t decompressed_size = 0;
            int rc = binject_decompress(data.data(), data.size(), &decompressed, &decompressed_size);
            if (rc != BINJECT_OK) {
                fprintf(stderr, "Error: Failed to decompress data for verification\n");
                return BINJECT_ERROR_DECOMPRESSION_FAILED;
            }
            verify_data = decompressed;
            verify_size = decompressed_size;
            printf("  Decompressed size: %zu bytes\n", decompressed_size);
        }

        // Calculate checksum
        uint32_t calculated_checksum = binject_checksum(verify_data, verify_size);
        printf("  Calculated checksum: 0x%08x\n", calculated_checksum);

        if (decompressed) {
            free(decompressed);
        }

        if (calculated_checksum == meta->checksum) {
            printf("✓ Verification passed\n");
            return BINJECT_OK;
        } else {
            fprintf(stderr, "✗ Verification failed: checksum mismatch\n");
            return BINJECT_ERROR;
        }

    } catch (const std::exception& e) {
        fprintf(stderr, "Error: LIEF exception: %s\n", e.what());
        return BINJECT_ERROR;
    } catch (...) {
        fprintf(stderr, "Error: Unknown exception\n");
        return BINJECT_ERROR;
    }
}
