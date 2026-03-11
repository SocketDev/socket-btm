---
name: updating-yoga
description: Updates Yoga layout library submodule to latest stable version. Triggers when user mentions "update Yoga", layout bugs, or Flexbox improvements.
user-invocable: true
allowed-tools: Bash, Read, Edit, Glob, Grep
---

# updating-yoga

<task>
Your task is to update the Yoga layout library submodule to its latest stable version, validate build and tests pass, bump cache versions, and commit changes with detailed changelog.
</task>

<context>
**What is Yoga?**
Yoga is Facebook's cross-platform layout engine that implements Flexbox. It's used by socket-btm for layout calculations in binary analysis and visualization.

**socket-btm Architecture:**

- Yoga tracked via submodule: `packages/yoga-layout-builder/upstream/yoga`
- Version pinned in `.gitmodules` (commit hash + semantic version comment)
- Builds WASM module for cross-platform layout calculations

**Why Update:**

- Bug fixes in layout calculations
- Performance improvements
- New Flexbox features
- Security patches

**Critical Files:**

- `.gitmodules` - Yoga submodule configuration with version pinning
- `packages/yoga-layout-builder/upstream/yoga` - Git submodule tracking facebook/yoga
- `.github/cache-versions.json` - Cache version keys for CI invalidation

**Cache Version Bump:**
When Yoga is updated, bump this cache version in `.github/cache-versions.json`:
- `yoga-layout` - Yoga library artifacts
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

- Update to stable release tags (format: vX.Y.Z)
- Bump cache version: yoga-layout
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
cd packages/yoga-layout-builder/upstream/yoga
git fetch origin --tags

# Get current version
YOGA_CURRENT=$(git describe --tags 2>/dev/null || echo "unknown")
echo "Current Yoga: $YOGA_CURRENT"

# Get latest stable (format: vX.Y.Z)
YOGA_LATEST=$(git tag -l 'v*.*.*' --sort=-version:refname | grep -v -E '(rc|alpha|beta)' | head -1)
echo "Latest Yoga: $YOGA_LATEST"
cd ../../../..
```

**Check if update needed:**
- If Yoga already at latest, report "Already up to date" and exit
- If update available, proceed

---

### Phase 3: Update Submodule

<action>
Checkout latest version:
</action>

```bash
cd packages/yoga-layout-builder/upstream/yoga
git checkout "$YOGA_LATEST"
YOGA_COMMIT=$(git rev-parse HEAD)
cd ../../../..

echo "Updated Yoga to $YOGA_LATEST ($YOGA_COMMIT)"
```

---

### Phase 4: Update .gitmodules

<action>
Update version comment in .gitmodules:
</action>

Use the Edit tool to update the version comment in `.gitmodules`:
- Update yoga comment: `# yoga-X.Y.Z` (strip 'v' prefix from tag)

---

### Phase 5: Validate Build and Tests (Skip in CI Mode)

<action>
Run full validation (skip in CI mode):
</action>

```bash
if [ "$CI_MODE" = "true" ]; then
  echo "CI mode: Skipping build validation (CI will run builds separately)"
else
  cd packages/yoga-layout-builder
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
Bump the yoga-layout cache version in .github/cache-versions.json:
</action>

Use the Read tool to get current cache version, then use Edit tool to bump:
- `yoga-layout`: Increment version (e.g., v18 -> v19)

---

### Phase 7: Commit Changes

<action>
Stage and commit all changes:
</action>

```bash
YOGA_VERSION="${YOGA_LATEST#v}"

git add .gitmodules packages/yoga-layout-builder/upstream/yoga .github/cache-versions.json

git commit -m "chore(yoga-layout-builder): update Yoga to $YOGA_VERSION

Update Yoga submodule to latest stable release.

Updated:
- Yoga: $YOGA_CURRENT -> $YOGA_LATEST
- Cache version bumped: yoga-layout

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
## Yoga Update Complete

**Yoga:** $YOGA_CURRENT -> $YOGA_LATEST

**Cache versions bumped:**
- yoga-layout

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

- Yoga submodule updated to latest stable
- .gitmodules updated with new version comment
- Build succeeded (or skipped in CI mode)
- Tests passed (or skipped in CI mode)
- Cache version bumped: yoga-layout
- Commit created with detailed changelog
- Ready for push to remote

## Commands

This skill uses direct git and pnpm commands for simplicity.

## Context

This skill is useful for:

- Updating Yoga for bug fixes
- Accessing new layout features
- Performance improvements
- Regular maintenance (quarterly or as-needed)

**Safety:** Working directory must be clean. Validation ensures build/tests pass before committing. Rollback available with `git reset --hard HEAD~1`.

**Post-Update Considerations:**
- **external-tools.json**: Check if `packages/yoga-layout-builder/external-tools.json` needs updates (cmake, emscripten versions may need bumping for new Yoga versions)
- **Pinned dependencies**: All dependencies (dev and direct) are pinned to exact versions. After updating, run `pnpm run update` to check for compatible dependency updates.
