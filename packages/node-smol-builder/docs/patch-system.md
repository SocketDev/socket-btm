# Node-SMOL Patch System

## Overview

The node-smol-builder applies 14 patches to Node.js source code to integrate SEA (Single Executable Application), VFS (Virtual Filesystem), and SMOL compression functionality. Each patch is independent and modifies exactly one Node.js source file.

## Patch Directory

```
patches/source-patched/
├── 001-common_gypi_fixes.patch           # Compiler/linker flags
├── 002-polyfills.patch                   # Locale polyfills
├── 003-realm-vfs-binding.patch           # VFS binding registration
├── 004-node-gyp-vfs-binject.patch        # Source file integration (LARGEST)
├── 005-node-binding-vfs.patch            # VFS binding replacement
├── 006-node-sea-smol-config.patch        # SEA config parsing
├── 007-node-sea-header.patch             # SEA struct definitions
├── 008-node-sea-bin-binject.patch        # Binject integration (CRITICAL)
├── 009-fix_v8_typeindex_macos.patch      # macOS V8 fix
├── 010-vfs_bootstrap.patch               # VFS initialization
├── 011-vfs_require_resolve.patch         # Module resolution hooks
├── 012-debug-utils-smol-sea-category.patch  # Debug utilities
├── 013-node-sea-silent-exit.patch        # SEA exit handling
└── 014-fast-webstreams.patch             # Fast WebStreams polyfill
```

## Patch Categories

### Build System Patches

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          BUILD SYSTEM PATCHES                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  001-common_gypi_fixes.patch                                               │
│  ─────────────────────────────                                              │
│  File: common.gypi                                                          │
│  Purpose: Optimize compiler/linker flags                                   │
│  Changes:                                                                   │
│    • Enable ThinLTO for Clang (faster linking)                             │
│    • Remove linker plugin requirement for GCC                              │
│    • Add ARM64 branch protection flags                                     │
│                                                                             │
│  004-node-gyp-vfs-binject.patch (10.7 KB - LARGEST)                        │
│  ───────────────────────────────────────────────                            │
│  File: node.gyp                                                             │
│  Purpose: Integrate all Socket Security source files                       │
│  Changes:                                                                   │
│    • Add ~55 C/C++ source files to compilation                             │
│    • Add fast-webstreams JavaScript to js2c                                │
│    • Link platform-specific compression libraries:                         │
│      - macOS: libcompression (native)                                      │
│      - Linux/Windows: liblzfse, libdeflate                                 │
│    • Add include paths for socketsecurity/ headers                         │
│                                                                             │
│  009-fix_v8_typeindex_macos.patch                                          │
│  ─────────────────────────────────                                          │
│  File: deps/v8/src/wasm/value-type.h                                       │
│  Purpose: Fix TypeIndex compilation on macOS                               │
│  Changes:                                                                   │
│    • Add constexpr constructors for TypeIndex struct                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Bootstrap & Runtime Patches

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       BOOTSTRAP & RUNTIME PATCHES                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  002-polyfills.patch                                                        │
│  ────────────────────                                                       │
│  File: lib/internal/bootstrap/node.js                                      │
│  Purpose: Load locale comparison polyfills for small-icu builds            │
│  Changes:                                                                   │
│    • Require 'internal/socketsecurity/polyfills/locale-compare'            │
│                                                                             │
│  003-realm-vfs-binding.patch                                               │
│  ───────────────────────────                                                │
│  File: lib/internal/bootstrap/realm.js                                     │
│  Purpose: Register smol_vfs binding in process bindings                    │
│  Changes:                                                                   │
│    • Add 'smol_vfs' to process binding allow list                          │
│                                                                             │
│  005-node-binding-vfs.patch                                                │
│  ──────────────────────────                                                 │
│  File: src/node_binding.cc                                                 │
│  Purpose: Replace WASI binding with smol_vfs                               │
│  Changes:                                                                   │
│    • Comment out: V(wasi)                                                  │
│    • Add: V(smol_vfs)                                                      │
│                                                                             │
│  010-vfs_bootstrap.patch                                                   │
│  ────────────────────────                                                   │
│  File: lib/internal/process/pre_execution.js                              │
│  Purpose: Initialize VFS during Node.js startup                            │
│  Changes:                                                                   │
│    • Call setupVFS() before user code runs                                 │
│    • Must run before fs module patching                                    │
│                                                                             │
│  014-fast-webstreams.patch                                                 │
│  ──────────────────────────                                                 │
│  File: lib/internal/bootstrap/web/exposed-wildcard.js                      │
│  Purpose: Replace WebStreams with Vercel's fast-webstreams                 │
│  Changes:                                                                   │
│    • Patch global WebStreams with 10x faster implementation                │
│    • Backed by Node.js native streams                                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### SEA Integration Patches

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SEA INTEGRATION PATCHES                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  006-node-sea-smol-config.patch                                            │
│  ───────────────────────────────                                            │
│  File: src/node_sea.cc                                                     │
│  Purpose: Parse SMOL configuration from SEA blob                           │
│  Changes:                                                                   │
│    • Call ParseSmolConfig() for SMOL-specific config                       │
│    • Wrapped in #ifdef HAVE_LIEF guards                                    │
│                                                                             │
│  007-node-sea-header.patch                                                 │
│  ──────────────────────────                                                 │
│  File: src/node_sea.h                                                      │
│  Purpose: Define SMOL-specific structs                                     │
│  Changes:                                                                   │
│    • Add SmolUpdateConfig struct:                                          │
│      - binname, command, url, tag, intervals                               │
│    • Add SmolVfsConfig struct:                                             │
│      - mode, source, prefix                                                │
│    • Add optional fields to SeaConfig (conditional on HAVE_LIEF)           │
│                                                                             │
│  008-node-sea-bin-binject.patch (30.2 KB - CRITICAL)                       │
│  ───────────────────────────────────────────────────                        │
│  File: src/node_sea_bin.cc                                                 │
│  Purpose: Replace Node.js LIEF injection with binject                     │
│  Changes:                                                                   │
│    • Comment out 300+ lines of Node.js LIEF code                          │
│    • Include smol_config_parser.h                                          │
│    • Call binject framework functions for:                                 │
│      - SEA blob injection                                                  │
│      - VFS blob injection                                                  │
│      - SMOL config injection                                               │
│                                                                             │
│  013-node-sea-silent-exit.patch                                            │
│  ───────────────────────────────                                            │
│  File: src/node_options.cc                                                 │
│  Purpose: Allow SEA apps to control validation                            │
│  Changes:                                                                   │
│    • Clear --build-sea flag when LIEF not compiled                        │
│    • Log debug message only when NODE_DEBUG_NATIVE=smol_sea               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### VFS Support Patches

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           VFS SUPPORT PATCHES                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  011-vfs_require_resolve.patch                                             │
│  ──────────────────────────────                                             │
│  File: lib/internal/main/embedding.js                                      │
│  Purpose: Enhance module resolution for VFS                                │
│  Changes:                                                                   │
│    • Set up process.smol and argv handling                                 │
│    • Require smolBootstrap AFTER main thread execution                     │
│    • Enhance embedderRequire with VFS support                              │
│    • Enable --vfs-compat mode for legacy apps                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Debug & Utility Patches

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        DEBUG & UTILITY PATCHES                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  012-debug-utils-smol-sea-category.patch                                   │
│  ────────────────────────────────────────                                   │
│  File: src/debug_utils.h                                                   │
│  Purpose: Add SMOL_SEA debug category                                      │
│  Changes:                                                                   │
│    • Add V(SMOL_SEA) to debug category macro                               │
│    • Enables NODE_DEBUG_NATIVE=smol_sea for diagnostics                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Files Modified by Patches

| Patch | File Modified | Size |
|-------|---------------|------|
| 001 | `common.gypi` | ~2 KB |
| 002 | `lib/internal/bootstrap/node.js` | ~0.5 KB |
| 003 | `lib/internal/bootstrap/realm.js` | ~0.3 KB |
| 004 | `node.gyp` | **10.7 KB** |
| 005 | `src/node_binding.cc` | ~1 KB |
| 006 | `src/node_sea.cc` | ~1.3 KB |
| 007 | `src/node_sea.h` | ~1.3 KB |
| 008 | `src/node_sea_bin.cc` | **30.2 KB** |
| 009 | `deps/v8/src/wasm/value-type.h` | ~0.5 KB |
| 010 | `lib/internal/process/pre_execution.js` | ~0.7 KB |
| 011 | `lib/internal/main/embedding.js` | ~1.1 KB |
| 012 | `src/debug_utils.h` | ~0.9 KB |
| 013 | `src/node_options.cc` | ~1.3 KB |
| 014 | `lib/internal/bootstrap/web/exposed-wildcard.js` | ~1 KB |

## Patch Format Requirements

### Standard Unified Diff Format

Patches MUST use standard unified diff format, NOT git diff format:

```diff
Socket Security: Description of changes

Detailed explanation of what this patch does.

Files modified:
- file1: Description

--- node.gyp.orig
+++ node.gyp
@@ -1003,6 +1003,10 @@
         'defines': [ 'HAVE_LIEF=1' ],
+        'sources': [
+          'src/file.cc',
+        ],
```

**FORBIDDEN** git diff format:

```diff
diff --git a/node.gyp b/node.gyp  ← FORBIDDEN
index 8430fa0b66..24531b6479 100644  ← FORBIDDEN
--- a/node.gyp  ← FORBIDDEN
+++ b/node.gyp  ← FORBIDDEN
```

### Patch Independence

Each patch:
- Affects exactly **ONE** file
- Does **NOT** depend on other patches
- Can be regenerated without applying other patches first

### Patch Quality Guidelines

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PATCH QUALITY GUIDELINES                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ✓ GOOD - Minimal insertion at function end:                               │
│  ──────────────────────────────────────────────                             │
│    }                                                                        │
│    return require(normalizedId);                                            │
│  + }                                                                        │
│  +                                                                          │
│  + // New enhancement code.                                                 │
│  + const hasVFSInfra = smolBootstrap.hasVFSInfrastructure();               │
│  + if (hasVFSInfra) {                                                       │
│  +   embedderRequire = smolBootstrap.enhanceRequire(embedderRequire);      │
│  + }                                                                        │
│                                                                             │
│   return [process, embedderRequire, embedderRunCjs];                       │
│                                                                             │
│  ✗ BAD - Unnecessary line shifts:                                          │
│  ──────────────────────────────────                                         │
│    }                                                                        │
│  -  return require(normalizedId);                                          │
│  -}                                                                         │
│  -                                                                          │
│  -return [process, embedderRequire, embedderRunCjs];                       │
│  +  return require(normalizedId);                                          │
│  +}                                                                         │
│  +                                                                          │
│  +// New enhancement code.                                                  │
│  +const hasVFSInfra = smolBootstrap.hasVFSInfrastructure();                │
│  +...                                                                       │
│  +                                                                          │
│  +return [process, embedderRequire, embedderRunCjs];                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Regenerating Patches

### Workflow

1. Get pristine copy of the target file from upstream:
   ```bash
   cp upstream/node/src/node_sea.h /tmp/node_sea.h.orig
   ```

2. Make changes to a copy:
   ```bash
   cp /tmp/node_sea.h.orig /tmp/node_sea.h
   # Edit /tmp/node_sea.h
   ```

3. Generate patch:
   ```bash
   diff -u /tmp/node_sea.h.orig /tmp/node_sea.h > patches/source-patched/007-node-sea-header.patch
   ```

4. Validate patch:
   ```bash
   cd upstream/node
   patch --dry-run < ../../patches/source-patched/007-node-sea-header.patch
   ```

### Using the Skill

For complex patch regeneration, use the `regenerating-node-patches` skill:

```bash
/regenerating-node-patches
```

This skill handles:
- Pristine upstream extraction
- Clean diff generation
- Patch validation
- Build verification

## Patch Application Process

Located in: `scripts/source-patched/shared/apply-patches.mjs`

### Steps

1. **Find patches**: Read from `patches/source-patched/`
2. **Validate**: `patch --dry-run` for each patch
3. **Apply**: `patch -p1 --batch --forward` sequentially
4. **Create checkpoint**: Record applied patches

### Error Handling

If a patch fails:
```bash
# Check which patch failed
ls patches/source-patched/

# Test patch manually
cd build/dev/source
patch --dry-run -p1 < ../../../patches/source-patched/XXX-name.patch

# If context has drifted, regenerate from pristine upstream
```

## Integration Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       PATCH INTEGRATION FLOW                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. SOURCE COPIED                                                           │
│     └── Pristine Node.js source from upstream/node                         │
│                                                                             │
│  2. PATCHES APPLIED (14 patches in numerical order)                         │
│     └── 001 → 002 → ... → 014                                              │
│                                                                             │
│  3. ADDITIONS COPIED                                                        │
│     └── additions/source-patched/ → source tree                            │
│         ├── lib/internal/socketsecurity/ (JavaScript)                      │
│         ├── src/socketsecurity/ (C/C++ from packages)                      │
│         └── deps/ (compression libraries)                                  │
│                                                                             │
│  4. CONFIGURE + COMPILE                                                     │
│     └── Node.js build with Socket Security integration                     │
│                                                                             │
│  5. FINAL BINARY                                                            │
│     └── node-smol with SEA, VFS, compression built-in                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Summary of Functionality Added

| Capability | Patches | What It Enables |
|------------|---------|-----------------|
| SEA Injection | 006, 007, 008, 013 | Build single-executable apps with embedded code |
| VFS Support | 003, 005, 010, 011 | Embed TAR-based virtual filesystems |
| SMOL Compression | 004 (libraries), 006, 007 | Self-extracting compressed binaries |
| Build Optimization | 001, 009 | ThinLTO, ARM64 branch protection |
| Fast WebStreams | 014 | 10x faster stream throughput |
| Debug Support | 012 | NODE_DEBUG_NATIVE=smol_sea |
| Locale Polyfills | 002 | String comparison for small-icu |
