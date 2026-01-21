/**
 * binject_sea_fuse.hpp - NODE_SEA_FUSE flipping utilities
 *
 * Provides shared implementation of NODE_SEA_FUSE flipping to prevent
 * duplication and divergence across Mach-O, ELF, and PE implementations.
 *
 * BACKGROUND: What is NODE_SEA_FUSE?
 * ===================================
 *
 * NODE_SEA_FUSE is a magic string embedded in Node.js binaries that controls
 * Single Executable Application (SEA) behavior:
 *
 * - Unflipped: "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2:0"
 * - Flipped:   "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2:1"
 *                                                                ^
 *                                                          (0 -> 1)
 *
 * When Node.js starts:
 * 1. Searches for this string in the binary
 * 2. If found and ends in ":1", enters SEA mode
 * 3. Looks for NODE_SEA_BLOB section containing JavaScript code
 * 4. Executes the embedded code instead of reading from filesystem
 *
 * WHEN TO FLIP:
 * - First injection: Flip the fuse (unflipped binary -> flipped binary)
 * - Re-injection: Don't flip (already flipped, sections already exist)
 *
 * CRITICAL: This pattern must match across ALL platforms (Mach-O/ELF/PE).
 * If you change this, update all three platforms and test thoroughly!
 */

#ifndef BINJECT_SEA_FUSE_HPP
#define BINJECT_SEA_FUSE_HPP

#include <LIEF/LIEF.hpp>
#include <cstring>
#include <vector>
#include "binject_lief_traits.hpp"

namespace binject {

/**
 * Flip NODE_SEA_FUSE from :0 to :1 in any binary format.
 *
 * ALGORITHM:
 * 1. Iterate through all sections in the binary
 * 2. Search each section's content for the unflipped fuse string
 * 3. If found, change the last character from '0' to '1'
 * 4. Update the section content
 * 5. Stop after first match (there should only be one)
 *
 * CRITICAL: This function must behave identically across all platforms.
 * Any changes must be tested on Mach-O, ELF, and PE binaries.
 *
 * @param binary LIEF binary object (any platform)
 * @return true if fuse was found and flipped, false if not found
 */
template<typename BinaryType>
inline bool flip_sea_fuse(BinaryType* binary) {
    const char* fuse_unflipped = NODE_SEA_FUSE_UNFLIPPED;
    const size_t fuse_length = strlen(fuse_unflipped);
    bool found_unflipped = false;

    printf("Flipping NODE_SEA_FUSE...\n");

    // Iterate through all sections
    for (auto& section : binary->sections()) {
        // Get section content (LIEF returns span, convert to vector for modification)
        auto content_span = section.content();
        std::vector<uint8_t> content(content_span.begin(), content_span.end());

        // Search for unflipped fuse string
        for (size_t i = 0; i + fuse_length <= content.size(); i++) {
            if (memcmp(content.data() + i, fuse_unflipped, fuse_length) == 0) {
                // Found it! Flip the fuse by changing last character '0' -> '1'
                content[i + fuse_length - 1] = '1';

                // Update section with modified content
                section.content(std::move(content));

                found_unflipped = true;
                printf("✓ Flipped NODE_SEA_FUSE from :0 to :1\n");

                // Stop after first match (there should only be one)
                return true;
            }
        }
    }

    // Not finding the fuse is not an error - some binaries don't have it
    if (!found_unflipped) {
        printf("⚠ NODE_SEA_FUSE not found (may not be present in this binary)\n");
    }

    return found_unflipped;
}

/**
 * Determine if fuse should be flipped based on SEA section existence.
 *
 * LOGIC:
 * - If SEA data is provided AND section doesn't exist yet -> flip fuse
 * - If section already exists -> skip flip (already done on first injection)
 * - If no SEA data provided -> skip flip (not injecting SEA)
 *
 * CRITICAL DIVERGENCE PREVENTION:
 * This function uses binject_lief_traits.hpp to handle platform differences:
 * - Mach-O: Checks segment existence (NODE_SEA segment)
 * - ELF/PE: Checks section existence (__NODE_SEA_BLOB section)
 *
 * This divergence is intentional and correct for each platform's architecture.
 *
 * @param binary LIEF binary object
 * @param sea_data SEA blob data (nullptr if not injecting SEA)
 * @param sea_size Size of SEA blob
 * @return true if fuse flipping should proceed, false otherwise
 */
template<typename BinaryType>
inline bool should_flip_fuse(BinaryType* binary, const uint8_t* sea_data, size_t sea_size) {
    // No SEA data -> no need to flip
    if (!sea_data || sea_size == 0) {
        return false;
    }

    // Check if SEA section already exists (using platform-aware helper)
    bool section_exists = has_node_sea_section(binary);

    if (section_exists) {
        printf("NODE_SEA section already exists, skipping fuse flip (already flipped)\n");
        return false;
    }

    // SEA data provided and section doesn't exist -> flip the fuse
    return true;
}

/**
 * Complete fuse flip workflow with existence checking.
 *
 * USAGE PATTERN:
 * ```cpp
 * if (flip_fuse_if_needed(binary, sea_data, sea_size)) {
 *     // Fuse was flipped, proceed with injection
 * }
 * ```
 *
 * This is the recommended entry point for fuse flipping operations.
 *
 * @param binary LIEF binary object
 * @param sea_data SEA blob data (nullptr if not injecting SEA)
 * @param sea_size Size of SEA blob
 * @return true if fuse was flipped, false if skipped or not found
 */
template<typename BinaryType>
inline bool flip_fuse_if_needed(BinaryType* binary, const uint8_t* sea_data, size_t sea_size) {
    if (!should_flip_fuse(binary, sea_data, sea_size)) {
        return false;
    }

    return flip_sea_fuse(binary);
}

} // namespace binject

#endif // BINJECT_SEA_FUSE_HPP
