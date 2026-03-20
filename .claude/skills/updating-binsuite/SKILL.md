---
name: updating-binsuite
description: Orchestrates LIEF and stubs updates in correct dependency order. Triggers after Node.js update, before releases, or when binary tools need refresh.
user-invocable: true
allowed-tools: Skill, Bash, Read
---

# updating-binsuite

<task>
Your task is to orchestrate updating the binary manipulation suite (binsuite) by triggering the updating-lief and updating-stubs skills in the correct order, ensuring all builds pass, and reporting a comprehensive summary.
</task>

<context>
**What is binsuite?**
The binary suite (binsuite) includes all tools for binary manipulation in socket-btm:
- **LIEF** - Library for binary parsing/modification
- **stubs** - Self-extracting loader binaries (depends on curl)
- **binject** - Binary injection tool
- **binpress** - Binary compression tool
- **binflate** - Binary decompression tool

**Dependency Chain:**
```
updating-binsuite
  ├─→ updating-lief (reads LIEF version from Node.js deps, bumps lief/binflate/binject/binpress caches)
  └─→ updating-stubs (triggers curl, bumps stubs/binpress caches)
        └─→ updating-curl (bumps curl cache)
```

**Order of Operations:**
1. **updating-lief** - Must run first, gets LIEF version from node/deps/LIEF
2. **updating-stubs** - Runs second, which triggers curl update

**When to Use:**
- After updating Node.js submodule (LIEF version may change)
- Before major releases to ensure all binary tools are current
- Periodic maintenance to pick up security patches
</context>

<constraints>
**CRITICAL Requirements:**
- Working directory MUST be clean before starting
- LIEF MUST be updated first (may determine version from Node.js)
- Both skills MUST complete successfully
- All cache versions MUST be bumped appropriately

**CI Mode:**
This skill passes through to sub-skills (updating-lief, updating-stubs).
The sub-skills detect CI mode via `CI=true` or `GITHUB_ACTIONS` env var and:
- Skip build validation (CI runs builds separately)
- Skip test validation (CI runs tests separately)
- Focus on version updates, cache bumps, commits
- Do NOT push changes (workflow handles push)

**Do NOT:**

- Run stubs before LIEF (wrong order)
- Skip either update (binsuite requires both)
- Continue if either skill fails
- Push changes when in CI mode

**Do ONLY:**

- Run updating-lief first
- Run updating-stubs second
- Report comprehensive summary of all updates
</constraints>

<instructions>

## Process

### Phase 1: Validate Environment

<action>
Check working directory is clean:
</action>

```bash
git status
```

<validation>
**Expected State:**
- ✓ Working directory clean (no uncommitted changes)

Do NOT proceed if environment checks fail.
</validation>

---

### Phase 2: Update LIEF

<action>
Trigger the updating-lief skill:
</action>

```
Skill({ skill: "updating-lief" })
```

Wait for LIEF update to complete.

**Possible outcomes:**
- LIEF updated with API fixes and cache versions bumped
- LIEF already at target version (no changes)
- LIEF update failed (abort binsuite update)

**If LIEF update fails:**
- Report error to user
- Do NOT proceed to stubs update
- Exit with failure

---

### Phase 3: Update Stubs

<action>
Trigger the updating-stubs skill (which also triggers curl):
</action>

```
Skill({ skill: "updating-stubs" })
```

Wait for stubs update to complete.

**Possible outcomes:**
- curl updated, stubs rebuilt, cache versions bumped
- curl and stubs already current (no changes)
- Update failed (report error)

---

### Phase 4: Report Summary

<action>
Generate comprehensive summary:
</action>

```
## Binsuite Update Complete

### LIEF Update
[Results from updating-lief]

### Stubs Update (includes curl)
[Results from updating-stubs]

### Cache Versions Bumped
- lief (from updating-lief)
- binflate (from updating-lief)
- binject (from updating-lief)
- binpress (from updating-lief and updating-stubs)
- stubs (from updating-stubs)
- curl (from updating-stubs)

### Commits Created
[List all commits from both skills]

### Next Steps
**Interactive mode:**
1. Review changes: `git log --oneline -N`
2. Push to remote: `git push origin main`

**CI mode:**
1. Workflow will push branch and create PR
2. CI will run full build/test validation
```

</instructions>

## Success Criteria

- ✅ Working directory clean at start
- ✅ updating-lief completed successfully
- ✅ updating-stubs completed successfully
- ✅ All cache versions bumped appropriately
- ✅ Comprehensive summary reported
- ✅ Ready for push to remote

## Commands

This skill orchestrates other skills:
- `updating-lief` - LIEF library update
- `updating-stubs` - Stub binaries update (triggers curl)

## Context

This skill is useful for:

- Comprehensive binary tooling updates
- Post-Node.js update maintenance (LIEF version may change)
- Pre-release preparation
- Security patch rollout

**Safety:** Validates environment first. Each sub-skill has its own validation. Rollback requires reverting multiple commits.

**Dependencies:** This skill coordinates updating-lief and updating-stubs in the correct order.
