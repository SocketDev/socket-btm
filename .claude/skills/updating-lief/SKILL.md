---
name: updating-lief
description: Updates LIEF library to newer version by updating submodule, auditing all LIEF API usage for compatibility, fixing API issues, validating build and tests. Use when upgrading LIEF for features, security patches, or bug fixes.
user-invocable: true
disable-model-invocation: false
allowed-tools: Task
---

# updating-lief

<task>
Your task is to spawn an autonomous agent that updates the LIEF library submodule to a specified version, performs comprehensive LIEF API compatibility audit, fixes any API issues found, validates build and tests pass, and commits changes with detailed audit report.
</task>

<context>
**What is LIEF?**
LIEF (Library to Instrument Executable Formats) is used by socket-btm for cross-platform binary manipulation:
- Parsing and modifying Mach-O binaries (macOS)
- Parsing and modifying ELF binaries (Linux)
- Parsing and modifying PE binaries (Windows)
- Used by binject, binpress, and bin-infra packages

**socket-btm LIEF Architecture:**
- LIEF tracked via submodule: `packages/bin-infra/upstream/lief`
- Version pinned in `.gitmodules` (commit hash + semantic version comment)
- Currently using: v0.17.0 (commit 038b60671f12dbd86bf84d9f8a38395bd2a8176e)
- Used across 20 source files for binary manipulation operations

**Why Update LIEF:**
- Access new LIEF features and improvements
- Fix bugs in binary parsing/writing
- Security patches for binary format vulnerabilities
- API improvements and performance optimizations

**Critical Files:**
- `.gitmodules` - LIEF submodule configuration with version pinning
- `packages/bin-infra/upstream/lief` - Git submodule tracking lief-project/LIEF
- All C++ files using `#include <LIEF/` - API consumers requiring audit

**Success Metrics:**
- API Audit: 100% of LIEF API usage verified compatible
- Build: Must complete without errors across all platforms
- Tests: 100% pass rate
- Zero API compatibility issues remaining
</context>

<constraints>
**CRITICAL Requirements:**
- Working directory MUST be clean before starting (no uncommitted changes)
- Target version MUST be a stable LIEF release tag (vX.Y.Z format)
- COMPREHENSIVE API audit MUST be performed after update
- ALL API compatibility issues MUST be fixed before committing
- Build MUST succeed without errors on all platforms (macOS, Linux, Windows)
- Tests MUST pass (100% success rate)
- Multiple commits MAY be created (version update + API fixes)

**Do NOT:**
- Update to unstable/development commits (use tagged releases only)
- Skip API compatibility audit (LIEF API changes frequently between versions)
- Commit without validating build succeeds (compilation failures block deployment)
- Skip test validation (runtime regressions undetected)
- Assume backward compatibility (LIEF often has breaking API changes)

**Do ONLY:**
- Update to stable release tags (format: vX.Y.Z, no -rc/-alpha suffix)
- Perform exhaustive API audit across ALL files using LIEF
- Fix all API compatibility issues found
- Validate build and tests on primary platform before final commit
- Use conventional commit format with detailed changelog
- Include API audit report in commit message
</constraints>

<instructions>

## Process

This skill spawns an autonomous agent to handle the complete LIEF update workflow, including submodule update, comprehensive API audit, issue fixes, validation, and commits.

### Phase 1: Validate Environment

<prerequisites>
Before spawning the agent, verify the environment is ready:
</prerequisites>

<action>
Check working directory and submodule state:
</action>

```bash
# Check working directory is clean
git status

# Verify LIEF submodule exists
ls -la packages/bin-infra/upstream/lief

# Check current LIEF version
cd packages/bin-infra/upstream/lief
git describe --tags 2>/dev/null || echo "No tag found"
cd ../../..
```

<validation>
**Expected State:**
- ✓ Working directory clean (no uncommitted changes)
- ✓ Submodule directory exists: `packages/bin-infra/upstream/lief/`
- ✓ Current version identifiable from git tags

**If working directory NOT clean:**
- Commit or stash changes before proceeding
- LIEF update should start from clean state

**If submodule missing:**
- Initialize: `git submodule update --init --recursive`
- Report error and ask user to fix

Do NOT proceed if environment checks fail.
</validation>

---

### Phase 2: Determine Target Version

<action>
Parse user input to determine target LIEF version:
</action>

**Skill Invocation Patterns:**
- `/updating-lief` - Use latest stable LIEF release (fetch from repository)
- `/updating-lief latest` - Use latest stable LIEF release (explicit)
- `/updating-lief v0.18.0` - Use specific version v0.18.0
- `/updating-lief 0.18.0` - Use specific version v0.18.0 (add 'v' prefix automatically)

**Version Resolution Logic:**
```bash
# Parse user input
if [ -z "$USER_VERSION" ] || [ "$USER_VERSION" = "latest" ]; then
  # Fetch latest stable from repository
  cd packages/bin-infra/upstream/lief
  git fetch origin --tags
  TARGET_VERSION=$(git tag -l 'v*.*.*' --sort=-version:refname | grep -v -E '(rc|alpha|beta)' | head -1)
  echo "Using latest stable LIEF: $TARGET_VERSION"
  cd ../../..
else
  # Use specified version
  TARGET_VERSION="$USER_VERSION"

  # Add 'v' prefix if missing
  if [[ ! "$TARGET_VERSION" =~ ^v ]]; then
    TARGET_VERSION="v$TARGET_VERSION"
  fi

  echo "Using specified LIEF version: $TARGET_VERSION"
fi

# Validate format: vX.Y.Z
if ! echo "$TARGET_VERSION" | grep -qE '^v[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "ERROR: Invalid version format: $TARGET_VERSION"
  echo "Expected format: vX.Y.Z (e.g., v0.18.0)"
  exit 1
fi

# Check not a pre-release
if echo "$TARGET_VERSION" | grep -qE '-(rc|alpha|beta)'; then
  echo "ERROR: Pre-release versions not supported: $TARGET_VERSION"
  echo "Please specify stable release"
  exit 1
fi
```

**Confirmation:**
- Display resolved version to user
- For "latest", show: "Updating to latest stable: v0.18.0"
- For explicit version, show: "Updating to: v0.18.0"

---

### Phase 3: Spawn Autonomous Agent

<action>
Spawn a general-purpose agent with detailed instructions for LIEF update:
</action>

**Use Task tool with the following prompt:**

```javascript
Task({
  subagent_type: "general-purpose",
  description: "Update LIEF and audit API usage",
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
Think through these validation questions:
1. Does TARGET_VERSION exist in LIEF repository?
2. Does TARGET_VERSION match format vX.Y.Z (semantic version)?
3. Is TARGET_VERSION different from CURRENT_TAG?
4. Does TARGET_VERSION NOT contain "-rc", "-alpha", "-beta" (pre-release)?

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
**Critical Validation Questions:**
1. Were ALL files using LIEF found and analyzed?
2. Are there any anti-pattern issues detected?
3. Does audit report show 0 issues?

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
`
})
```

</instructions>

## Success Criteria

- ✅ `<promise>LIEF_UPDATE_COMPLETE</promise>` output
- ✅ Autonomous agent spawned with detailed instructions
- ✅ Agent completed LIEF update workflow
- ✅ LIEF submodule updated to target version
- ✅ .gitmodules updated
- ✅ Comprehensive API audit performed (100% file coverage)
- ✅ All API compatibility issues fixed
- ✅ Build and tests passed (100%)
- ✅ Commits created with audit report embedded
- ✅ Ready for push to remote

## Commands

This skill spawns an autonomous agent. No direct commands needed.

## Context

This skill is useful for:
- Upgrading LIEF to access new features
- Applying LIEF security patches
- Fixing LIEF bugs
- Improving binary manipulation performance
- Regular maintenance (quarterly or as-needed)

**Safety:** Working directory must be clean. Comprehensive audit ensures API compatibility. Validation ensures build/tests pass before committing. Rollback available with `git reset --hard HEAD~2`.

**Trade-offs:**
- ✓ Automated workflow with comprehensive audit
- ✓ Validation ensures compatibility with new version
- ✓ Atomic commits (version + API fixes separate)
- ✓ Audit report embedded in commit for traceability
- ✗ Requires clean working directory
- ✗ May require manual API fixes if audit finds issues
- ✗ Time-consuming for major version upgrades
- ✗ Cross-platform validation may require CI (single platform tested locally)
