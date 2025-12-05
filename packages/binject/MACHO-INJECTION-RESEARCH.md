# Mach-O Injection Research Summary

## Problem Statement

Binject needs to inject data into Mach-O binaries (macOS executables) without using LIEF, due to LIEF's Mach-O corruption issues in recent versions.

## Attempted Solutions

### 1. Simple Append + Codesign Approach

**Implementation**: Append data to end of binary, then use `codesign` to re-sign

**Result**: FAILED
- Appending data corrupts the Mach-O structure
- `codesign` refuses to sign: "main executable failed strict validation"
- Even without signing, binary crashes on execution
- **Root cause**: Mach-O format requires specific internal structure with load commands describing all segments

### 2. Native macOS Tools Investigation

**Tools researched**:
- `segedit`: Can extract/replace existing sections, but **cannot create new sections**
- `install_name_tool`: Only for modifying dylib references
- `ld -sectcreate`: Can create sections during linking, but not for existing binaries

**Result**: No native macOS tool can add new segments/sections to existing Mach-O binaries

### 3. Manual Mach-O Structure Manipulation

**Research findings**:
- Blog post by Alexander O'Mara describes manual segment insertion
- Requires:
  - Parsing Mach-O header and load commands
  - Inserting new segment_command_64 before `__LINKEDIT`
  - Shifting `__LINKEDIT` segment data to make room
  - Updating all offset references in related load commands
- Tools available: Python's `macholib`, or manual C/C++ implementation

**Result**: This is essentially reimplementing LIEF's functionality
- LIEF does exactly this, but has a corruption bug in 0.17.1
- Reimplementing would require hundreds/thousands of lines of code
- Not "simple" as originally requested

## Technical Details: Why Simple Append Fails

Mach-O binaries have a strict structure:

```
[Mach-O Header]
  ├─ Lists all load commands
  └─ Specifies number and size of commands

[Load Commands]
  ├─ segment_command_64 for __PAGEZERO
  ├─ segment_command_64 for __TEXT
  ├─ segment_command_64 for __DATA
  ├─ ... other segments ...
  └─ segment_command_64 for __LINKEDIT (must be last)

[Segment Data]
  ├─ __TEXT segment data
  ├─ __DATA segment data
  ├─ ... other segment data ...
  └─ __LINKEDIT segment data (must be at end of file)
```

Simply appending data:
1. Doesn't create a load command describing the data
2. Leaves `__LINKEDIT` not at the end (violates format requirement)
3. Results in an invalid Mach-O that dyld cannot load

## Why LIEF Exists

LIEF (Library to Instrument Executable Formats) was created specifically to solve this problem:
- It knows all the Mach-O format rules
- It can parse, modify, and rebuild valid Mach-O structures
- It handles all the offset calculations and load command updates

The problem is that recent LIEF versions have a bug: "This method may corrupt the file if the segment is not the first one nor the last one"

## Alternatives Analysis

### Option 1: Use Old Working LIEF (Postject's Approach)

**Implementation**: Vendor LIEF commit b183666 (Sept 2022, ~v0.12.x)

**Pros**:
- Known to work (postject uses it successfully for Node.js SEA)
- Battle-tested by Node.js community
- No corruption issues

**Cons**:
- Requires building LIEF from source (~5-10 min setup)
- No pre-built arm64 binaries
- Misses 3+ years of LIEF improvements
- Adds complexity to build process

### Option 2: Reimplement Mach-O Manipulation

**Implementation**: Write custom C code to manually manipulate Mach-O structure

**Pros**:
- No external dependencies
- Full control over implementation

**Cons**:
- Complex: requires deep Mach-O format knowledge
- Error-prone: easy to create corrupted binaries
- Maintenance burden: must handle format changes
- Estimated effort: weeks of development + testing
- Essentially rebuilding parts of LIEF

### Option 3: Use Postject Directly

**Implementation**: Use postject for Node.js SEA, don't use binject for Mach-O

**Pros**:
- Works today, no changes needed
- Officially supported by Node.js
- No maintenance burden

**Cons**:
- Doesn't solve the general binject use case
- Dependency on external tool

### Option 4: Wait for LIEF Fix

**Implementation**: Monitor LIEF project for corruption bug fix

**Pros**:
- Eventually get latest LIEF + working Mach-O

**Cons**:
- Unknown timeline
- No guarantee bug will be fixed
- Binject unusable for Mach-O in the meantime

## Recommendation

Based on the research, **there is no simple alternative to LIEF** for Mach-O binary manipulation.

For Socket BTM specifically:

1. **Short term**: Use postject for Node.js SEA (it works and is officially supported)
2. **Medium term**: If binject needs Mach-O support, vendor old LIEF like postject does
3. **Long term**: Monitor LIEF project for bug fixes

The simplified codesign-only approach attempted in this branch **cannot work** for Mach-O binaries due to fundamental format constraints.

## Files Created During Investigation

- `src/macho_inject_simple.c` - Failed attempt at simple append approach
- `src/elf_inject_stub.c` - Stub for ELF (to allow macOS-only builds)
- `src/pe_inject_stub.c` - Stub for PE (to allow macOS-only builds)
- Updated `Makefile` - Removed LIEF dependencies

These files demonstrate why the simple approach fails and should be considered experimental/educational.

## References

- LIEF Documentation: https://lief.re/doc/stable/doxygen/classLIEF_1_1MachO_1_1Binary.html
- Postject DEPENDENCIES: https://github.com/nodejs/postject/blob/main/DEPENDENCIES
- Alexander O'Mara's Blog: https://alexomara.com/blog/adding-a-segment-to-an-existing-macos-mach-o-binary/
- Apple cctools segedit: https://opensource.apple.com/source/cctools/cctools-822/man/segedit.1.auto.html
