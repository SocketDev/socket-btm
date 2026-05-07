# upstreaming Reference Documentation

This document provides detailed information about upstream dependencies, version detection, and update procedures for the upstreaming skill.

## Table of Contents

1. [Upstream Inventory](#upstream-inventory)
2. [Version Detection](#version-detection)
3. [Dependency Order](#dependency-order)
4. [Update Procedures](#update-procedures)
5. [Validation](#validation)
6. [Troubleshooting](#troubleshooting)

---

## Upstream Inventory

### Complete Submodule List

From `.gitmodules`:

```
# node-25.5.0
packages/node-smol-builder/upstream/node → https://github.com/nodejs/node.git

# yoga-1.8.0
packages/yoga-layout-builder/upstream/yoga → https://github.com/facebook/yoga.git

# onnxruntime-1.20.0
packages/onnxruntime-builder/upstream/onnxruntime → https://github.com/microsoft/onnxruntime.git

# lief-0.17.0
packages/lief-builder/upstream/lief → https://github.com/lief-project/LIEF.git

# lzfse-1.0
packages/lief-builder/upstream/lzfse → https://github.com/lzfse/lzfse.git

# cJSON-1.7.15
packages/binject/upstream/cJSON → https://github.com/DaveGamble/cJSON.git

# libdeflate-1.25
packages/binject/upstream/libdeflate → https://github.com/ebiggers/libdeflate.git

# curl-8.18.0
packages/curl-builder/upstream/curl → https://github.com/curl/curl.git

# mbedtls-3.6.5
packages/curl-builder/upstream/mbedtls → https://github.com/Mbed-TLS/mbedtls.git

# wpt-epochs/three_hourly/2026-02-24_21H
packages/node-smol-builder/scripts/vendor-fast-webstreams/wpt/streams → https://github.com/web-platform-tests/wpt.git
```

### Categorization

**Has Dedicated Skill:**
- Node.js → `updating-node`
- LIEF → `updating-lief`
- fast-webstreams → `updating-fast-webstreams`

**Simple Submodule Update:**
- curl
- mbedtls
- yoga
- onnxruntime
- cJSON
- libdeflate
- lzfse

**Special Handling:**
- WPT streams (epoch-based, used for testing only)

---

## Version Detection

### Tag Patterns

Each upstream uses different tag naming conventions:

| Upstream | Pattern | Example | Sort Flag |
|----------|---------|---------|-----------|
| Node.js | `v*.*.*` | v1.2.3 | `-version:refname` |
| LIEF | `v*.*.*` | v0.17.0 | `-version:refname` |
| curl | `curl-*_*_*` | curl-8_18_0 | `-version:refname` |
| mbedtls | `v*.*.*` | v3.6.5 | `-version:refname` |
| yoga | `v*.*.*` | v1.8.0 | `-version:refname` |
| onnxruntime | `v*.*.*` | v1.20.0 | `-version:refname` |
| cJSON | `v*.*.*` | v1.7.15 | `-version:refname` |
| libdeflate | `v*.*` | v1.25 | `-version:refname` |
| lzfse | `lzfse-*.*` | lzfse-1.0 | `-version:refname` |

### Version Extraction Scripts

```bash
# Node.js
cd packages/node-smol-builder/upstream/node
git tag -l 'v*.*.*' --sort=-version:refname | grep -v 'rc' | head -1

# LIEF
cd packages/lief-builder/upstream/lief
git tag -l 'v*.*.*' --sort=-version:refname | grep -v -E '(rc|alpha|beta)' | head -1

# curl (note: underscores in version)
cd packages/curl-builder/upstream/curl
git tag -l 'curl-*' --sort=-version:refname | head -1

# mbedtls
cd packages/curl-builder/upstream/mbedtls
git tag -l 'v*.*.*' --sort=-version:refname | head -1

# yoga
cd packages/yoga-layout-builder/upstream/yoga
git tag -l 'v*.*.*' --sort=-version:refname | head -1

# onnxruntime
cd packages/onnxruntime-builder/upstream/onnxruntime
git tag -l 'v*.*.*' --sort=-version:refname | head -1

# cJSON
cd packages/binject/upstream/cJSON
git tag -l 'v*.*.*' --sort=-version:refname | head -1

# libdeflate
cd packages/binject/upstream/libdeflate
git tag -l 'v*.*' --sort=-version:refname | head -1

# lzfse
cd packages/lief-builder/upstream/lzfse
git tag -l 'lzfse-*' --sort=-version:refname | head -1
```

### Reading Current Version from .gitmodules

The `.gitmodules` file contains version comments above each submodule:

```bash
# Extract all version comments
grep -E "^# " .gitmodules

# Extract specific version
grep -B1 "packages/curl-builder/upstream/curl" .gitmodules | grep "^#"
```

---

## Dependency Order

### Why Order Matters

Some packages depend on others being updated first:

```
LIEF ─────────────────────────────────────┐
  ↓                                        │
binject (uses LIEF for binary ops)         │
  ↓                                        │
stubs-builder (embeds binject artifacts)   │
  ↓                                        │
binpress (uses stubs)                      │
  ↓                                        │
node-smol (uses binpress, LIEF) ───────────┘

curl + mbedtls (independent pair)

yoga (independent)

onnxruntime (independent)
```

### Recommended Update Order

1. **LIEF** - Foundation for binary manipulation
2. **lzfse** - Compression library used with LIEF
3. **cJSON** - JSON parsing for binject
4. **libdeflate** - Compression for binject
5. **curl + mbedtls** - Independent, can be parallel
6. **yoga** - Independent
7. **onnxruntime** - Independent
8. **Node.js** - Core runtime, depends on LIEF compatibility
9. **fast-webstreams** - Vendor sync, run last

### LIEF and Node.js Relationship

**Important clarification:** Node.js does NOT specify a required LIEF version. The relationship is:

- Node.js build system has a `node_use_lief` flag
- When enabled, it expects LIEF at `deps/LIEF/`
- Socket BTM provides LIEF at build time via `lief-builder`
- Socket BTM controls the exact LIEF version used
- LIEF should be updated BEFORE Node.js to ensure compatibility
- If LIEF API changes break binject/node-smol, fix before updating Node.js

---

## Update Procedures

### Using Existing Skills

**For Node.js:**
```
Skill({ skill: "update-node" })
```
- Updates submodule to latest stable tag
- Updates `.node-version`
- Regenerates patches
- Validates build and tests
- Creates 2 commits

**For LIEF:**
```
Skill({ skill: "updating-lief" })
```
- Updates submodule to specified or latest version
- Performs comprehensive API audit
- Fixes API compatibility issues
- Validates build and tests
- Creates commits with audit report

**For fast-webstreams:**
```
Skill({ skill: "syncing-fast-webstreams" })
```
- Syncs vendor from node_modules
- Converts ES modules to CommonJS

### Simple Submodule Update Procedure

For upstreams without dedicated skills:

```bash
# 1. Navigate to submodule
cd packages/<package>/upstream/<name>

# 2. Fetch latest tags
git fetch origin --tags

# 3. Find latest stable tag
LATEST=$(git tag -l '<pattern>' --sort=-version:refname | grep -v -E '(rc|alpha|beta)' | head -1)
echo "Latest: $LATEST"

# 4. Checkout new tag
git checkout "$LATEST"

# 5. Return to repo root
cd ../../../../  # adjust depth as needed

# 6. Update .gitmodules comment
# Edit the version comment above the submodule entry

# 7. Stage changes
git add packages/<package>/upstream/<name> .gitmodules

# 8. Build and test the affected package
cd packages/<package>
pnpm run clean
pnpm run build
pnpm test
cd ../..

# 9. Commit
git commit -m "chore(<package>): update <name> to $LATEST

Updated <name> submodule from <old-version> to $LATEST.

Changes:
- [Brief summary of notable changes if known]"
```

### Updating .gitmodules Comment

The version comment format is: `# name-version`

Example:
```diff
-# curl-8.18.0
+# curl-8.19.0
 [submodule "packages/curl-builder/upstream/curl"]
```

---

## Validation

### Per-Package Validation

After updating each submodule, validate the affected package:

```bash
cd packages/<affected-package>
pnpm run clean
pnpm run build
pnpm test
```

### Cross-Package Validation

Some updates affect multiple packages:

| Updated | Must Also Validate |
|---------|-------------------|
| LIEF | lief-builder, binject, binpress, bin-infra, node-smol |
| lzfse | lief-builder, stubs-builder |
| cJSON | binject |
| libdeflate | binject |
| curl | curl-builder |
| mbedtls | curl-builder |

### Full Validation

After all updates complete:

```bash
# From repo root
pnpm run clean --all  # If available
pnpm run build
pnpm test
```

---

## Troubleshooting

### Submodule Not Initialized

```bash
# Initialize all submodules
git submodule update --init --recursive

# Initialize specific submodule
git submodule update --init packages/curl-builder/upstream/curl
```

### Tag Not Found

If `git tag -l` returns empty:

```bash
# Ensure tags are fetched
git fetch origin --tags --force

# Check remote tags directly
git ls-remote --tags origin
```

### Build Failure After Update

1. Check for API breaking changes in the upstream's changelog
2. For LIEF: Use `updating-lief` skill which performs API audit
3. For others: Review build error messages and update code as needed
4. Rollback if needed: `git checkout HEAD~1 -- packages/<package>/upstream/<name>`

### Partial Sync Recovery

If sync fails partway through:

1. Check which commits were created: `git log --oneline -10`
2. Decide whether to keep or rollback completed updates
3. To rollback all: `git reset --hard <commit-before-sync>`
4. To continue: Resume from the failed step

### Version Mismatch

If `.gitmodules` comment doesn't match actual submodule:

```bash
# Check actual submodule version
cd packages/<package>/upstream/<name>
git describe --tags

# Update .gitmodules to match
# Then: git add .gitmodules && git commit --amend
```

---

## Quick Reference

### Check All Current Versions

```bash
echo "=== Current Upstream Versions ==="
grep -E "^# " .gitmodules
```

### Check All for Updates

```bash
echo "=== Checking for Updates ==="
for submodule in $(git config --file .gitmodules --get-regexp path | awk '{print $2}'); do
  name=$(basename "$submodule")
  cd "$submodule" 2>/dev/null || continue
  git fetch origin --tags -q
  current=$(git describe --tags 2>/dev/null || echo "unknown")
  latest=$(git tag -l --sort=-version:refname | grep -v -E '(rc|alpha|beta)' | head -1)
  if [ "$current" != "$latest" ] && [ -n "$latest" ]; then
    echo "UPDATE AVAILABLE: $name: $current → $latest"
  else
    echo "Up to date: $name ($current)"
  fi
  cd - > /dev/null
done
```
