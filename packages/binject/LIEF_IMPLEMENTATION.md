# LIEF Implementation Notes for Mach-O Injection

## Overview

This document explains the Mach-O binary injection implementation using the LIEF library (`src/macho_inject_lief.cpp`). The implementation uses a hybrid approach that combines LIEF's API for structure manipulation with manual file I/O for content injection.

## Implementation Approach

### The Correct LIEF Pattern

Based on the LIEF examples (`vendor/lief/submodule/examples/cpp/elf_add_section.cpp:33-36`), the correct pattern for setting section content is:

```cpp
Section section(name);
std::vector<uint8_t> data = {...};
section.content(std::move(data));  // Key: use .content() method, not constructor
binary->add(section);
```

**Critical insight**: Content must be set via the `.content()` method, not through the constructor.

### Mach-O Specific Considerations

For Mach-O binaries, `Binary::add_section(const SegmentCommand&, const Section&)` performs complex space allocation logic (see `vendor/lief/submodule/src/MachO/Binary.cpp:1431-1468`). This logic:

1. Checks if `section.offset() == 0`
2. Calls `ensure_command_space()` to allocate header space
3. Calls `extend()` on the target segment
4. Adjusts load command offsets

When working with newly created custom segments (like `NODE_SEA`), this allocation logic can encounter issues, leading to segmentation faults.

### Hybrid Solution

Our implementation uses a hybrid approach:

1. **Structure Creation**: Use LIEF to create the segment and section structure
   - `binary->add(segment)` to create segment
   - `SegmentCommand::add_section()` to add section (only updates metadata)

2. **Binary Writing**: Use LIEF Builder to write the complete Mach-O structure
   - `LIEF::MachO::Builder::write(*fat_binary, executable)`
   - This creates a valid Mach-O with proper headers and load commands

3. **Content Injection**: Manually write the actual section content
   - Re-parse the written binary to get the actual section file offset
   - Use standard C `fopen()`/`fwrite()` to write content bytes at that offset

## Implementation Steps

```cpp
// Step 1: Create or get segment
LIEF::MachO::SegmentCommand new_segment(segment_name);
new_segment.init_protection(7);  // rwx
new_segment.max_protection(7);
target_segment = binary->add(new_segment);

// Step 2: Create section with content
LIEF::MachO::Section new_section(section_name);
std::vector<uint8_t> content_vec(data, data + size);
new_section.content(std::move(content_vec));  // Critical!
new_section.alignment(2);
new_section.type(LIEF::MachO::Section::TYPE::REGULAR);

// Step 3: Add section to segment (metadata only)
target_segment->add_section(new_section);

// Step 4: Remove code signature
binary->remove_signature();

// Step 5: Write structure
LIEF::MachO::Builder::write(*fat_binary, executable);

// Step 6: Manual content injection
auto written = LIEF::MachO::Parser::parse(executable);
auto section = written->at(0)->get_section(section_name);
uint64_t offset = section->offset();

FILE* fp = fopen(executable, "r+b");
fseek(fp, offset, SEEK_SET);
fwrite(data, 1, size, fp);
fclose(fp);
```

## Why This Approach Works

1. **Avoids LIEF allocation issues**: By using `SegmentCommand::add_section()` instead of `Binary::add_section()`, we bypass the problematic space allocation logic

2. **Leverages LIEF's strengths**: LIEF correctly handles all the complex Mach-O structure creation (load commands, segment headers, section headers, file layout)

3. **Direct content control**: Manual file I/O gives us complete control over the exact bytes written, with no LIEF intermediation

4. **Reliable and predictable**: This approach works regardless of segment state (new or existing) and content size

## Verification

The implementation has been verified to:
- ✅ Correctly inject arbitrary sized content (tested with 273 bytes)
- ✅ Create proper NODE_SEA segment structure
- ✅ Create __NODE_SEA_BLOB section with correct metadata
- ✅ Write exact content bytes that can be extracted and verified
- ✅ Work with both compressed stub binaries and extracted cache binaries

## References

- LIEF Documentation: https://lief-project.github.io/
- LIEF GitHub: https://github.com/lief-project/LIEF
- LIEF Examples: `vendor/lief/submodule/examples/cpp/`
- LIEF Source: `vendor/lief/submodule/src/MachO/Binary.cpp`
- Node.js SEA Documentation: https://nodejs.org/api/single-executable-applications.html
