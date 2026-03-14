---
name: updating-yoga
description: Updates Yoga layout library to latest stable version. Triggers when user mentions "update Yoga", layout bugs, or Flexbox improvements.
user-invocable: true
allowed-tools: Bash, Read, Edit, Glob, Grep
---

# updating-yoga

<task>
Your task is to update the Yoga layout library to its latest stable version, validate build and tests pass, bump cache versions, and commit changes with detailed changelog.
</task>

<context>
**What is Yoga?**
Yoga is Facebook's cross-platform layout engine that implements Flexbox. It's used by socket-btm for layout calculations in ink (terminal UI).

**socket-btm Architecture:**

- Yoga version pinned in `packages/yoga-layout-builder/package.json` under `sources.yoga`
- Source cloned from GitHub (not submodule) during build
- Builds WASM module with official yoga-layout API
- Uses official `embind.cpp`, `Node.cpp`, `Config.cpp` bindings from upstream
- Wraps with `wrapAssembly.mjs` for Node.create(), node.free(), etc.

**Build Architecture:**

The yoga-layout-builder produces the official yoga-layout npm API:
- `Yoga.Node.create()` - Factory method
- `node.free()` - Cleanup method
- `node.calculateLayout(width, height, direction)` - With defaults
- Flat enum constants: `DIRECTION_LTR`, `FLEX_DIRECTION_ROW`, etc.

**Key Files:**

- `packages/yoga-layout-builder/package.json` - Contains `sources.yoga` with version, ref, url
- `packages/yoga-layout-builder/src/wrapper/YGEnums.mjs` - Yoga enum constants
- `packages/yoga-layout-builder/src/wrapper/wrapAssembly.mjs` - API wrapper (from upstream)
- `packages/yoga-layout-builder/scripts/wasm-synced/shared/generate-sync.mjs` - Sync wrapper generation
- `packages/yoga-layout-builder/scripts/paths.mjs` - Build paths and bindings configuration
- `.github/cache-versions.json` - Cache version keys for CI invalidation

**Code Transformation:**

The sync wrapper generation uses AST-based transformations (acorn + MagicString) instead of regex for robustness:
- `acorn` - JavaScript parser (pinned in pnpm-workspace.yaml catalog)
- `acorn-walk` - AST traversal (pinned in catalog)
- `magic-string` - Source code manipulation with source maps (pinned in catalog)

**Why Update:**

- Bug fixes in layout calculations
- Performance improvements
- New Flexbox features
- Security patches

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
- Modify the AST transformation code unless necessary

**Do ONLY:**

- Update to stable release tags (format: vX.Y.Z)
- Update package.json sources.yoga section
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
Check latest stable version from GitHub:
</action>

```bash
# Get current version from package.json
YOGA_CURRENT=$(node -p "require('./packages/yoga-layout-builder/package.json').sources.yoga.version")
echo "Current Yoga: v$YOGA_CURRENT"

# Get latest stable release from GitHub API
YOGA_LATEST=$(curl -s https://api.github.com/repos/facebook/yoga/releases/latest | grep '"tag_name"' | sed -E 's/.*"v([^"]+)".*/\1/')
echo "Latest Yoga: v$YOGA_LATEST"

# Get commit hash for latest release
YOGA_COMMIT=$(curl -s "https://api.github.com/repos/facebook/yoga/git/refs/tags/v$YOGA_LATEST" | grep '"sha"' | head -1 | sed -E 's/.*"([a-f0-9]+)".*/\1/')
echo "Commit: $YOGA_COMMIT"
```

**Check if update needed:**
- If Yoga already at latest, report "Already up to date" and exit
- If update available, proceed

---

### Phase 3: Update package.json

<action>
Update the sources.yoga section in package.json:
</action>

Use the Edit tool to update `packages/yoga-layout-builder/package.json`:

```json
"sources": {
  "yoga": {
    "version": "X.Y.Z",
    "type": "git",
    "url": "https://github.com/facebook/yoga.git",
    "ref": "<commit-hash>"
  }
}
```

---

### Phase 4: Check Wrapper File Sync

<action>
Compare upstream wrapper files for changes:
</action>

After updating package.json and before rebuilding, run a build to clone the new source, then check for upstream changes:

```bash
cd packages/yoga-layout-builder
pnpm run build --force 2>&1 | head -20  # Clone new source

# Compare YGEnums
echo "=== YGEnums changes ==="
diff build/shared/source/javascript/src/generated/YGEnums.ts src/wrapper/YGEnums.mjs || true

# Compare wrapAssembly
echo "=== wrapAssembly changes ==="
diff build/shared/source/javascript/src/wrapAssembly.ts src/wrapper/wrapAssembly.mjs || true

cd ../..
```

**If significant changes detected:**
1. Update `src/wrapper/YGEnums.mjs` with new enum values
2. Update `src/wrapper/wrapAssembly.mjs` with new patches
3. Ensure flat constants in YGEnums match new enum values

---

### Phase 5: Clean and Rebuild

<action>
Clean build artifacts and rebuild:
</action>

```bash
if [ "$CI_MODE" = "true" ]; then
  echo "CI mode: Skipping build validation (CI will run builds separately)"
else
  cd packages/yoga-layout-builder
  pnpm run clean
  pnpm run build --force || exit 1
  pnpm test || exit 1
  cd ../..

  # Also test ink integration
  cd packages/ink
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
# Include wrapper files if they were updated
git add packages/yoga-layout-builder/package.json .github/cache-versions.json
git add packages/yoga-layout-builder/src/wrapper/*.mjs 2>/dev/null || true

git commit -m "chore(yoga-layout-builder): update Yoga to $YOGA_LATEST

Update Yoga source to latest stable release.

Updated:
- Yoga: v$YOGA_CURRENT -> v$YOGA_LATEST
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

**Yoga:** v$YOGA_CURRENT -> v$YOGA_LATEST

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

- Yoga version updated in package.json sources.yoga
- Build succeeded (or skipped in CI mode)
- Tests passed (or skipped in CI mode)
- Cache version bumped: yoga-layout
- Commit created with detailed changelog
- Ready for push to remote

## Architecture Notes

### Official API via wrapAssembly

The yoga-layout-builder produces the same API as the official `yoga-layout` npm package:

```javascript
import Yoga from 'yoga-layout'

// Factory method (not constructor)
const node = Yoga.Node.create()

// Set dimensions
node.setWidth(100)
node.setHeight(50)
node.setFlexDirection(Yoga.FLEX_DIRECTION_ROW)

// Calculate layout with defaults
node.calculateLayout()

// Get computed values
console.log(node.getComputedWidth())  // 100

// Cleanup (required!)
node.free()
```

### AST-Based Code Transformation

The sync wrapper generation uses robust AST-based transformations:

1. **acorn** - Parses JavaScript into AST
2. **acorn-walk** - Traverses AST to find import/export nodes
3. **MagicString** - Modifies source while preserving positions

This approach is more robust than regex because:
- Handles edge cases (comments, strings containing keywords)
- Validates syntax during parsing
- Provides clear errors if structure changes

### Key Transformations

**For ESM inlining:**
- Remove `import` declarations
- Convert `export default X` to `const alias = X;`
- Convert `export default function X` to `function X`

**For CJS inlining:**
- Remove `import` declarations
- Convert `export const X` to `const X`
- Remove `export default` statements

**For wrapper export replacement:**
- Find `export default yogaPromise;` (ESM)
- Find `module.exports = yogaPromise;` (CJS)
- Replace with wrapped version

## Wrapper Files Sync Check

**IMPORTANT:** When updating Yoga, check if upstream wrapper files have changed:

### Files to Compare

1. **YGEnums.mjs** (`src/wrapper/YGEnums.mjs`)
   - Source: `yoga/javascript/src/generated/YGEnums.ts`
   - Contains enum definitions and flat constants
   - Check for new/removed enum values

2. **wrapAssembly.mjs** (`src/wrapper/wrapAssembly.mjs`)
   - Source: `yoga/javascript/src/wrapAssembly.ts`
   - Contains API wrapper patches
   - Check for new patched methods or API changes

### How to Check

```bash
# After cloning new yoga source, compare:
cd packages/yoga-layout-builder/build/shared/source

# Check YGEnums changes
diff -u javascript/src/generated/YGEnums.ts ../../../src/wrapper/YGEnums.mjs

# Check wrapAssembly changes
diff -u javascript/src/wrapAssembly.ts ../../../src/wrapper/wrapAssembly.mjs
```

### What to Look For

- **New enum values**: Add to both the enum object and the flat constants
- **New patched methods**: Add to the `for (const fnName of [...])` array in wrapAssembly
- **API signature changes**: Update method patches accordingly
- **New exports**: Update the return statement in wrapAssembly

### Bindings Files

The build uses official bindings from cloned source (`javascript/src/`):
- `embind.cpp` - Main Emscripten bindings
- `Node.cpp` - Node class implementation
- `Config.cpp` - Config class implementation

If these files change structure significantly, the build may fail with missing symbols.

## Sync Wrapper Generation

The sync wrapper (`yoga-sync.cjs` / `yoga-sync.mjs`) is generated by:

1. **Base wrapper generation** (`build-infra/wasm-synced/wasm-sync-wrapper`)
   - Embeds WASM as base64
   - Creates synchronous instantiation
   - Exports raw Emscripten module

2. **Post-processing** (`generate-sync.mjs`)
   - Inlines YGEnums.mjs (with AST transformation)
   - Inlines wrapAssembly.mjs (with AST transformation)
   - Wraps the raw module with official API
   - Exports wrapped Yoga object

### Validation Checks

The build validates:
- `Yoga.Node.create` is a function (factory method works)
- `Yoga.DIRECTION_LTR` is a number (flat constants exported)
- Module loads without errors

### Troubleshooting

**"Sync wrapper missing Node.create()"**
- wrapAssembly not applied correctly
- Check AST transformations in generate-sync.mjs

**"Sync wrapper missing DIRECTION_LTR"**
- YGEnums not inlined correctly
- Check that constants object is aliased as YGEnums

**Duplicate export errors**
- Multiple `export default` statements after inlining
- Check AST removes/converts exports properly

## Context

This skill is useful for:

- Updating Yoga for bug fixes
- Accessing new layout features
- Performance improvements
- Regular maintenance (quarterly or as-needed)

**Safety:** Working directory must be clean. Validation ensures build/tests pass before committing. Rollback available with `git reset --hard HEAD~1`.

**Post-Update Considerations:**
- **external-tools.json**: Check if `packages/yoga-layout-builder/external-tools.json` needs updates (cmake, emscripten versions may need bumping for new Yoga versions)
- **Bindings compatibility**: New Yoga versions may add/remove C++ API functions that affect bindings
- **Wrapper sync**: Compare upstream YGEnums.ts and wrapAssembly.ts for changes
- **ink integration**: Always test ink package after Yoga updates to ensure layout calculations are correct
- **ink rebuild**: After updating Yoga, rebuild ink to pick up new yoga-sync.mjs (run `updating-ink` skill or manually rebuild)
