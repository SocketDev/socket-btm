---
name: updating-zstd
description: Updates zstd submodule to match Node.js deps version. Use after Node.js updates or when zstd version drifts from Node.js deps.
user-invocable: true
allowed-tools: Bash(pnpm:*), Bash(npm:*), Bash(git:*), Bash(node:*), Bash(rg:*), Bash(grep:*), Bash(find:*), Bash(ls:*), Bash(cat:*), Bash(head:*), Bash(tail:*), Bash(wc:*), Bash(diff:*), Read, Edit, Grep---

# updating-zstd

Update the zstd submodule to match the version in Node.js deps.

- **Submodule**: `packages/bin-infra/upstream/zstd` (facebook/zstd)
- **Node.js deps path**: `packages/node-smol-builder/upstream/node/deps/zstd/lib/zstd.h`
- **Vendored path**: `packages/bin-infra/upstream/zstd/lib/zstd.h`
- **Version defines**: `ZSTD_VERSION_MAJOR`, `ZSTD_VERSION_MINOR`, `ZSTD_VERSION_RELEASE`
- **Cache bumps**: `stubs`, `binflate`, `binject`, `binpress`, `node-smol`

zstd version is driven by Node.js deps. Update Node.js first (`updating-node`), then run this skill. Do not update zstd independently — the version must match what Node.js bundles to avoid compression format mismatches.

## Process

### Phase 1: Determine Version

Extract version from Node.js deps header and compare with our vendored copy:

```bash
# Helper to extract version from zstd.h
get_zstd_version() {
  local header="$1"
  local major=$(awk '/ZSTD_VERSION_MAJOR/{print $3}' "$header")
  local minor=$(awk '/ZSTD_VERSION_MINOR/{print $3}' "$header")
  local release=$(awk '/ZSTD_VERSION_RELEASE/{print $3}' "$header")
  echo "${major}.${minor}.${release}"
}

NODE_ZSTD=$(get_zstd_version packages/node-smol-builder/upstream/node/deps/zstd/lib/zstd.h)
OUR_ZSTD=$(get_zstd_version packages/bin-infra/upstream/zstd/lib/zstd.h)
echo "Node.js deps: $NODE_ZSTD, Vendored: $OUR_ZSTD"
```

Exit if already matching. If they differ, update to match Node.js deps.

### Phase 2: Update Submodule

If versions differ:

```bash
cd packages/bin-infra/upstream/zstd
git fetch --tags
git checkout vX.Y.Z
cd ../../../..
```

Update `.gitmodules` version comment: `# zstd-X.Y.Z`

### Phase 3: Bump Cache Versions

Bump these in `.github/cache-versions.json`:
- `stubs` (stubs embed zstd for decompression)
- `binflate` (links vendored zstd)
- `binject` (links vendored zstd)
- `binpress` (links vendored zstd)
- `node-smol` (uses Node.js built-in zstd, but cache should refresh)

### Phase 4: Verify

```bash
# Verify submodule matches Node.js deps
NODE_ZSTD=$(grep 'ZSTD_VERSION_RELEASE' packages/node-smol-builder/upstream/node/deps/zstd/lib/zstd.h | awk '{print $3}')
OUR_ZSTD=$(grep 'ZSTD_VERSION_RELEASE' packages/bin-infra/upstream/zstd/lib/zstd.h | awk '{print $3}')
[ "$NODE_ZSTD" = "$OUR_ZSTD" ] && echo "Aligned" || echo "MISMATCH"
```

### Phase 5: Commit

```bash
git add packages/bin-infra/upstream/zstd .gitmodules .github/cache-versions.json
git commit -m "chore(zstd): update to vX.Y.Z (align with Node.js deps)"
```
