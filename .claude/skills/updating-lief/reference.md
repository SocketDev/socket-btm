# updating-lief Reference Documentation

This document provides detailed edge cases, troubleshooting procedures, API compatibility patterns, and advanced topics for the updating-lief skill in socket-btm.

## Table of Contents

1. [LIEF API Compatibility Patterns](#lief-api-compatibility-patterns)
2. [Edge Cases](#edge-cases)
3. [Rollback Procedures](#rollback-procedures)
4. [API Audit Methodology](#api-audit-methodology)
5. [Common API Issues](#common-api-issues)
6. [Build and Test Failures](#build-and-test-failures)
7. [Cross-Platform Considerations](#cross-platform-considerations)
8. [Advanced Topics](#advanced-topics)

---

## LIEF API Compatibility Patterns

### Mach-O API Evolution

#### v0.17.0 Breaking Changes

**1. Header::magic() Return Type**

```cpp
// ❌ WRONG (pre-v0.17.0 or incorrect)
uint32_t magic = binary->header().magic();
if (magic != 0xFEEDFACF) { /* ... */ }

// ✅ CORRECT (v0.17.0+)
LIEF::MachO::MACHO_TYPES magic = binary->header().magic();
if (magic != LIEF::MachO::MACHO_TYPES::MAGIC_64) { /* ... */ }

// When printing magic value, cast to uint32_t
fprintf(stderr, "Magic: 0x%x\n", static_cast<uint32_t>(magic));
```

**Rationale:** LIEF v0.17.0 made magic() type-safe by returning an enum instead of raw uint32_t. This prevents accidental comparison with invalid magic values and provides better IDE auto-completion.

**2. MACHO_TYPES Enum Constants**

```cpp
// ❌ WRONG (old constant names with MH_ prefix)
LIEF::MachO::MACHO_TYPES::MH_MAGIC_64   // Does not exist in v0.17.0
LIEF::MachO::MACHO_TYPES::MH_CIGAM_64   // Does not exist
LIEF::MachO::MACHO_TYPES::MH_MAGIC      // Does not exist
LIEF::MachO::MACHO_TYPES::MH_CIGAM      // Does not exist

// ✅ CORRECT (v0.17.0+ without MH_ prefix)
LIEF::MachO::MACHO_TYPES::MAGIC_64      // 0xFEEDFACF (64-bit big-endian)
LIEF::MachO::MACHO_TYPES::CIGAM_64      // 0xCFFAEDFE (64-bit little-endian)
LIEF::MachO::MACHO_TYPES::MAGIC         // 0xFEEDFACE (32-bit big-endian)
LIEF::MachO::MACHO_TYPES::CIGAM         // 0xCEFAEDFE (32-bit little-endian)
```

**Rationale:** The `MH_` prefix was removed to avoid conflict with macOS system headers (`<mach-o/loader.h>`) which define `MH_MAGIC_64` as a macro. The new names are cleaner and prevent macro expansion issues.

**3. Binary::add() Return Type**

```cpp
// ❌ WRONG (assuming SegmentCommand* return type)
LIEF::MachO::SegmentCommand* seg = binary->add(segment);
if (!seg) { /* error */ }

// ✅ CORRECT (v0.17.0+ returns LoadCommand* base class)
LIEF::MachO::LoadCommand* cmd = binary->add(segment);
if (!cmd) { /* error */ }

// If you need SegmentCommand*, cast explicitly
auto* seg = dynamic_cast<LIEF::MachO::SegmentCommand*>(cmd);
```

**Rationale:** Returning the base class `LoadCommand*` is more flexible and aligns with LIEF's internal architecture. Most callers only check for NULL anyway, so the specific type isn't needed.

---

### ELF API Patterns (Stable Since v0.15.0)

**Note::create() Factory Method**

```cpp
// ✅ CORRECT - Always specify section_name parameter (CRITICAL)
auto note = LIEF::ELF::Note::create(
    "NODE_SEA_BLOB",                        // name (owner)
    uint32_t(0),                            // type
    data_vector,                            // description
    ".note.NODE_SEA_BLOB",                  // section_name (REQUIRED!)
    LIEF::ELF::Header::FILE_TYPE::NONE,
    LIEF::ELF::ARCH::NONE,
    LIEF::ELF::Header::CLASS::NONE
);

// ❌ WRONG - Omitting section_name causes LIEF bug #1026
auto note = LIEF::ELF::Note::create(
    "NODE_SEA_BLOB",
    uint32_t(0),
    data_vector
);  // Missing section_name - will fail to serialize!
```

**Binary::add() for Notes**

```cpp
// ✅ CORRECT - Dereference unique_ptr before adding
auto note = LIEF::ELF::Note::create(/* ... */);
binary->add(*note);  // Note the dereference operator *

// ❌ WRONG - Passing unique_ptr directly
binary->add(note);  // Type mismatch
```

**Builder Config for Notes**

```cpp
// ✅ CORRECT - Must set notes=true in config
LIEF::ELF::Builder::config_t config;
config.notes = true;  // CRITICAL for PT_NOTE serialization
// ... set other config flags ...
binary->write(output_path, config);

// ❌ WRONG - Default config may not serialize notes
LIEF::ELF::Builder::config_t config;  // defaults may vary
binary->write(output_path, config);
```

---

### PE API Patterns (Stable Since v0.14.0)

**ResourcesManager::TYPE Constants**

```cpp
// ✅ CORRECT - Use LIEF's enum, not Windows macros
const uint32_t LIEF_RT_RCDATA =
    static_cast<uint32_t>(LIEF::PE::ResourcesManager::TYPE::RCDATA);

// ❌ WRONG - Don't use Windows SDK macros (conflict risk)
#ifdef _WIN32
const uint32_t RT_RCDATA = 10;  // Windows macro, but fragile
#endif
```

**Builder Config Structure**

```cpp
// ✅ CORRECT - Explicit config for PE binaries
LIEF::PE::Builder::config_t config;
config.resources = true;   // Rebuild resources (if modified)
config.imports = false;    // Don't modify import table
config.exports = false;    // Don't modify export table
config.tls = false;        // Don't modify TLS
config.relocations = false;// Don't modify relocations
binary->write(output_path, config);
```

---

### Parser API Patterns (All Versions)

**Return Types**

```cpp
// Mach-O - Returns unique_ptr<FatBinary>
std::unique_ptr<LIEF::MachO::FatBinary> fat =
    LIEF::MachO::Parser::parse(path);
if (!fat || fat->size() == 0) { /* error */ }
LIEF::MachO::Binary* binary = fat->at(0);
if (!binary) { /* error */ }

// ELF - Returns unique_ptr<Binary>
std::unique_ptr<LIEF::ELF::Binary> binary =
    LIEF::ELF::Parser::parse(path);
if (!binary) { /* error */ }

// PE - Returns unique_ptr<Binary>
std::unique_ptr<LIEF::PE::Binary> binary =
    LIEF::PE::Parser::parse(path);
if (!binary) { /* error */ }
```

**Always Check for NULL**

```cpp
// ✅ CORRECT - Check every pointer
auto fat = LIEF::MachO::Parser::parse(path);
if (!fat) {
    fprintf(stderr, "Failed to parse Mach-O\n");
    return -1;
}

if (fat->size() == 0) {
    fprintf(stderr, "Empty fat binary\n");
    return -1;
}

LIEF::MachO::Binary* binary = fat->at(0);
if (!binary) {
    fprintf(stderr, "Failed to get binary at index 0\n");
    return -1;
}
```

---

## Edge Cases

### Already on Target Version

**Scenario:** LIEF update runs but already at target version.

**Detection:**
```bash
cd packages/bin-infra/upstream/lief
CURRENT_TAG=$(git describe --tags 2>/dev/null)
TARGET_VERSION="v0.18.0"

if [ "$CURRENT_TAG" = "$TARGET_VERSION" ]; then
  echo "Already on target: $TARGET_VERSION"
  exit 0
fi
```

**Outcome:** Exit successfully with message "LIEF already at v0.18.0" - no commits created.

---

### Pre-Release Version Specified

**Scenario:** User requests update to pre-release (v0.18.0-rc.1, v0.19.0-alpha.1).

**Prevention:**
```bash
if echo "$TARGET_VERSION" | grep -qE '-(rc|alpha|beta)'; then
  echo "ERROR: Pre-release versions not supported"
  echo "Target: $TARGET_VERSION"
  echo "Please specify stable release (e.g., v0.18.0)"
  exit 1
fi
```

**Why Critical:** Pre-release versions are unstable and may have incomplete API documentation. Production builds require stable releases.

---

### Major Version Upgrade

**Scenario:** Upgrading across major versions (v0.17.x → v1.0.x or v1.x → v2.x).

**Higher Risk:**
- Major API breaking changes likely
- More comprehensive audit needed
- Extensive testing required

**Additional Validation:**
```bash
OLD_MAJOR=$(echo "$CURRENT_TAG" | sed 's/v\([0-9]*\)\..*/\1/')
NEW_MAJOR=$(echo "$TARGET_VERSION" | sed 's/v\([0-9]*\)\..*/\1/')

if [ "$NEW_MAJOR" -gt "$OLD_MAJOR" ]; then
  echo "⚠️  WARNING: Major version upgrade detected"
  echo "   $CURRENT_TAG → $TARGET_VERSION"
  echo ""
  echo "   Major version upgrades may include:"
  echo "   - Significant API redesigns"
  echo "   - Removed or renamed methods"
  echo "   - Changed behavior across all platforms"
  echo ""
  echo "   Review LIEF release notes:"
  echo "   https://github.com/lief-project/LIEF/releases/tag/$TARGET_VERSION"
  echo ""
  read -p "Continue with major version upgrade? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborting LIEF update"
    exit 1
  fi
fi
```

---

### API Audit Finds Many Issues

**Scenario:** Audit finds 10+ API compatibility issues across multiple files.

**Handling:**
- Don't panic - this is expected for major updates
- Create checklist of all issues
- Fix systematically, one pattern at a time
- Re-run audit after each batch of fixes
- Validate build frequently during fixing

**Workflow:**
```bash
# Fix all Header::magic() issues first
for file in $(grep -l "uint32_t magic.*header().magic()" -r packages/*/src); do
  echo "Fixing: $file"
  # Apply Edit tool
done

# Re-audit after fixes
grep -r "uint32_t magic.*header().magic()" packages/*/src || echo "✅ Fixed"

# Fix all MACHO_TYPES constants second
# ... repeat for each issue pattern
```

---

### Partial Commit State

**Scenario:** First commit (version update) succeeded but API fixes failed.

**State:**
- ✓ Commit 1: LIEF version updated
- ✗ Commit 2: API fixes incomplete

**Recovery:**

**Option 1: Complete the Fixes**
```bash
# Continue fixing issues
# Use Edit tool for remaining files

# Re-validate
cd packages/binject && pnpm run build && pnpm test
cd ../binpress && pnpm run build && pnpm test
cd ../bin-infra && pnpm run build && pnpm test
cd ../..

# Complete Step 9 (commit)
git add packages/*/src
git commit -m "fix(lief): update API usage for LIEF vX.Y.Z"
```

**Option 2: Rollback**
```bash
# Remove version update commit
git reset --hard HEAD~1

# LIEF submodule reverted
```

---

### Network Failure During Fetch

**Scenario:** `git fetch origin --tags` fails in LIEF submodule.

**Retry Logic:**
```bash
cd packages/bin-infra/upstream/lief

MAX_RETRIES=3
for i in $(seq 1 $MAX_RETRIES); do
  echo "Attempt $i/$MAX_RETRIES: Fetching LIEF tags..."
  if git fetch origin --tags; then
    echo "✓ Tags fetched successfully"
    break
  fi
  if [ $i -eq $MAX_RETRIES ]; then
    echo "✗ ERROR: Failed to fetch after $MAX_RETRIES attempts"
    exit 1
  fi
  echo "Retry in 5 seconds..."
  sleep 5
done
```

---

## Rollback Procedures

### Rollback After Partial Success (1 Commit)

**Current State:**
```bash
git log -1 --oneline
# abc123d chore(lief): update LIEF from v0.17.0 to v0.18.0
```

**Rollback:**
```bash
git reset --hard HEAD~1

# Verify
cd packages/bin-infra/upstream/lief
git describe --tags  # Should show old version
cd ../../..
```

---

### Rollback After Full Success (2 Commits)

**Current State:**
```bash
git log -2 --oneline
# def456e fix(lief): update API usage for LIEF v0.18.0
# abc123d chore(lief): update LIEF from v0.17.0 to v0.18.0
```

**Rollback:**
```bash
git reset --hard HEAD~2

# Verify
cd packages/bin-infra/upstream/lief
git describe --tags  # Should show old version
cd ../../..
pnpm run build  # Should build with old LIEF
```

---

### Rollback After Push

**⚠️ WARNING:** Rewrites history. Coordinate with team.

**Safe Option (Revert):**
```bash
# Revert in reverse order
git revert HEAD      # Revert API fixes
git revert HEAD~1    # Revert version update
git push origin main  # Safe, no force needed
```

**Destructive Option (Force Push):**
```bash
git reset --hard HEAD~2
git push --force origin main  # DESTRUCTIVE
```

---

## API Audit Methodology

### Comprehensive File Discovery

**Search Strategy:**
```bash
# Find ALL C++ files in relevant packages
find packages/{binject,binpress,bin-infra}/src \
  -type f \( -name "*.cpp" -o -name "*.hpp" -o -name "*.h" -o -name "*.cc" \) \
  -exec grep -l "LIEF::" {} \;

# Alternative: Use ripgrep for speed
rg -l "LIEF::" packages/{binject,binpress,bin-infra}/src

# Count files found
FILES=$(find ... | wc -l)
echo "Found $FILES files using LIEF"
```

**Verification:**
- Manually spot-check a few files to confirm LIEF usage
- Cross-reference with known LIEF-using files (macho_inject_lief.cpp, elf_inject_lief.cpp, etc.)

---

### API Pattern Extraction

**For Each File:**
```bash
file="packages/binject/src/socketsecurity/binject/macho_inject_lief.cpp"

# Extract all lines with LIEF namespace usage
grep -n "LIEF::" "$file"

# Extract method calls specifically
grep -n "->.*(" "$file" | grep "LIEF::"

# Extract type declarations
grep -n "LIEF::[^:]*::[^:]*\s" "$file"
```

**Analysis Focus:**
1. Return types of LIEF methods
2. Parameter types passed to LIEF methods
3. Enum constant names
4. Pointer types (raw vs unique_ptr)
5. Builder config structures

---

### Anti-Pattern Detection

**Known v0.17.0 Patterns:**

```bash
# 1. Wrong magic() type
grep -rn "uint32_t magic.*header().magic()" packages/*/src

# 2. Old MH_* constants
grep -rn "MACHO_TYPES::MH_" packages/*/src

# 3. Wrong add() return type
grep -rn "SegmentCommand\* .*= .*->add(" packages/*/src

# 4. Missing section_name in Note::create
grep -rn "Note::create" packages/*/src | grep -v "section_name"
```

**For Each Match:**
- Record file path and line number
- Extract surrounding context (5 lines before/after)
- Add to audit report with severity (CRITICAL/HIGH/MEDIUM/LOW)

---

### Audit Report Structure

```markdown
# LIEF API Compatibility Audit Report
Date: 2026-02-07
Target Version: v0.18.0
Previous Version: v0.17.0

## Executive Summary
Files audited: 20
Issues found: 5
Severity breakdown:
- CRITICAL: 2
- HIGH: 2
- MEDIUM: 1
- LOW: 0

## Files Audited
[List of all files]

## Issues Found

### CRITICAL-001: Header::magic() Type Mismatch
**File:** packages/binpress/src/.../macho_compress_segment.cpp:192
**Current Code:**
```cpp
uint32_t magic = binary->header().magic();
```
**Issue:** Returns MACHO_TYPES enum in v0.18.0, not uint32_t
**Fix:**
```cpp
LIEF::MachO::MACHO_TYPES magic = binary->header().magic();
```

[Repeat for each issue]

## Anti-Pattern Detection Results
- ✅ No uint32_t magic issues (after fixes)
- ✅ No MH_* constant issues (after fixes)
- ✅ No SegmentCommand* issues (after fixes)

## Recommendations
[Any additional concerns or suggestions]
```

---

## Common API Issues

### Issue: Compilation Error "cannot convert MACHO_TYPES to uint32_t"

**Symptom:**
```
error: cannot convert 'LIEF::MachO::MACHO_TYPES' to 'uint32_t' in initialization
uint32_t magic = binary->header().magic();
```

**Root Cause:** LIEF v0.17.0+ changed `Header::magic()` return type from `uint32_t` to `MACHO_TYPES` enum.

**Fix:**
```cpp
// Change variable type
LIEF::MachO::MACHO_TYPES magic = binary->header().magic();

// When printing, cast to uint32_t
fprintf(stderr, "Magic: 0x%x\n", static_cast<uint32_t>(magic));
```

**Files Affected (socket-btm):**
- `packages/binject/src/socketsecurity/binject/macho_inject_lief.cpp:267`
- `packages/binpress/src/socketsecurity/binpress/macho_compress_segment.cpp:192`

---

### Issue: Compilation Error "MH_MAGIC_64 is not a member of MACHO_TYPES"

**Symptom:**
```
error: 'MH_MAGIC_64' is not a member of 'LIEF::MachO::MACHO_TYPES'; did you mean 'MAGIC_64'?
if (magic != LIEF::MachO::MACHO_TYPES::MH_MAGIC_64) {
```

**Root Cause:** LIEF v0.17.0+ removed `MH_` prefix from `MACHO_TYPES` enum constants.

**Fix:**
```cpp
// Remove MH_ prefix from all constants
MACHO_TYPES::MAGIC_64   // was MH_MAGIC_64
MACHO_TYPES::CIGAM_64   // was MH_CIGAM_64
MACHO_TYPES::MAGIC      // was MH_MAGIC
MACHO_TYPES::CIGAM      // was MH_CIGAM
```

**Files Affected (socket-btm):**
- `packages/binject/src/socketsecurity/binject/macho_inject_lief.cpp:268-271`
- `packages/binpress/src/socketsecurity/binpress/macho_compress_segment.cpp:193-196`

---

### Issue: Compilation Error "invalid conversion from LoadCommand* to SegmentCommand*"

**Symptom:**
```
error: invalid conversion from 'LIEF::MachO::LoadCommand*' to 'LIEF::MachO::SegmentCommand*'
LIEF::MachO::SegmentCommand* seg = binary->add(segment);
```

**Root Cause:** LIEF v0.17.0+ changed `Binary::add()` return type to base class `LoadCommand*`.

**Fix:**
```cpp
// Change to LoadCommand* (usually sufficient)
LIEF::MachO::LoadCommand* cmd = binary->add(segment);

// Or cast explicitly if SegmentCommand* needed
auto* seg = dynamic_cast<LIEF::MachO::SegmentCommand*>(
    binary->add(segment)
);
```

**Files Affected (socket-btm):**
- `packages/binject/src/socketsecurity/binject/macho_inject_lief.cpp:311, 836`
- `packages/binpress/src/socketsecurity/binpress/macho_compress_segment.cpp:270, 374`
- `packages/bin-infra/src/socketsecurity/bin-infra/stub_smol_repack_lief.cpp:86`

---

### Issue: ELF Note Not Serialized to Output Binary

**Symptom:**
- Binary builds successfully
- Tests pass
- But note section missing in output binary
- Runtime fails to find note data

**Root Cause:** `Note::create()` called without `section_name` parameter (LIEF bug #1026).

**Fix:**
```cpp
// Always provide section_name parameter
auto note = LIEF::ELF::Note::create(
    "NODE_SEA_BLOB",
    uint32_t(0),
    data_vector,
    ".note.NODE_SEA_BLOB",  // CRITICAL - must specify
    LIEF::ELF::Header::FILE_TYPE::NONE,
    LIEF::ELF::ARCH::NONE,
    LIEF::ELF::Header::CLASS::NONE
);

// Also ensure builder config has notes=true
LIEF::ELF::Builder::config_t config;
config.notes = true;  // CRITICAL
binary->write(output_path, config);
```

**Files Affected (socket-btm):**
- `packages/bin-infra/src/socketsecurity/bin-infra/elf_note_utils.hpp:662-672`
- All ELF injection code

---

## Build and Test Failures

### Build Failure: Missing LIEF Symbols

**Symptom:**
```
undefined reference to `LIEF::MachO::Binary::add(LIEF::MachO::SegmentCommand const&)'
```

**Possible Causes:**
1. LIEF not properly built/installed
2. Linker flags missing `-lLIEF`
3. LIEF ABI incompatibility

**Diagnosis:**
```bash
# Check LIEF build
cd packages/bin-infra/upstream/lief
ls -la build/libLIEF.*

# Check linker flags in gyp files
grep -r "LIEF" packages/*/binding.gyp
grep -r "lLIEF" packages/*/binding.gyp
```

**Fix:**
```bash
# Rebuild LIEF
cd packages/bin-infra
pnpm run clean
pnpm run build
```

---

### Test Failure: Binary Format Invalid

**Symptom:**
```
Error: Invalid Mach-O magic number
Test: should inject into darwin-arm64 binary
```

**Possible Causes:**
1. LIEF wrote corrupted binary
2. API changes caused incorrect segment layout
3. Builder config incomplete

**Diagnosis:**
```bash
# Check output binary with file
file output/binary.macho

# Check with otool (macOS)
otool -h output/binary.macho

# Compare with reference binary
diff <(otool -l reference.macho) <(otool -l output.macho)
```

**Fix:**
- Review LIEF API usage in write operations
- Check Builder config has all required flags
- Verify segment/section construction correct

---

### Test Failure: Unexpected LIEF Behavior Change

**Symptom:**
```
Expected section size: 1024
Actual section size: 1056
```

**Possible Cause:** LIEF changed alignment or padding behavior between versions.

**Fix:**
- Update test expectations to match new behavior
- Verify new behavior is acceptable (not a regression)
- Consult LIEF changelog for intentional changes

---

## Cross-Platform Considerations

### macOS vs Linux vs Windows

**LIEF Submodule:**
- ✅ Same submodule works on all platforms
- ✅ Same git operations

**LIEF Build:**
- ⚠️ macOS: Builds with clang (may catch different warnings)
- ⚠️ Linux: Builds with gcc (stricter in some areas)
- ⚠️ Windows: Builds with MSVC (different ABI)

**API Usage:**
- ✅ Core API identical across platforms
- ⚠️ Some platform-specific features (e.g., Mach-O only on macOS testing)

**Recommendation:** Validate build on primary platform (macOS for socket-btm), then rely on CI for full cross-platform validation.

---

## Advanced Topics

### Selective API Audit

**Scenario:** Only audit specific API patterns (e.g., just Mach-O).

**Script:**
```bash
# Audit only Mach-O APIs
grep -rn "LIEF::MachO::" packages/*/src

# Audit only ELF APIs
grep -rn "LIEF::ELF::" packages/*/src

# Audit only PE APIs
grep -rn "LIEF::PE::" packages/*/src
```

**Use Case:** Minor version updates where only one format changed.

---

### Automated LIEF Updates

**GitHub Actions Example:**
```yaml
name: Monthly LIEF Update Check

on:
  schedule:
    - cron: '0 9 1 * *'  # First day of month
  workflow_dispatch:

jobs:
  check-lief-update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
        with:
          submodules: recursive

      - name: Check for LIEF updates
        run: |
          cd packages/bin-infra/upstream/lief
          git fetch origin --tags
          LATEST=$(git tag -l 'v*.*.*' --sort=-version:refname | head -1)
          CURRENT=$(git describe --tags)

          if [ "$LATEST" != "$CURRENT" ]; then
            echo "LIEF update available: $CURRENT → $LATEST"
            echo "has_update=true" >> $GITHUB_OUTPUT
            echo "latest_version=$LATEST" >> $GITHUB_OUTPUT
          fi

      - name: Create issue
        if: steps.check.outputs.has_update
        uses: actions/github-script@v6
        with:
          script: |
            github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.name,
              title: 'LIEF update available: ${{ steps.check.outputs.latest_version }}',
              body: 'Use `/updating-lief ${{ steps.check.outputs.latest_version }}` skill to update.'
            })
```

---

### LIEF API Documentation References

**Official Documentation:**
- Main docs: https://lief.re/doc/stable/index.html
- API reference: https://lief.re/doc/stable/api/index.html
- Release notes: https://github.com/lief-project/LIEF/releases

**Mach-O APIs:**
- https://lief.re/doc/stable/api/cpp/macho.html
- Header class: https://lief.re/doc/stable/api/cpp/macho/header.html
- Binary class: https://lief.re/doc/stable/api/cpp/macho/binary.html

**ELF APIs:**
- https://lief.re/doc/stable/api/cpp/elf.html
- Note class: https://lief.re/doc/stable/api/cpp/elf/note.html

**PE APIs:**
- https://lief.re/doc/stable/api/cpp/pe.html

---

### Troubleshooting Checklist

When LIEF update fails, check:

- [ ] Working directory clean before update?
- [ ] Target version is stable release (not -rc/-alpha)?
- [ ] Submodule fetched tags successfully?
- [ ] Target version exists in LIEF repository?
- [ ] API audit found all LIEF-using files?
- [ ] All API issues fixed (zero remaining)?
- [ ] Build passes with new LIEF?
- [ ] Tests pass with new LIEF?
- [ ] .gitmodules updated with new version?
- [ ] Commits created with audit report?

Run through checklist systematically to identify root cause.

---

## Monitoring and Metrics

### Success Metrics to Track

**Per Update:**
- Version change (old → new)
- Files audited: X files
- Issues found: Y issues
- Issues fixed: Y issues
- Build status: PASS/FAIL
- Test status: PASS/FAIL
- Commit SHAs
- Duration

**Over Time:**
- Update frequency
- Success rate
- Issues per update (trend)
- Manual intervention rate
- Time to update (trend)

---

### Alerting on Failures

**When to Alert:**
1. API audit finds >10 issues (significant compatibility break)
2. Build fails after API fixes (incomplete fixes or new issues)
3. Tests fail after update (behavior regressions)
4. Update takes >60 minutes (complexity indicator)

**Alert Content:**
- LIEF version attempted (old → new)
- Failure step (audit/fix/build/test)
- Issue count and severity
- Error logs
- Rollback instructions

---

# Agent Prompt Template

This section contains the autonomous agent prompt template used by the updating-lief skill. The skill executor loads this template and passes it to the Task tool to spawn the LIEF update agent.

**Usage:** In SKILL.md Phase 3, load this template and pass to `Task({ subagent_type: "general-purpose", prompt: <template> })`

**Template:**

```
  prompt: `Update LIEF library to version [TARGET_VERSION], perform comprehensive API compatibility audit, fix all issues found, validate build/tests, commit with detailed audit report.

<task>
Your task is to update the LIEF submodule to version [TARGET_VERSION], perform a comprehensive audit of ALL LIEF API usage across the codebase for compatibility with the new version, fix all API issues found, validate build and tests pass, and create commits with detailed changelogs including the API audit report.
</task>

<context>
**Project Context:**
You are working on socket-btm (Socket Security's binary tooling manager) which uses the LIEF library for cross-platform binary manipulation (Mach-O, ELF, PE formats). LIEF is tracked via a git submodule.

**LIEF Submodule:**
- Location: \`packages/bin-infra/upstream/lief\`
- Current Version: v0.17.0 (commit 038b60671f12dbd86bf84d9f8a38395bd2a8176e)
- Repository: https://github.com/lief-project/LIEF.git
- Version pinned in: \`.gitmodules\`

**Why Update LIEF:**
- Access new features and improvements
- Fix bugs in binary parsing/manipulation
- Security patches
- Performance optimizations

**Workflow Overview:**
1. Fetch target LIEF tag from submodule
2. Update submodule to target version
3. Update .gitmodules with new version info
4. Commit version change
5. **COMPREHENSIVE API AUDIT** (CRITICAL STEP)
6. Fix all API compatibility issues found
7. Validate build and tests pass
8. Commit API fixes with audit report
9. Report metrics and changes

**Critical Success Factors:**
- Only stable tags (vX.Y.Z, no -rc or -alpha)
- 100% API usage audited and verified
- All compatibility issues fixed
- Build succeeds without errors
- Tests pass (100%)
- Commits include detailed audit results
</context>

<constraints>
**CRITICAL Requirements:**
- MUST use stable release tag only (vX.Y.Z format)
- MUST audit ALL files using LIEF APIs (exhaustive search)
- MUST fix ALL API compatibility issues before committing
- MUST validate build succeeds before committing
- MUST validate tests pass (100%)
- MUST include API audit report in commit message

**Failure Modes to Prevent:**
- Updating to unstable pre-release version
- Skipping API audit (LIEF has breaking changes frequently)
- Partial API audit (missing files with LIEF usage)
- Committing with unfixed API issues (breaks build)
- Insufficient validation (untested changes)
</constraints>

<instructions>

## Critical Workflow (9 Steps)

Execute these steps sequentially. Each step must succeed before proceeding.

### Step 1: Validate Environment

<action>
Verify starting state is clean:
</action>

\`\`\`bash
git status
\`\`\`

<validation>
**Expected Output:**
\`\`\`
On branch main
nothing to commit, working tree clean
\`\`\`

**If working directory NOT clean:**
- Stop immediately
- Report uncommitted changes to user
- Ask user to commit or stash changes first

Do NOT proceed if git status shows uncommitted changes.
</validation>

---

### Step 2: Fetch Target LIEF Version

<action>
Fetch all tags from LIEF repository and verify target version exists:
</action>

\`\`\`bash
cd packages/bin-infra/upstream/lief
git fetch origin --tags

# Capture current version for comparison
CURRENT_TAG=\$(git describe --tags 2>/dev/null || echo "unknown")
CURRENT_COMMIT=\$(git rev-parse HEAD)
echo "Current LIEF version: \$CURRENT_TAG (\$CURRENT_COMMIT)"

# Verify target version exists
TARGET_VERSION="[TARGET_VERSION]"
if ! git tag -l | grep -q "^\${TARGET_VERSION}\$"; then
  echo "ERROR: Target version \$TARGET_VERSION not found in LIEF repository"
  echo "Available versions:"
  git tag -l 'v*.*.*' --sort=-version:refname | head -10
  exit 1
fi

echo "Target LIEF version: \$TARGET_VERSION"
TARGET_COMMIT=\$(git rev-list -n 1 "\$TARGET_VERSION")
echo "Target commit: \$TARGET_COMMIT"

cd ../../..
\`\`\`

<validation>
**Chain-of-Thought Validation:**

Use `<thinking>` tags to show your reasoning process:

<thinking>
1. Does TARGET_VERSION exist in LIEF repository?
   - Check: git tag -l | grep $TARGET_VERSION
   - Found: [yes/no]
   - Result: [PASS/FAIL]

2. Does TARGET_VERSION match format vX.Y.Z (semantic version)?
   - Pattern: ^v[0-9]+\.[0-9]+\.[0-9]+$
   - Match: [yes/no]
   - Result: [PASS/FAIL]

3. Is TARGET_VERSION different from CURRENT_TAG?
   - Current: $CURRENT_TAG
   - Target: $TARGET_VERSION
   - Different: [yes/no]
   - Result: [PASS/FAIL - proceed/exit]

4. Does TARGET_VERSION NOT contain "-rc", "-alpha", "-beta" (pre-release)?
   - Check: echo $TARGET_VERSION | grep -E '(rc|alpha|beta)'
   - Is stable: [yes/no]
   - Result: [PASS/FAIL]

Overall validation: [PASS/FAIL]
Decision: [PROCEED to Step 3 / EXIT with message]
</thinking>

**Expected Output:**
\`\`\`
Current LIEF version: v0.17.0 (038b606...)
Target LIEF version: v0.18.0
Target commit: abc123...
\`\`\`

**If TARGET_VERSION not found:**
- List available versions
- Report error and exit

**If TARGET_VERSION == CURRENT_TAG:**
- Already on target version
- Report to user: "LIEF already at \$TARGET_VERSION"
- Exit successfully (no update needed)

**If TARGET_VERSION is pre-release:**
- Report error: "Pre-release versions not supported for stability"
- Exit and ask user to specify stable release

Do NOT proceed if version validation fails.
</validation>

---

### Step 3: Update LIEF Submodule

<action>
Checkout target LIEF version and capture metadata:
</action>

\`\`\`bash
cd packages/bin-infra/upstream/lief
git checkout "\$TARGET_VERSION"
NEW_COMMIT=\$(git rev-parse HEAD)
NEW_VERSION="\${TARGET_VERSION}"

echo "Updated LIEF to \$NEW_VERSION (\$NEW_COMMIT)"
cd ../../..
\`\`\`

<validation>
Verify submodule updated:
\`\`\`bash
cd packages/bin-infra/upstream/lief
git describe --tags  # Should output TARGET_VERSION
cd ../../..
\`\`\`

**Expected Output:**
\`\`\`
Updated LIEF to v0.18.0 (abc123...)
v0.18.0
\`\`\`
</validation>

---

### Step 4: Update .gitmodules

<action>
Update .gitmodules with new LIEF version and commit SHA:
</action>

\`\`\`bash
# Update .gitmodules comment with new version
sed -i.bak "s|# v[0-9]*\\.[0-9]*\\.[0-9]*|# \$NEW_VERSION|" .gitmodules
sed -i.bak "s|ref = [a-f0-9]*|ref = \$NEW_COMMIT|" .gitmodules
rm .gitmodules.bak

# Verify update
grep -A 3 "submodule.*lief" .gitmodules

# Stage changes
git add .gitmodules packages/bin-infra/upstream/lief

# Create first commit (version update)
git commit -m "chore(lief): update LIEF from \$CURRENT_TAG to \$NEW_VERSION

Update LIEF submodule to \$NEW_VERSION

Updated:
- .gitmodules: \$CURRENT_TAG → \$NEW_VERSION
- packages/bin-infra/upstream/lief → \$NEW_VERSION (\$NEW_COMMIT)

API compatibility audit will be performed in next commit."
\`\`\`

<validation>
Verify commit created:
\`\`\`bash
git log -1 --oneline
git show --stat HEAD
\`\`\`

**Expected Output:**
\`\`\`
chore(lief): update LIEF from v0.17.0 to v0.18.0
\`\`\`

**Report to user:**
✓ Commit 1/N: LIEF version updated to \$NEW_VERSION
</validation>

---

### Step 5: Comprehensive LIEF API Audit (CRITICAL)

<action>
Perform exhaustive search for ALL LIEF API usage and audit compatibility:
</action>

\`\`\`bash
echo "Starting comprehensive LIEF API compatibility audit..."
echo "Target: LIEF \$NEW_VERSION"
echo ""

# Find ALL files using LIEF
echo "Step 1: Finding all files using LIEF APIs..."
FILES_WITH_LIEF=\$(find packages/{binject,binpress,bin-infra}/src -type f \\( -name "*.cpp" -o -name "*.hpp" -o -name "*.h" -o -name "*.cc" \\) -exec grep -l "LIEF::" {} \\; 2>/dev/null)

FILE_COUNT=\$(echo "\$FILES_WITH_LIEF" | wc -l | tr -d ' ')
echo "Found \$FILE_COUNT files using LIEF APIs"
echo ""

# Create audit report
AUDIT_REPORT="/tmp/lief-api-audit-report.txt"
cat > "\$AUDIT_REPORT" << 'AUDIT_HEADER'
# LIEF API Compatibility Audit Report
Date: \$(date +%Y-%m-%d)
Target Version: \$NEW_VERSION
Previous Version: \$CURRENT_TAG

## Files Audited

AUDIT_HEADER

echo "\$FILES_WITH_LIEF" >> "\$AUDIT_REPORT"

echo "" >> "\$AUDIT_REPORT"
echo "## API Patterns to Verify" >> "\$AUDIT_REPORT"
echo "" >> "\$AUDIT_REPORT"
echo "### Mach-O APIs" >> "\$AUDIT_REPORT"
echo "- [ ] Header::magic() return type (MACHO_TYPES enum in v0.17+)" >> "\$AUDIT_REPORT"
echo "- [ ] MACHO_TYPES constants (MAGIC_64 not MH_MAGIC_64 in v0.17+)" >> "\$AUDIT_REPORT"
echo "- [ ] Binary::add() return type (LoadCommand* in v0.17+)" >> "\$AUDIT_REPORT"
echo "- [ ] SegmentCommand construction and usage" >> "\$AUDIT_REPORT"
echo "- [ ] Builder::write() config_t usage" >> "\$AUDIT_REPORT"
echo "" >> "\$AUDIT_REPORT"
echo "### ELF APIs" >> "\$AUDIT_REPORT"
echo "- [ ] Note::create() factory method with section_name" >> "\$AUDIT_REPORT"
echo "- [ ] Binary::add() for notes (dereference unique_ptr)" >> "\$AUDIT_REPORT"
echo "- [ ] Builder config notes flag" >> "\$AUDIT_REPORT"
echo "" >> "\$AUDIT_REPORT"
echo "### PE APIs" >> "\$AUDIT_REPORT"
echo "- [ ] Binary::add_section() usage" >> "\$AUDIT_REPORT"
echo "- [ ] ResourcesManager::TYPE constants" >> "\$AUDIT_REPORT"
echo "- [ ] Builder config structure" >> "\$AUDIT_REPORT"
echo "" >> "\$AUDIT_REPORT"
echo "### Parser APIs (All Formats)" >> "\$AUDIT_REPAIR"
echo "- [ ] Parser::parse() return types (unique_ptr)" >> "\$AUDIT_REPORT"
echo "- [ ] NULL checks after parse" >> "\$AUDIT_REPORT"
echo "" >> "\$AUDIT_REPORT"

echo "Step 2: Detailed API analysis..."
echo "## Detailed API Analysis" >> "\$AUDIT_REPORT"
echo "" >> "\$AUDIT_REPORT"

# For each file, extract and analyze LIEF API usage
for file in \$FILES_WITH_LIEF; do
  echo "Analyzing: \$file"
  echo "### \$file" >> "\$AUDIT_REPORT"
  echo "\`\`\`" >> "\$AUDIT_REPORT"

  # Extract lines with LIEF:: usage (with line numbers)
  grep -n "LIEF::" "\$file" | head -50 >> "\$AUDIT_REPORT"

  echo "\`\`\`" >> "\$AUDIT_REPORT"
  echo "" >> "\$AUDIT_REPORT"
done

echo "" >> "\$AUDIT_REPORT"
echo "## Known API Changes" >> "\$AUDIT_REPORT"
echo "" >> "\$AUDIT_REPORT"
echo "### v0.17.0 Breaking Changes" >> "\$AUDIT_REPORT"
echo "1. Header::magic() now returns MACHO_TYPES enum (was uint32_t)" >> "\$AUDIT_REPORT"
echo "2. MACHO_TYPES constants renamed: MAGIC_64 (was MH_MAGIC_64)" >> "\$AUDIT_REPORT"
echo "3. Binary::add() returns LoadCommand* (was SegmentCommand*)" >> "\$AUDIT_REPORT"
echo "" >> "\$AUDIT_REPORT"

# Check for known problematic patterns
echo "Step 3: Checking for known anti-patterns..."
echo "## Anti-Pattern Detection" >> "\$AUDIT_REPORT"
echo "" >> "\$AUDIT_REPORT"

ISSUES_FOUND=0

# Check for uint32_t magic usage (should be MACHO_TYPES)
if grep -r "uint32_t magic.*header().magic()" packages/{binject,binpress,bin-infra}/src 2>/dev/null; then
  echo "❌ ISSUE: Found uint32_t magic = header().magic() (should be MACHO_TYPES)" >> "\$AUDIT_REPORT"
  ISSUES_FOUND=\$((ISSUES_FOUND + 1))
else
  echo "✅ PASS: No uint32_t magic issues" >> "\$AUDIT_REPORT"
fi

# Check for MH_* constants (should be without MH_ prefix)
if grep -r "MACHO_TYPES::MH_" packages/{binject,binpress,bin-infra}/src 2>/dev/null; then
  echo "❌ ISSUE: Found MACHO_TYPES::MH_* constants (should be MAGIC_64/CIGAM_64/etc)" >> "\$AUDIT_REPORT"
  ISSUES_FOUND=\$((ISSUES_FOUND + 1))
else
  echo "✅ PASS: No MH_* constant issues" >> "\$AUDIT_REPORT"
fi

# Check for SegmentCommand* return type from add()
if grep -r "SegmentCommand\\* .*= .*->add(" packages/{binject,binpress,bin-infra}/src 2>/dev/null; then
  echo "❌ ISSUE: Found SegmentCommand* = binary->add() (should be LoadCommand*)" >> "\$AUDIT_REPORT"
  ISSUES_FOUND=\$((ISSUES_FOUND + 1))
else
  echo "✅ PASS: No SegmentCommand* return type issues" >> "\$AUDIT_REPORT"
fi

echo "" >> "\$AUDIT_REPORT"
echo "## Summary" >> "\$AUDIT_REPORT"
echo "" >> "\$AUDIT_REPORT"
echo "Files audited: \$FILE_COUNT" >> "\$AUDIT_REPORT"
echo "Issues found: \$ISSUES_FOUND" >> "\$AUDIT_REPORT"
echo "" >> "\$AUDIT_REPORT"

if [ \$ISSUES_FOUND -eq 0 ]; then
  echo "✅ **AUDIT PASSED**: All LIEF API usage compatible with \$NEW_VERSION" >> "\$AUDIT_REPORT"
  echo ""
  echo "✅ API Audit Complete: No issues found"
else
  echo "❌ **AUDIT FAILED**: \$ISSUES_FOUND compatibility issues found" >> "\$AUDIT_REPORT"
  echo "**Action Required**: Fix all issues before proceeding to Step 6" >> "\$AUDIT_REPORT"
  echo ""
  echo "❌ API Audit Complete: \$ISSUES_FOUND issues found"
fi

# Display audit report
cat "\$AUDIT_REPORT"
\`\`\`

<validation>
**Chain-of-Thought Validation:**

Use `<thinking>` tags to show your reasoning:

<thinking>
1. Were ALL files using LIEF found and analyzed?
   - Search performed: find + grep for "LIEF::"
   - Files found: $FILE_COUNT
   - Directories searched: packages/{binject,binpress,bin-infra}/src
   - Confidence: [HIGH/MEDIUM/LOW]
   - Result: [PASS/FAIL]

2. Are there any anti-pattern issues detected?
   - uint32_t magic issues: [yes/no]
   - MH_* constant issues: [yes/no]
   - SegmentCommand* return type issues: [yes/no]
   - Total issues: $ISSUES_FOUND
   - Result: [PASS/FAIL]

3. Does audit report show 0 issues?
   - Issues found: $ISSUES_FOUND
   - Result: [PASS/FAIL]

Overall API audit: [PASSED/FAILED - issues: $ISSUES_FOUND]
Decision: [PROCEED to Step 7 / PROCEED to Step 6 to fix issues]
</thinking>

**If ISSUES_FOUND > 0:**
- Proceed to Step 6 (Fix API Issues)
- Do NOT skip Step 6

**If ISSUES_FOUND = 0:**
- Audit passed, proceed to Step 7 (Validation)

**Report to user:**
- Files audited: [COUNT]
- Issues found: [COUNT]
- Status: PASS/FAIL
</validation>

---

### Step 6: Fix All API Compatibility Issues

<action>
Fix all API issues identified in audit (if any):
</action>

\`\`\`bash
if [ \$ISSUES_FOUND -eq 0 ]; then
  echo "No API fixes needed, skipping to validation"
else
  echo "Fixing \$ISSUES_FOUND API compatibility issues..."

  # This step requires manual fixes based on audit report
  # Common fixes for v0.17.0:

  # 1. Fix Header::magic() return type
  #    Change: uint32_t magic = binary->header().magic();
  #    To:     LIEF::MachO::MACHO_TYPES magic = binary->header().magic();

  # 2. Fix MACHO_TYPES constants
  #    Change: MACHO_TYPES::MH_MAGIC_64
  #    To:     MACHO_TYPES::MAGIC_64

  # 3. Fix Binary::add() return type
  #    Change: SegmentCommand* seg = binary->add(...)
  #    To:     LoadCommand* seg = binary->add(...)

  # Use Edit tool for each file needing fixes
  # Example:
  # Edit({
  #   file_path: "packages/binpress/src/.../file.cpp",
  #   old_string: "uint32_t magic = binary->header().magic();",
  #   new_string: "LIEF::MachO::MACHO_TYPES magic = binary->header().magic();"
  # })

  # TODO: Apply fixes based on audit report
  # (Agent will use Edit tool for specific fixes)

  echo "All API fixes applied"
fi
\`\`\`

<validation>
After applying fixes, re-run anti-pattern checks:

\`\`\`bash
echo "Re-validating API usage after fixes..."

# Re-check all anti-patterns
REMAINING_ISSUES=0

if grep -r "uint32_t magic.*header().magic()" packages/{binject,binpress,bin-infra}/src 2>/dev/null; then
  echo "❌ Still found uint32_t magic issues"
  REMAINING_ISSUES=\$((REMAINING_ISSUES + 1))
fi

if grep -r "MACHO_TYPES::MH_" packages/{binject,binpress,bin-infra}/src 2>/dev/null; then
  echo "❌ Still found MH_* constant issues"
  REMAINING_ISSUES=\$((REMAINING_ISSUES + 1))
fi

if grep -r "SegmentCommand\\* .*= .*->add(" packages/{binject,binpress,bin-infra}/src 2>/dev/null; then
  echo "❌ Still found SegmentCommand* issues"
  REMAINING_ISSUES=\$((REMAINING_ISSUES + 1))
fi

if [ \$REMAINING_ISSUES -gt 0 ]; then
  echo "ERROR: \$REMAINING_ISSUES issues remain after fixes"
  exit 1
else
  echo "✅ All API issues resolved"
fi
\`\`\`

**Expected Outcome:**
- All anti-pattern checks pass
- Zero remaining issues

Do NOT proceed to Step 7 if any issues remain.
</validation>

---

### Step 7: Sync to Additions Directory

<action>
Sync fixed files to node-smol-builder additions directory:
</action>

\`\`\`bash
echo "Syncing files to additions directory..."

# Sync bin-infra files that have additions copies
for file in packages/bin-infra/src/socketsecurity/bin-infra/*.{c,cpp,h,hpp}; do
  if [ -f "\$file" ]; then
    basename=\$(basename "\$file")
    additions_path="packages/node-smol-builder/additions/source-patched/src/socketsecurity/bin-infra/\$basename"
    if [ -f "\$additions_path" ]; then
      echo "Syncing: \$basename"
      cp "\$file" "\$additions_path"
    fi
  fi
done

# Sync binject files that have additions copies
for file in packages/binject/src/socketsecurity/binject/*.{c,cpp,h,hpp}; do
  if [ -f "\$file" ]; then
    basename=\$(basename "\$file")
    additions_path="packages/node-smol-builder/additions/source-patched/src/socketsecurity/binject/\$basename"
    if [ -f "\$additions_path" ]; then
      echo "Syncing: \$basename"
      cp "\$file" "\$additions_path"
    fi
  fi
done

echo "✅ Files synced to additions"
\`\`\`

---

### Step 8: Validate Build and Tests

<action>
Run full validation: clean, build, and tests:
</action>

\`\`\`bash
# Test primary package (binject) first
echo "Validating binject package..."
cd packages/binject
pnpm run clean
pnpm run build || exit 1
pnpm test || exit 1
cd ../..

# Test binpress package
echo "Validating binpress package..."
cd packages/binpress
pnpm run clean
pnpm run build || exit 1
pnpm test || exit 1
cd ../..

# Test bin-infra package
echo "Validating bin-infra package..."
cd packages/bin-infra
pnpm run clean
pnpm run build || exit 1
pnpm test || exit 1
cd ../..

echo "✅ All packages validated successfully"
\`\`\`

<validation>
**Expected Output:**
\`\`\`
✅ All packages validated successfully
\`\`\`

**If validation fails:**
- Review build errors (compilation issues, missing symbols)
- Review test failures (runtime API changes)
- Fix issues and re-run validation
- May indicate incomplete API fixes or new API issues

Do NOT proceed to Step 9 if validation fails.
</validation>

---

### Step 9: Final Commit with Audit Report

<action>
Create commit with API fixes and attach audit report:
</action>

\`\`\`bash
# Stage all changes (API fixes + additions sync)
git add packages/binject/src packages/binpress/src packages/bin-infra/src
git add packages/node-smol-builder/additions

# Create commit with audit report embedded
git commit -m "fix(lief): update API usage for LIEF \$NEW_VERSION compatibility

Fix all LIEF API compatibility issues for \$NEW_VERSION.

## API Audit Summary
- Files audited: \$FILE_COUNT
- Issues found: \$ISSUES_FOUND
- Issues fixed: \$ISSUES_FOUND
- Build status: PASS
- Test status: PASS

## API Changes Applied

### Mach-O API Updates
\$(grep -q "MACHO_TYPES magic" && echo "- Updated Header::magic() return type to MACHO_TYPES enum")
\$(grep -q "MAGIC_64" && echo "- Updated constants: MAGIC_64/CIGAM_64 (removed MH_ prefix)")
\$(grep -q "LoadCommand\\*" && echo "- Updated Binary::add() return type to LoadCommand*")

### Files Modified
\$(git diff --cached --name-only | grep -E '\\.cpp$|\\.hpp$|\\.h$' | sed 's/^/- /')

## Validation
- ✅ Build: SUCCESS (all packages)
- ✅ Tests: PASS (100%)
- ✅ API audit: PASSED (0 issues remaining)

Full audit report: /tmp/lief-api-audit-report.txt

This completes the LIEF update from \$CURRENT_TAG to \$NEW_VERSION."
\`\`\`

<validation>
Verify commits created:
\`\`\`bash
git log -2 --oneline
git show --stat HEAD
\`\`\`

**Expected Output:**
\`\`\`
abc123d fix(lief): update API usage for LIEF v0.18.0 compatibility
abc123c chore(lief): update LIEF from v0.17.0 to v0.18.0
\`\`\`

**Report to user:**
✓ Commit 2/2: API fixes applied and validated for \$NEW_VERSION
</validation>

---

### Step 10: Report Summary

<action>
Generate final summary report with audit metrics:
</action>

\`\`\`bash
# Get commit SHAs
COMMIT_1=\$(git rev-parse HEAD~1)
COMMIT_2=\$(git rev-parse HEAD)

# Generate summary
cat << EOF

LIEF Update Complete
====================
Updated from: \$CURRENT_TAG → \$NEW_VERSION
Upstream commit: \$NEW_COMMIT

Commits Created:
- \${COMMIT_1:0:7}: chore(lief): version update
- \${COMMIT_2:0:7}: fix(lief): API compatibility fixes

API Audit Results:
✓ Files audited: \$FILE_COUNT
✓ Issues found: \$ISSUES_FOUND
✓ Issues fixed: \$ISSUES_FOUND
✓ Issues remaining: 0

Validation:
✓ Build: SUCCESS (binject, binpress, bin-infra)
✓ Tests: PASS (100%)
✓ API audit: PASSED
✓ Total commits: 2

Audit Report:
- Full report: /tmp/lief-api-audit-report.txt
- Embedded in commit message

Next Steps:
- Review changes: git log -2 --stat
- Review audit report: cat /tmp/lief-api-audit-report.txt
- Test manually if desired
- Push to remote: git push origin main
- Monitor CI/CD for cross-platform validation

LIEF is now updated to \$NEW_VERSION with full API compatibility.
EOF
\`\`\`

</instructions>

<completion_signal>
\`\`\`xml
<promise>LIEF_UPDATE_COMPLETE</promise>
\`\`\`
</completion_signal>

<success_criteria>
- ✅ Updated from CURRENT_TAG to NEW_VERSION
- ✅ .gitmodules updated with new version
- ✅ Comprehensive API audit performed (100% coverage)
- ✅ All API issues found and fixed
- ✅ Build succeeded on all packages
- ✅ Tests passed (100%)
- ✅ Commits created with audit report
- ✅ Ready for push to remote
</success_criteria>

## Edge Cases

**Submodule not initialized:**
\`\`\`bash
git submodule update --init --recursive packages/bin-infra/upstream/lief
\`\`\`

**Target version doesn't exist:**
- Verify version format: vX.Y.Z
- List available versions: \`git tag -l 'v*' --sort=-version:refname\`
- User may have typo in version number

**API audit finds no issues:**
- Lucky! Proceed directly to validation
- Still validate build/tests thoroughly
- LIEF may be backward compatible for this update

**Build fails after update:**
- Review build errors for LIEF-related compilation issues
- May indicate API changes not caught by audit
- Expand audit to check more API patterns
- Consult LIEF changelog for breaking changes

**Tests fail after update:**
- Review test failures for LIEF-related runtime issues
- May indicate behavior changes in LIEF
- Update tests or code to match new behavior
- Consult LIEF release notes

**Rollback if needed:**
\`\`\`bash
git reset --hard HEAD~2  # Remove both commits
\`\`\`
```
