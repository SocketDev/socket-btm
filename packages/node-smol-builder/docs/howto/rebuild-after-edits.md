# How to Rebuild After Edits

Guide for making changes and rebuilding efficiently.

## Key Principle

**Always edit canonical source packages, never edit additions/ directly.**

```
CORRECT:
packages/build-infra/src/socketsecurity/build-infra/file_utils.c

WRONG (will be overwritten):
packages/node-smol-builder/additions/source-patched/src/socketsecurity/build-infra/file_utils.c
```

## Workflow

### 1. Edit Source Package

```bash
# Edit the canonical file
vim packages/build-infra/src/socketsecurity/build-infra/file_utils.c
```

### 2. Clean Build Directory

**Critical:** Always clean before rebuilding to invalidate checkpoints.

```bash
pnpm --filter node-smol-builder run clean
```

### 3. Rebuild

```bash
pnpm --filter node-smol-builder run build
```

The build will:
1. Detect source changes
2. Sync sources to additions/
3. Recompile affected files
4. Run through remaining stages

## What Triggers Rebuilds

| Change Type | Stages Rebuilt |
|-------------|----------------|
| Patch file modified | source-patched → all |
| Source package modified | binary-released → all |
| Build script modified | Affected stage → all |
| `--clean` flag | All stages |

## Source Package Edit Locations

### build-infra (16 files)

```bash
packages/build-infra/src/socketsecurity/build-infra/
├── debug_common.h
├── dlx_cache_common.h
├── file_io_common.c
├── file_io_common.h
├── file_utils.c
├── file_utils.h
├── gzip_compress.c
├── gzip_compress.h
├── path_utils.c
├── path_utils.h
├── posix_compat.h
├── process_exec.c
├── process_exec.h
├── tar_create.c
├── tar_create.h
└── tmpdir_common.h
```

### bin-infra (29 files)

```bash
packages/bin-infra/src/socketsecurity/bin-infra/
├── binary_format.c
├── binary_format.h
├── compression_common.c
├── compression_common.h
├── segment_names.h
├── smol_segment.c
├── smol_segment.h
├── stub_smol_repack_lief.cpp
├── stub_smol_repack_lief.h
└── ...
```

### binject (22 files)

```bash
packages/binject/src/socketsecurity/binject/
├── binject.c
├── binject.h
├── macho_inject_lief.cpp
├── elf_inject_lief.cpp
├── pe_inject_lief.cpp
├── stub_repack.c
├── stub_repack.h
└── ...
```

## Cache Version Bumps

When modifying source files, bump cache versions in `.github/cache-versions.json`:

### Dependency Chain

```
build-infra/   → bump: stubs-builder, binflate, binject, binpress, node-smol
bin-infra/     → bump: stubs-builder, binflate, binject, binpress, node-smol
binject/       → bump: binject, node-smol
stubs-builder/ → bump: stubs-builder, binpress, node-smol
binpress/      → bump: binpress, node-smol
binflate/      → bump: binflate
```

### Example

```json
// .github/cache-versions.json
{
  "stubs": "v25",      // Was v24, bump if build-infra or bin-infra changed
  "binflate": "v56",
  "binject": "v76",
  "binpress": "v76",
  "node-smol": "v64"   // Was v63, bump if any source package changed
}
```

## Incremental Rebuild Tips

### Skip Compilation

If you only changed post-compilation stages:

```bash
pnpm run build --from-checkpoint=binary-released
```

### Skip Compression

For faster iteration during development:

```bash
pnpm run build --stop-at=binary-stripped
```

### Test Uncompressed Binary

```bash
./build/dev/out/Stripped/node/node --version
```

## Modifying Patches

### Edit Patch File

```bash
vim packages/node-smol-builder/patches/source-patched/004-node-gyp-vfs-binject.patch
```

### Regenerate Patch

To regenerate a patch from scratch:

```bash
# 1. Get pristine file from upstream
cp upstream/node/src/node_sea.cc /tmp/node_sea.cc.orig

# 2. Make changes to a copy
cp /tmp/node_sea.cc.orig /tmp/node_sea.cc
vim /tmp/node_sea.cc

# 3. Generate unified diff
diff -u /tmp/node_sea.cc.orig /tmp/node_sea.cc > patches/source-patched/008-node-sea-bin-binject.patch

# 4. Validate patch applies
cd upstream/node && patch --dry-run < ../../patches/source-patched/008-node-sea-bin-binject.patch
```

## Modifying JavaScript Additions

JavaScript files in additions/ ARE committed (not synced):

```bash
# These can be edited directly
packages/node-smol-builder/additions/source-patched/lib/internal/socketsecurity/
├── vfs/
│   ├── index.js
│   ├── tar.js
│   └── mount.js
├── smol/
│   └── bootstrap.js
└── polyfills/
    └── locale-compare.js
```

After editing:

```bash
pnpm --filter node-smol-builder run clean
pnpm --filter node-smol-builder run build
```

## Verifying Changes

### Check Sync Happened

```bash
# Compare source package to additions
diff packages/build-infra/src/socketsecurity/build-infra/file_utils.c \
     packages/node-smol-builder/additions/source-patched/src/socketsecurity/build-infra/file_utils.c
```

### Check Compilation Included File

```bash
# Look for file in ninja log
grep "file_utils" build/dev/source/out/Release/.ninja_log
```

### Test Your Changes

```bash
./build/dev/out/Final/node/node -e "console.log('test')"
```

## Common Issues

### Changes Not Picked Up

```bash
# Always clean first
pnpm --filter node-smol-builder run clean
```

### Sync Validation Failed

```bash
# Check gitignore
cat packages/node-smol-builder/additions/source-patched/src/socketsecurity/.gitignore

# Should contain:
# binject/
# bin-infra/
# build-infra/
```

### Patch Apply Failed

```bash
# Check patch with dry-run
cd build/dev/source
patch --dry-run -p1 < ../../../patches/source-patched/004-node-gyp-vfs-binject.patch
```
