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
 *
 * CRITICAL: Node.js -fno-exceptions Requirement
 * =============================================
 * Node.js is compiled with -fno-exceptions (C++ exceptions disabled).
 * This file MUST NOT use try/catch blocks or throw statements.
 * Use error code returns (BINJECT_OK, BINJECT_ERROR) and null checks instead.
 * LIEF operations return nullptr or empty containers on failure, not exceptions.
 */

#ifndef BINJECT_SECTION_OPS_HPP
#define BINJECT_SECTION_OPS_HPP

#include <LIEF/LIEF.hpp>

#include <cstdio>
#include <cstring>
#include <vector>
#include "socketsecurity/bin-infra/binject_lief_traits.hpp"

// Note: Error codes come from binject.h which is included by the calling .cpp file
// We don't include it here to avoid header dependency issues.

// Forward declare C file I/O functions
extern "C" {
int create_parent_directories(const char* path);
int write_file_atomically(const char *path, const unsigned char *data, size_t size, int mode);
}

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
            // ELF: Check PT_NOTE segments by parsing raw content from file
            // LIEF's notes() only returns notes with corresponding sections,
            // and seg.content() may not reflect modified PT_NOTE segments
            auto* elf = static_cast<LIEF::ELF::Binary*>(binary);

            // Open file to read PT_NOTE segments directly
            FILE* fp = fopen(executable, "rb");
            if (!fp) {
                fprintf(stderr, "Error: Failed to open file for reading: %s\n", executable);
                return BINJECT_ERROR;
            }

            // Parse notes directly from PT_NOTE segments using file I/O
            for (const auto& seg : elf->segments()) {
                if (seg.type() != LIEF::ELF::Segment::TYPE::NOTE) continue;

                uint64_t file_offset = seg.file_offset();
                uint64_t file_size = seg.physical_size();

                if (file_size == 0 || file_size > 100 * 1024 * 1024) continue;

                // Read segment content directly from file
                std::vector<uint8_t> content(file_size);
                if (fseek(fp, static_cast<long>(file_offset), SEEK_SET) != 0) continue;
                if (fread(content.data(), 1, file_size, fp) != file_size) continue;

                // Parse notes from segment content
                size_t pos = 0;
                while (pos + 12 <= content.size()) {  // Minimum note header size
                    // Use memcpy for safe unaligned access
                    uint32_t namesz, descsz;
                    memcpy(&namesz, &content[pos], sizeof(namesz));
                    memcpy(&descsz, &content[pos + 4], sizeof(descsz));
                    // uint32_t type; memcpy(&type, &content[pos + 8], sizeof(type));

                    // Sanity check
                    if (namesz > 1024 || descsz > 100 * 1024 * 1024) break;

                    size_t name_padded = (namesz + 3) & ~3;  // Align to 4 bytes
                    size_t desc_padded = (descsz + 3) & ~3;  // Align to 4 bytes

                    if (pos + 12 + name_padded + desc_padded > content.size()) break;

                    // Get note name
                    std::string note_name(reinterpret_cast<const char*>(&content[pos + 12]),
                                         namesz > 0 ? namesz - 1 : 0);  // -1 for null terminator

                    // Check for our notes
                    if (note_name == ELF_NOTE_NODE_SEA_BLOB) {
                        printf("Note: %s (PT_NOTE segment)\n", ELF_NOTE_NODE_SEA_BLOB);
                        printf("  Size: %u bytes\n", descsz);
                        found_any = true;
                    } else if (note_name == ELF_NOTE_SMOL_VFS_BLOB) {
                        printf("Note: %s (PT_NOTE segment)\n", ELF_NOTE_SMOL_VFS_BLOB);
                        printf("  Size: %u bytes\n", descsz);
                        found_any = true;
                    }

                    pos += 12 + name_padded + desc_padded;
                }
            }

            fclose(fp);

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
                            std::u16string u16_sea = to_u16string(PE_RESOURCE_NODE_SEA_BLOB);
                            std::u16string u16_vfs = to_u16string(PE_RESOURCE_SMOL_VFS_BLOB);

                            for (const auto& name_node : type_node.childs()) {
                                if (name_node.has_name()) {
                                    const std::u16string& res_name_u16 = name_node.name();
                                    if (res_name_u16 == u16_sea || res_name_u16 == u16_vfs) {
                                        // Convert to std::string for printf
                                        std::string res_name = from_u16string(res_name_u16);
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
        } else if constexpr (std::is_same_v<BinaryType, LIEF::ELF::Binary>) {
            // ELF: Check PT_NOTE segments for notes (NODE_SEA_BLOB, SMOL_VFS_BLOB)
            // and regular sections for other content (pressed_data)
            auto* elf = static_cast<LIEF::ELF::Binary*>(binary);

            // First check if it's a note (stored in PT_NOTE segment)
            if (strcmp(section_name, ELF_NOTE_NODE_SEA_BLOB) == 0 ||
                strcmp(section_name, ELF_NOTE_SMOL_VFS_BLOB) == 0) {

                // Open file to read PT_NOTE segments directly
                FILE* fp = fopen(executable, "rb");
                if (!fp) {
                    fprintf(stderr, "Error: Failed to open file for reading: %s\n", executable);
                    return BINJECT_ERROR;
                }

                // Parse notes directly from PT_NOTE segments
                for (const auto& seg : elf->segments()) {
                    if (seg.type() != LIEF::ELF::Segment::TYPE::NOTE) continue;
                    if (found) break;

                    uint64_t file_offset = seg.file_offset();
                    uint64_t file_size = seg.physical_size();

                    if (file_size == 0 || file_size > 100 * 1024 * 1024) continue;

                    // Read segment content directly from file
                    std::vector<uint8_t> seg_content(file_size);
                    if (fseek(fp, static_cast<long>(file_offset), SEEK_SET) != 0) continue;
                    if (fread(seg_content.data(), 1, file_size, fp) != file_size) continue;

                    // Parse notes from segment content
                    size_t pos = 0;
                    while (pos + 12 <= seg_content.size()) {
                        // Use memcpy for safe unaligned access
                        uint32_t namesz, descsz;
                        memcpy(&namesz, &seg_content[pos], sizeof(namesz));
                        memcpy(&descsz, &seg_content[pos + 4], sizeof(descsz));

                        if (namesz > 1024 || descsz > 100 * 1024 * 1024) break;

                        size_t name_padded = (namesz + 3) & ~3;
                        size_t desc_padded = (descsz + 3) & ~3;

                        if (pos + 12 + name_padded + desc_padded > seg_content.size()) break;

                        std::string note_name(reinterpret_cast<const char*>(&seg_content[pos + 12]),
                                             namesz > 0 ? namesz - 1 : 0);

                        if (note_name == section_name) {
                            // Extract the note description (payload)
                            const uint8_t* desc_start = &seg_content[pos + 12 + name_padded];
                            content.assign(desc_start, desc_start + descsz);
                            found = true;
                            break;
                        }

                        pos += 12 + name_padded + desc_padded;
                    }
                }

                fclose(fp);
            } else {
                // Regular ELF section lookup (e.g., pressed_data)
                if (Traits::has_section(binary, section_name)) {
                    auto* section = binary->get_section(section_name);
                    auto content_span = section->content();
                    content = std::vector<uint8_t>(content_span.begin(), content_span.end());
                    found = true;
                }
            }
        } else {
            // PE: Direct section lookup
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

        // Write content to file using cross-platform helper with detailed error logging
        if (write_file_atomically(output_file, content.data(), content.size(), 0755) == -1) {
            return BINJECT_ERROR_WRITE_FAILED;
        }

        printf("Extracted %zu bytes from section '%s' to %s\n",
               content.size(), section_name, output_file);
        return BINJECT_OK;

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
        } else if constexpr (std::is_same_v<BinaryType, LIEF::ELF::Binary>) {
            // ELF: Check PT_NOTE segments for notes and regular sections for other content
            auto* elf = static_cast<LIEF::ELF::Binary*>(binary);

            // First check if it's a note (stored in PT_NOTE segment)
            if (strcmp(section_name, ELF_NOTE_NODE_SEA_BLOB) == 0 ||
                strcmp(section_name, ELF_NOTE_SMOL_VFS_BLOB) == 0) {

                // Open file to read PT_NOTE segments directly
                FILE* fp = fopen(executable, "rb");
                if (!fp) {
                    fprintf(stderr, "Error: Failed to open file for reading: %s\n", executable);
                    return BINJECT_ERROR;
                }

                // Parse notes directly from PT_NOTE segments
                for (const auto& seg : elf->segments()) {
                    if (seg.type() != LIEF::ELF::Segment::TYPE::NOTE) continue;
                    if (found) break;

                    uint64_t file_offset = seg.file_offset();
                    uint64_t file_size = seg.physical_size();

                    if (file_size == 0 || file_size > 100 * 1024 * 1024) continue;

                    // Read segment content directly from file
                    std::vector<uint8_t> seg_content(file_size);
                    if (fseek(fp, static_cast<long>(file_offset), SEEK_SET) != 0) continue;
                    if (fread(seg_content.data(), 1, file_size, fp) != file_size) continue;

                    // Parse notes from segment content
                    size_t pos = 0;
                    while (pos + 12 <= seg_content.size()) {
                        // Use memcpy for safe unaligned access
                        uint32_t namesz, descsz;
                        memcpy(&namesz, &seg_content[pos], sizeof(namesz));
                        memcpy(&descsz, &seg_content[pos + 4], sizeof(descsz));

                        if (namesz > 1024 || descsz > 100 * 1024 * 1024) break;

                        size_t name_padded = (namesz + 3) & ~3;
                        size_t desc_padded = (descsz + 3) & ~3;

                        if (pos + 12 + name_padded + desc_padded > seg_content.size()) break;

                        std::string note_name(reinterpret_cast<const char*>(&seg_content[pos + 12]),
                                             namesz > 0 ? namesz - 1 : 0);

                        if (note_name == section_name) {
                            size = descsz;
                            found = true;
                            break;
                        }

                        pos += 12 + name_padded + desc_padded;
                    }
                }

                fclose(fp);
            } else {
                // Regular ELF section lookup (e.g., pressed_data)
                if (Traits::has_section(binary, section_name)) {
                    auto* section = binary->get_section(section_name);
                    size = section->size();
                    found = true;
                }
            }
        } else {
            // PE: Direct section lookup
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

}

} // namespace binject

#endif // BINJECT_SECTION_OPS_HPP
