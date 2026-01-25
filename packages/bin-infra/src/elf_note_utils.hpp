/**
 * ELF PT_NOTE utilities for DRY code
 *
 * Shared helpers for creating, removing, and replacing PT_NOTE segments
 * across binpress, binject, and bin-infra.
 *
 * ============================================================================
 * TWO APPROACHES FOR ELF NOTE INJECTION
 * ============================================================================
 *
 * This header provides two distinct approaches for injecting PT_NOTE segments:
 *
 * 1. RAW APPROACH (SMOL STUBS) - smol_reuse_multi_ptnote()
 *    - For STATICALLY LINKED glibc binaries (SMOL stubs)
 *    - Preserves PHT at original offset (CRITICAL for static glibc)
 *    - SMOL compressed data storage:
 *        Mach-O: SMOL/__PRESSED_DATA        (segment/section)
 *        ELF:    PT_NOTE with owner "pressed_data" (LIEF creates .note.pressed_data section)
 *        PE:     .pressed_data              (section only - no segments in PE)
 *    - Appends notes to end of file, modifies existing PT_NOTE in-place
 *    - Extends last PT_LOAD to cover appended note data
 *    - glibc reads PHT from base+phoff; moving PHT causes SIGSEGV
 *
 * 2. LIEF APPROACH (POSTJECT-COMPATIBLE) - write_with_notes()
 *    - For DYNAMICALLY LINKED binaries (Node.js SEA, etc.)
 *    - Matches postject's behavior: creates NEW PT_LOAD + PT_NOTE segments
 *    - LIEF creates both segments at same offset/vaddr (page-aligned)
 *    - Required for dl_iterate_phdr() / postject_find_resource()
 *    - PHT may be relocated (acceptable for dynamic binaries)
 *
 * ============================================================================
 * WHEN TO USE EACH APPROACH
 * ============================================================================
 *
 * USE RAW APPROACH FOR:
 * - SMOL stubs (statically linked with glibc)
 * - Binaries where PHT MUST stay at original offset
 * - binpress single-file executables
 *
 * USE LIEF APPROACH FOR:
 * - Node.js SEA injection
 * - Dynamically linked binaries
 * - Postject compatibility requirements
 * - binject SEA/VFS injection
 *
 * ============================================================================
 */

#ifndef ELF_NOTE_UTILS_HPP
#define ELF_NOTE_UTILS_HPP

#include <LIEF/LIEF.hpp>
#include <set>
#include <string>
#include <vector>
#include <cstdio>
#include <cstring>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>

// Fuse string constants (must match segment_names.h)
#ifndef NODE_SEA_FUSE_UNFLIPPED
#define NODE_SEA_FUSE_UNFLIPPED "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2:0"
#endif

namespace elf_note_utils {

/**
 * Align a value up to the specified alignment.
 */
inline uint64_t align_up(uint64_t value, uint64_t alignment) {
    return (value + alignment - 1) & ~(alignment - 1);
}

// Forward declaration for write_with_notes_raw
inline void write_with_notes(LIEF::ELF::Binary* binary, const std::string& output_path);

/**
 * Flip NODE_SEA_FUSE from :0 to :1 in raw binary data.
 *
 * This searches the binary data for the unflipped fuse string and changes
 * the last character from '0' to '1'. Works on raw binary data without
 * requiring LIEF parsing.
 *
 * @param data Pointer to binary data
 * @param size Size of binary data
 * @return 0 on success (fuse found and flipped), -1 if not found (not an error)
 */
inline int flip_sea_fuse_raw(uint8_t* data, size_t size) {
    const char* fuse_unflipped = NODE_SEA_FUSE_UNFLIPPED;
    const size_t fuse_length = strlen(fuse_unflipped);

    printf("Flipping NODE_SEA_FUSE...\n");

    // Search for unflipped fuse string in entire binary
    for (size_t i = 0; i + fuse_length <= size; i++) {
        if (memcmp(data + i, fuse_unflipped, fuse_length) == 0) {
            // Found it! Flip the fuse by changing last character '0' -> '1'
            data[i + fuse_length - 1] = '1';
            printf("✓ Flipped NODE_SEA_FUSE from :0 to :1\n");
            return 0;
        }
    }

    // Not finding the fuse is not an error - some binaries don't have it
    printf("⚠ NODE_SEA_FUSE not found (may not be present in this binary)\n");
    return 0;  // Return success - missing fuse is OK
}

/**
 * Structure representing a note to be added to an ELF binary.
 */
struct NoteEntry {
    const char* name;
    std::vector<uint8_t> data;

    NoteEntry(const char* n, const std::vector<uint8_t>& d) : name(n), data(d) {}
    NoteEntry(const char* n, const uint8_t* d, size_t sz) : name(n), data(d, d + sz) {}
};

/**
 * Callback for in-memory binary modifications (e.g., fuse flipping).
 * Called after reading the binary into memory, before writing.
 *
 * @param data Pointer to binary data in memory
 * @param size Size of binary data
 * @return 0 on success, -1 on error
 */
using BinaryModifyCallback = int (*)(uint8_t* data, size_t size);

/**
 * Write ELF binary with multiple raw notes appended (no PHT relocation).
 *
 * ============================================================================
 * RAW APPROACH - FOR SMOL STUBS (STATICALLY LINKED GLIBC BINARIES)
 * ============================================================================
 *
 * This is the SMOL stub approach that preserves binary structure.
 * DO NOT use this for Node.js SEA injection - use write_with_notes() instead.
 *
 * WHEN TO USE THIS:
 * - SMOL stub initial compression (binpress)
 * - SMOL stub repack (updating .note.pressed_data with new content)
 * - Any SMOL note operation that reuses an existing PT_NOTE entry
 *
 * WHY THIS APPROACH EXISTS:
 * For static glibc binaries (SMOL stubs), PHT MUST stay at the original offset.
 * glibc reads PHT from base+phoff in memory; moving PHT causes SIGSEGV.
 * LIEF's write() restructures binaries, relocating PHT - fatal for static glibc.
 *
 * ============================================================================
 * HOW THIS DIFFERS FROM POSTJECT/LIEF APPROACH
 * ============================================================================
 *
 * POSTJECT/LIEF (write_with_notes):
 * - Creates NEW PT_LOAD + NEW PT_NOTE segments
 * - Page-aligned at same offset/vaddr (e.g., offset=0x7240000, vaddr=0xf240000)
 * - PHT may be relocated (OK for dynamic binaries)
 * - Uses LIEF's builder for segment creation
 *
 * SMOL REPACK (this function):
 * - REUSES existing PT_NOTE entry (modifies in-place)
 * - Only for SMOL notes (pressed_data, etc.)
 * - EXTENDS last PT_LOAD to cover appended note data
 * - PHT stays at ORIGINAL location (CRITICAL for static glibc)
 * - Manual binary manipulation, no LIEF write()
 *
 * ============================================================================
 * APPROACH DETAILS
 * ============================================================================
 *
 * 1. Copies the input binary exactly as-is
 * 2. Optionally applies in-memory modifications (e.g., fuse flipping)
 * 3. Appends all notes in proper ELF note format (combined into one PT_NOTE)
 * 4. REUSES an existing PT_NOTE entry - modifies it in-place to point to appended data
 * 5. EXTENDS last PT_LOAD to cover appended data (for dl_iterate_phdr)
 * 6. PHT stays at original location
 *
 * This preserves all LOAD segments, entry point, and PHT location.
 * Used by binpress (single note) and SMOL repack (multiple notes).
 *
 * @param input_path Path to the input binary
 * @param output_path Path to write the output binary
 * @param notes Vector of SMOL notes to append
 * @param modify_callback Optional callback for in-memory modifications (can be nullptr)
 * @return 0 on success, -1 on error
 */
inline int smol_reuse_multi_ptnote(
    const std::string& input_path,
    const std::string& output_path,
    const std::vector<NoteEntry>& notes,
    BinaryModifyCallback modify_callback = nullptr
) {
    if (notes.empty()) {
        fprintf(stderr, "Error: No notes to write\n");
        return -1;
    }

    // Read the entire input file
    FILE* input_file = fopen(input_path.c_str(), "rb");
    if (!input_file) {
        fprintf(stderr, "Error: Cannot open input file: %s\n", input_path.c_str());
        return -1;
    }

    fseek(input_file, 0, SEEK_END);
    size_t input_size = ftell(input_file);
    fseek(input_file, 0, SEEK_SET);

    std::vector<uint8_t> binary_data(input_size);
    if (fread(binary_data.data(), 1, input_size, input_file) != input_size) {
        fprintf(stderr, "Error: Failed to read input file\n");
        fclose(input_file);
        return -1;
    }
    fclose(input_file);

    // Validate ELF header
    if (input_size < 64 || binary_data[0] != 0x7f || binary_data[1] != 'E' ||
        binary_data[2] != 'L' || binary_data[3] != 'F') {
        fprintf(stderr, "Error: Invalid ELF file\n");
        return -1;
    }

    bool is_64bit = (binary_data[4] == 2);
    if (!is_64bit) {
        fprintf(stderr, "Error: Only 64-bit ELF supported\n");
        return -1;
    }

    // By design: only little-endian (x86-64, ARM64) is supported.
    // Big-endian (PowerPC, s390x) would require byte-swapping all header fields
    // (phoff, phentsize, phnum, PT_NOTE offsets/sizes). All target platforms are
    // little-endian, so big-endian support is intentionally omitted.
    bool is_little_endian = (binary_data[5] == 1);
    if (!is_little_endian) {
        fprintf(stderr, "Error: Only little-endian ELF supported\n");
        return -1;
    }

    // Apply in-memory modifications if callback provided (e.g., fuse flipping)
    if (modify_callback) {
        int result = modify_callback(binary_data.data(), binary_data.size());
        if (result != 0) {
            fprintf(stderr, "Error: In-memory modification failed\n");
            return -1;
        }
    }

    // Read ELF header fields (64-bit little-endian)
    uint64_t phoff = *reinterpret_cast<uint64_t*>(&binary_data[32]);
    uint16_t phentsize = *reinterpret_cast<uint16_t*>(&binary_data[54]);
    uint16_t phnum = *reinterpret_cast<uint16_t*>(&binary_data[56]);

    // Validate PHT entry count (executable/library should have program headers)
    if (phnum == 0) {
        fprintf(stderr, "Error: Binary has no program headers (not an executable/library)\n");
        return -1;
    }

    printf("  PHT: offset=%lu, entries=%u, entry_size=%u (keeping at original location)\n",
           (unsigned long)phoff, phnum, phentsize);

    // Find the last PT_LOAD segment that we can extend to cover our note data.
    // For SEA binaries, dl_iterate_phdr() needs the note data actually mapped
    // into memory via a PT_LOAD segment. We extend the last PT_LOAD to cover
    // the appended note data, then set PT_NOTE vaddr to point within it.
    int last_load_idx = -1;
    uint64_t last_load_vaddr = 0;
    uint64_t last_load_offset = 0;
    uint64_t last_load_filesz = 0;
    uint64_t last_load_memsz = 0;
    uint64_t max_load_end = 0;

    for (uint16_t i = 0; i < phnum; i++) {
        uint8_t* phdr = &binary_data[phoff + i * phentsize];
        uint32_t p_type = *reinterpret_cast<uint32_t*>(phdr);
        if (p_type == 1) {  // PT_LOAD
            uint64_t p_offset = *reinterpret_cast<uint64_t*>(phdr + 8);
            uint64_t p_vaddr = *reinterpret_cast<uint64_t*>(phdr + 16);
            uint64_t p_filesz = *reinterpret_cast<uint64_t*>(phdr + 32);
            uint64_t p_memsz = *reinterpret_cast<uint64_t*>(phdr + 40);
            uint64_t seg_end = p_vaddr + p_memsz;
            if (seg_end > max_load_end) {
                max_load_end = seg_end;
            }
            // Track the last PT_LOAD segment (highest file offset)
            if (p_offset + p_filesz >= last_load_offset + last_load_filesz) {
                last_load_idx = i;
                last_load_vaddr = p_vaddr;
                last_load_offset = p_offset;
                last_load_filesz = p_filesz;
                last_load_memsz = p_memsz;
            }
        }
    }

    // Calculate note vaddr - place it at the end of the extended last PT_LOAD segment
    // Note: We'll calculate the actual vaddr after we know the padding needed
    uint64_t note_vaddr = 0;
    printf("  Max LOAD end: 0x%lx, last PT_LOAD[%d]: offset=0x%lx, vaddr=0x%lx, filesz=0x%lx\n",
           (unsigned long)max_load_end, last_load_idx,
           (unsigned long)last_load_offset, (unsigned long)last_load_vaddr,
           (unsigned long)last_load_filesz);

    // Build combined ELF note structure for all notes
    // Multiple notes are concatenated in a single PT_NOTE segment
    // Format per note: namesz (4) + descsz (4) + type (4) + name (aligned) + data (aligned)
    std::vector<uint8_t> combined_notes;

    for (const auto& note : notes) {
        size_t name_len = strlen(note.name) + 1;  // Include null terminator
        size_t name_aligned = align_up(name_len, 4);
        size_t data_aligned = align_up(note.data.size(), 4);
        size_t note_size = 12 + name_aligned + data_aligned;  // 12 = 3 * uint32_t

        size_t offset = combined_notes.size();
        combined_notes.resize(offset + note_size, 0);

        uint32_t namesz = name_len;
        uint32_t descsz = note.data.size();
        uint32_t type = 0;  // Custom note type

        memcpy(&combined_notes[offset + 0], &namesz, 4);
        memcpy(&combined_notes[offset + 4], &descsz, 4);
        memcpy(&combined_notes[offset + 8], &type, 4);
        memcpy(&combined_notes[offset + 12], note.name, name_len);
        if (!note.data.empty()) {
            memcpy(&combined_notes[offset + 12 + name_aligned], note.data.data(), note.data.size());
        }

        printf("  Note '%s': %zu bytes data, %zu bytes total\n",
               note.name, note.data.size(), note_size);
    }

    // Find a PT_NOTE entry (we'll use the LAST PT_NOTE found)
    // SAFETY: Reusing an existing PT_NOTE entry is safe because:
    // 1. We set p_vaddr to a high address past LOAD segments (visible to dl_iterate_phdr)
    // 2. We preserve original note content via deduplication (below)
    // 3. Kernel supports multiple notes within a single PT_NOTE segment
    // 4. Stub binaries typically have .note.gnu.build-id as the last PT_NOTE
    // 5. Node.js SEA needs proper p_vaddr for postject_find_resource() to work
    int last_note_idx = -1;
    for (uint16_t i = 0; i < phnum; i++) {
        uint8_t* phdr = &binary_data[phoff + i * phentsize];
        uint32_t p_type = *reinterpret_cast<uint32_t*>(phdr);
        if (p_type == 4) {  // PT_NOTE
            last_note_idx = i;
        }
    }

    if (last_note_idx < 0) {
        fprintf(stderr, "Error: No PT_NOTE entry found in binary\n");
        return -1;
    }

    printf("  Using PT_NOTE entry at index %d\n", last_note_idx);

    // Get the existing PT_NOTE segment info
    uint8_t* target_phdr = &binary_data[phoff + last_note_idx * phentsize];
    uint64_t orig_offset = *reinterpret_cast<uint64_t*>(target_phdr + 8);
    uint64_t orig_vaddr = *reinterpret_cast<uint64_t*>(target_phdr + 16);
    uint64_t orig_filesz = *reinterpret_cast<uint64_t*>(target_phdr + 32);
    printf("  Original PT_NOTE[%d]: offset=0x%lx, vaddr=0x%lx, filesz=0x%lx\n",
           last_note_idx, (unsigned long)orig_offset, (unsigned long)orig_vaddr,
           (unsigned long)orig_filesz);

    // Build a set of note names we're adding (for deduplication)
    std::set<std::string> new_note_names;
    for (const auto& note : notes) {
        new_note_names.insert(note.name);
    }

    // Read existing notes from the PT_NOTE segment and preserve any that
    // don't conflict with our new notes
    std::vector<uint8_t> preserved_notes;
    if (orig_filesz > 0 && orig_offset + orig_filesz <= input_size) {
        const uint8_t* existing_data = binary_data.data() + orig_offset;
        size_t pos = 0;

        printf("  Scanning existing notes for preservation...\n");
        while (pos + 12 <= orig_filesz) {
            uint32_t namesz = *reinterpret_cast<const uint32_t*>(existing_data + pos);
            uint32_t descsz = *reinterpret_cast<const uint32_t*>(existing_data + pos + 4);
            // uint32_t type = *reinterpret_cast<const uint32_t*>(existing_data + pos + 8);

            size_t name_aligned = align_up(namesz, 4);
            size_t desc_aligned = align_up(descsz, 4);
            size_t note_total = 12 + name_aligned + desc_aligned;

            if (pos + note_total > orig_filesz) break;

            // Get note name (may not be null-terminated in struct, but namesz includes null)
            std::string existing_name;
            if (namesz > 0) {
                existing_name.assign(reinterpret_cast<const char*>(existing_data + pos + 12),
                                     namesz > 0 ? namesz - 1 : 0);  // Exclude null terminator
            }

            // Check if this note conflicts with one we're adding
            if (new_note_names.find(existing_name) == new_note_names.end()) {
                // Preserve this note - it doesn't conflict
                printf("    Preserving existing note '%s' (%u bytes)\n",
                       existing_name.c_str(), descsz);
                // Use insert with iterators for better readability and idiomatic C++
                preserved_notes.insert(preserved_notes.end(),
                                      existing_data + pos,
                                      existing_data + pos + note_total);
            } else {
                printf("    Replacing existing note '%s'\n", existing_name.c_str());
            }

            pos += note_total;
        }
    }

    // Combine preserved notes with our new notes
    std::vector<uint8_t> all_notes;
    if (!preserved_notes.empty()) {
        all_notes = std::move(preserved_notes);
    }
    // Append our new notes
    size_t prev_size = all_notes.size();
    all_notes.resize(prev_size + combined_notes.size());
    memcpy(all_notes.data() + prev_size, combined_notes.data(), combined_notes.size());

    // Notes will be appended at end of binary
    size_t notes_total_size = all_notes.size();

    printf("  Combined notes: offset=%lu, size=%zu (preserved + new)\n",
           (unsigned long)input_size, notes_total_size);

    // Check if this is a SMOL compression operation (pressed_data note).
    // SMOL stubs should NEVER extend PT_LOAD - they need unmapped vaddr.
    // Even if the stub has PT_DYNAMIC (e.g., PIE musl stubs), extending PT_LOAD
    // causes the loader to try mapping 26MB at a low address, causing SIGSEGV.
    bool is_smol_compression = false;
    for (const auto& note : notes) {
        if (strcmp(note.name, "pressed_data") == 0) {
            is_smol_compression = true;
            break;
        }
    }

    // Check if binary is dynamically linked (needs PT_LOAD for SEA/dl_iterate_phdr).
    // IMPORTANT: Only check for PT_INTERP, not PT_DYNAMIC!
    // - Static-PIE binaries have PT_DYNAMIC (for TLS/relocations) but NO PT_INTERP
    // - Dynamically linked binaries have BOTH PT_DYNAMIC AND PT_INTERP
    // - Only binaries with PT_INTERP use dl_iterate_phdr() at runtime
    // Also: For SMOL compression, always treat as static regardless
    bool is_dynamic = false;
    if (!is_smol_compression) {
        for (uint16_t i = 0; i < phnum; i++) {
            uint8_t* phdr = &binary_data[phoff + i * phentsize];
            uint32_t p_type = *reinterpret_cast<uint32_t*>(phdr);
            if (p_type == 3) {  // PT_INTERP only (not PT_DYNAMIC)
                is_dynamic = true;
                break;
            }
        }
    }

    // For SEA binaries (dynamically linked), dl_iterate_phdr() needs the note data
    // mapped into memory. We extend the last PT_LOAD segment to cover the appended
    // note data, making it accessible at runtime.
    //
    // Strategy:
    // 1. Calculate how far past the last PT_LOAD's file content our notes start
    // 2. Extend that PT_LOAD's filesz/memsz to cover the notes
    // 3. Set PT_NOTE vaddr to point within the extended PT_LOAD region

    // Calculate the file offset where notes will be written (end of original file)
    // and the corresponding virtual address in the extended PT_LOAD
    uint64_t notes_file_offset = input_size;

    // The gap between the last PT_LOAD's file content and our notes
    uint64_t gap_from_load_end = notes_file_offset - (last_load_offset + last_load_filesz);

    // Calculate note_vaddr: it's the last PT_LOAD's vaddr + its original filesz + gap
    // This places the notes at the correct virtual address within the extended segment
    note_vaddr = last_load_vaddr + last_load_filesz + gap_from_load_end;

    printf("  Extending PT_LOAD[%d] to cover note data (SEA compatibility)\n", last_load_idx);
    printf("  Gap from LOAD end to notes: 0x%lx bytes\n", (unsigned long)gap_from_load_end);
    printf("  Note vaddr within extended LOAD: 0x%lx\n", (unsigned long)note_vaddr);

    // Extend the last PT_LOAD segment to cover the appended notes
    if (last_load_idx >= 0 && is_dynamic) {
        uint8_t* load_phdr = &binary_data[phoff + last_load_idx * phentsize];

        // New sizes: original size + gap + notes
        uint64_t new_load_filesz = last_load_filesz + gap_from_load_end + notes_total_size;
        uint64_t new_load_memsz = last_load_memsz + gap_from_load_end + notes_total_size;

        // Update PT_LOAD filesz and memsz
        memcpy(load_phdr + 32, &new_load_filesz, 8);  // p_filesz
        memcpy(load_phdr + 40, &new_load_memsz, 8);   // p_memsz

        printf("  Extended PT_LOAD[%d]: filesz 0x%lx -> 0x%lx, memsz 0x%lx -> 0x%lx\n",
               last_load_idx,
               (unsigned long)last_load_filesz, (unsigned long)new_load_filesz,
               (unsigned long)last_load_memsz, (unsigned long)new_load_memsz);
    } else if (!is_dynamic) {
        // For static binaries or SMOL stubs, use a high virtual address
        // that's past all LOAD segments but doesn't need actual mapping.
        // SMOL stubs (even with PT_DYNAMIC) must use this path because extending
        // PT_LOAD would cause the loader to map 26MB+ at a low address -> SIGSEGV.
        note_vaddr = 0x10000000 + align_up(input_size, 0x1000);
        if (is_smol_compression) {
            printf("  SMOL compression - using unmapped vaddr: 0x%lx (no PT_LOAD extension)\n",
                   (unsigned long)note_vaddr);
        } else {
            printf("  Static binary - using unmapped vaddr: 0x%lx\n", (unsigned long)note_vaddr);
        }
    }

    // Update PT_NOTE segment to point to our appended notes
    {
        uint32_t new_flags = 4;    // PF_R (readable)
        uint64_t new_offset = notes_file_offset;
        uint64_t new_paddr = note_vaddr;
        uint64_t new_filesz = notes_total_size;
        uint64_t new_memsz = notes_total_size;
        uint64_t new_align = 4;

        memcpy(target_phdr + 4, &new_flags, 4);
        memcpy(target_phdr + 8, &new_offset, 8);
        memcpy(target_phdr + 16, &note_vaddr, 8);
        memcpy(target_phdr + 24, &new_paddr, 8);
        memcpy(target_phdr + 32, &new_filesz, 8);
        memcpy(target_phdr + 40, &new_memsz, 8);
        memcpy(target_phdr + 48, &new_align, 8);

        printf("  Modified PT_NOTE[%d]: offset=0x%lx, vaddr=0x%lx, filesz=0x%lx\n",
               last_note_idx, (unsigned long)new_offset, (unsigned long)note_vaddr,
               (unsigned long)new_filesz);

        // Create output file
        FILE* out_file = fopen(output_path.c_str(), "wb");
        if (!out_file) {
            fprintf(stderr, "Error: Cannot create output file: %s\n", output_path.c_str());
            return -1;
        }

        // Write binary data (with modified PHT entries)
        if (fwrite(binary_data.data(), 1, input_size, out_file) != input_size) {
            fprintf(stderr, "Error: Failed to write binary data\n");
            fclose(out_file);
            return -1;
        }

        // Write all notes
        if (fwrite(all_notes.data(), 1, notes_total_size, out_file) != notes_total_size) {
            fprintf(stderr, "Error: Failed to write note data\n");
            fclose(out_file);
            return -1;
        }

        fclose(out_file);
        chmod(output_path.c_str(), 0755);

        printf("  Successfully wrote binary with %zu notes (PHT unchanged at offset %lu)\n",
               notes.size(), (unsigned long)phoff);
        printf("  Output size: %lu bytes\n",
               (unsigned long)(input_size + notes_total_size));
        if (is_dynamic) {
            printf("  Note data mapped via extended PT_LOAD (SEA compatible)\n");
        }
    }

    return 0;
}

/**
 * Write ELF binary with raw note appending (no PHT relocation) - single note.
 *
 * ============================================================================
 * SMOL REPACK SINGLE NOTE - CONVENIENCE WRAPPER
 * ============================================================================
 *
 * This is a convenience wrapper around smol_reuse_multi_ptnote() for
 * single-note use (e.g., binpress initial compression).
 *
 * REUSES an existing PT_NOTE entry - only for SMOL notes.
 * SMOL compressed data storage:
 *   Mach-O: SMOL/__PRESSED_DATA        (segment/section)
 *   ELF:    PT_NOTE with owner "pressed_data" (LIEF creates .note.pressed_data section)
 *   PE:     .pressed_data              (section only - no segments in PE)
 *
 * For static glibc binaries, PHT MUST stay at the original offset because glibc
 * reads PHT from base+phoff in memory, and moving it causes SIGSEGV.
 *
 * @param stub_path Path to the original stub binary
 * @param output_path Path to write the output binary
 * @param note_name SMOL note owner name (e.g., "pressed_data")
 * @param note_data Note data to append
 * @return 0 on success, -1 on error
 */
inline int smol_reuse_single_ptnote(
    const std::string& stub_path,
    const std::string& output_path,
    const char* note_name,
    const std::vector<uint8_t>& note_data
) {
    std::vector<NoteEntry> notes;
    notes.emplace_back(note_name, note_data);
    return smol_reuse_multi_ptnote(stub_path, output_path, notes, nullptr);
}

/**
 * Create and add a PT_NOTE to an ELF binary.
 *
 * This handles the LIEF #1026 fix where section_name must be specified
 * in the format ".note.<owner_name>" for custom notes to serialize.
 *
 * @param binary ELF binary to add note to
 * @param note_name Note owner name (e.g., "NODE_SEA_BLOB")
 * @param data Note data/description
 * @return 0 on success, -1 on error
 */
inline int create_and_add(
    LIEF::ELF::Binary* binary,
    const char* note_name,
    const std::vector<uint8_t>& data
) {
    if (!binary || !note_name) {
        fprintf(stderr, "Error: Invalid arguments to create_and_add\n");
        return -1;
    }

    // CRITICAL: Must specify section_name for LIEF serialization (Issue #1026)
    // Format: .note.<owner_name> (e.g., ".note.NODE_SEA_BLOB")
    std::string section_name = std::string(".note.") + note_name;

    // Create note using factory method
    auto note = LIEF::ELF::Note::create(
        note_name,                              // name (owner)
        uint32_t(0),                            // type (0 for custom notes)
        data,                                   // description (data)
        section_name,                           // section_name (required)
        LIEF::ELF::Header::FILE_TYPE::NONE,     // ftype
        LIEF::ELF::ARCH::NONE,                  // arch
        LIEF::ELF::Header::CLASS::NONE          // cls
    );

    if (!note) {
        fprintf(stderr, "Error: Failed to create PT_NOTE for '%s'\n", note_name);
        fprintf(stderr, "  Note owner: %s\n", note_name);
        fprintf(stderr, "  Data size: %zu bytes\n", data.size());
        fprintf(stderr, "  Section: %s\n", section_name.c_str());
        fprintf(stderr, "  This indicates LIEF Note::create() failed\n");
        return -1;
    }

    binary->add(*note);

    // Remove ALLOC flag from the new note section.
    // LIEF creates note sections with SHF_ALLOC and VirtAddr=0, which causes
    // the kernel to try mapping the section to address 0, resulting in SIGSEGV.
    // Since we read the note data using file offsets (not virtual addresses),
    // the ALLOC flag is unnecessary. Removing it prevents the loader crash.
    // See: https://github.com/rust-lang/rust/issues/26764
    //
    // Note: We search for the section by checking if its name contains our note name,
    // because LIEF may store the name differently.
    bool found = false;
    for (auto& sec : binary->sections()) {
        // Check if this is our note section (by substring match or exact match)
        if (sec.name() == section_name ||
            sec.name().find(note_name) != std::string::npos) {
            auto flags = sec.flags();
            if (static_cast<uint64_t>(flags) & static_cast<uint64_t>(LIEF::ELF::Section::FLAGS::ALLOC)) {
                sec.remove(LIEF::ELF::Section::FLAGS::ALLOC);
                printf("  Removed ALLOC flag from %s section\n", sec.name().c_str());
                found = true;
            }
            break;
        }
    }
    if (!found) {
        printf("  Warning: Could not find section %s to remove ALLOC flag\n", section_name.c_str());
        printf("  Sections in binary:\n");
        for (const auto& sec : binary->sections()) {
            if (sec.name().find("note") != std::string::npos ||
                sec.name().find("pressed") != std::string::npos) {
                printf("    - %s\n", sec.name().c_str());
            }
        }
    }

    return 0;
}

/**
 * Remove all PT_NOTE segments with matching name.
 * Safe against iterator invalidation.
 *
 * @param binary ELF binary to remove notes from
 * @param note_name Note owner name to match
 */
inline void remove_all(
    LIEF::ELF::Binary* binary,
    const char* note_name
) {
    if (!binary || !note_name) {
        return;
    }

    // Safe iterator removal pattern - restart after each removal
    bool found;
    do {
        found = false;
        for (auto& note : binary->notes()) {
            if (note.name() == note_name) {
                binary->remove(note);
                found = true;
                break;  // Restart iteration after removal
            }
        }
    } while (found);
}

/**
 * Check if PT_NOTE with given name exists.
 *
 * @param binary ELF binary to check
 * @param note_name Note owner name to find
 * @return true if note exists, false otherwise
 */
inline bool exists(
    LIEF::ELF::Binary* binary,
    const char* note_name
) {
    if (!binary || !note_name) {
        return false;
    }

    for (const auto& note : binary->notes()) {
        if (note.name() == note_name) {
            return true;
        }
    }
    return false;
}

/**
 * Remove and replace (or just add if not exists) a PT_NOTE.
 *
 * This is the common pattern for updating PT_NOTE content:
 * 1. Check if note exists
 * 2. Remove if exists
 * 3. Add new note with updated content
 *
 * @param binary ELF binary to update
 * @param note_name Note owner name
 * @param data New note data
 * @return 0 on success, -1 on error
 */
inline int replace_or_add(
    LIEF::ELF::Binary* binary,
    const char* note_name,
    const std::vector<uint8_t>& data
) {
    if (!binary || !note_name) {
        fprintf(stderr, "Error: Invalid arguments to replace_or_add\n");
        return -1;
    }

    // Check if note exists
    bool note_exists = exists(binary, note_name);

    if (note_exists) {
        printf("  Found existing %s PT_NOTE, removing and recreating...\n", note_name);
        remove_all(binary, note_name);
        printf("  Removed old %s PT_NOTE\n", note_name);
    } else {
        printf("  No existing %s PT_NOTE found, creating new one...\n", note_name);
    }

    // Add new note
    return create_and_add(binary, note_name, data);
}

/**
 * Create matching PT_LOAD segment for PT_NOTE (postject compatibility).
 *
 * ============================================================================
 * PART OF LIEF/POSTJECT APPROACH - NOT USED BY RAW/SMOL APPROACH
 * ============================================================================
 *
 * This is called by write_with_notes() for postject-compatible injection.
 * The SMOL approach (smol_reuse_multi_ptnote) extends an existing PT_LOAD
 * instead of creating a new one.
 *
 * WHY THIS IS NEEDED:
 * Postject creates BOTH PT_LOAD and PT_NOTE segments pointing to the same region:
 * - PT_LOAD: Provides memory mapping so note data is accessible at runtime
 * - PT_NOTE: Provides dl_iterate_phdr() access for postject_find_resource()
 *
 * This function mimics postject's behavior by adding a PT_LOAD segment that
 * covers the same region as the PT_NOTE segment containing our injected notes.
 *
 * @param binary ELF binary to fix
 */
inline void add_matching_load_for_notes(LIEF::ELF::Binary* binary) {
    // Find the highest file offset and vaddr used by LOAD segments
    uint64_t max_load_file_end = 0;
    uint64_t max_load_vaddr_end = 0;
    for (auto& seg : binary->segments()) {
        if (seg.type() == LIEF::ELF::Segment::TYPE::LOAD) {
            uint64_t file_end = seg.file_offset() + seg.physical_size();
            uint64_t vaddr_end = seg.virtual_address() + seg.virtual_size();
            if (file_end > max_load_file_end) {
                max_load_file_end = file_end;
            }
            if (vaddr_end > max_load_vaddr_end) {
                max_load_vaddr_end = vaddr_end;
            }
        }
    }

    // Find PT_NOTE segments that contain our SEA/VFS notes
    for (auto& seg : binary->segments()) {
        if (seg.type() == LIEF::ELF::Segment::TYPE::NOTE) {
            // Check if this NOTE segment contains our custom notes
            bool has_sea_note = false;
            for (const auto& note : binary->notes()) {
                if (note.name() == "NODE_SEA_BLOB" || note.name() == "SMOL_VFS_BLOB") {
                    has_sea_note = true;
                    break;
                }
            }

            if (has_sea_note && seg.virtual_address() != 0) {
                // Create a matching PT_LOAD segment for memory mapping
                // Use page-aligned size to ensure proper loading
                uint64_t load_offset = seg.file_offset();
                uint64_t load_vaddr = seg.virtual_address();
                uint64_t load_size = align_up(seg.physical_size(), 0x1000);

                LIEF::ELF::Segment load_seg;
                load_seg.type(LIEF::ELF::Segment::TYPE::LOAD);
                load_seg.flags(LIEF::ELF::Segment::FLAGS::R);  // Read-only
                load_seg.file_offset(load_offset);
                load_seg.virtual_address(load_vaddr);
                load_seg.physical_address(load_vaddr);
                load_seg.physical_size(load_size);
                load_seg.virtual_size(load_size);
                load_seg.alignment(0x1000);  // Page alignment

                binary->add(load_seg);
                printf("  Added PT_LOAD for notes: offset=0x%lx, vaddr=0x%lx, size=0x%lx\n",
                       (unsigned long)load_offset, (unsigned long)load_vaddr,
                       (unsigned long)load_size);
                break;  // Only need one LOAD for notes
            }
        }
    }
}

/**
 * Fix PT_NOTE segment virtual addresses to make them visible to dl_iterate_phdr().
 *
 * LIEF creates PT_NOTE segments with p_vaddr=0, which makes them invisible to
 * dl_iterate_phdr() that Node.js SEA uses (postject_find_resource).
 * This function sets proper non-zero virtual addresses for PT_NOTE segments.
 *
 * Strategy:
 * - Find the highest LOAD segment end address
 * - Place PT_NOTE segments starting after that, with 4KB page alignment
 *
 * @param binary ELF binary to fix
 */
inline void fix_note_segment_vaddrs(LIEF::ELF::Binary* binary) {
    // Find the highest address used by LOAD segments
    uint64_t max_load_end = 0;
    for (auto& seg : binary->segments()) {
        if (seg.type() == LIEF::ELF::Segment::TYPE::LOAD) {
            uint64_t seg_end = seg.virtual_address() + seg.virtual_size();
            if (seg_end > max_load_end) {
                max_load_end = seg_end;
            }
        }
    }

    // Start placing PT_NOTE segments after LOAD segments, with 4KB page alignment
    uint64_t next_vaddr = align_up(max_load_end, 0x1000);

    // Fix PT_NOTE segments that have p_vaddr=0
    int fixed_count = 0;
    for (auto& seg : binary->segments()) {
        if (seg.type() == LIEF::ELF::Segment::TYPE::NOTE && seg.virtual_address() == 0) {
            seg.virtual_address(next_vaddr);
            seg.physical_address(next_vaddr);
            printf("  Fixed PT_NOTE segment: set p_vaddr=0x%lx (was 0x0)\n",
                   (unsigned long)next_vaddr);
            next_vaddr = align_up(next_vaddr + seg.physical_size(), 0x1000);
            fixed_count++;
        }
    }

    if (fixed_count > 0) {
        printf("  Fixed %d PT_NOTE segment(s) to be visible to dl_iterate_phdr()\n", fixed_count);
    }
}

/**
 * Write ELF binary using raw binary manipulation (preferred for large notes).
 *
 * This function appends notes to the end of the file and updates the PT_NOTE
 * segment to point to them. For SEA binaries (dynamically linked), postject
 * adds both PT_LOAD and PT_NOTE segments - we currently just update PT_NOTE.
 *
 * NOTE: This may not work for all SEA use cases since the note data won't
 * be mapped into memory. For full SEA compatibility with dl_iterate_phdr,
 * consider using postject which properly handles PT_LOAD segments.
 *
 * @param binary ELF binary with notes added via LIEF API
 * @param input_path Path to the original input binary
 * @param output_path Path to write the output binary
 * @return 0 on success, -1 on error
 */
inline int write_with_notes_raw(
    LIEF::ELF::Binary* binary,
    const std::string& input_path,
    const std::string& output_path
) {
    // Extract notes from LIEF binary and write using raw approach
    std::vector<NoteEntry> notes;

    for (const auto& note : binary->notes()) {
        const std::string& name = note.name();
        const auto& desc = note.description();

        // Only include custom notes we care about (SEA/VFS)
        if (name == "NODE_SEA_BLOB" || name == "SMOL_VFS_BLOB") {
            printf("  Extracting note '%s' (%zu bytes) for raw write...\n",
                   name.c_str(), desc.size());
            // Convert span to vector
            std::vector<uint8_t> desc_vec(desc.begin(), desc.end());
            notes.emplace_back(name.c_str(), desc_vec);
        }
    }

    if (notes.empty()) {
        fprintf(stderr, "Error: No notes found in binary for raw write\n");
        return -1;
    }

    // Use flip_sea_fuse_raw callback if we have a SEA blob
    BinaryModifyCallback fuse_callback = nullptr;
    for (const auto& note : notes) {
        if (strcmp(note.name, "NODE_SEA_BLOB") == 0 && !note.data.empty()) {
            fuse_callback = flip_sea_fuse_raw;
            break;
        }
    }

    return smol_reuse_multi_ptnote(input_path, output_path, notes, fuse_callback);
}

/**
 * Write ELF binary with minimal config for PT_NOTE operations (LIEF builder).
 *
 * ============================================================================
 * LIEF APPROACH - POSTJECT-COMPATIBLE (DYNAMICALLY LINKED BINARIES)
 * ============================================================================
 *
 * This is the postject-compatible approach for Node.js SEA injection.
 * DO NOT use this for SMOL stubs - use smol_reuse_multi_ptnote() instead.
 *
 * WHY THIS APPROACH EXISTS:
 * Postject uses LIEF's Note API to create both PT_LOAD and PT_NOTE segments
 * pointing to the same location. dl_iterate_phdr() needs notes mapped via
 * PT_LOAD to access them at runtime (postject_find_resource).
 *
 * ============================================================================
 * HOW THIS ALIGNS WITH POSTJECT
 * ============================================================================
 *
 * POSTJECT BEHAVIOR:
 *   LIEF::ELF::Note note;
 *   note.name(note_name);
 *   note.description(data);
 *   binary->add(note);
 *   binary->raw();  // Creates PT_LOAD + PT_NOTE at same offset
 *
 * BINJECT BEHAVIOR (this function):
 *   Note::create() + binary->add()  // Same as postject
 *   write_with_notes()              // LIEF builder with proper config
 *
 * RESULTING STRUCTURE:
 * - NEW PT_LOAD segment created (not reusing existing)
 * - PT_LOAD: offset=0x7240000, vaddr=0xf240000, size=0x10000 (page-aligned)
 * - PT_NOTE: offset=0x7240000, vaddr=0xf240000, size=actual_note_size
 * - Both point to same location, allowing dl_iterate_phdr() access
 *
 * ============================================================================
 * HOW THIS DIFFERS FROM SMOL REPACK APPROACH
 * ============================================================================
 *
 * SMOL REPACK (smol_reuse_multi_ptnote):
 * - REUSES existing PT_NOTE entry (modifies in-place)
 * - Only for SMOL notes (pressed_data, etc.)
 * - EXTENDS last PT_LOAD to cover appended note data
 * - PHT stays at ORIGINAL location (CRITICAL for static glibc)
 *
 * LIEF/POSTJECT (this function):
 * - Creates NEW PT_LOAD + NEW PT_NOTE segments
 * - Page-aligned at same offset/vaddr
 * - PHT may be relocated (OK for dynamic binaries)
 *
 * ============================================================================
 * IMPLEMENTATION DETAILS
 * ============================================================================
 *
 * WARNING: LIEF's builder may truncate large notes (~1MB limit observed).
 * For notes larger than 1MB, use write_with_notes_raw() instead.
 *
 * CRITICAL: This is the correct way to write ELF binaries after modifying
 * PT_NOTE segments. Using binary->raw() or write() without proper config
 * causes VirtAddr=0 on note sections, leading to segfaults.
 *
 * The config disables all Builder processing except notes, which ensures:
 * 1. PT_NOTE segments are properly constructed in the PHT
 * 2. Section VirtAddr is correctly set (not 0)
 * 3. Other binary structures remain untouched
 *
 * TRIPLE-WRITE PATTERN:
 * This function performs three writes to work around LIEF quirks:
 * 1. First write: Properly constructs PT_NOTE segments (config.notes=true)
 * 2. Re-parse and fix: Removes ALLOC flag from sections with VirtAddr=0
 *    (LIEF adds ALLOC+VirtAddr=0, which causes kernel crashes - see Rust #26764)
 * 3. Fix PT_NOTE p_vaddr: Sets non-zero virtual addresses for PT_NOTE segments
 *    (LIEF creates p_vaddr=0, making them invisible to dl_iterate_phdr())
 * 4. Third write: Preserves all fixes while maintaining PT_NOTE integrity
 *    (MUST use config.notes=true to prevent PT_NOTE corruption/segfaults)
 *
 * LIEF VERSION NOTE:
 * This code has been tested with LIEF 0.14.x. When upgrading LIEF, verify:
 * 1. Builder respects section flags during write (ALLOC removal preserved)
 * 2. config.notes=true still properly constructs PT_NOTE segments
 * 3. The double-write pattern still prevents ALLOC+VirtAddr=0 crashes
 * 4. Second write with notes=true does NOT undo the ALLOC flag fixes
 * 5. PT_NOTE segment p_vaddr modifications are preserved
 *
 * @param binary ELF binary to write
 * @param output_path Path to write the binary to
 */
inline void write_with_notes(
    LIEF::ELF::Binary* binary,
    const std::string& output_path
) {
    // FIRST: Fix PT_NOTE segment virtual addresses before first write
    // This must happen before any writes because LIEF creates segments with p_vaddr=0
    fix_note_segment_vaddrs(binary);

    // SECOND: Add matching PT_LOAD segment for SEA/VFS notes (postject compatibility)
    // This allows dl_iterate_phdr() to access the note data at runtime
    add_matching_load_for_notes(binary);

    LIEF::ELF::Builder::config_t config;
    config.dt_hash = false;
    config.dyn_str = false;
    config.dynamic_section = false;
    config.fini_array = false;
    config.gnu_hash = false;
    config.init_array = false;
    config.interpreter = false;
    config.jmprel = false;
    config.notes = true;  // MUST be true to properly write PT_NOTE segments
    config.preinit_array = false;
    config.relr = false;
    config.android_rela = false;
    config.rela = false;
    config.static_symtab = false;
    config.sym_verdef = false;
    config.sym_verneed = false;
    config.sym_versym = false;
    config.symtab = false;
    config.coredump_notes = false;
    config.force_relocate = false;
    config.skip_dynamic = true;

    binary->write(output_path, config);

    // Fix: Re-parse the written binary and remove ALLOC flag from note sections
    // that have VirtAddr=0. LIEF creates these sections with ALLOC but VirtAddr=0,
    // which causes the loader to crash when trying to map them to address 0.
    // See: https://github.com/rust-lang/rust/issues/26764
    auto fixed = LIEF::ELF::Parser::parse(output_path);
    if (fixed) {
        bool modified = false;
        for (auto& sec : fixed->sections()) {
            // Check for note sections with ALLOC flag and VirtAddr=0
            if (sec.type() == LIEF::ELF::Section::TYPE::NOTE &&
                sec.virtual_address() == 0) {
                auto flags = sec.flags();
                if (static_cast<uint64_t>(flags) & static_cast<uint64_t>(LIEF::ELF::Section::FLAGS::ALLOC)) {
                    sec.remove(LIEF::ELF::Section::FLAGS::ALLOC);
                    printf("  Fixed: Removed ALLOC flag from %s (VirtAddr=0)\n", sec.name().c_str());
                    modified = true;
                }
            }
        }
        if (modified) {
            // Fix PT_NOTE segment virtual addresses again (re-parsed binary loses the fix)
            fix_note_segment_vaddrs(fixed.get());

            // Re-add matching PT_LOAD for SEA/VFS notes (postject compatibility)
            add_matching_load_for_notes(fixed.get());

            // Write with minimal config to preserve the binary structure.
            // CRITICAL: Third write to apply both ALLOC flag fixes AND p_vaddr fixes.
            LIEF::ELF::Builder::config_t fix_config;
            fix_config.dt_hash = false;
            fix_config.dyn_str = false;
            fix_config.dynamic_section = false;
            fix_config.fini_array = false;
            fix_config.gnu_hash = false;
            fix_config.init_array = false;
            fix_config.interpreter = false;
            fix_config.jmprel = false;
            // CRITICAL: notes MUST be true here! If false, LIEF skips PT_NOTE
            // segment construction, corrupting the Program Header Table and
            // causing SIGSEGV (exit 139) when the binary executes.
            // Setting to true ensures:
            // 1. PT_NOTE segments are properly serialized to the output
            // 2. PHT entries for PT_NOTE are valid and complete
            // 3. ALLOC flag fixes (from above) are preserved (orthogonal operation)
            // 4. PT_NOTE p_vaddr fixes make segments visible to dl_iterate_phdr()
            fix_config.notes = true;
            fix_config.preinit_array = false;
            fix_config.relr = false;
            fix_config.android_rela = false;
            fix_config.rela = false;
            fix_config.static_symtab = false;
            fix_config.sym_verdef = false;
            fix_config.sym_verneed = false;
            fix_config.sym_versym = false;
            fix_config.symtab = false;
            fix_config.coredump_notes = false;
            fix_config.force_relocate = false;
            fix_config.skip_dynamic = true;
            fixed->write(output_path, fix_config);
        }
    }
}

} // namespace elf_note_utils

#endif // ELF_NOTE_UTILS_HPP
