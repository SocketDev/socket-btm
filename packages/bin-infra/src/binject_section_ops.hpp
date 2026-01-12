/**
 * binject_section_ops.hpp - Template-based section operations (list/extract/verify)
 *
 * Provides generic implementations of list, extract, and verify operations
 * that work across Mach-O, ELF, and PE binary formats using LIEF.
 *
 * MOTIVATION:
 * ===========
 * The list/extract/verify functions in elf_inject_lief.cpp, pe_inject_lief.cpp,
 * and macho_inject_lief.cpp are 60-90% identical, differing only in LIEF API
 * calls and platform-specific section names.
 *
 * By using templates, we write the logic once and let the compiler generate
 * platform-specific versions automatically.
 *
 * USAGE PATTERN:
 * =============
 * ```cpp
 * // In elf_inject_lief.cpp
 * extern "C" int binject_elf_list_lief(const char* executable) {
 *     return binject::list_sections<LIEF::ELF::Binary>(executable);
 * }
 *
 * // In pe_inject_lief.cpp
 * extern "C" int binject_pe_list_lief(const char* executable) {
 *     return binject::list_sections<LIEF::PE::Binary>(executable);
 * }
 * ```
 *
 * BENEFITS:
 * - Write logic once, works for all platforms
 * - Fix bug once, all platforms get the fix
 * - Compiler enforces consistency
 * - Reduces ~180 lines of duplicate code
 */

#ifndef BINJECT_SECTION_OPS_HPP
#define BINJECT_SECTION_OPS_HPP

#include <LIEF/LIEF.hpp>

// Suppress deprecation warning for wstring_convert (deprecated in C++17)
// We use this for PE resource name conversion (UTF-16) and there's no
// standard replacement yet. When C++20/23 alternatives are available, migrate.
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wdeprecated-declarations"
#include <codecvt>
#include <locale>
#pragma GCC diagnostic pop

#include <cstdio>
#include <cstring>
#include <vector>
#include "binject_lief_traits.hpp"

// Note: Error codes come from binject.h which is included by the calling .cpp file
// We don't include it here to avoid header dependency issues.

// Forward declare C file I/O function
extern "C" int create_parent_directories(const char* path);

namespace binject {

/**
 * List sections of interest (NODE_SEA_BLOB, SMOL_VFS_BLOB, compressed stub).
 *
 * Template works for ELF, PE, and Mach-O with platform-specific handling:
 * - ELF/PE: Checks sections directly
 * - Mach-O: Checks segments (NODE_SEA, SMOL) and sections within them
 *
 * @param executable Path to binary file
 * @return BINJECT_OK on success, error code otherwise
 */
template<typename BinaryType>
inline int list_sections(const char* executable) {
    using Traits = BinaryTraits<BinaryType>;

    if (!executable) {
        fprintf(stderr, "Error: Invalid arguments (NULL parameter)\n");
        return BINJECT_ERROR_INVALID_ARGS;
    }

    try {
        auto [parsed, binary] = parse_binary<BinaryType>(executable);

        if (!binary) {
            fprintf(stderr, "Error: Failed to parse %s binary: %s\n",
                    Traits::PLATFORM_NAME, executable);
            return BINJECT_ERROR_INVALID_FORMAT;
        }

        printf("%s binary: %s\n", Traits::PLATFORM_NAME, executable);
        printf("\n");

        bool found_any = false;

        // Platform-specific section detection
        if constexpr (Traits::HAS_SEGMENTS) {
            // Mach-O: Check segments and their sections
            auto* macho = static_cast<LIEF::MachO::Binary*>(binary);

            // Check NODE_SEA segment
            if (macho->has_segment(MACHO_SEGMENT_NODE_SEA)) {
                auto* segment = macho->get_segment(MACHO_SEGMENT_NODE_SEA);
                printf("Segment: %s\n", MACHO_SEGMENT_NODE_SEA);
                for (const auto& section : segment->sections()) {
                    printf("  Section: %s\n", section.name().c_str());
                    printf("    Size: %llu bytes\n", (unsigned long long)section.size());
                }
                found_any = true;
            }

            // Check SMOL segment
            if (macho->has_segment(MACHO_SEGMENT_SMOL)) {
                auto* segment = macho->get_segment(MACHO_SEGMENT_SMOL);
                printf("Segment: %s\n", MACHO_SEGMENT_SMOL);
                for (const auto& section : segment->sections()) {
                    printf("  Section: %s\n", section.name().c_str());
                    printf("    Size: %llu bytes\n", (unsigned long long)section.size());
                }
                found_any = true;
            }
        } else if constexpr (std::is_same_v<BinaryType, LIEF::ELF::Binary>) {
            // ELF: Check PT_NOTE segments (not sections!)
            auto* elf = static_cast<LIEF::ELF::Binary*>(binary);

            // Check for NODE_SEA_BLOB note
            for (const auto& note : elf->notes()) {
                if (note.name() == ELF_NOTE_NODE_SEA_BLOB) {
                    printf("Note: %s (PT_NOTE segment)\n", ELF_NOTE_NODE_SEA_BLOB);
                    printf("  Size: %llu bytes\n", (unsigned long long)note.description().size());
                    found_any = true;
                }
            }

            // Check for SMOL_VFS_BLOB note
            for (const auto& note : elf->notes()) {
                if (note.name() == ELF_NOTE_SMOL_VFS_BLOB) {
                    printf("Note: %s (PT_NOTE segment)\n", ELF_NOTE_SMOL_VFS_BLOB);
                    printf("  Size: %llu bytes\n", (unsigned long long)note.description().size());
                    found_any = true;
                }
            }

            // Check for compressed stub section
            if (Traits::has_section(binary, ELF_SECTION_PRESSED_DATA)) {
                auto* section = binary->get_section(ELF_SECTION_PRESSED_DATA);
                printf("Section: %s (compressed stub)\n", ELF_SECTION_PRESSED_DATA);
                printf("  Size: %llu bytes\n", (unsigned long long)section->size());
                found_any = true;
            }
        } else {
            // PE: Check PE resources (not sections!)
            auto* pe = static_cast<LIEF::PE::Binary*>(binary);

            if (pe->has_resources()) {
                auto* resources = pe->resources();
                if (resources) {
                    // Look for RT_RCDATA resources
                    for (const auto& type_node : resources->childs()) {
                        if (type_node.id() == static_cast<uint32_t>(LIEF::PE::ResourcesManager::TYPE::RCDATA)) {
                            // Check for NODE_SEA_BLOB and SMOL_VFS_BLOB resources
                            // Convert resource names to UTF-16 for comparison (LIEF uses u16string)
                            std::wstring_convert<std::codecvt_utf8_utf16<char16_t>, char16_t> converter;
                            std::u16string u16_sea = converter.from_bytes(PE_RESOURCE_NODE_SEA_BLOB);
                            std::u16string u16_vfs = converter.from_bytes(PE_RESOURCE_SMOL_VFS_BLOB);

                            for (const auto& name_node : type_node.childs()) {
                                if (name_node.has_name()) {
                                    const std::u16string& res_name_u16 = name_node.name();
                                    if (res_name_u16 == u16_sea || res_name_u16 == u16_vfs) {
                                        // Convert to std::string for printf
                                        std::string res_name = converter.to_bytes(res_name_u16);
                                        // Get size from the first language node (ResourceData)
                                        unsigned long long res_size = 0;
                                        if (name_node.childs().size() > 0) {
                                            const auto& lang_node = name_node.childs()[0];
                                            if (lang_node.is_data()) {
                                                auto* data_node = static_cast<const LIEF::PE::ResourceData*>(&lang_node);
                                                res_size = data_node->content().size();
                                            }
                                        }
                                        printf("Resource: %s (RT_RCDATA)\n", res_name.c_str());
                                        printf("  Size: %llu bytes\n", res_size);
                                        found_any = true;
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Check for compressed stub section
            if (Traits::has_section(binary, PE_SECTION_PRESSED_DATA)) {
                auto* section = binary->get_section(PE_SECTION_PRESSED_DATA);
                printf("Section: %s (compressed stub)\n", PE_SECTION_PRESSED_DATA);
                printf("  Size: %llu bytes\n", (unsigned long long)section->size());
                found_any = true;
            }
        }

        if (!found_any) {
            printf("No SEA/VFS/SMOL sections found\n");
        }

        return BINJECT_OK;

    } catch (const std::exception& e) {
        fprintf(stderr, "Error: LIEF exception: %s\n", e.what());
        return BINJECT_ERROR;
    }
}

/**
 * Extract section content to file.
 *
 * Template works for ELF, PE, and Mach-O with platform-specific handling:
 * - ELF/PE: Extracts section directly
 * - Mach-O: Searches NODE_SEA and SMOL segments for section
 *
 * @param executable Path to binary file
 * @param section_name Name of section to extract
 * @param output_file Path to write extracted content
 * @return BINJECT_OK on success, error code otherwise
 */
template<typename BinaryType>
inline int extract_section(const char* executable, const char* section_name,
                          const char* output_file) {
    using Traits = BinaryTraits<BinaryType>;

    if (!executable || !section_name || !output_file) {
        fprintf(stderr, "Error: Invalid arguments (NULL parameter)\n");
        return BINJECT_ERROR_INVALID_ARGS;
    }

    try {
        auto [parsed, binary] = parse_binary<BinaryType>(executable);

        if (!binary) {
            fprintf(stderr, "Error: Failed to parse %s binary: %s\n",
                    Traits::PLATFORM_NAME, executable);
            return BINJECT_ERROR_INVALID_FORMAT;
        }

        // Platform-specific section lookup
        std::vector<uint8_t> content;
        bool found = false;

        if constexpr (Traits::HAS_SEGMENTS) {
            // Mach-O: Search in NODE_SEA and SMOL segments
            auto* macho = static_cast<LIEF::MachO::Binary*>(binary);

            for (const char* segment_name : {MACHO_SEGMENT_NODE_SEA, MACHO_SEGMENT_SMOL}) {
                if (macho->has_segment(segment_name)) {
                    auto* segment = macho->get_segment(segment_name);
                    for (const auto& section : segment->sections()) {
                        if (section.name() == section_name) {
                            auto content_span = section.content();
                            content = std::vector<uint8_t>(content_span.begin(), content_span.end());
                            found = true;
                            break;
                        }
                    }
                    if (found) break;
                }
            }
        } else {
            // ELF/PE: Direct section lookup
            if (Traits::has_section(binary, section_name)) {
                auto* section = binary->get_section(section_name);
                auto content_span = section->content();
                content = std::vector<uint8_t>(content_span.begin(), content_span.end());
                found = true;
            }
        }

        if (!found) {
            fprintf(stderr, "Section '%s' not found\n", section_name);
            return BINJECT_ERROR_SECTION_NOT_FOUND;
        }

        // Create parent directories if needed
        if (create_parent_directories(output_file) != 0) {
            fprintf(stderr, "Error: Failed to create parent directories: %s\n", output_file);
            return BINJECT_ERROR;
        }

        // Write content to file
        FILE* fp = fopen(output_file, "wb");
        if (!fp) {
            fprintf(stderr, "Error: Failed to open output file: %s\n", output_file);
            return BINJECT_ERROR_WRITE_FAILED;
        }

        size_t written = fwrite(content.data(), 1, content.size(), fp);
        int close_result = fclose(fp);

        if (written != content.size()) {
            fprintf(stderr, "Error: Failed to write all bytes to output file (%zu/%zu)\n",
                    written, content.size());
            unlink(output_file);  // Clean up partial file
            return BINJECT_ERROR_WRITE_FAILED;
        }

        if (close_result != 0) {
            fprintf(stderr, "Error: Failed to close output file (disk full?)\n");
            unlink(output_file);  // Clean up potentially corrupted file
            return BINJECT_ERROR_WRITE_FAILED;
        }

        printf("Extracted %zu bytes from section '%s' to %s\n",
               content.size(), section_name, output_file);
        return BINJECT_OK;

    } catch (const std::exception& e) {
        fprintf(stderr, "Error: LIEF exception: %s\n", e.what());
        return BINJECT_ERROR;
    }
}

/**
 * Verify section exists and print info.
 *
 * Template works for ELF, PE, and Mach-O with platform-specific handling:
 * - ELF/PE: Checks section directly
 * - Mach-O: Searches NODE_SEA and SMOL segments
 *
 * @param executable Path to binary file
 * @param section_name Name of section to verify
 * @return BINJECT_OK if section exists, error code otherwise
 */
template<typename BinaryType>
inline int verify_section(const char* executable, const char* section_name) {
    using Traits = BinaryTraits<BinaryType>;

    if (!executable || !section_name) {
        fprintf(stderr, "Error: Invalid arguments (NULL parameter)\n");
        return BINJECT_ERROR_INVALID_ARGS;
    }

    try {
        auto [parsed, binary] = parse_binary<BinaryType>(executable);

        if (!binary) {
            fprintf(stderr, "Error: Failed to parse %s binary: %s\n",
                    Traits::PLATFORM_NAME, executable);
            return BINJECT_ERROR_INVALID_FORMAT;
        }

        // Platform-specific section verification
        bool found = false;
        uint64_t size = 0;

        if constexpr (Traits::HAS_SEGMENTS) {
            // Mach-O: Search in NODE_SEA and SMOL segments
            auto* macho = static_cast<LIEF::MachO::Binary*>(binary);

            for (const char* segment_name : {MACHO_SEGMENT_NODE_SEA, MACHO_SEGMENT_SMOL}) {
                if (macho->has_segment(segment_name)) {
                    auto* segment = macho->get_segment(segment_name);
                    for (const auto& section : segment->sections()) {
                        if (section.name() == section_name) {
                            size = section.size();
                            found = true;
                            break;
                        }
                    }
                    if (found) break;
                }
            }
        } else {
            // ELF/PE: Direct section lookup
            if (Traits::has_section(binary, section_name)) {
                auto* section = binary->get_section(section_name);
                size = section->size();
                found = true;
            }
        }

        if (!found) {
            fprintf(stderr, "Section '%s' not found\n", section_name);
            return BINJECT_ERROR_SECTION_NOT_FOUND;
        }

        printf("Section '%s' found (%llu bytes)\n", section_name, (unsigned long long)size);
        return BINJECT_OK;

    } catch (const std::exception& e) {
        fprintf(stderr, "Error: LIEF exception: %s\n", e.what());
        return BINJECT_ERROR;
    }
}

} // namespace binject

#endif // BINJECT_SECTION_OPS_HPP
