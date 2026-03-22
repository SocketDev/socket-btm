# Claude Code Guidelines for Socket BTM

**MANDATORY**: Act as principal-level engineer. Follow these guidelines exactly.

## CANONICAL REFERENCE

See `../socket-registry/CLAUDE.md` for shared Socket standards.

## Critical Rules

### Destructive Commands - ABSOLUTE PROHIBITION

**NEVER use `rm -rf` with glob patterns matching hidden files**

- **FORBIDDEN FOREVER**: `rm -rf * .*` - Deletes .git directory, destroys repository
- **FORBIDDEN FOREVER**: Any variant that expands to hidden files without explicit safeguards
- Safe alternatives:
  - `git clean -fdx` (respects .git)
  - `rm -rf build/ node_modules/` (explicit directories)
  - `find . -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +`

**Why this rule exists:** On 2026-03-09, `rm -rf * .*` destroyed the repository during history squashing, deleting .git and all local branches. Recovery required reinitializing from remote.

**Recovery if this happens:**
1. `git init` - Reinitialize repository
2. `git remote add origin <url>` - Re-add remote
3. `git fetch origin` - Fetch remote branches
4. `git checkout -b main origin/main` - Restore main branch
5. All local-only branches are permanently lost

### Fix ALL Issues

- **Fix ALL issues when asked** - Never dismiss as "pre-existing" or "not caused by my changes"
- When asked to fix, lint, or check: fix everything found, regardless of who introduced it

### Documentation Policy - NO DOCS PROLIFERATION

**NEVER create documentation files unless explicitly requested**

- **FORBIDDEN**: Creating README.md, GUIDE.md, HOWTO.md, ARCHITECTURE.md, or docs/ directories
- **Code is documentation** - Write self-documenting code with minimal comments
- **Only exceptions**: Package README.md (1-2 sentences), CLAUDE.md, .claude/ directory
- **If user asks for documentation**: Ask whether they want it in CLAUDE.md or standalone

### Backward Compatibility

- **NO BACKWARD COMPATIBILITY** - FORBIDDEN to maintain it; we're our only consumers
- **Active removal**: MUST remove existing backward compatibility code when encountered
- **Clean breaks**: Make clean API changes without deprecation paths
- **Forbidden patterns**:
  - ❌ Renaming unused `_vars` instead of deleting
  - ❌ Re-exporting types for "compatibility"
  - ❌ Adding `// removed` comments
  - ❌ Environment variables for legacy behavior
  - ✅ Just delete unused code completely

## Code Style

### spawn() Usage

**NEVER change `shell: WIN32` to `shell: true`**

- `shell: WIN32` enables shell on Windows (needed) and disables on Unix (not needed)
- If spawn fails with ENOENT, fix by separating command and arguments:

```javascript
// WRONG - passing full command as string
spawn('python3 -m module arg1 arg2', [], { shell: WIN32 })

// CORRECT - separate command and args
spawn('python3', ['-m', 'module', 'arg1', 'arg2'], { shell: WIN32 })
```

### ESLint Disable Comments

**ALWAYS use `eslint-disable-next-line` above the line, NEVER trailing `eslint-disable-line`**

```javascript
// WRONG - trailing comment
process.exit(1) // eslint-disable-line n/no-process-exit

// CORRECT - line above
// eslint-disable-next-line n/no-process-exit
process.exit(1)
```

### Built-in Module Import Style

**Cherry-pick fs, default import path/os/url/crypto, prefer @socketsecurity/lib over child_process**

```javascript
// CORRECT
import { existsSync, readFileSync, promises as fs } from 'node:fs'
import { spawn } from '@socketsecurity/lib/spawn'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url' // Exception: cherry-pick from url

// WRONG - using node:child_process directly (except in additions/)
import { execSync } from 'node:child_process'

// WRONG - default import for fs
import fs from 'node:fs'

// WRONG - cherry-picking from path/os
import { join, resolve } from 'node:path'
```

### isMainModule Detection Pattern

**ALWAYS use exact URL match, NEVER use endsWith()**

```javascript
// CORRECT - exact URL match
const isMainModule = import.meta.url === `file://${process.argv[1]}`

// WRONG - causes race conditions when build scripts import each other
const isMainModule = process.argv[1]?.endsWith('build.mjs')
```

### Platform-Arch and libc Parameters

**ALWAYS pass libc parameter for Linux platform operations**

- Missing libc causes builds to output to wrong directories
- **Prefer `getCurrentPlatformArch()`** which auto-detects libc

```javascript
// BEST - auto-detects libc
import { getCurrentPlatformArch } from 'build-infra/lib/platform-mappings'
const platformArch = await getCurrentPlatformArch()

// CORRECT - explicit libc
import { getAssetPlatformArch, isMusl } from 'build-infra/lib/platform-mappings'
const libc = process.platform === 'linux' ? ((await isMusl()) ? 'musl' : undefined) : undefined
const platformArch = getAssetPlatformArch(process.platform, arch, libc)
```

### Logging

**ALWAYS use `@socketsecurity/lib/logger` instead of `console.*` methods**

- NEVER add emoji/symbols manually - logger provides them automatically
- Exception: `additions/` directory

```javascript
// CORRECT
import { getDefaultLogger } from '@socketsecurity/lib/logger'
const logger = getDefaultLogger()
logger.success('Build completed') // Already adds ✓

// WRONG
console.log('Starting build')
logger.info('✓ Build completed') // Don't add symbols manually
```

### Dynamic Imports

**NEVER use dynamic imports (`await import()`)**

```javascript
// WRONG
const logger = (await import('@socketsecurity/lib/logger')).getDefaultLogger()

// CORRECT
import { getDefaultLogger } from '@socketsecurity/lib/logger'
```

### Parallel Operations

**Prefer `Promise.allSettled` over `Promise.all` for independent operations**

- `Promise.allSettled` continues on rejection, providing complete results
- Use `Promise.all` only when ALL operations must succeed atomically

```javascript
// PREFERRED - shows ALL failures
const results = await Promise.allSettled([downloadFile('a'), downloadFile('b')])
const failures = results.filter(r => r.status === 'rejected')

// OK - atomic operations
await Promise.all([fs.copyFile(src1, dst1), fs.copyFile(src2, dst2)])
```

### Avoid `null` - Use `undefined`

**NEVER use `null` except for `__proto__: null` or external API requirements**

```javascript
// WRONG
let result = null
const libc = isMusl() ? 'musl' : null

// CORRECT
let result
const libc = isMusl() ? 'musl' : undefined
```

### Object Literals - Prototype-less Objects

**ALWAYS use `{ __proto__: null, ... }` for config objects, return objects, and internal state**

```javascript
// CORRECT - prototype-less objects
const config = {
  __proto__: null,
  host: options.host ?? 'localhost',
};

// CORRECT - spread options into prototype-less object
function foo(options) {
  const opts = { __proto__: null, ...options };
}

// WRONG - inherits from Object.prototype
const config = { host: 'localhost' };
```

## Node.js Additions (`additions/` directory)

Code embedded into Node.js during early bootstrap. Special constraints apply.

### Restrictions

- **No third-party packages** - Only built-in modules
- Use `require('fs')` not `require('node:fs')` - node: protocol unavailable at bootstrap
- NEVER import from `@socketsecurity/*` packages

```javascript
// WRONG
const { safeDeleteSync } = require('@socketsecurity/lib/fs')

// CORRECT
const { rmSync } = require('fs')
```

### Primordials

**ALWAYS use primordials for Map/Set operations in internal modules**

```javascript
const {
  BigInt: BigIntCtor,    // Use *Ctor suffix for constructors shadowing globals
  Error: ErrorCtor,
  MapPrototypeDelete,
  MapPrototypeGet,
  MapPrototypeSet,
  SafeMap,
  ObjectKeys,
} = primordials;

const cache = new SafeMap();
MapPrototypeSet(cache, key, value);
const entry = MapPrototypeGet(cache, key);

// .size is safe on SafeMap/SafeSet (no primordial needed)
if (cache.size > maxSize) { /* ... */ }
```

Common primordials:
- Constructors: `SafeMap`, `SafeSet`, `SafeWeakMap`
- Map: `MapPrototypeGet`, `MapPrototypeSet`, `MapPrototypeDelete`, `MapPrototypeHas`, `MapPrototypeClear`
- Set: `SetPrototypeAdd`, `SetPrototypeDelete`, `SetPrototypeHas`
- `ArrayFrom` - safe Array.from()

### Object Iteration Performance

**ALWAYS use `ObjectKeys()` + indexed for-loop**

```javascript
// CORRECT - faster
const keys = ObjectKeys(obj);
for (let i = 0, len = keys.length; i < len; i++) {
  const key = keys[i];
  const value = obj[key];
}

// WRONG - slower due to extra function call per iteration
for (const key in obj) {
  if (ObjectPrototypeHasOwnProperty(obj, key)) { /* ... */ }
}
```

### C++ Code

**NEVER use C++ exceptions** - Node.js compiled with `-fno-exceptions`

```cpp
// WRONG - throws exception
void EnsureCapacity(size_t needed) {
  if (needed > max_size_) throw std::runtime_error("overflow");
}

// CORRECT - use status flag
void EnsureCapacity(size_t needed) {
  if (needed > max_size_) { overflow_ = true; return; }
}
```

### C++ Include Paths

**ALWAYS use full `socketsecurity/...` paths**

```cpp
// CORRECT
#include "socketsecurity/http-perf/http_fast_response.h"

// WRONG - breaks builds
#include "http_fast_response.h"
```

**env.h vs env-inl.h**: If .cc file uses `Environment*` methods, include `env-inl.h` (provides inline definitions).

### Internal Module JavaScript

**NEVER require `internalBinding` from `'internal/bootstrap/realm'`** - already in scope

```javascript
// WRONG - causes duplicate declaration error
const { internalBinding } = require('internal/bootstrap/realm')

// CORRECT - already in scope
const binding = internalBinding('my_binding')
```

## Node.js Source Patches

Patches in `packages/node-smol-builder/patches/source-patched/`:

### Format

**ALWAYS use standard unified diff format, NEVER git diff format**

```diff
# CORRECT - standard unified diff
--- node.gyp.orig
+++ node.gyp
@@ -1003,6 +1003,10 @@
         'defines': [ 'HAVE_LIEF=1' ],
+        'sources': [
+          'src/file.cc',
+        ],
```

```diff
# FORBIDDEN - git diff format
diff --git a/node.gyp b/node.gyp  ← FORBIDDEN
index 8430fa0b66..24531b6479 100644  ← FORBIDDEN
--- a/node.gyp  ← FORBIDDEN git path prefix
```

### Patch Quality

- **Minimal touch**: Only modify minimum lines needed
- **Clean diffs**: Avoid shifting line numbers unnecessarily
- **No style changes**: Don't reformat code outside patch scope
- **Surgical edits**: Add new code at function ends when possible

### Patch Independence

Each patch affects exactly ONE file and does NOT depend on other patches. To regenerate:
1. Get pristine file from `upstream/node`
2. Apply changes to that single file
3. Generate: `diff -u original modified > patch_file`
4. Validate: `patch --dry-run < patch_file`

## Build System

### Building Packages

**ALWAYS use `pnpm run build`, NEVER invoke Makefiles directly**

```bash
# CORRECT
pnpm --filter stubs-builder build

# WRONG - bypasses dependency downloads
make -f Makefile.macos all
```

Build scripts handle downloading prebuilt dependencies (curl, LIEF) from releases.

### Clean Before Rebuild

**ALWAYS run clean before rebuilding**

```bash
# CORRECT
pnpm --filter node-smol-builder clean
pnpm --filter node-smol-builder build

# WRONG - may use stale checkpoint
pnpm run build
```

NEVER manually delete checkpoint files - the clean script knows all locations.

### Source of Truth Architecture

**Source packages are canonical - additions syncs FROM packages**

- `binject`, `bin-infra`, `build-infra` are the **source of truth**
- ALL work in source packages, then sync to `additions/`
- NEVER make changes only in additions - they will be overwritten

```bash
# CORRECT - edit source package first, then sync
vim packages/build-infra/src/socketsecurity/build-infra/debug_common.h
cp packages/build-infra/src/... additions/.../

# WRONG - editing additions directly
vim packages/node-smol-builder/additions/.../debug_common.h
```

### Cache Version Cascade

**When modifying source, bump `.github/cache-versions.json` for all dependents**

| Changed | Bump |
|---------|------|
| build-infra/src/socketsecurity/build-infra/ | stubs, binflate, binject, binpress, node-smol |
| bin-infra/src/socketsecurity/bin-infra/ | stubs, binflate, binject, binpress, node-smol |
| binject/src/socketsecurity/binject/ | binject, node-smol |
| stubs-builder/src/ | stubs, binpress, node-smol |
| binpress/src/ | binpress, node-smol |
| binflate/src/ | binflate |

### Integration Tests

**ALWAYS use Final binary, NEVER intermediate stages**

```javascript
// CORRECT
import { getLatestFinalBinary } from '../paths.mjs'

// WRONG
import { getLatestCompressedBinary } from '../paths.mjs'
```

### Fetching npm Packages

**ALWAYS use npm registry directly, NEVER CDNs**

```bash
# CORRECT
npm pack package-name --pack-destination /tmp
curl -sL "https://registry.npmjs.org/package-name/-/package-name-1.0.0.tgz"

# WRONG
curl -sL "https://unpkg.com/package-name@1.0.0/..."
```

### File Editing

**ALWAYS use Edit tool, NEVER sed/awk for code modifications**

## Glossary

### Binary Formats

- **Mach-O**: macOS/iOS executable format
- **ELF**: Linux executable format
- **PE**: Windows executable format

### Build Concepts

- **Checkpoint**: Cached snapshot of build progress (e.g., "source-copied", "compiled")
- **Progressive Build**: Saves checkpoints after each stage for incremental builds
- **Cache Version**: Version in `.github/cache-versions.json` that invalidates CI caches
- **Upstream**: Original Node.js source from nodejs/node before patches

### Node.js Customization

- **SEA (Single Executable Application)**: Standalone executable with Node.js runtime + app code
- **VFS (Virtual File System)**: Filesystem embedded inside a binary
- **Additions Directory**: Code embedded into Node.js during build
- **Source Patches**: Unified diff files modifying Node.js source

### Binary Manipulation

- **Binary Injection**: Inserting data into compiled binary without recompilation
- **Section**: Named region in executable (`.text` for code, `.data` for data)
- **LIEF**: Library for reading/modifying executable formats
- **Segment**: Container for sections in Mach-O binaries

### Compression

- **LZFSE**: Apple's compression (fast decompression, good ratio)
- **UPX**: Classic executable packer (aggressive compression)
- **Self-extracting Binary**: Compressed executable that decompresses at runtime
- **Stub Binary**: Small executable that decompresses and runs main binary

### Cross-Platform

- **libc/glibc**: Standard C library on most Linux distributions
- **musl**: Lightweight C library used by Alpine Linux
- **Universal Binary**: macOS binary with ARM64 + x64 code
- **Cross-compilation**: Building binaries for different platform

### Package Names

- **binject**: Injects data into binaries (SEA resources, VFS archives)
- **binpress**: Compresses binaries using LZFSE/UPX
- **binflate**: Decompresses binaries compressed by binpress
- **stubs-builder**: Builds self-extracting stub binaries
- **node-smol-builder**: Builds custom Node.js binary with Socket patches

### Tooling

- **pnpm**: Fast package manager for monorepo management
- **CMake**: Cross-platform build system generator
- **Husky**: Git hooks manager

## General Standards

See `../socket-registry/CLAUDE.md` for testing, code style, and CI patterns.
