---
name: updating-onnxruntime
description: Updates ONNX Runtime ML inference engine submodule to latest stable version. Triggers when user mentions "update ONNX", ML model updates, or inference improvements.
user-invocable: true
allowed-tools: Bash, Read, Edit, Glob, Grep
---

# updating-onnxruntime

<task>
Your task is to update the ONNX Runtime submodule to its latest stable version, validate build and tests pass, bump cache versions, and commit changes with detailed changelog.
</task>

<context>
**What is ONNX Runtime?**
ONNX Runtime is Microsoft's high-performance inference engine for ONNX models. It's used by socket-btm for running ML models (CodeT5, etc.) for code analysis and vulnerability detection.

**socket-btm Architecture:**

- ONNX Runtime tracked via submodule: `packages/onnxruntime-builder/upstream/onnxruntime`
- Version pinned in `.gitmodules` (commit hash + semantic version comment)
- Builds WASM module for cross-platform ML inference
- Used by the models package for running inference

**Why Update:**

- New ML operator support
- Performance improvements (faster inference)
- Security patches
- Bug fixes in model loading/execution
- Better WASM compatibility

**Critical Files:**

- `.gitmodules` - ONNX Runtime submodule configuration with version pinning
- `packages/onnxruntime-builder/upstream/onnxruntime` - Git submodule tracking microsoft/onnxruntime
- `.github/cache-versions.json` - Cache version keys for CI invalidation

**Cache Version Bump:**
When ONNX Runtime is updated, bump these cache versions in `.github/cache-versions.json`:
- `onnxruntime` - ONNX Runtime library artifacts
- `models` - Models package depends on onnxruntime for inference
</context>

<constraints>
**CRITICAL Requirements:**
- Working directory MUST be clean before starting (no uncommitted changes)
- Target version MUST be a stable release (no -rc/-alpha/-beta/-dev)
- Cache versions MUST be bumped after update

**CI Mode (detected via `CI=true` or `GITHUB_ACTIONS` env var):**
- Skip build validation (CI runs builds in separate workflow jobs)
- Skip test validation (CI runs tests in separate workflow jobs)
- Focus on: version update, cache bumps, commit only
- Do NOT push changes (workflow handles push)

**Interactive Mode (default):**
- Build MUST succeed without errors
- Tests MUST pass (100% success rate)

**Do NOT:**

- Update to unstable/pre-release versions
- Push changes when in CI mode

**Do ONLY:**

- Update to stable release tags (format: vX.Y.Z)
- Bump cache versions: onnxruntime, models
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
cd packages/onnxruntime-builder/upstream/onnxruntime
git fetch origin --tags

# Get current version
ORT_CURRENT=$(git describe --tags 2>/dev/null || echo "unknown")
echo "Current ONNX Runtime: $ORT_CURRENT"

# Get latest stable (format: vX.Y.Z, exclude -dev/-rc/-preview)
ORT_LATEST=$(git tag -l 'v*.*.*' --sort=-version:refname | grep -v -E '(rc|alpha|beta|dev|preview)' | head -1)
echo "Latest ONNX Runtime: $ORT_LATEST"
cd ../../../..
```

**Check if update needed:**
- If ONNX Runtime already at latest, report "Already up to date" and exit
- If update available, proceed

---

### Phase 3: Update Submodule

<action>
Checkout latest version and initialize nested submodules:
</action>

```bash
cd packages/onnxruntime-builder/upstream/onnxruntime
git checkout "$ORT_LATEST"
ORT_COMMIT=$(git rev-parse HEAD)
cd ../../../..

# CRITICAL: ONNX Runtime has nested submodules (cmake/external/onnx, cmake/external/emsdk)
# These must be initialized recursively to avoid "untracked content" or "modified content" status
git submodule update --init --recursive packages/onnxruntime-builder/upstream/onnxruntime

echo "Updated ONNX Runtime to $ORT_LATEST ($ORT_COMMIT)"
```

<validation>
After this step, verify the submodule is clean:
```bash
git status packages/onnxruntime-builder/upstream/onnxruntime
```
Should show only the submodule pointer change (capital 'M'), not:
- modified content (lowercase 'm')
- untracked content
- new commits

If you see "modified content" or "untracked content", run:
```bash
git submodule update --init --recursive packages/onnxruntime-builder/upstream/onnxruntime
```
</validation>

---

### Phase 4: Update .gitmodules

<action>
Update version comment in .gitmodules:
</action>

Use the Edit tool to update the version comment in `.gitmodules`:
- Update onnxruntime comment: `# onnxruntime-X.Y.Z` (strip 'v' prefix from tag)

---

### Phase 5: Validate Build and Tests (Skip in CI Mode)

<action>
Run full validation (skip in CI mode):
</action>

```bash
if [ "$CI_MODE" = "true" ]; then
  echo "CI mode: Skipping build validation (CI will run builds separately)"
else
  cd packages/onnxruntime-builder
  pnpm run clean
  pnpm run build || exit 1
  pnpm test || exit 1
  cd ../..

  echo "Build and tests passed"
fi
```

<validation>
**Note:** ONNX Runtime builds can take 30+ minutes due to WASM compilation.
If build fails, check for:
- API changes in onnxruntime headers
- WASM compatibility issues
- Missing dependencies
</validation>

---

### Phase 6: Bump Cache Versions

<action>
Bump cache versions in .github/cache-versions.json:
</action>

Use the Read tool to get current cache versions, then use Edit tool to bump:
- `onnxruntime`: Increment version (e.g., v19 -> v20)
- `models`: Increment version (e.g., v19 -> v20) - depends on onnxruntime

---

### Phase 7: Commit Changes

<action>
Stage and commit all changes:
</action>

```bash
ORT_VERSION="${ORT_LATEST#v}"

git add .gitmodules packages/onnxruntime-builder/upstream/onnxruntime .github/cache-versions.json

git commit -m "chore(onnxruntime-builder): update ONNX Runtime to $ORT_VERSION

Update ONNX Runtime submodule to latest stable release.

Updated:
- ONNX Runtime: $ORT_CURRENT -> $ORT_LATEST
- Cache versions bumped: onnxruntime, models

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
## ONNX Runtime Update Complete

**ONNX Runtime:** $ORT_CURRENT -> $ORT_LATEST

**Cache versions bumped:**
- onnxruntime
- models

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

- ONNX Runtime submodule updated to latest stable
- .gitmodules updated with new version comment
- Build succeeded (or skipped in CI mode)
- Tests passed (or skipped in CI mode)
- Cache versions bumped: onnxruntime, models
- Commit created with detailed changelog
- Ready for push to remote

## Commands

This skill uses direct git and pnpm commands for simplicity.

## Context

This skill is useful for:

- Updating ONNX Runtime for new ML operators
- Performance improvements in inference
- Security patches
- Better model compatibility
- Regular maintenance (quarterly or as-needed)

**Safety:** Working directory must be clean. Validation ensures build/tests pass before committing. Rollback available with `git reset --hard HEAD~1`.

**Note:** ONNX Runtime is a large dependency. Updates may require significant build time (30+ minutes for WASM) and could introduce breaking changes in model loading or inference APIs.

**Post-Update Considerations:**
- **external-tools.json**: Check if `packages/onnxruntime-builder/external-tools.json` needs updates (cmake, emscripten, python versions may need bumping for new ONNX Runtime versions)
- **Pinned dependencies**: All dependencies (dev and direct) are pinned to exact versions. After updating, run `pnpm run update` to check for compatible dependency updates.
- **Model compatibility**: New ONNX Runtime versions may require model re-quantization or format updates.
