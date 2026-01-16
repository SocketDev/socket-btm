/**
 * macho_lief_utils.hpp - Shared Mach-O LIEF utilities
 *
 * Common helper functions for working with LIEF Mach-O binaries.
 * Used by binpress and binject for SMOL segment manipulation.
 */

#ifndef MACHO_LIEF_UTILS_HPP
#define MACHO_LIEF_UTILS_HPP

#include <LIEF/LIEF.hpp>

/**
 * Find the index of a segment by name in a Mach-O binary.
 *
 * @param binary The LIEF Mach-O binary
 * @param segment_name Name of the segment to find (e.g., "SMOL", "NODE_SEA")
 * @param out_index Pointer to store the segment index if found
 * @return true if segment found, false otherwise
 */
inline bool find_segment_index(LIEF::MachO::Binary* binary, const char* segment_name, size_t* out_index) {
    if (!binary || !segment_name || !out_index) {
        return false;
    }

    size_t index = 0;
    for (const LIEF::MachO::LoadCommand& cmd : binary->commands()) {
        if (cmd.command() == LIEF::MachO::LoadCommand::TYPE::SEGMENT_64 ||
            cmd.command() == LIEF::MachO::LoadCommand::TYPE::SEGMENT) {
            const LIEF::MachO::SegmentCommand* seg =
                dynamic_cast<const LIEF::MachO::SegmentCommand*>(&cmd);
            if (seg && seg->name() == segment_name) {
                *out_index = index;
                return true;
            }
        }
        index++;
    }

    return false;
}

/**
 * Remove a segment from a Mach-O binary by name.
 *
 * @param binary The LIEF Mach-O binary
 * @param segment_name Name of the segment to remove (e.g., "SMOL", "NODE_SEA")
 * @return 0 on success, -1 on error
 */
inline int remove_segment_by_name(LIEF::MachO::Binary* binary, const char* segment_name) {
    if (!binary || !segment_name) {
        fprintf(stderr, "Error: Invalid parameters for remove_segment_by_name\n");
        return -1;
    }

    // Check if segment exists
    if (!binary->has_segment(segment_name)) {
        fprintf(stderr, "Error: Segment %s not found\n", segment_name);
        return -1;
    }

    // Find segment index
    size_t segment_index = 0;
    if (!find_segment_index(binary, segment_name, &segment_index)) {
        fprintf(stderr, "Error: Could not find %s segment index\n", segment_name);
        return -1;
    }

    // Remove the segment by index
    if (!binary->remove_command(segment_index)) {
        fprintf(stderr, "Error: Failed to remove %s segment\n", segment_name);
        return -1;
    }

    return 0;
}

#endif // MACHO_LIEF_UTILS_HPP
