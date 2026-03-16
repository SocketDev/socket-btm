---
name: updating-ink
description: Updates ink TUI framework to latest stable version. Triggers when user mentions "update ink", terminal UI bugs, or rendering improvements.
user-invocable: true
allowed-tools: Bash, Read, Edit, Glob, Grep
---

# updating-ink

<task>
Your task is to update the ink TUI framework to its latest stable version, regenerate patches if needed, validate build and tests pass, bump cache versions, and commit changes with detailed changelog.
</task>

<context>
**What is ink?**
ink is a React-based terminal UI framework. socket-btm uses a prepatched version of ink that bundles yoga-sync (synchronous Yoga WASM) instead of depending on the yoga-layout npm package.

**socket-btm Architecture:**

- ink version pinned in `packages/ink-builder/package.json` under `sources.ink`
- sources.ink tracks GitHub ref for version reference
- Downloaded from npm registry (pre-built JavaScript, avoids TypeScript build complexity)
- Patches applied from `packages/ink-builder/patches/ink@X.Y.Z.patch`
- yoga-layout imports rewired to use bundled yoga-sync.mjs
- yoga-sync.mjs copied from yoga-layout-builder output

**Build Process:**

1. Download ink tarball from npm (pre-built JavaScript)
2. Extract to build directory
3. Apply version-specific patch file
4. Rewire yoga-layout imports to ./yoga-sync.mjs
5. Copy yoga-sync.mjs from yoga-layout-builder
6. Output to dist/

**Key Files:**

- `packages/ink-builder/package.json` - Contains `sources.ink` with version
- `packages/ink-builder/patches/ink@X.Y.Z.patch` - Version-specific patches
- `packages/ink-builder/scripts/build.mjs` - Build script
- `packages/ink-builder/dist/` - Built output with bundled yoga-sync
- `.github/cache-versions.json` - Cache version keys for CI invalidation

**Patches Applied:**

The patch file applies these fixes:
- `signal-exit` import: Convert default import to named import `{ onExit as signalExit }`
- `devtools` disable: Remove dynamic devtools import for smaller bundle

**Dependencies:**

- **yoga-layout-builder**: ink depends on yoga-sync.mjs from yoga-layout-builder
- Build yoga-layout-builder BEFORE building ink

**Why Update:**

- Bug fixes in rendering/layout
- Performance improvements
- New React features support
- Security patches

**Cache Version Bump:**
When ink is updated, bump these cache versions in `.github/cache-versions.json`:
- `ink` - ink TUI framework artifacts
</context>

<constraints>
**CRITICAL Requirements:**
- Working directory MUST be clean before starting (no uncommitted changes)
- Target version MUST be a stable release (no -rc/-alpha/-beta)
- yoga-layout-builder MUST be built before ink
- Cache version MUST be bumped after update

**CI Mode (detected via `CI=true` or `GITHUB_ACTIONS` env var):**
- Skip build validation (CI runs builds in separate workflow jobs)
- Skip test validation (CI runs tests in separate workflow jobs)
- Focus on: version update, patch regeneration, cache bump, commit only
- Do NOT push changes (workflow handles push)

**Interactive Mode (default):**
- Build MUST succeed without errors
- Tests MUST pass (100% success rate)

**Do NOT:**

- Update to unstable/pre-release versions
- Push changes when in CI mode
- Modify yoga-layout-builder (use updating-yoga skill for that)

**Do ONLY:**

- Update to stable release versions
- Update package.json sources.ink section
- Regenerate patch file if needed
- Bump cache version: ink
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

### Phase 2: Check yoga-layout-builder

<action>
Verify yoga-layout-builder is built (ink depends on yoga-sync.mjs):
</action>

```bash
# Check if yoga-sync.mjs exists
if [ -f "packages/yoga-layout-builder/build/dev/out/Final/yoga-sync.mjs" ] || \
   [ -f "packages/yoga-layout-builder/build/prod/out/Final/yoga-sync.mjs" ]; then
  echo "yoga-sync.mjs found"
else
  echo "ERROR: yoga-sync.mjs not found. Run yoga-layout-builder build first."
  echo "  cd packages/yoga-layout-builder && pnpm run build"
  exit 1
fi
```

---

### Phase 3: Determine Target Version

<action>
Check latest stable version from GitHub:
</action>

```bash
# Get current version from package.json
INK_CURRENT=$(node -p "require('./packages/ink-builder/package.json').sources.ink.version")
echo "Current ink: v$INK_CURRENT"

# Get latest stable release from GitHub API
INK_LATEST=$(curl -s https://api.github.com/repos/vadimdemedes/ink/releases/latest | grep '"tag_name"' | sed -E 's/.*"v([^"]+)".*/\1/')
echo "Latest ink: v$INK_LATEST"

# Get commit SHA for the release tag
INK_SHA=$(curl -s "https://api.github.com/repos/vadimdemedes/ink/git/refs/tags/v$INK_LATEST" | grep '"sha"' | head -1 | sed -E 's/.*"([a-f0-9]+)".*/\1/')
echo "Commit SHA: $INK_SHA"
```

**Check if update needed:**
- If ink already at latest, report "Already up to date" and exit
- If update available, proceed

---

### Phase 4: Update package.json

<action>
Update the sources.ink section in package.json:
</action>

Use the Edit tool to update `packages/ink-builder/package.json`:

```json
"sources": {
  "ink": {
    "version": "X.Y.Z",
    "type": "git",
    "url": "https://github.com/vadimdemedes/ink.git",
    "ref": "<commit-sha-for-tag>"
  }
}
```

**Note:** The `ref` field should be the commit SHA for the tag, not the tag name itself (e.g., `7e2ae86e5ec75dd871403822ae29f08bd27f8aea` not `v6.3.1`).

---

### Phase 5: Regenerate Patch File

<action>
Download new ink version from npm and regenerate patch:
</action>

```bash
cd packages/ink-builder

# Clean build artifacts
pnpm run clean

# Download new ink version from npm (pre-built JavaScript)
mkdir -p build
npm pack ink@$INK_LATEST --pack-destination build

# Extract to compare
mkdir -p build/original
tar -xzf build/ink-$INK_LATEST.tgz -C build/original

echo "Files that need patching:"
echo "- build/ink.js (signal-exit import)"
echo "- build/reconciler.js (devtools disable)"

cd ../..
```

**Manual Steps:**
1. Copy original to patched: `cp -r build/original/package build/patched`
2. Apply patches manually to built files in `build/patched/build/`
3. Generate new patch file: `diff -ruN build/original/package build/patched > patches/ink@$INK_LATEST.patch`
4. Test the patch applies cleanly

---

### Phase 6: Clean and Rebuild

<action>
Clean build artifacts and rebuild:
</action>

```bash
if [ "$CI_MODE" = "true" ]; then
  echo "CI mode: Skipping build validation (CI will run builds separately)"
else
  cd packages/ink-builder
  pnpm run clean
  pnpm run build || exit 1
  pnpm test || exit 1
  cd ../..

  echo "Build and tests passed"
fi
```

---

### Phase 7: Bump Cache Version

<action>
Bump the ink cache version in .github/cache-versions.json:
</action>

Use the Read tool to get current cache version, then use Edit tool to bump:
- `ink`: Increment version (e.g., v1 -> v2)

---

### Phase 8: Commit Changes

<action>
Stage and commit all changes:
</action>

```bash
# Include patch file and package.json
git add packages/ink-builder/package.json .github/cache-versions.json
git add packages/ink-builder/patches/*.patch 2>/dev/null || true

git commit -m "chore(ink): update ink to $INK_LATEST

Update ink TUI framework to latest stable release.

Updated:
- ink: $INK_CURRENT -> $INK_LATEST
- Patch regenerated for new version
- Cache version bumped: ink

Validation:
- Build: $([ "$CI_MODE" = "true" ] && echo "SKIPPED (CI)" || echo "SUCCESS")
- Tests: $([ "$CI_MODE" = "true" ] && echo "SKIPPED (CI)" || echo "PASS")"
```

---

### Phase 9: Report Summary

<action>
Generate final summary:
</action>

```
## ink Update Complete

**ink:** $INK_CURRENT -> $INK_LATEST

**Cache versions bumped:**
- ink

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

- ink version updated in package.json sources.ink
- Patch file regenerated for new version
- Build succeeded (or skipped in CI mode)
- Tests passed (or skipped in CI mode)
- Cache version bumped: ink
- Commit created with detailed changelog
- Ready for push to remote

## Patch File Format

The patch file applies to extracted npm tarball. Example structure:

```patch
--- a/build/ink.js
+++ b/build/ink.js
@@ -1,5 +1,5 @@
-import signalExit from 'signal-exit';
+import { onExit as signalExit } from 'signal-exit';
 import { isCI } from 'is-in-ci';

--- a/build/reconciler.js
+++ b/build/reconciler.js
@@ -100,10 +100,8 @@
-    if (options.debug) {
-        const { default: devtools } = await import('./devtools.js');
-        devtools(root.current, options);
-    }
+    // devtools disabled - reduces bundle size and avoids dynamic import
+    void 0; // no-op
```

## Patch Regeneration Process

When updating to a new ink version:

1. **Extract original**: `tar -xzf ink-X.Y.Z.tgz`
2. **Copy to patched**: `cp -r package patched`
3. **Apply changes manually**:
   - Edit `patched/build/ink.js`: Fix signal-exit import
   - Edit `patched/build/reconciler.js`: Disable devtools
4. **Generate diff**: `diff -ruN package patched > patches/ink@X.Y.Z.patch`
5. **Test patch**: Apply patch to fresh extract to verify

## Context

This skill is useful for:

- Updating ink for bug fixes
- Accessing new terminal rendering features
- React compatibility updates
- Regular maintenance (quarterly or as-needed)

**Safety:** Working directory must be clean. Validation ensures build/tests pass before committing. Rollback available with `git reset --hard HEAD~1`.

**Dependencies:**
- **yoga-layout-builder**: MUST be built before ink (provides yoga-sync.mjs)
- If updating both, run updating-yoga FIRST, then updating-ink

**Post-Update Considerations:**
- **Patch compatibility**: New ink versions may require patch updates if patched files changed
- **API changes**: New ink versions may have breaking changes requiring code updates
- **yoga-sync compatibility**: Ensure bundled yoga-sync still works with new ink version
- **Upstream tests**: Reference upstream test patterns for smoke testing

## Upstream Test Reference

ink's upstream tests are available at: `https://github.com/vadimdemedes/ink/tree/v{VERSION}/test`

Key test categories for smoke testing:
- **Layout tests**: `flex-direction.tsx`, `flex-align-*.tsx`, `width-height.tsx`, `margin.tsx`, `padding.tsx`
- **Component tests**: `components.tsx`, `text.tsx`, `borders.tsx`
- **Rendering tests**: `render.tsx`, `render-to-string.tsx`

These tests use `renderToString()` helper which internally exercises:
1. React reconciler
2. yoga-sync layout calculations
3. Terminal output rendering

When updating ink, check if upstream added new layout tests that should be reflected in our smoke tests.
