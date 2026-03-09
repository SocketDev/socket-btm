# Platform-Specific Injection Guide

Deep dive into how binject injects SEA/VFS resources into Mach-O, ELF, and PE binaries.

## Overview

binject uses LIEF (Library to Instrument Executable Formats) for cross-platform binary manipulation. Each platform has unique requirements and constraints.

## Mach-O (macOS)

### Segment Structure

```
Mach-O Binary Layout:
├── Header (mach_header_64)
├── Load Commands
│   ├── LC_SEGMENT_64 __PAGEZERO
│   ├── LC_SEGMENT_64 __TEXT
│   ├── LC_SEGMENT_64 __DATA
│   ├── LC_SEGMENT_64 NODE_SEA    ← Injected
│   ├── LC_SEGMENT_64 __LINKEDIT   ← Must be last
│   └── LC_CODE_SIGNATURE          ← Re-signed after injection
└── Data
```

### Injection Process

```cpp
// 1. Parse binary with LIEF
auto binary = LIEF::MachO::Parser::parse(input_path);

// 2. Create NODE_SEA segment
LIEF::MachO::SegmentCommand sea_segment("NODE_SEA");

// 3. Create sections
LIEF::MachO::Section sea_section("__NODE_SEA_BLOB");
sea_section.content(sea_blob_data);

LIEF::MachO::Section vfs_section("__SMOL_VFS_BLOB");
vfs_section.content(vfs_data);

// 4. Add sections to segment
sea_segment.add_section(sea_section);
sea_segment.add_section(vfs_section);

// 5. Insert BEFORE __LINKEDIT (critical for code signing)
binary->add(sea_segment);

// 6. Write binary
binary->write(output_path);
```

### Code Signing

After injection, the binary must be re-signed:

```bash
# Ad-hoc signing (development)
codesign --sign - --force myapp

# Identity signing (distribution)
codesign --sign "Developer ID Application: ..." myapp
```

binject automatically performs ad-hoc signing after injection.

### Section Names

| Segment | Section | Purpose |
|---------|---------|---------|
| `NODE_SEA` | `__NODE_SEA_BLOB` | SEA application blob |
| `NODE_SEA` | `__SMOL_VFS_BLOB` | VFS archive (TAR/TAR.GZ) |
| `NODE_SEA` | `__SMOL_VFS_CONFIG` | SVFG configuration |
| `SMOL` | `__PRESSED_DATA` | Compressed Node.js binary |

### Constraints

- **__LINKEDIT must be last**: Mach-O requires __LINKEDIT as the final segment
- **Page alignment**: Segments must be page-aligned (4KB or 16KB on ARM)
- **Code signature**: Must be valid or ad-hoc signed for execution
- **SIP paths**: Cannot modify binaries in SIP-protected locations

### Error Handling

```
Error: Failed to add segment before __LINKEDIT
```
Binary structure is incompatible. May need to rebuild from source.

```
Error: codesign failed
```
Signing failed. Check Keychain access or use `--skip-signing`.

---

## ELF (Linux)

### Section Structure

```
ELF Binary Layout:
├── ELF Header
├── Program Headers
│   ├── PT_LOAD (code)
│   ├── PT_LOAD (data)
│   ├── PT_NOTE              ← Used for injection
│   └── PT_GNU_RELRO
├── Sections
│   ├── .text
│   ├── .data
│   ├── .note.node_sea_blob  ← Injected
│   ├── .note.smol_vfs_blob  ← Injected
│   └── .note.smol_vfs_config ← Injected
└── Section Headers
```

### Injection Process

```cpp
// 1. Parse binary with LIEF
auto binary = LIEF::ELF::Parser::parse(input_path);

// 2. Create PT_NOTE section for SEA
LIEF::ELF::Section sea_section(".note.node_sea_blob");
sea_section.type(LIEF::ELF::ELF_SECTION_TYPES::SHT_NOTE);
sea_section.content(sea_blob_data);

// 3. Add section
binary->add(sea_section);

// 4. For static binaries: Preserve Program Header Table (PHT)
// CRITICAL: glibc static binaries have fixed PHT expectations
if (is_static_binary(binary)) {
    preserve_program_header_table(binary);
}

// 5. Write binary
binary->write(output_path);
```

### PT_NOTE Segments

ELF uses PT_NOTE segments for metadata. binject creates notes containing:
- SEA blob data
- VFS archive
- Configuration

### Static Binary Handling

Static glibc binaries require special handling:

1. **PHT Preservation**: Program Header Table must remain at expected offsets
2. **No segment growth**: Cannot resize existing segments
3. **Note placement**: Must use existing note sections or append carefully

```cpp
// Check for static binary
bool is_static = !binary->has_interpreter();

if (is_static) {
    // Use LIEF's double-write pattern for stable PHT
    binary->write(temp_path);
    auto binary2 = LIEF::ELF::Parser::parse(temp_path);
    binary2->write(output_path);
}
```

### Section Names

| Section | Purpose |
|---------|---------|
| `.note.node_sea_blob` | SEA application blob |
| `.note.smol_vfs_blob` | VFS archive |
| `.note.smol_vfs_config` | SVFG configuration |
| `.note.smol_pressed_data` | Compressed binary |

### Constraints

- **1MB note size limit**: LIEF default; patched to 100MB in lief-builder
- **PHT stability**: Static binaries need careful handling
- **Permissions**: May need CAP_FOWNER on some systems
- **SELinux**: May need context adjustment

### Error Handling

```
Error: Note size exceeds limit
```
Data too large for PT_NOTE. Check LIEF is built with patched limits.

```
Error: Failed to preserve program headers
```
Static binary PHT issue. Try double-write pattern.

---

## PE (Windows)

### Section Structure

```
PE Binary Layout:
├── DOS Header
├── PE Signature
├── COFF Header
├── Optional Header
├── Section Headers
│   ├── .text
│   ├── .data
│   ├── .rdata
│   ├── .node_sea     ← Injected
│   ├── .smol_vfs     ← Injected
│   └── .rsrc
└── Section Data
```

### Injection Process

```cpp
// 1. Parse binary with LIEF
auto binary = LIEF::PE::Parser::parse(input_path);

// 2. Create SEA section
LIEF::PE::Section sea_section(".node_sea");
sea_section.characteristics(
    LIEF::PE::SECTION_CHARACTERISTICS::IMAGE_SCN_MEM_READ |
    LIEF::PE::SECTION_CHARACTERISTICS::IMAGE_SCN_CNT_INITIALIZED_DATA
);
sea_section.content(sea_blob_data);

// 3. Add section
binary->add_section(sea_section);

// 4. Write binary
binary->write(output_path);
```

### Section Characteristics

| Characteristic | Value | Description |
|----------------|-------|-------------|
| `IMAGE_SCN_MEM_READ` | 0x40000000 | Section is readable |
| `IMAGE_SCN_CNT_INITIALIZED_DATA` | 0x00000040 | Contains initialized data |

### Resource Section

For Windows resources (icons, manifests), binject preserves the `.rsrc` section:

```cpp
// Find and preserve .rsrc
auto* rsrc = binary->section_from_offset(".rsrc");
if (rsrc) {
    // Ensure our sections don't conflict
}
```

### Section Names

| Section | Purpose |
|---------|---------|
| `.node_sea` | SEA application blob |
| `.smol_vfs` | VFS archive |
| `.vfs_config` | SVFG configuration |
| `.pressed_data` | Compressed binary |

Note: PE section names are limited to 8 characters.

### Constraints

- **8-char section names**: PE limitation
- **Section alignment**: Must match OptionalHeader.SectionAlignment
- **File alignment**: Must match OptionalHeader.FileAlignment
- **No signing**: binject doesn't perform Authenticode signing

### Error Handling

```
Error: Section name too long
```
PE section names must be ≤ 8 characters.

```
Error: Section alignment mismatch
```
Check SectionAlignment and FileAlignment values.

---

## Cross-Platform Comparison

| Feature | Mach-O | ELF | PE |
|---------|--------|-----|-----|
| Segment/Section | Segments contain sections | Sections mapped to segments | Sections only |
| Max name length | 16 chars | Unlimited | 8 chars |
| Signing | codesign required | Not required | Authenticode optional |
| Note sections | Not used | PT_NOTE | Not used |
| Hot path | Segment lookup | PT_NOTE scan | Section lookup |

## LIEF Integration

### Building LIEF

lief-builder builds LIEF with patches:

1. **1MB note limit removed**: Allows larger SEA/VFS blobs
2. **Musl compatibility**: No glibc-specific symbols
3. **Static linking**: No runtime dependencies

### Version

Currently using LIEF v0.17.0 with custom patches.

### Error Recovery

LIEF write failures trigger diagnostics:

```cpp
try {
    binary->write(output_path);
} catch (const LIEF::exception& e) {
    // Log diagnostic info
    diagnose_lief_failure(binary, output_path, e);
}
```

Diagnostics check:
- Disk space
- Permissions
- File locks
- Binary corruption

## Related Documentation

- [Config Formats](config-formats.md) - SMFG/SVFG specifications
- [smol-injection-flow.md](smol-injection-flow.md) - Full injection workflow
- [Binary Formats](../../bin-infra/docs/binary-formats.md) - Format specifications
