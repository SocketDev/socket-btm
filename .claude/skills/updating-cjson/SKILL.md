---
name: updating-cjson
description: Updates cJSON JSON parsing library submodule to latest stable version. Triggers when user mentions "update cJSON", JSON parsing bugs, or binject updates.
user-invocable: true
allowed-tools: Bash, Read, Edit, Glob, Grep
---

# updating-cjson

<task>
Your task is to update the cJSON library submodule to its latest stable version, validate build and tests pass, bump cache versions, and commit changes with detailed changelog.
</task>

<context>
**What is cJSON?**
cJSON is a lightweight JSON parser in C. It's used by socket-btm's binject package for JSON configuration handling in binary injection operations.

**socket-btm Architecture:**

- cJSON tracked via submodule: `packages/binject/upstream/cJSON`
- Version pinned in `.gitmodules` (commit hash + semantic version comment)
- Used by binject for JSON parsing in binary injection

**Why Update:**

- Security patches for JSON parsing vulnerabilities
- Bug fixes in parsing/serialization
- Performance improvements
- New JSON features

**Critical Files:**

- `.gitmodules` - cJSON submodule configuration with version pinning
- `packages/binject/upstream/cJSON` - Git submodule tracking DaveGamble/cJSON
- `.github/cache-versions.json` - Cache version keys for CI invalidation

**Cache Version Bump:**
When cJSON is updated, bump these cache versions in `.github/cache-versions.json`:
- `binject` - binject uses cJSON for JSON parsing
- `node-smol` - node-smol uses binject for SEA/VFS injection
</context>

<constraints>
**CRITICAL Requirements:**
- Working directory MUST be clean before starting (no uncommitted changes)
- Target version MUST be a stable release (no -rc/-alpha/-beta)
- Cache versions MUST be bumped after update

**CI Mode (detected via `CI=true` or `GITHUB_ACTIONS` env var):**
- Skip build validation (CI runs builds in separate workflow jobs)
- Skip test validation (CI runs tests in separate workflow jobs)
- Focus on: version update, cache bump, commit only
- Do NOT push changes (workflow handles push)

**Interactive Mode (default):**
- Build MUST succeed without errors
- Tests MUST pass (100% success rate)

**Do NOT:**

- Update to unstable/pre-release versions
- Push changes when in CI mode

**Do ONLY:**

- Update to stable release tags (format: vX.Y.Z)
- Bump cache versions: binject, node-smol
- Use conventional commit format with detailed changelog
</constraints>

<instructions>

## Process

### Phase 1: Validate Environment

<action>
Check working directory is clean and detect CI mode:
</action>

```bash
# Detect CI mode
if [ "$CI" = "true" ] || [ -n "$GITHUB_ACTIONS" ]; then
  CI_MODE=true
  echo "Running in CI mode - will skip build validation"
else
  CI_MODE=false
  echo "Running in interactive mode - will validate builds"
fi

git status
```

<validation>
**Expected State:**
- Working directory clean (no uncommitted changes)

Do NOT proceed if environment checks fail.
</validation>

---

### Phase 2: Determine Target Version

<action>
Auto-detect latest stable version:
</action>

```bash
cd packages/binject/upstream/cJSON
git fetch origin --tags

# Get current version
CJSON_CURRENT=$(git describe --tags 2>/dev/null || echo "unknown")
echo "Current cJSON: $CJSON_CURRENT"

# Get latest stable (format: vX.Y.Z)
CJSON_LATEST=$(git tag -l 'v*.*.*' --sort=-version:refname | grep -v -E '(rc|alpha|beta)' | head -1)
echo "Latest cJSON: $CJSON_LATEST"
cd ../../../..
```

**Check if update needed:**
- If cJSON already at latest, report "Already up to date" and exit
- If update available, proceed

---

### Phase 3: Update Submodule

<action>
Checkout latest version:
</action>

```bash
cd packages/binject/upstream/cJSON
git checkout "$CJSON_LATEST"
CJSON_COMMIT=$(git rev-parse HEAD)
cd ../../../..

echo "Updated cJSON to $CJSON_LATEST ($CJSON_COMMIT)"
```

---

### Phase 4: Update .gitmodules

<action>
Update version comment in .gitmodules:
</action>

Use the Edit tool to update the version comment in `.gitmodules`:
- Update cJSON comment: `# cJSON-X.Y.Z` (strip 'v' prefix from tag)

---

### Phase 5: Validate Build and Tests (Skip in CI Mode)

<action>
Run full validation (skip in CI mode):
</action>

```bash
if [ "$CI_MODE" = "true" ]; then
  echo "CI mode: Skipping build validation (CI will run builds separately)"
else
  cd packages/binject
  pnpm run clean
  pnpm run build || exit 1
  pnpm test || exit 1
  cd ../..

  echo "Build and tests passed"
fi
```

---

### Phase 6: Bump Cache Versions

<action>
Bump cache versions in .github/cache-versions.json:
</action>

Use the Read tool to get current cache versions, then use Edit tool to bump:
- `binject`: Increment version (e.g., v76 -> v77)
- `node-smol`: Increment version (node-smol uses binject)

---

### Phase 7: Commit Changes

<action>
Stage and commit all changes:
</action>

```bash
CJSON_VERSION="${CJSON_LATEST#v}"

git add .gitmodules packages/binject/upstream/cJSON .github/cache-versions.json

git commit -m "chore(binject): update cJSON to $CJSON_VERSION

Update cJSON submodule to latest stable release.

Updated:
- cJSON: $CJSON_CURRENT -> $CJSON_LATEST
- Cache versions bumped: binject, node-smol

Validation:
- Build: $([ "$CI_MODE" = "true" ] && echo "SKIPPED (CI)" || echo "SUCCESS")
- Tests: $([ "$CI_MODE" = "true" ] && echo "SKIPPED (CI)" || echo "PASS")"
```

---

### Phase 8: Report Summary

<action>
Generate final summary:
</action>

```
## cJSON Update Complete

**cJSON:** $CJSON_CURRENT -> $CJSON_LATEST

**Cache versions bumped:**
- binject
- node-smol

**Validation:**
- Build: SUCCESS (or SKIPPED in CI mode)
- Tests: PASS (or SKIPPED in CI mode)

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

- cJSON submodule updated to latest stable
- .gitmodules updated with new version comment
- Build succeeded (or skipped in CI mode)
- Tests passed (or skipped in CI mode)
- Cache versions bumped: binject, node-smol
- Commit created with detailed changelog
- Ready for push to remote

## Commands

This skill uses direct git and pnpm commands for simplicity.

## Context

This skill is useful for:

- Updating cJSON for security patches
- Bug fixes in JSON parsing
- Performance improvements
- Regular maintenance (quarterly or as-needed)

**Safety:** Working directory must be clean. Validation ensures build/tests pass before committing. Rollback available with `git reset --hard HEAD~1`.

**Post-Update Considerations:**
- **Pinned dependencies**: All dependencies (dev and direct) are pinned to exact versions. After updating, run `pnpm run update` to check for compatible dependency updates.
