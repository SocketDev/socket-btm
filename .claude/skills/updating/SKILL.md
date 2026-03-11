---
name: updating
description: Coordinates all dependency updates (npm packages and upstream submodules) in correct order. Triggers when user asks to "update everything", "sync all upstreams", or prepare for a release.
user-invocable: true
allowed-tools: Task, Skill, Bash, Read, Grep, Glob, Edit
---

# updating

<task>
Your task is to update all dependencies in socket-btm: first npm packages via `pnpm run update`, then upstream submodules to their latest stable versions, respecting dependency order and ensuring all builds and tests pass.
</task>

<context>
**What are Upstreams?**
socket-btm tracks multiple external dependencies via git submodules. These "upstreams" need periodic updates for security patches, bug fixes, and new features.

**Upstream Dependencies (from .gitmodules):**

| Submodule | Package | Current Version | Notes |
|-----------|---------|-----------------|-------|
| `node-smol-builder/upstream/node` | Node.js | 25.8.0 | Core runtime |
| `lief-builder/upstream/lief` | LIEF | 0.17.0 | Binary manipulation |
| `lief-builder/upstream/lzfse` | LZFSE | 1.0 | Compression |
| `curl-builder/upstream/curl` | curl | 8.18.0 | HTTP client |
| `curl-builder/upstream/mbedtls` | mbedTLS | 3.6.5 | TLS library |
| `yoga-layout-builder/upstream/yoga` | Yoga | 1.8.0 | Layout engine |
| `onnxruntime-builder/upstream/onnxruntime` | ONNX Runtime | 1.20.0 | ML inference |
| `binject/upstream/cJSON` | cJSON | 1.7.15 | JSON parsing |
| `binject/upstream/libdeflate` | libdeflate | 1.25 | Compression |
| `node-smol-builder/scripts/vendor-fast-webstreams/wpt/streams` | WPT | (epoch) | Web streams tests |

**Dependency Order:**
Some upstreams must be updated before others:
1. **LIEF** - Used by binject, binpress, node-smol (update early)
2. **curl + mbedtls** - Independent, can be parallel
3. **cJSON + libdeflate + lzfse** - Used by binject/stubs (update before binject consumers)
4. **Node.js** - Depends on LIEF being compatible (update after LIEF)
5. **yoga, onnxruntime** - Independent packages
6. **fast-webstreams** - Vendor sync, independent

**Existing Skills:**
- `updating-node` - Updates Node.js submodule, .node-version, regenerates patches
- `updating-binsuite` - Orchestrates LIEF + stubs updates with cache version bumps
- `updating-lief` - Updates LIEF submodule with API compatibility audit, bumps lief/binflate/binject/binpress/node-smol caches
- `updating-stubs` - Updates stub binaries, triggers curl, bumps stubs/binpress/node-smol caches
- `updating-curl` - Updates curl and mbedtls submodules, bumps curl/stubs/binpress/node-smol caches
- `updating-cjson` - Updates cJSON submodule, bumps binject/node-smol caches
- `updating-libdeflate` - Updates libdeflate submodule, bumps binject/node-smol caches
- `updating-lzfse` - Updates LZFSE submodule, bumps lief/stubs/binpress/node-smol caches
- `updating-yoga` - Updates Yoga layout library submodule, bumps yoga-layout cache
- `updating-onnxruntime` - Updates ONNX Runtime submodule, bumps onnxruntime/models caches
- `updating-fast-webstreams` - Updates fast-webstreams vendor from node_modules
</context>

<constraints>
**Requirements:**
- Start with clean working directory (no uncommitted changes)
- Follow dependency order: LIEF → curl → other libs → Node.js
- Target stable releases only (exclude -rc, -alpha, -beta tags)
- LIEF version is independent of Node.js version

**CI Mode** (detected via `CI=true` or `GITHUB_ACTIONS`):
- Create atomic commits, skip build validation (CI validates separately)
- Workflow handles push and PR creation

**Interactive Mode** (default):
- Validate each update with build/tests before proceeding
- Report validation results to user

**Actions:**
- Update to latest stable releases using existing skills
- Create atomic commits for each update
- Report comprehensive summary of all changes
</constraints>

<instructions>

## Process

This skill coordinates multiple upstream updates, using existing skills where available and direct submodule updates for simpler dependencies.

### Phase 1: Validate Environment

<action>
Check working directory is clean, detect CI mode, and verify submodules exist:
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

# Check working directory is clean
git status --porcelain

# Verify submodules are initialized
git submodule status
```

<validation>
- Working directory must be clean
- All submodules must show commit hash (not empty)
- If submodules missing: `git submodule update --init --recursive`
- CI_MODE detected for subsequent phases
</validation>

---

### Phase 2: Gather Current Versions

<action>
Collect current versions of all upstreams:
</action>

```bash
# Read versions from .gitmodules comments
grep -E "^# " .gitmodules

# Or check each submodule tag
for submodule in $(git submodule status | awk '{print $2}'); do
  echo "$submodule: $(cd $submodule && git describe --tags 2>/dev/null || echo 'no tag')"
done
```

---

### Phase 3: Fetch Latest Versions

<action>
For each upstream, fetch tags and identify latest stable:
</action>

```bash
# Example for a submodule
cd packages/curl-builder/upstream/curl
git fetch origin --tags
LATEST=$(git tag -l 'curl-*' --sort=-version:refname | grep -v -E '(rc|alpha|beta)' | head -1)
echo "curl latest: $LATEST"
cd ../../../..
```

**Tag Patterns by Upstream:**
- Node.js: `v*.*.*` (e.g., v25.8.1)
- LIEF: `v*.*.*` (e.g., v0.17.0) - Note: LIEF is independent of Node.js version
- curl: `curl-*_*_*` (e.g., curl-8_18_0)
- mbedtls: `v*.*.*` (e.g., v3.6.5)
- yoga: `v*.*.*` (e.g., v1.8.0)
- onnxruntime: `v*.*.*` (e.g., v1.20.0)
- cJSON: `v*.*.*` (e.g., v1.7.15)
- libdeflate: `v*.*` (e.g., v1.25)
- lzfse: `lzfse-*.*` (e.g., lzfse-1.0)

---

### Phase 4: Update npm Packages

<action>
Run pnpm update to update npm dependencies:
</action>

```bash
# Update npm packages
pnpm run update

# Check if there are changes
if [ -n "$(git status --porcelain pnpm-lock.yaml package.json packages/*/package.json)" ]; then
  git add pnpm-lock.yaml package.json packages/*/package.json
  git commit -m "chore: update npm dependencies

Updated npm packages via pnpm run update."
  echo "✓ npm packages updated"
else
  echo "npm packages already up to date"
fi
```

---

### Phase 5: Update Upstreams (Ordered)

Execute updates in dependency order. Use existing skills where available.

#### 5.1: Update LIEF (if newer available)

<action>
Use the updating-lief skill:
</action>

```
Skill({ skill: "updating-lief" })
```

Wait for skill completion before proceeding.

#### 5.2: Update curl and mbedtls (if newer available)

<action>
Use the updating-curl skill:
</action>

```
Skill({ skill: "updating-curl" })
```

Wait for skill completion before proceeding.

#### 5.3: Update cJSON (if newer available)

<action>
Use the updating-cjson skill:
</action>

```
Skill({ skill: "updating-cjson" })
```

Wait for skill completion before proceeding.

#### 5.4: Update libdeflate (if newer available)

<action>
Use the updating-libdeflate skill:
</action>

```
Skill({ skill: "updating-libdeflate" })
```

Wait for skill completion before proceeding.

#### 5.5: Update LZFSE (if newer available)

<action>
Use the updating-lzfse skill:
</action>

```
Skill({ skill: "updating-lzfse" })
```

Wait for skill completion before proceeding.

#### 5.6: Update Yoga (if newer available)

<action>
Use the updating-yoga skill:
</action>

```
Skill({ skill: "updating-yoga" })
```

Wait for skill completion before proceeding.

#### 5.7: Update ONNX Runtime (if newer available)

<action>
Use the updating-onnxruntime skill:
</action>

```
Skill({ skill: "updating-onnxruntime" })
```

Wait for skill completion before proceeding.

#### 5.8: Update Node.js (if newer available)

<action>
Use the updating-node skill:
</action>

```
Skill({ skill: "updating-node" })
```

Wait for skill completion before proceeding.

#### 5.9: Update fast-webstreams (if needed)

<action>
Use the updating-fast-webstreams skill:
</action>

```
Skill({ skill: "updating-fast-webstreams" })
```

---

### Phase 6: Final Validation

<action>
Run full build and test suite (skip in CI mode):
</action>

```bash
if [ "$CI_MODE" = "true" ]; then
  echo "CI mode: Skipping final validation (CI will run builds/tests separately)"
  echo "Commits created - ready for push by CI workflow"
else
  echo "Interactive mode: Running full validation..."
  pnpm run build
  pnpm test
fi
```

---

### Phase 7: Report Summary

<action>
Generate comprehensive update report:
</action>

```
## Upstream Sync Complete

### Updates Applied:

| Upstream | Old Version | New Version | Status |
|----------|-------------|-------------|--------|
| Node.js | v25.8.0 | v25.8.1 | ✓ Updated |
| LIEF | v0.17.0 | v0.17.0 | - No update |
| curl | 8.18.0 | 8.19.0 | ✓ Updated |
| ... | ... | ... | ... |

### Commits Created:
- abc1234 chore(curl-builder): update curl to 8.19.0
- def5678 chore(node): update Node.js from v25.8.0 to v25.8.1
- ...

### Validation:
- Build: SUCCESS
- Tests: PASS

### Next Steps:
**Interactive mode:**
1. Review changes: `git log --oneline -N`
2. Push to remote: `git push origin main`

**CI mode:**
1. Workflow will push branch and create PR
2. CI will run full build/test validation
3. Review PR when CI passes
```

</instructions>

## Success Criteria

- ✅ All upstreams checked for updates
- ✅ Updates applied in correct dependency order
- ✅ Each update validated before proceeding
- ✅ Existing skills used where available
- ✅ Full build and tests pass
- ✅ Comprehensive summary report generated

## Commands

This skill coordinates other skills and direct submodule updates:

- Uses `updating-node` skill for Node.js updates
- Uses `updating-lief` skill for LIEF updates
- Uses `updating-fast-webstreams` skill for fast-webstreams
- Direct git commands for simpler submodules

## Context

This skill is useful for:

- Periodic maintenance (monthly or quarterly)
- Security patch rollout across all dependencies
- Major version upgrades
- Pre-release preparation

**Safety:** Each update is validated independently. Failures stop the process. Rollback individual updates with `git reset --hard HEAD~N`.

**Trade-offs:**

- ✓ Comprehensive: Updates all upstreams in one operation
- ✓ Ordered: Respects dependency chain
- ✓ Validated: Each step verified before continuing
- ✓ Resumable: Can restart from any failed step
- ✗ Time-consuming: Full sync may take significant time
- ✗ Partial failures: May leave some upstreams updated, others not

**Post-Update Considerations:**
- **external-tools.json**: Upstream updates may require bumping build tool versions (cmake, emscripten, python) in `external-tools.json` files across affected packages
- **Pinned dependencies**: All dependencies (dev and direct) are pinned to exact versions. The `pnpm run update` step at the beginning handles npm package updates, but manual review may be needed for compatibility.
- **Cache versions**: Each updating-* skill handles its own cache version bumps in `.github/cache-versions.json`
