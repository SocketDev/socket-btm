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
Load the agent prompt template from reference.md and spawn the autonomous agent:
</action>

**Agent Prompt Source:** The complete agent prompt template is documented in `reference.md` under the "Agent Prompt Template" section. This prompt contains detailed instructions for the 10-step LIEF update workflow including comprehensive API compatibility audit.

**Spawn Agent:**

```javascript
Task({
  subagent_type: "general-purpose",
  description: "Update LIEF and audit API usage",
  prompt: `${LIEF_UPDATE_AGENT_PROMPT_FROM_REFERENCE_MD}`
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
