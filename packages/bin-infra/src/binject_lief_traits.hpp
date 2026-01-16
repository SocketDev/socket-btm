/**
 * binject_lief_traits.hpp - Type traits for platform-specific LIEF operations
 *
 * EXPLANATION: Template-Based Abstraction
 * ==========================================
 *
 * This file uses C++ templates to create a "traits" system that encapsulates
 * platform differences at compile-time. Here's how it works:
 *
 * 1. PROBLEM: We have three binary formats (Mach-O, ELF, PE) that need similar
 *    operations but with different LIEF API calls.
 *
 * 2. OLD APPROACH: Copy-paste code, change LIEF::MachO to LIEF::ELF to LIEF::PE
 *    Result: 60-70% duplication, divergence bugs when one platform gets fixed
 *
 * 3. NEW APPROACH: Define "traits" that describe platform differences, then
 *    write generic algorithms that work with any platform.
 *
 * EXAMPLE: How to use this
 * =========================
 *
 * WITHOUT traits (duplicated code):
 * ```cpp
 * // In macho_inject_lief.cpp
 * auto fat = LIEF::MachO::Parser::parse(path);
 * LIEF::MachO::Binary* bin = fat->at(0);
 *
 * // In elf_inject_lief.cpp (DUPLICATED with different types)
 * auto bin = LIEF::ELF::Parser::parse(path);
 *
 * // In pe_inject_lief.cpp (DUPLICATED again)
 * auto bin = LIEF::PE::Parser::parse(path);
 * ```
 *
 * WITH traits (shared code):
 * ```cpp
 * template<typename BinaryType>
 * void generic_parse_function(const char* path) {
 *     using Traits = BinaryTraits<BinaryType>;
 *     auto parsed = Traits::parse(path);  // Calls correct parser!
 *     auto* binary = Traits::get_binary(parsed.get());
 *     // ... rest of logic is identical ...
 * }
 *
 * // Usage:
 * generic_parse_function<LIEF::MachO::Binary>(path);  // Calls MachO parser
 * generic_parse_function<LIEF::ELF::Binary>(path);    // Calls ELF parser
 * generic_parse_function<LIEF::PE::Binary>(path);     // Calls PE parser
 * ```
 *
 * BENEFITS:
 * - Write algorithm ONCE, works for all platforms
 * - Fix bug ONCE, all platforms get the fix
 * - Compiler enforces consistency at build time
 * - Zero runtime overhead (templates resolved at compile time)
 *
 * WHEN TO USE:
 * - Operations that are conceptually identical across platforms
 * - Only API calls differ (parse, get section, etc.)
 *
 * WHEN NOT TO USE:
 * - Fundamentally different operations (Mach-O segments vs ELF sections)
 * - Platform-specific features (code signing on macOS only)
 */

#ifndef BINJECT_LIEF_TRAITS_HPP
#define BINJECT_LIEF_TRAITS_HPP

#include <LIEF/LIEF.hpp>

// Suppress deprecation warning for wstring_convert (deprecated in C++17)
// We use this for PE resource name conversion (UTF-16) and there's no
// standard replacement yet. When C++20/23 alternatives are available, migrate.
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wdeprecated-declarations"
#include <codecvt>
#include <locale>
#pragma GCC diagnostic pop

#include <memory>
#include <string>

namespace binject {

/**
 * Primary template - intentionally undefined.
 * Forces compile error if used with unsupported type.
 */
template<typename BinaryType>
struct BinaryTraits;

/**
 * Mach-O specialization
 * ======================
 *
 * Mach-O binaries are special because they can be "fat" (universal) binaries
 * containing multiple architectures. LIEF returns a FatBinary wrapper that
 * contains one or more Binary objects.
 *
 * Key differences from ELF/PE:
 * - Has segments AND sections (hierarchical)
 * - Requires code signing on macOS
 * - Parser returns FatBinary not Binary directly
 */
template<>
struct BinaryTraits<LIEF::MachO::Binary> {
    using BinaryType = LIEF::MachO::Binary;
    using SectionType = LIEF::MachO::Section;
    using SegmentType = LIEF::MachO::SegmentCommand;
    using FatBinaryType = LIEF::MachO::FatBinary;

    static constexpr const char* PLATFORM_NAME = "Mach-O";
    static constexpr bool HAS_SEGMENTS = true;
    static constexpr bool NEEDS_CODE_SIGNING = true;

    /**
     * Parse Mach-O binary.
     * Returns FatBinary which may contain multiple architectures.
     */
    static std::unique_ptr<FatBinaryType> parse(const char* path) {
        return LIEF::MachO::Parser::parse(path);
    }

    /**
     * Get first binary from fat binary.
     * For non-fat binaries, this returns the only binary.
     */
    static BinaryType* get_binary(FatBinaryType* fat) {
        if (!fat || fat->empty()) {
            return nullptr;
        }
        return fat->at(0);
    }

    /**
     * Check if section exists.
     * Mach-O: Must check if segment exists first, then check sections.
     * Note: This is simplified - real code might need segment name too.
     */
    static bool has_section(BinaryType* binary, const char* section_name) {
        // Simplified: Search all segments for section
        for (const auto& segment : binary->segments()) {
            for (const auto& section : segment.sections()) {
                if (section.name() == section_name) {
                    return true;
                }
            }
        }
        return false;
    }
};

/**
 * ELF specialization
 * ==================
 *
 * ELF binaries have a flat section structure (no segments at this level).
 * No code signing required on Linux.
 *
 * Key differences from Mach-O:
 * - Sections only (no segment hierarchy)
 * - No code signing
 * - Parser returns Binary directly
 */
template<>
struct BinaryTraits<LIEF::ELF::Binary> {
    using BinaryType = LIEF::ELF::Binary;
    using SectionType = LIEF::ELF::Section;

    static constexpr const char* PLATFORM_NAME = "ELF";
    static constexpr bool HAS_SEGMENTS = false;
    static constexpr bool NEEDS_CODE_SIGNING = false;

    /**
     * Parse ELF binary.
     * Returns Binary directly (no fat binary concept).
     */
    static std::unique_ptr<BinaryType> parse(const char* path) {
        return LIEF::ELF::Parser::parse(path);
    }

    /**
     * Get binary (identity function for ELF).
     * ELF has no fat binary concept, so this just returns the input.
     */
    static BinaryType* get_binary(BinaryType* bin) {
        return bin;
    }

    /**
     * Check if section exists.
     * ELF: Direct section lookup, no segments involved.
     */
    static bool has_section(BinaryType* binary, const char* section_name) {
        return binary->has_section(section_name);
    }
};

/**
 * PE specialization
 * =================
 *
 * PE (Windows) binaries have a flat section structure similar to ELF.
 * No code signing in binject (PE signatures handled differently).
 *
 * Key differences from Mach-O:
 * - Sections only (no segment hierarchy)
 * - No code signing in binject
 * - Parser returns Binary directly
 */
template<>
struct BinaryTraits<LIEF::PE::Binary> {
    using BinaryType = LIEF::PE::Binary;
    using SectionType = LIEF::PE::Section;

    static constexpr const char* PLATFORM_NAME = "PE";
    static constexpr bool HAS_SEGMENTS = false;
    static constexpr bool NEEDS_CODE_SIGNING = false;

    /**
     * Parse PE binary.
     * Returns Binary directly (no fat binary concept).
     */
    static std::unique_ptr<BinaryType> parse(const char* path) {
        return LIEF::PE::Parser::parse(path);
    }

    /**
     * Get binary (identity function for PE).
     * PE has no fat binary concept, so this just returns the input.
     */
    static BinaryType* get_binary(BinaryType* bin) {
        return bin;
    }

    /**
     * Check if section exists.
     * PE: Direct section lookup via get_section.
     * Note: PE's has_section may not exist, use get_section != nullptr.
     */
    static bool has_section(BinaryType* binary, const char* section_name) {
        return binary->get_section(section_name) != nullptr;
    }
};

/**
 * Helper function: Parse binary with automatic type deduction
 * ============================================================
 *
 * USAGE EXAMPLE:
 * ```cpp
 * auto [parsed, binary] = binject::parse_binary<LIEF::ELF::Binary>(path);
 * if (!binary) {
 *     // handle error
 * }
 * // use binary...
 * ```
 *
 * Returns: pair of (parsed container, raw binary pointer)
 * The container owns memory, pointer is for convenience.
 */
template<typename BinaryType>
inline auto parse_binary(const char* path)
    -> std::pair<decltype(BinaryTraits<BinaryType>::parse(path)), BinaryType*>
{
    using Traits = BinaryTraits<BinaryType>;
    auto parsed = Traits::parse(path);
    BinaryType* binary = nullptr;

    if (parsed) {
        binary = Traits::get_binary(parsed.get());
    }

    return {std::move(parsed), binary};
}

/**
 * Helper function: Check if NODE_SEA_BLOB resource exists
 * ========================================================
 *
 * CRITICAL: This function handles platform-specific resource storage!
 *
 * Platform implementations:
 * - Mach-O: Checks segment existence (NODE_SEA segment with __NODE_SEA_BLOB section)
 * - ELF: Checks PT_NOTE segments for note owner "NODE_SEA_BLOB"
 * - PE: Checks PE resources (.rsrc) for RT_RCDATA resource "NODE_SEA_BLOB"
 *
 * This divergence is intentional and aligns with postject/Node.js expectations:
 * - Mach-O: Uses custom segments (traditional Mach-O approach)
 * - ELF: Uses PT_NOTE segments (survives stripping, searchable via dl_iterate_phdr)
 * - PE: Uses PE resources (standard Windows resource mechanism via FindResource)
 */
template<typename BinaryType>
inline bool has_node_sea_section(BinaryType* binary) {
    using Traits = BinaryTraits<BinaryType>;

    if constexpr (Traits::HAS_SEGMENTS) {
        // Mach-O: Check segment existence
        // Casting because we know BinaryType is LIEF::MachO::Binary here
        auto* macho = static_cast<LIEF::MachO::Binary*>(binary);
        return macho->has_segment(MACHO_SEGMENT_NODE_SEA);
    } else if constexpr (std::is_same_v<BinaryType, LIEF::ELF::Binary>) {
        // ELF: Check for PT_NOTE segment with NODE_SEA_BLOB owner name
        // Note: This checks sections, but actual injection uses PT_NOTE segments
        // The section name check is a fallback for binaries that may have sections
        auto* elf = static_cast<LIEF::ELF::Binary*>(binary);
        // Check if any note has the NODE_SEA_BLOB name
        for (const auto& note : elf->notes()) {
            if (note.name() == ELF_NOTE_NODE_SEA_BLOB) {
                return true;
            }
        }
        return false;
    } else {
        // PE: Check if resources exist with NODE_SEA_BLOB name
        auto* pe = static_cast<LIEF::PE::Binary*>(binary);
        if (!pe->has_resources()) {
            return false;
        }
        // Check for RT_RCDATA resources with NODE_SEA_BLOB name
        auto* resources = pe->resources();
        if (!resources) {
            return false;
        }
        // Look for RT_RCDATA type node
        for (const auto& node : resources->childs()) {
            if (node.id() == static_cast<uint32_t>(LIEF::PE::ResourcesManager::TYPE::RCDATA)) {
                // Check if PE_RESOURCE_NODE_SEA_BLOB exists in this type
                // Convert resource name to UTF-16 for comparison (LIEF uses u16string)
                std::wstring_convert<std::codecvt_utf8_utf16<char16_t>, char16_t> converter;
                std::u16string u16_name = converter.from_bytes(PE_RESOURCE_NODE_SEA_BLOB);

                for (const auto& child : node.childs()) {
                    // Resource names are stored uppercase
                    if (child.has_name() && child.name() == u16_name) {
                        return true;
                    }
                }
            }
        }
        return false;
    }
}

} // namespace binject

#endif // BINJECT_LIEF_TRAITS_HPP
