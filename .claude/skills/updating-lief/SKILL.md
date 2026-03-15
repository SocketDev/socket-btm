---
name: updating-lief
description: Updates LIEF binary manipulation library with comprehensive API compatibility audit. Triggers when Node.js deps change LIEF version or user requests LIEF update.
user-invocable: true
allowed-tools: Task, Bash, Read, Edit, Grep, Glob
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

- **LIEF version is driven by Node.js deps** - source of truth:
  `packages/node-smol-builder/upstream/node/deps/LIEF/include/LIEF/version.h`
- LIEF submodule: `packages/lief-builder/upstream/lief` MUST match Node.js deps version
- Used across 20 source files for binary manipulation operations
- **CRITICAL WORKFLOW**:
  1. First update Node.js (use `/updating-node` skill)
  2. Then run `/updating-lief` to sync submodule to match Node.js deps
  3. NEVER update LIEF independently - it must match Node.js
- **This skill automatically reads the LIEF version from Node.js deps and syncs to that version**

**LIEF Version Discovery:**

```bash
# Get LIEF version from Node.js deps (source of truth)
grep '#define LIEF_VERSION "' packages/node-smol-builder/upstream/node/deps/LIEF/include/LIEF/version.h
# Output: #define LIEF_VERSION "0.17.0-"
# Note: Trailing "-" means dev build from commit after 0.17.0 tag
# Use the base version (0.17.0) for the submodule tag

# Current LIEF submodule version
git -C packages/lief-builder/upstream/lief describe --tags
```

**When to Run This Skill:**

- **After running `/updating-node`** - to sync LIEF submodule to match new Node.js deps
- **After manual Node.js submodule update** - to ensure LIEF stays in sync
- **NEVER run independently** - LIEF version must match Node.js deps

**Why This Matters:**

- Node.js includes LIEF in its deps/ for SEA (Single Executable Application) support
- Our LIEF submodule must match to ensure API compatibility
- Mismatched versions cause runtime crashes and build failures

**Critical Files:**

- `.gitmodules` - LIEF submodule configuration with version pinning
- `packages/lief-builder/upstream/lief` - Git submodule tracking lief-project/LIEF
- All C++ files using `#include <LIEF/` - API consumers requiring audit
- `.github/cache-versions.json` - Cache version keys for CI invalidation

**Cache Version Bump:**
When LIEF is updated, bump these cache versions in `.github/cache-versions.json`:
- `lief` - LIEF library artifacts
- `binflate` - uses LIEF for binary extraction
- `binject` - uses LIEF for binary injection
- `binpress` - uses LIEF for binary compression
- `node-smol` - uses binject for SEA/VFS injection

**Success Metrics:**

- API Audit: 100% of LIEF API usage verified compatible
- Build: Must complete without errors across all platforms
- Tests: 100% pass rate
- Zero API compatibility issues remaining
- Cache versions bumped: lief, binflate, binject, binpress, node-smol
  </context>

<constraints>
**Requirements:**
- Start with clean working directory (no uncommitted changes)
- Target stable release tags only (vX.Y.Z, exclude -rc/-alpha)
- Perform comprehensive API audit after update (LIEF API changes frequently)
- Fix all API compatibility issues before committing
- Bump cache versions: lief, binflate, binject, binpress, node-smol
- May create multiple commits (version update + API fixes)

**CI Mode** (detected via `CI=true` or `GITHUB_ACTIONS`):
- Skip build/test validation (CI validates separately)
- API audit still required (catch issues before CI builds)
- Workflow handles push

**Interactive Mode** (default):
- Validate build/tests pass on all platforms

**Actions:**
- Update to stable LIEF release tag
- Audit all LIEF API usage across codebase
- Fix compatibility issues found
- Create conventional commits with API audit report
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
ls -la packages/lief-builder/upstream/lief

# Check current LIEF version
cd packages/lief-builder/upstream/lief
git describe --tags 2>/dev/null || echo "No tag found"
cd ../../..
```

<validation>
**Expected State:**
- ✓ Working directory clean (no uncommitted changes)
- ✓ Submodule directory exists: `packages/lief-builder/upstream/lief/`
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

### Phase 2: Determine Target Version from Node.js deps

<action>
**CRITICAL**: LIEF version MUST match Node.js deps. Extract target version from Node.js source:
</action>

**LIEF Version Source of Truth:**

The LIEF version is determined by what Node.js includes in its deps/ directory:
`packages/node-smol-builder/upstream/node/deps/LIEF/include/LIEF/version.h`

**Version Resolution Logic:**

```bash
# STEP 1: Extract LIEF version from Node.js deps (SOURCE OF TRUTH)
NODE_LIEF_VERSION_FILE="packages/node-smol-builder/upstream/node/deps/LIEF/include/LIEF/version.h"

if [ ! -f "$NODE_LIEF_VERSION_FILE" ]; then
  echo "ERROR: Node.js LIEF version file not found"
  echo "Expected: $NODE_LIEF_VERSION_FILE"
  echo "Make sure Node.js submodule is initialized and up to date"
  exit 1
fi

# Parse version from header file
# Format: #define LIEF_VERSION "0.17.0-"
# Note: Trailing "-" means dev build, strip it
NODE_LIEF_VERSION=$(grep '#define LIEF_VERSION "' "$NODE_LIEF_VERSION_FILE" | sed 's/.*"\([0-9.]*\).*/\1/')

if [ -z "$NODE_LIEF_VERSION" ]; then
  echo "ERROR: Could not parse LIEF version from Node.js deps"
  cat "$NODE_LIEF_VERSION_FILE"
  exit 1
fi

echo "Node.js deps LIEF version: $NODE_LIEF_VERSION"

# STEP 2: Get current LIEF submodule version
cd packages/lief-builder/upstream/lief
git fetch origin --tags
CURRENT_VERSION=$(git describe --tags 2>/dev/null || echo "unknown")
cd ../../../..

echo "Current LIEF submodule: $CURRENT_VERSION"

# STEP 3: Determine if update is needed
TARGET_VERSION="$NODE_LIEF_VERSION"

if [ "$CURRENT_VERSION" = "$TARGET_VERSION" ]; then
  echo "LIEF submodule already matches Node.js deps version: $TARGET_VERSION"
  echo "No update needed."
  exit 0
fi

echo "Update needed: $CURRENT_VERSION -> $TARGET_VERSION"

# STEP 4: Verify target version exists in LIEF repository
cd packages/lief-builder/upstream/lief
if ! git tag -l | grep -q "^${TARGET_VERSION}$"; then
  echo "ERROR: LIEF version $TARGET_VERSION not found in repository"
  echo "This may indicate Node.js is using a commit between releases"
  echo "Available versions:"
  git tag -l --sort=-version:refname | head -10
  exit 1
fi
cd ../../../..
```

**User-specified Version Override:**

If user explicitly specifies a version (e.g., `/updating-lief 0.18.0`), warn them:

```bash
if [ -n "$USER_VERSION" ]; then
  echo "WARNING: User specified LIEF version: $USER_VERSION"
  echo "Node.js deps expects: $NODE_LIEF_VERSION"
  echo ""
  echo "Using a different LIEF version than Node.js deps may cause:"
  echo "- API incompatibilities at runtime"
  echo "- Binary format mismatches"
  echo "- Build failures"
  echo ""
  echo "Recommended: Update Node.js first, then run /updating-lief without arguments"
  echo ""
  read -p "Continue with user-specified version? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborting. Use /updating-node to update Node.js first."
    exit 1
  fi
  TARGET_VERSION="$USER_VERSION"
fi
```

**Confirmation:**

- Display: "Syncing LIEF submodule to match Node.js deps: X.Y.Z"
- If version mismatch with user input, show warning and require confirmation

---

### Phase 3: Spawn Autonomous Agent

<action>
Load the agent prompt template from reference.md and spawn the autonomous agent:
</action>

**Agent Prompt Source:** The complete agent prompt template is documented in `reference.md` under the "Agent Prompt Template" section. This prompt contains detailed instructions for the 10-step LIEF update workflow including comprehensive API compatibility audit.

**Spawn Agent:**

```javascript
Task({
  subagent_type: 'general-purpose',
  description: 'Update LIEF and audit API usage',
  prompt: `${LIEF_UPDATE_AGENT_PROMPT_FROM_REFERENCE_MD}`,
})
```

**Instructions for Skill Executor:**

1. **Read the agent prompt template** from `reference.md` starting at the "Agent Prompt Template" heading
2. **Extract the full prompt** (from "Update LIEF library..." through the final rollback bash block)
3. **Replace [TARGET_VERSION] placeholder** with the actual target version determined in Phase 2
4. **Pass the prompt to Task tool** using the code block above (replace placeholder with actual prompt content)
5. **Monitor agent execution** and capture the output
6. **Verify completion signal**: Agent must output `<promise>LIEF_UPDATE_COMPLETE</promise>`

**Why Extracted to reference.md:**

- Keeps SKILL.md concise and focused on skill logic
- Agent prompt template is 730 lines - too large to embed inline
- reference.md provides single source of truth for the prompt
- Easier to maintain, update, and review prompt independently
- Follows same pattern as quality-scan and syncing-upstream skills

<validation>
**Structured Output Validation:**

After agent returns, validate output structure before parsing:

```bash
# 1. Verify completion signal
if ! echo "$AGENT_OUTPUT" | grep -q '<promise>LIEF_UPDATE_COMPLETE</promise>'; then
  echo "ERROR: Agent did not complete successfully"
  echo "Agent may have failed or encountered an error"
  echo "Review agent output for error messages"
  exit 1
fi

# 2. Verify expected content sections exist
VALIDATION_FAILED=0

if ! echo "$AGENT_OUTPUT" | grep -q 'LIEF Update Complete'; then
  echo "WARNING: Missing summary report section"
  VALIDATION_FAILED=1
fi

if ! echo "$AGENT_OUTPUT" | grep -q 'Updated from:.*→'; then
  echo "WARNING: Missing version change information"
  VALIDATION_FAILED=1
fi

if ! echo "$AGENT_OUTPUT" | grep -q 'API Audit Results:'; then
  echo "WARNING: Missing API audit results"
  VALIDATION_FAILED=1
fi

if ! echo "$AGENT_OUTPUT" | grep -q 'Files audited:'; then
  echo "WARNING: Missing audit metrics"
  VALIDATION_FAILED=1
fi

if [ $VALIDATION_FAILED -eq 1 ]; then
  echo "WARNING: Agent output structure incomplete"
  echo "Proceeding with manual verification..."
fi
```

**Manual Verification Checklist:**

- [ ] Agent output shows `<promise>LIEF_UPDATE_COMPLETE</promise>`
- [ ] Two commits created (check: `git log -2 --oneline`)
- [ ] .gitmodules updated with new LIEF version
- [ ] API audit report present (Files audited, Issues found/fixed)
- [ ] Build and tests passed (check agent output for "✓ Build: SUCCESS")
- [ ] No error messages in agent output

**If validation fails:**

- Review full agent output for specific errors
- Check git status and commits created
- Verify API audit completed (check /tmp/lief-api-audit-report.txt)
- Rollback if needed: `git reset --hard HEAD~2`

**Report to user:**

- LIEF updated: vOLD → vNEW
- API audit: N files, N issues found/fixed
- Cache versions bumped: lief, binflate, binject, binpress, node-smol
- Commits: 2
- Build: SUCCESS
- Tests: PASS
- Ready for push
  </validation>

---

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
- ✅ Cache versions bumped: lief, binflate, binject, binpress, node-smol
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

**Post-Update Considerations:**
- **external-tools.json**: Check if `packages/lief-builder/external-tools.json` and dependent packages need updates
- **Pinned dependencies**: All dependencies (dev and direct) are pinned to exact versions. After updating, run `pnpm run update` to check for compatible dependency updates.
- **API changes**: LIEF frequently has breaking API changes between versions. The audit step catches these, but manual fixes may be needed.
