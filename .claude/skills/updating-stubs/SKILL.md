---
name: updating-stubs
description: Rebuilds self-extracting stub binaries after triggering curl updates. Triggers when stub binaries need refresh or after curl security patches.
user-invocable: true
allowed-tools: Skill, Bash, Read, Edit, Glob, Grep
---

# updating-stubs

<task>
Your task is to update the stubs-builder package by first updating curl (its dependency), rebuilding stubs, validating tests pass, bumping cache versions, and committing changes.
</task>

<context>
**What are stubs?**
Stubs are small self-extracting loader binaries used by binpress to create compressed executables. They decompress and launch the main binary at runtime.

**socket-btm Architecture:**

- stubs-builder: `packages/stubs-builder/`
- Depends on curl-builder (downloads curl for HTTP support)
- Stub binaries are embedded into binpress
- stubs-builder output is used by binpress which compresses node-smol

**Dependency Chain:**
```
updating-stubs
  └─→ updating-curl (triggered first)
```

**Cache Version Bump:**
When stubs are updated, bump these cache versions in `.github/cache-versions.json`:
- `stubs` - stubs-builder artifacts
- `binpress` - depends on stub binaries

**Critical Files:**

- `packages/stubs-builder/` - Stub binary source
- `.github/cache-versions.json` - Cache version keys
</context>

<constraints>
**CRITICAL Requirements:**
- Working directory MUST be clean before starting
- MUST trigger curl update first (dependency)
- Cache versions MUST be bumped: stubs, binpress

**CI Mode (detected via `CI=true` or `GITHUB_ACTIONS` env var):**
- Skip build validation (CI runs builds in separate workflow jobs)
- Skip test validation (CI runs tests in separate workflow jobs)
- Focus on: dependency updates, cache bumps, commits only
- Do NOT push changes (workflow handles push)

**Interactive Mode (default):**
- Build MUST succeed without errors
- Tests MUST pass (100% success rate)

**Do NOT:**

- Skip curl update (stubs depend on curl)
- Forget to bump both stubs AND binpress cache versions
- Push changes when in CI mode

**Do ONLY:**

- Trigger curl update first
- Bump cache versions: stubs, binpress
- Use conventional commit format
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

### Phase 2: Update curl Dependency

<action>
First, trigger the updating-curl skill:
</action>

```
Skill({ skill: "updating-curl" })
```

Wait for curl update to complete. If curl is already up to date, this will report "Already up to date" and exit successfully.

**Check for curl changes:**
```bash
git log -1 --oneline
```

If the last commit is a curl update, curl was updated. Otherwise, curl was already current.

---

### Phase 3: Rebuild Stubs (Skip in CI Mode)

<action>
Clean and rebuild stubs-builder (skip in CI mode):
</action>

```bash
# Detect CI mode
if [ "$CI" = "true" ] || [ -n "$GITHUB_ACTIONS" ]; then
  echo "CI mode: Skipping stubs rebuild (CI will run builds separately)"
else
  cd packages/stubs-builder
  pnpm run clean
  pnpm run build || exit 1
  cd ../..

  echo "✅ Stubs rebuilt successfully"
fi
```

---

### Phase 4: Validate Tests (Skip in CI Mode)

<action>
Run stubs-builder tests (skip in CI mode):
</action>

```bash
# Detect CI mode
if [ "$CI" = "true" ] || [ -n "$GITHUB_ACTIONS" ]; then
  echo "CI mode: Skipping tests (CI will run tests separately)"
else
  cd packages/stubs-builder
  pnpm test || exit 1
  cd ../..

  echo "✅ Tests passed"
fi
```

<validation>
**Expected Output (Interactive):**
```
✅ Tests passed
```

**Expected Output (CI):**
```
CI mode: Skipping tests (CI will run tests separately)
```

**If validation fails:**
- Review test errors
- May indicate issues with curl update or stub code
- Do NOT proceed to commit if validation fails
</validation>

---

### Phase 5: Bump Cache Versions

<action>
Bump cache versions in .github/cache-versions.json if curl was updated:
</action>

**IMPORTANT:** ALWAYS bump cache versions if curl was updated (even if stubs binaries are identical). Changed dependencies = changed cache requirements.

Use the Read tool to get current cache versions, then use Edit tool to bump:
- `stubs`: Increment version (e.g., v70 → v71)
- `binpress`: Increment version (binpress embeds stubs)
- `node-smol`: Increment version (node-smol compressed with binpress)

---

### Phase 6: Commit Changes (if any)

<action>
Check if there are changes to commit:
</action>

```bash
git status --porcelain
```

**If no changes:** Report "Stubs already up to date" and exit.

**If changes exist:**
```bash
git add packages/stubs-builder .github/cache-versions.json

git commit -m "chore(stubs-builder): rebuild stubs with latest dependencies

Rebuild stub binaries with updated dependencies.

Updated:
- Stubs rebuilt with latest curl
- Cache versions bumped: stubs, binpress

Validation:
- Build: SUCCESS
- Tests: PASS"
```

---

### Phase 7: Report Summary

<action>
Generate final summary:
</action>

```
## Stubs Update Complete

**Actions:**
- ✅ curl updated (if needed)
- ✅ Stubs rebuilt
- ✅ Tests passed

**Cache versions bumped:**
- stubs
- binpress

**Next Steps:**
**Interactive mode:**
1. Review changes: `git log -1 --stat`
2. Push to remote: `git push origin main`

**CI mode:**
1. Workflow will push branch and create PR
2. CI will run full build/test validation
```

</instructions>

## Success Criteria

- ✅ curl updated (or confirmed current)
- ✅ Stubs rebuilt successfully
- ✅ Tests passed (100%)
- ✅ Cache versions bumped: stubs, binpress
- ✅ Commit created (if changes)
- ✅ Ready for push to remote

## Commands

This skill triggers the updating-curl skill and uses direct pnpm commands.

## Context

This skill is useful for:

- Updating stub binaries with new curl
- Rebuilding stubs after dependency changes
- Regular maintenance as part of binsuite updates

**Safety:** Working directory must be clean. Validation ensures tests pass. Rollback with `git reset --hard HEAD~1`.

**Dependencies:** This skill triggers updating-curl first to ensure curl is current before rebuilding stubs.

**Post-Update Considerations:**
- **external-tools.json**: Check if `packages/stubs-builder/external-tools.json` needs updates
- **Pinned dependencies**: All dependencies (dev and direct) are pinned to exact versions. After updating, run `pnpm run update` to check for compatible dependency updates.
