# LIEF Version Compatibility Notes

## TL;DR
binject currently uses LIEF 0.17.1 which has a **known Mach-O corruption issue** when injecting into complex binaries like Node.js.

## Background

### The Problem
LIEF 0.17.1 has a documented limitation in the Mach-O `add_section()` API:

> "This method may corrupt the file if the segment is not the first one nor the last one"

This applies to our use case because:
- The `__BINJECT` segment cannot be first (`__PAGEZERO` and `__TEXT` must come first)
- The `__BINJECT` segment cannot be last (`__LINKEDIT` must be last per dyld requirements)
- Therefore it MUST be in the middle, triggering the corruption

### Testing Results

Tested LIEF versions:
- ✗ **0.17.1** (Oct 2025): Current version - has documented corruption issue, API compatible with binject code
- ✗ **0.14.0** (tested): Significant API changes - requires code modifications for `CPU_TYPES`, `VM_PROTECTIONS`, ELF `Section::TYPE`, etc.
- ✗ **0.13.0**: No arm64 pre-built binaries available
- ✗ **0.12.3**: No arm64 pre-built binaries available
- ✓ **commit b183666** (Sept 2022, ~v0.12.x): Used by postject - works correctly but would require building from source

### Why Postject Works

Postject vendors LIEF commit `b183666` from September 20, 2022 (approximately LIEF v0.12.x era). This version:
- Does NOT have the documented corruption warning
- Successfully injects into Node.js binaries without corruption
- Is 3+ years older than the current LIEF version

### API Compatibility Issues

Newer LIEF versions (0.14.0+) introduced breaking API changes:
- `LIEF::MachO::Header::CPU_TYPE` → `LIEF::MachO::CPU_TYPES`
- `LIEF::MachO::SegmentCommand::VM_PROTECTIONS` → `LIEF::MachO::VM_PROTECTIONS`
- `LIEF::ELF::Section::TYPE` enum location changed
- Enum value names changed (e.g., `ARM64` → `ARM_64`, `READ` → `VM_PROT_READ`)

Older LIEF versions (0.12.x, 0.13.x) lack pre-built arm64 binaries.

## Options Going Forward

### Option 1: Use LIEF 0.17.1 (Current)
**Pros:**
- Pre-built binaries available for all platforms
- API compatible with current binject code
- Latest features and fixes

**Cons:**
- Documented Mach-O corruption issue
- Will corrupt complex binaries like Node.js
- Not suitable for production use with Node.js SEA

### Option 2: Downgrade to postject's LIEF commit
**Pros:**
- Proven to work correctly with Node.js injection
- No corruption issues
- Battle-tested by Node.js SEA users

**Cons:**
- Requires building LIEF from source
- No pre-built binaries
- Adds ~5-10 minutes to initial setup time
- Misses 3+ years of LIEF improvements

### Option 3: Wait for LIEF fix
**Pros:**
- Eventually get both latest LIEF and working Mach-O injection

**Cons:**
- Unknown timeline
- No guarantee the issue will be fixed
- binject unusable for Node.js in the meantime

## Recommendation

For now, binject should:
1. **Document the limitation clearly** in README
2. **Recommend using postject** for Node.js SEA instead of binject
3. **Keep LIEF 0.17.1** for ELF/PE injection (which may work fine)
4. **Consider implementing Option 2** if there's demand for Mach-O injection

The corruption issue is a fundamental LIEF limitation, not a binject bug. Until LIEF fixes the `add_section()` middle-segment corruption, or until we vendor the old working LIEF version, binject cannot reliably inject into Mach-O binaries.

## References

- LIEF Documentation: https://lief.re/doc/stable/doxygen/classLIEF_1_1MachO_1_1Binary.html
- Postject LIEF commit: b183666a082d19ffc91ed0763f49e1d4f3814a59
- Postject DEPENDENCIES file: https://github.com/nodejs/postject/blob/main/DEPENDENCIES
- LIEF Releases: https://github.com/lief-project/LIEF/releases
