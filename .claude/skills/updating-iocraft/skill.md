---
name: updating-iocraft
description: Updates iocraft TUI library submodule to latest stable version. Triggers when user mentions "update iocraft", TUI improvements, or terminal rendering fixes.
user-invocable: true
allowed-tools: Bash, Read, Edit, Glob, Grep
---

# updating-iocraft

<task>
Your task is to update the iocraft TUI library submodule to its latest stable version, validate build and tests pass, bump cache versions, and commit changes with detailed changelog.
</task>

<context>
**What is iocraft?**
iocraft is a React-like declarative TUI (Text User Interface) framework for Rust, created by ccbrown. It provides component-based terminal UI rendering with support for mouse events, keyboard input, and flexible layouts.

**socket-btm Architecture:**

- iocraft tracked via submodule: `packages/iocraft-builder/upstream/iocraft`
- Version pinned in `.gitmodules` (commit hash + semantic version comment)
- Builds native Node.js bindings via napi-rs for cross-platform TUI rendering

**Why Update:**

- Bug fixes in terminal rendering
- Performance improvements
- New TUI features and components
- Mouse/keyboard event handling improvements

**Critical Files:**

- `.gitmodules` - iocraft submodule configuration with version pinning
- `packages/iocraft-builder/upstream/iocraft` - Git submodule tracking ccbrown/iocraft
- `.github/cache-versions.json` - Cache version keys for CI invalidation

**Cache Version Bump:**
When iocraft is updated, bump this cache version in `.github/cache-versions.json`:
- `iocraft` - iocraft library artifacts
</context>

<constraints>
**CRITICAL Requirements:**
- Working directory MUST be clean before starting (no uncommitted changes)
- Target version MUST be a stable release (no -rc/-alpha/-beta)
- Cache version MUST be bumped after update

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

- Update to stable release tags (format: iocraft-vX.Y.Z)
- Bump cache version: iocraft
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
cd packages/iocraft-builder/upstream/iocraft
git fetch origin --tags

# Get current version
IOCRAFT_CURRENT=$(git describe --tags 2>/dev/null || echo "unknown")
echo "Current iocraft: $IOCRAFT_CURRENT"

# Get latest stable (format: iocraft-vX.Y.Z)
IOCRAFT_LATEST=$(git tag -l 'iocraft-v*.*.*' --sort=-version:refname | grep -v -E '(rc|alpha|beta)' | head -1)
echo "Latest iocraft: $IOCRAFT_LATEST"
cd ../../../..
```

**Check if update needed:**
- If iocraft already at latest, report "Already up to date" and exit
- If update available, proceed

---

### Phase 3: Update Submodule

<action>
Checkout latest version and clean submodule working tree:
</action>

```bash
cd packages/iocraft-builder/upstream/iocraft
git checkout "$IOCRAFT_LATEST"
IOCRAFT_COMMIT=$(git rev-parse HEAD)

# Clean the submodule's working tree to remove any modified files
# This prevents the 'm' (modified content) status in git status
git checkout -- .
git clean -fd

cd ../../../..

echo "Updated iocraft to $IOCRAFT_LATEST ($IOCRAFT_COMMIT)"
```

---

### Phase 4: Update .gitmodules

<action>
Update version comment in .gitmodules:
</action>

Use the Edit tool to update the version comment in `.gitmodules`:
- Update iocraft comment: `# iocraft-X.Y.Z` (strip 'v' prefix from tag)

---

### Phase 5: Validate Build and Tests (Skip in CI Mode)

<action>
Run full validation (skip in CI mode):
</action>

```bash
if [ "$CI_MODE" = "true" ]; then
  echo "CI mode: Skipping build validation (CI will run builds separately)"
else
  cd packages/iocraft-builder
  pnpm run clean
  pnpm run build || exit 1
  pnpm test || exit 1
  cd ../..

  echo "Build and tests passed"
fi
```

---

### Phase 6: Bump Cache Version

<action>
Bump the iocraft cache version in .github/cache-versions.json:
</action>

Use the Read tool to get current cache version, then use Edit tool to bump:
- `iocraft`: Increment version (e.g., v1 -> v2)

---

### Phase 7: Commit Changes

<action>
Stage and commit all changes:
</action>

```bash
IOCRAFT_VERSION="${IOCRAFT_LATEST#iocraft-v}"

git add .gitmodules packages/iocraft-builder/upstream/iocraft .github/cache-versions.json

git commit -m "chore(iocraft-builder): update iocraft to $IOCRAFT_VERSION

Update iocraft submodule to latest stable release.

Updated:
- iocraft: $IOCRAFT_CURRENT -> $IOCRAFT_LATEST
- Cache version bumped: iocraft

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
## iocraft Update Complete

**iocraft:** $IOCRAFT_CURRENT -> $IOCRAFT_LATEST

**Cache versions bumped:**
- iocraft

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

- iocraft submodule updated to latest stable
- .gitmodules updated with new version comment
- Build succeeded (or skipped in CI mode)
- Tests passed (or skipped in CI mode)
- Cache version bumped: iocraft
- Commit created with detailed changelog
- Ready for push to remote

## Commands

This skill uses direct git and pnpm commands for simplicity.

## Context

This skill is useful for:

- Updating iocraft for bug fixes
- Accessing new TUI features
- Performance improvements
- Regular maintenance (quarterly or as-needed)

**Safety:** Working directory must be clean. Validation ensures build/tests pass before committing. Rollback available with `git reset --hard HEAD~1`.
