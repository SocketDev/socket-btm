# bin-infra Tests

This directory contains tests for the shared binary infrastructure, particularly the ELF PT_NOTE handling in `elf_note_utils.hpp`.

## test-write-with-notes.sh

**Purpose:** Regression test for the `write_with_notes()` function.

**What it tests:**
1. PT_NOTE segments are properly preserved in both writes (double-write pattern)
2. ALLOC flags are correctly removed from sections with VirtAddr=0
3. Produced binaries execute without SIGSEGV (exit code 139)

**Why this is critical:**

The `write_with_notes()` function performs a double-write to work around a LIEF quirk:
- **First write:** Constructs PT_NOTE segments with `config.notes=true`
- **Fix step:** Removes ALLOC flag from sections with VirtAddr=0 (prevents kernel crashes)
- **Second write:** MUST use `config.notes=true` to preserve PT_NOTE segments

If the second write uses `config.notes=false`, LIEF skips PT_NOTE segment construction, corrupting the Program Header Table and causing segfaults.

**Historical context:**

This bug was introduced and fixed in commit 271e9c5a. The original code incorrectly used `notes=false` in the second write, causing all SEA binaries (Node.js firewall) to segfault on startup.

**Running the test:**

```bash
# From bin-infra directory
pnpm test

# Or directly
bash test/test-write-with-notes.sh
```

**Platform support:**
- **Linux:** Full validation including ALLOC flag checks with `readelf`
- **macOS:** Partial validation (execution test only, as macOS uses LC_NOTE instead of PT_NOTE)

## Adding More Tests

When adding tests, ensure they verify:
- Binary structure correctness (use `readelf -l` on Linux)
- No ALLOC+VirtAddr=0 combinations (causes crashes)
- Produced binaries execute without segfaults
- Both SMOL (VirtAddr=0) and SEA (VirtAddr≠0) code paths work correctly
