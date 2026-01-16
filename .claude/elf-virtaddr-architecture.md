# ELF PT_NOTE VirtAddr Architecture Decision

**Date:** 2026-01-15
**Status:** Implemented
**Decision:** Split ELF PT_NOTE injection into two approaches based on use case

## Context

When injecting PT_NOTE segments into ELF binaries, there are two fundamentally different reading mechanisms that require different approaches:

1. **File-based reading** - Decompression stub reads notes from file offset
2. **Memory-based reading** - Node.js SEA uses `dl_iterate_phdr()` to find notes in memory

These different mechanisms require different VirtAddr settings in the PT_NOTE segment.

## Decision

### Approach 1: Raw Notes with VirtAddr=0 (SMOL Stubs)

**Use Case:** Binary compression with SMOL stubs (binpress, smol_repack)

**Method:** Raw binary manipulation (`write_with_raw_notes()`)

**VirtAddr:** 0 (non-loadable)

**Why:**
- Static glibc binaries require PHT at original offset (typically 64)
- LIEF's `binary->write()` restructures the entire binary, moving PHT
- Moving PHT causes SIGSEGV in static glibc (reads from `base + e_phoff`)
- Decompression stub reads notes from file offset, not memory address
- VirtAddr=0 means kernel won't map segment into memory (saves address space)

**Implementation:**
```cpp
// packages/binpress/src/stub_elf_compress_lief.cpp
elf_note_utils::write_with_raw_note(stub_path, output_path, note_name, note_data);

// packages/bin-infra/src/stub_smol_repack_lief.cpp
elf_note_utils::write_with_raw_note(stub_path, output_path, note_name, note_data);
```

**Critical Constraint:** PHT must stay at original offset for static glibc compatibility

### Approach 2: LIEF Notes with Proper VirtAddr (Node.js SEA)

**Use Case:** Node.js Single Executable Application (binject --sea, --vfs)

**Method:** LIEF high-level Note API (`write_with_notes()`)

**VirtAddr:** ≠ 0 (loadable, assigned by LIEF)

**Why:**
- Node.js uses `dl_iterate_phdr()` to discover resources at runtime
- `dl_iterate_phdr()` only reports segments mapped into memory
- VirtAddr=0 segments are not mapped, thus invisible to `dl_iterate_phdr()`
- Node.js expects notes discoverable via postject's mechanism
- Dynamic binaries can tolerate PHT relocation (dynamic linker handles it)

**Implementation:**
```cpp
// packages/binject/src/elf_inject_lief.cpp
elf_note_utils::replace_or_add(binary.get(), section_name, note_data);
elf_note_utils::write_with_notes(binary.get(), tmpfile);
```

**Critical Requirement:** Notes must be mapped into memory for `dl_iterate_phdr()` discovery

## Comparison

| Aspect | SMOL Stubs (VirtAddr=0) | Node.js SEA (VirtAddr≠0) |
|--------|-------------------------|--------------------------|
| **Primary Use** | Binary compression | JavaScript SEA execution |
| **Target Binaries** | Static glibc stubs | Dynamic Node.js binaries |
| **Reading Method** | File I/O (offset-based) | Memory mapping (`dl_iterate_phdr()`) |
| **VirtAddr** | 0 (non-loadable) | ≠ 0 (loadable) |
| **PHT Preservation** | Critical (must stay at offset 64) | Not critical (dynamic linker) |
| **Implementation** | Raw binary manipulation | LIEF high-level API |
| **Mapped to Memory** | No | Yes |
| **LIEF Restructuring** | Avoided (breaks static glibc) | Acceptable (dynamic linking) |

## Technical Details

### Why PHT Relocation Breaks Static Glibc

Static glibc binaries have hardcoded assumptions:
1. PHT is at offset 64 (ELF64 header size)
2. Code reads from `base + e_phoff` in memory
3. If PHT moves, `e_phoff` points to wrong memory location
4. PLT/GOT resolution fails → SIGSEGV

LIEF's `binary->write()`:
- Creates new PT_LOAD segments for added content
- Reorganizes segment layout
- Moves PHT to accommodate new segments
- Updates `e_phoff` in header
- But static code already has old offset hardcoded

### Why VirtAddr=0 Works for SMOL

Decompression stub flow:
1. Open compressed binary as file
2. Read ELF header, find PHT at `e_phoff`
3. Iterate PT_NOTE entries in PHT
4. Match note name (e.g., "pressed_data")
5. Read from file at `p_offset` (NOT `p_vaddr`)
6. Decompress and execute

Key insight: File I/O uses `p_offset`, not `p_vaddr`

### Why VirtAddr≠0 Required for SEA

Node.js resource discovery:
1. Call `dl_iterate_phdr()` at startup
2. Kernel returns segments mapped into memory
3. VirtAddr=0 segments skipped (not mapped)
4. Search returned segments for PT_NOTE
5. Match note name (e.g., "NODE_SEA_BLOB")
6. Read from memory at `p_vaddr + load_address`

Key insight: `dl_iterate_phdr()` only reports mapped segments (VirtAddr≠0)

## Implementation Files

### SMOL Stub Implementation (VirtAddr=0)

**Compression:**
- `packages/binpress/src/stub_elf_compress_lief.cpp` - Initial compression
- `packages/bin-infra/src/stub_smol_repack_lief.cpp` - Repack/update operations

**Core Utilities:**
- `packages/bin-infra/src/elf_note_utils.hpp::write_with_raw_notes()` - Raw injection
- `packages/bin-infra/src/elf_note_utils.hpp::write_with_raw_note()` - Single note wrapper

### Node.js SEA Implementation (VirtAddr≠0)

**Injection:**
- `packages/binject/src/elf_inject_lief.cpp::binject_elf_lief()` - Single injection
- `packages/binject/src/elf_inject_lief.cpp::binject_elf_lief_batch()` - Batch injection

**Core Utilities:**
- `packages/bin-infra/src/elf_note_utils.hpp::write_with_notes()` - LIEF with config
- `packages/bin-infra/src/elf_note_utils.hpp::replace_or_add()` - Note management
- `packages/bin-infra/src/elf_note_utils.hpp::create_and_add()` - Note creation

## Verification

### SMOL Stub Verification

Static glibc binary should:
1. ✅ Run without SIGSEGV
2. ✅ PHT at original offset (typically 64)
3. ✅ PT_NOTE with VirtAddr=0
4. ✅ Decompression stub finds note by name
5. ✅ Extraction succeeds

```bash
# Check PHT offset
readelf -h compressed-binary | grep "Start of program headers"
# Should show: 64 (bytes into file)

# Check PT_NOTE VirtAddr
readelf -l compressed-binary | grep -A 5 "NOTE"
# Should show: VirtAddr 0x0000000000000000
```

### Node.js SEA Verification

Dynamic Node.js binary should:
1. ✅ Run without SIGSEGV
2. ✅ PT_NOTE with VirtAddr≠0
3. ✅ NODE_SEA_FUSE flipped from :0 to :1
4. ✅ `dl_iterate_phdr()` discovers note
5. ✅ SEA JavaScript executes

```bash
# Check PT_NOTE VirtAddr
readelf -l node-sea-binary | grep -A 5 "NOTE"
# Should show: VirtAddr 0xNNNNNNNNNNNNNNNN (non-zero)

# Check fuse state
strings node-sea-binary | grep NODE_SEA_FUSE
# Should show: NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2:1
```

## Consequences

### Positive

1. **Correct Behavior:** Each use case gets the appropriate implementation
2. **Static Glibc Safety:** PHT preservation prevents segfaults
3. **Node.js Compatibility:** Proper VirtAddr enables resource discovery
4. **Clear Separation:** Code explicitly documents which approach to use
5. **Maintainable:** Easy to understand why two approaches exist

### Negative

1. **Complexity:** Two code paths to maintain instead of one
2. **Documentation:** Requires clear explanation of when to use each
3. **Testing:** Must test both approaches independently

### Mitigations

- Comprehensive documentation (this file)
- Clear comments in code explaining rationale
- Shared utilities where possible (note format, deduplication)
- Integration tests for both use cases (see Testing section below)

## Testing

### SMOL Stub Tests (VirtAddr=0)

**Unit Test: PT_NOTE Replacement**
- **Location:** `packages/binpress/test/elf-ptnote-repack.test.mjs`
- **Purpose:** Validates PT_NOTE segment replacement (not appending) during binary repacking
- **What it tests:**
  - PT_NOTE segments are properly replaced in update mode
  - Section names follow correct format (`.note.pressed_data`)
  - Multiple sequential updates don't accumulate PT_NOTE segments
  - Binary structure remains valid after repacking
  - Compressed binaries remain executable
- **Platform:** Linux only (ELF native platform)
- **Run with:** `pnpm test` in `packages/binpress`

**Integration Test: Compression Round-Trip**
- **Location:** `packages/binpress/test/compression-roundtrip.test.mjs`
- **Purpose:** End-to-end validation of compression/decompression workflow
- **What it tests:**
  - Compress binary with binpress (uses `write_with_raw_note()`)
  - Execute compressed binary (decompression stub reads PT_NOTE from file offset)
  - Verify decompressed binary matches original functionality
  - Validate LZFSE compression metadata and magic markers
  - Test multiple compression cycles and large binaries
- **Platform:** All platforms (Linux, macOS, Windows)
- **Run with:** `pnpm test` in `packages/binpress`
- **Critical validation:** Compressed binaries execute without SIGSEGV, proving VirtAddr=0 notes work correctly with file-based reading

### SEA Tests (VirtAddr≠0)

**Regression Test: write_with_notes() PT_NOTE Handling**
- **Location:** `packages/bin-infra/test/test-write-with-notes.sh`
- **Purpose:** Prevent regression of the notes=false bug (commit 271e9c5a)
- **What it tests:**
  - PT_NOTE segments properly preserved in both writes (double-write pattern)
  - ALLOC flags correctly removed from sections with VirtAddr=0
  - Produced binaries execute without SIGSEGV (exit code 139)
- **Platform:** Linux (full validation with readelf), macOS (execution test only)
- **Run with:** `pnpm test` in `packages/bin-infra` or `bash test/test-write-with-notes.sh`
- **Historical context:** This test catches the bug where `notes=false` in second write corrupted the Program Header Table

**Integration Test: LIEF Section Injection**
- **Location:** `packages/binject/test/test-lief-integration.sh`
- **Purpose:** Validates LIEF can inject multiple sections into the same segment
- **What it tests:**
  - Single section injection with LIEF
  - Multiple section injection into same segment
  - Data integrity after injection
  - Segment structure correctness
- **Platform:** macOS only (uses otool for verification)
- **Run with:** `pnpm test` in `packages/binject`
- **Note:** Tests macOS-specific Mach-O injection; Linux ELF injection tested via SEA execution in firewall E2E tests

### End-to-End Tests

**Firewall Integration Tests**
- **Location:** `packages/firewall/test/*.integration.test.ts`
- **Purpose:** Real-world validation of Node.js SEA binaries with VirtAddr≠0 notes
- **What it tests:**
  - Binaries built with binject execute Node.js code from embedded resources
  - `dl_iterate_phdr()` discovers PT_NOTE segments in memory
  - NODE_SEA_FUSE properly flipped from :0 to :1
  - SEA resources accessible at runtime
- **Platform:** All platforms (Linux, macOS, Windows)
- **Run with:** `pnpm test` in `packages/firewall`
- **Critical validation:** If PT_NOTE segments have VirtAddr=0, these tests would fail because `dl_iterate_phdr()` wouldn't find the notes

### Test Coverage Summary

| Code Path | What's Tested | Test Location | Platforms |
|-----------|---------------|---------------|-----------|
| **write_with_raw_note()** | VirtAddr=0 for SMOL stubs | binpress compression-roundtrip | All |
| **write_with_raw_note()** | PT_NOTE replacement in repack | binpress elf-ptnote-repack | Linux |
| **write_with_notes()** | VirtAddr≠0 for SEA | bin-infra test-write-with-notes | Linux, macOS |
| **write_with_notes()** | Double-write pattern | bin-infra test-write-with-notes | Linux, macOS |
| **binject SEA** | End-to-end SEA execution | firewall integration tests | All |
| **LIEF injection** | Multi-section support | binject test-lief-integration | macOS |

### Running All Tests

```bash
# SMOL stub tests (VirtAddr=0)
cd packages/binpress
pnpm test

# SEA regression test (VirtAddr≠0)
cd packages/bin-infra
pnpm test

# LIEF integration test (macOS only)
cd packages/binject
pnpm test

# End-to-end firewall tests
cd packages/firewall
pnpm test
```

## Future Considerations

### If Supporting Big-Endian Architectures

Would need to:
1. Byte-swap all header reads (`phoff`, `phnum`, etc.)
2. Byte-swap all note structure fields
3. Add endianness detection and conversion utilities
4. Test on actual big-endian hardware (PowerPC, s390x)

Currently rejected because:
- Target platforms (x86-64, ARM64) are all little-endian
- Byte-swapping adds complexity and overhead
- Big-endian usage is rare and declining

### If Supporting 32-bit ELF

Would need to:
1. Duplicate all pointer arithmetic for 32-bit offsets
2. Handle both ELF32 and ELF64 header layouts
3. Adjust size calculations (4-byte vs 8-byte fields)
4. Test on 32-bit systems

Currently rejected because:
- Modern systems are 64-bit
- 32-bit Node.js not supported
- Static glibc stubs built as 64-bit

## References

- **ELF Specification:** [System V ABI, Chapter 5](https://refspecs.linuxfoundation.org/elf/elf.pdf)
- **postject Implementation:** [nodejs/postject on GitHub](https://github.com/nodejs/postject)
- **Static Glibc Issue:** `.claude/fix-elf-ptnote-virtaddr.md`
- **dl_iterate_phdr Manual:** `man 3 dl_iterate_phdr`
- **Original Plan:** `.claude/elf-section-vs-note-plan.md`

## Related Documents

- `.claude/elf-ptnote-fix.md` - Initial PT_NOTE implementation
- `.claude/fix-elf-ptnote-virtaddr.md` - PHT relocation problems
- `.claude/elf-section-vs-note-plan.md` - Section vs Note comparison
