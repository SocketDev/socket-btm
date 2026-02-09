# Claude Code Guidelines for Socket BTM

**MANDATORY**: Act as principal-level engineer. Follow these guidelines exactly.

## CANONICAL REFERENCE

This is a reference to shared Socket standards. See `../socket-registry/CLAUDE.md` for canonical source.

## Critical Rules

### Fix ALL Issues
- **Fix ALL issues when asked** - Never dismiss issues as "pre-existing" or "not caused by my changes"
- When asked to fix, lint, or check: fix everything found, regardless of who introduced it
- Always address all issues found during lint/check operations

### Backward Compatibility
- **🚨 NO BACKWARD COMPATIBILITY**: FORBIDDEN to maintain it - we're our only consumers
- **Active removal**: MUST remove existing backward compatibility code when encountered
- **Breaking changes**: Inform about them, but NEVER add compat layers
- **Clean breaks**: Make clean API changes without deprecation paths
- **Examples of forbidden patterns**:
  - ❌ Renaming unused `_vars` instead of deleting
  - ❌ Re-exporting types for "compatibility"
  - ❌ Adding `// removed` comments for removed code
  - ❌ Environment variables for legacy behavior
  - ❌ Feature flags for old implementations
  - ✅ Just delete unused code completely

### spawn() Usage
**NEVER change `shell: WIN32` to `shell: true`**

- `shell: WIN32` is the correct pattern for cross-platform compatibility
- It enables shell on Windows (where it's needed) and disables on Unix (where it's not)
- If spawn fails with ENOENT, the issue is NOT the shell parameter
- Instead, fix by properly separating command and arguments:
  ```javascript
  // WRONG - passing full command as string
  spawn('python3 -m module arg1 arg2', [], { shell: WIN32 })

  // CORRECT - separate command and args
  spawn('python3', ['-m', 'module', 'arg1', 'arg2'], { shell: WIN32 })
  ```

This pattern is canonical across Socket Security codebases.

### ESLint Disable Comments
**ALWAYS use `eslint-disable-next-line` above the line, NEVER use trailing `eslint-disable-line`**

- Place ESLint disable directives on the line above the code, not as trailing comments
- This is a manual style convention across all Socket Security repositories
- Note: Not enforced by tooling, relies on code review
  ```javascript
  // WRONG - trailing comment
  process.exit(1) // eslint-disable-line n/no-process-exit

  // CORRECT - line above
  // eslint-disable-next-line n/no-process-exit
  process.exit(1)
  ```

This pattern is consistent across Socket Security codebases.

### Dynamic Imports
**NEVER use dynamic imports (await import())**

- Always use static imports at the top of the file
- Dynamic imports add unnecessary complexity and hurt performance
- This is a standard convention across all Socket Security repositories
  ```javascript
  // WRONG - dynamic import
  const logger = (await import('@socketsecurity/lib/logger')).getDefaultLogger()

  // CORRECT - static import
  import { getDefaultLogger } from '@socketsecurity/lib/logger'
  const logger = getDefaultLogger()
  ```

This pattern is consistent across Socket Security codebases.

### Integration and E2E Test Binary Selection
**ALWAYS use Final binary for integration and E2E tests, NEVER use intermediate build stages**

- Integration tests must use `getLatestFinalBinary()` from `test/paths.mjs`
- NEVER change tests to use `getLatestCompressedBinary()`, `getLatestStrippedBinary()`, or other intermediate stages
- The Final binary is the production-ready binary that may be compressed or uncompressed depending on build flags
- This ensures tests validate the actual binary that will be shipped to users
- Example:
  ```javascript
  // CORRECT - use Final binary
  import { getLatestFinalBinary } from '../paths.mjs'
  const binaryPath = getLatestFinalBinary()

  // WRONG - don't use intermediate stages
  import { getLatestCompressedBinary } from '../paths.mjs'
  const binaryPath = getLatestCompressedBinary()
  ```

This ensures integration tests validate the production binary users will receive.

### Node.js Additions Directory
**NEVER use third-party packages in `packages/node-smol-builder/additions/` .js files**

- The `additions/` directory contains code that gets embedded into Node.js itself during early bootstrap
- These files run before Node.js is fully initialized and cannot use external dependencies
- Only use built-in Node.js modules (fs, path, os, child_process, etc.)
- Use `require('fs')` not `require('node:fs')` - the node: protocol isn't available at this stage
- NEVER import from `@socketsecurity/*` packages or any npm dependencies
- Example:
  ```javascript
  // WRONG - third-party package
  const { safeDeleteSync } = require('@socketsecurity/lib/fs')

  // CORRECT - built-in fs module
  const { rmSync } = require('fs')
  rmSync(path, { recursive: true, force: true })
  ```

This is critical because additions/ files are embedded into the Node.js binary before the module system is fully bootstrapped.

### Avoid `null` - Use `undefined`
**NEVER use `null` except for `__proto__: null` or external API requirements**

- `null` is an antipattern in JavaScript - use `undefined` instead
- Using `undefined` is more JS-centric and helps with type values:
  - `undefined` is JavaScript's native "absence of value" type
  - TypeScript types work better with `undefined` (optional properties, strict null checks)
  - Avoids ambiguity: `null` requires explicit intent, `undefined` is natural default
  - JSON.stringify omits `undefined` properties (cleaner serialization)
- Default parameters: `function foo(bar)` or `function foo(bar = undefined)`, not `bar = null`
- Variable initialization: `let x` or `let x = undefined`, not `let x = null`
- Return values: Return `undefined`, not `null`
- Ternary expressions: `condition ? value : undefined`, not `condition ? value : null`
- Optional properties: Use `?:` syntax in types, not `| null`
- **Exception**: `__proto__: null` for prototype-less objects (required pattern)
- **Exception**: External APIs that explicitly require `null` (e.g., some native modules)
  ```javascript
  // WRONG - using null
  let result = null
  const libc = isMusl() ? 'musl' : null
  function download(tool, options = null) {}
  return items.find(x => x.id === id) || null

  // CORRECT - using undefined
  let result
  const libc = isMusl() ? 'musl' : undefined
  function download(tool, options) {}
  return items.find(x => x.id === id)  // already returns undefined
  ```

This pattern is consistent across Socket Security codebases.

### Node.js Source Patch Format
**ALWAYS use standard unified diff format, NEVER use git diff format**

- Node.js patches in `packages/node-smol-builder/patches/source-patched/` must use standard unified diff format
- The build system uses the `patch` command which expects standard unified diff format, NOT git-specific format
- NEVER use `git diff` to generate patches - it produces git-specific headers that are incompatible
- Use `diff -u` or apply changes to upstream source and generate patches via the build system
- Git diff format uses `diff --git a/file b/file` headers - this format is FORBIDDEN
- Standard unified diff uses `diff -u original_file modified_file` or no special headers
- Example of CORRECT patch format:
  ```diff
  Socket Security: Description of changes

  Detailed explanation of what this patch does.

  Files modified:
  - file1: Description
  - file2: Description

  --- node.gyp.orig
  +++ node.gyp
  @@ -1003,6 +1003,10 @@
           'defines': [ 'HAVE_LIEF=1' ],
  +        'sources': [
  +          'src/file.cc',
  +        ],
  ```
- Example of FORBIDDEN format:
  ```diff
  diff --git a/node.gyp b/node.gyp  ← FORBIDDEN git header
  index 8430fa0b66..24531b6479 100644  ← FORBIDDEN git index line
  --- a/node.gyp  ← FORBIDDEN git path prefix
  +++ b/node.gyp  ← FORBIDDEN git path prefix
  ```

This is critical because the Node.js build system validates and applies patches using the standard `patch` command, not `git apply`.

### Node.js Patch Independence
**Each patch affects exactly ONE file and does NOT depend on other patches**

- Patches in `packages/node-smol-builder/patches/source-patched/` are independent and self-contained
- Each patch modifies a single source file in isolation
- When regenerating a patch, only the target file needs to be edited - no need to apply other patches first
- To regenerate a patch:
  1. Get pristine copy of the target file from `upstream/node` (or use `source-copied` checkpoint)
  2. Apply your changes directly to that single file
  3. Generate unified diff: `diff -u original modified > patch_file`
  4. Validate the patch applies cleanly: `patch --dry-run < patch_file`
  5. Replace the patch in `patches/source-patched/`
- Example workflow:
  ```bash
  # Get pristine file from upstream
  cp upstream/node/src/node_sea.h /tmp/node_sea.h.orig

  # Make changes to a copy
  cp /tmp/node_sea.h.orig /tmp/node_sea.h
  # ... edit /tmp/node_sea.h ...

  # Generate patch
  diff -u /tmp/node_sea.h.orig /tmp/node_sea.h > patches/source-patched/009-node-sea-header.patch

  # Validate
  cd upstream/node && patch --dry-run < ../../patches/source-patched/009-node-sea-header.patch
  ```

This ensures patches can be regenerated independently without complex dependencies or ordering requirements.

### File Editing
**ALWAYS use the Edit tool for manual editing, NEVER use sed/awk for file modifications**

- Use the Edit tool with explicit old_string/new_string parameters for all file modifications
- NEVER use sed, awk, or other stream editors for code changes
- sed/awk edits are error-prone, hard to review, and can introduce subtle bugs
- The Edit tool provides exact string matching and clear visibility of changes
- Exceptions:
  - Simple one-time data transformations in build scripts (use with extreme caution)
  - When explicitly instructed by the user to use sed for a specific reason
- Example:
  ```javascript
  // WRONG - using sed
  sed -i 's/oldFunc/newFunc/g' file.js

  // CORRECT - using Edit tool
  Edit({
    file_path: '/path/to/file.js',
    old_string: 'function oldFunc() {',
    new_string: 'function newFunc() {',
  })
  ```

This is critical because sed edits create problems that are hard to debug and review, especially with complex patterns or multiple replacements.

### Source of Truth Architecture
**Source packages are canonical - additions directory syncs FROM packages, not TO packages**

- Packages `binject`, `bin-infra`, and `build-infra` are the **source of truth**
- **Package selection rules**:
  - `build-infra`: Code/files used by (binject, binpress, OR binflate) AND node-smol
  - `bin-infra`: Code/files used ONLY by binject, binpress, OR binflate (not node-smol)
  - Example: Segment names are used by node-smol tests, so they belong in `build-infra/test-helpers/`
- `node-smol-builder/additions/source-patched/src/socketsecurity/` syncs TO them, not FROM them
- **ALL work must be done in the source packages directly**, then synced to additions
- NEVER make changes only in additions - they will be overwritten
- When fixing bugs or adding features:
  1. Make changes in the source package (e.g., `packages/build-infra/src/socketsecurity/build-infra/`)
  2. Sync those changes to additions (e.g., `packages/node-smol-builder/additions/source-patched/src/socketsecurity/build-infra/`)
- Example workflow:
  ```bash
  # CORRECT - edit source package first
  vim packages/build-infra/src/socketsecurity/build-infra/debug_common.h
  # Then sync to additions
  cp packages/build-infra/src/socketsecurity/build-infra/debug_common.h \
     packages/node-smol-builder/additions/source-patched/src/socketsecurity/build-infra/debug_common.h

  # WRONG - editing additions directly
  vim packages/node-smol-builder/additions/source-patched/src/socketsecurity/build-infra/debug_common.h
  ```

This ensures consistency across the codebase and prevents divergence between source packages and embedded additions.

### Clean Before Rebuild
**ALWAYS run clean script before rebuilding to invalidate checkpoints and caches**

- The build system uses progressive checkpoints to speed up builds
- When source files change, checkpoints may prevent recompilation
- ALWAYS clean before rebuilding to ensure changes are picked up
- The clean script handles BOTH package-specific checkpoints AND shared checkpoints
- NEVER manually delete checkpoint files - always use the clean script
- Use `pnpm --filter` to clean specific packages from monorepo root
- Example:
  ```bash
  # CORRECT - clean before rebuild from monorepo root
  pnpm --filter node-smol-builder clean
  pnpm --filter node-smol-builder build

  # CORRECT - clean before rebuild from package directory
  cd packages/node-smol-builder
  pnpm run clean
  pnpm run build

  # WRONG - rebuild without cleaning (may use stale checkpoint)
  pnpm run build  # Changes to C/C++ files won't be picked up

  # WRONG - manually deleting checkpoint files
  rm -rf build/dev/checkpoints/*.tar.gz  # May miss shared checkpoints
  pnpm run build  # Incomplete cleanup leads to build failures
  ```

This is critical because:
- The build system caches intermediate build artifacts and checkpoints that prevent recompilation when source files change
- Shared checkpoints exist outside package directories and must be properly invalidated
- Manual checkpoint deletion is incomplete and error-prone - the clean script knows all checkpoint locations

### Cache Version Cascade Dependencies
**When modifying source files, bump cache versions for all dependent packages in `.github/cache-versions.json`**

- CI caches built artifacts to speed up builds
- If source changes but cache version doesn't bump, CI will use old cached artifacts with stale code
- The build dependency chain determines which cache versions must be bumped together

**Dependency chain:**
```
build-infra → bin-stubs → binpress → node-smol
                ↓            ↓
bin-infra ──────┴────────────┴─────→ node-smol
                ↓
binject ────────┴─────────────────→ node-smol
```

**Cache version bump rules:**

- **build-infra/src/socketsecurity/build-infra/** → bump: `stubs`, `binflate`, `binject`, `binpress`, `node-smol`
  - Reason: Used by bin-stubs (dlx_cache_common.h), binflate, binject, and copied to node-smol additions/

- **bin-infra/src/socketsecurity/bin-infra/** → bump: `stubs`, `binflate`, `binject`, `binpress`, `node-smol`
  - Reason: Used by bin-stubs, binflate, binject (LIEF operations), and copied to node-smol additions/

- **binject/src/socketsecurity/binject/** → bump: `binject`, `node-smol`
  - Reason: Used by binject package and copied to node-smol additions/ (SEA/VFS injection code)

- **bin-stubs/src/** → bump: `stubs`, `binpress`, `node-smol`
  - Reason: Stub binaries are embedded into binpress, which compresses node-smol

- **binpress/src/** → bump: `binpress`, `node-smol`
  - Reason: Binpress is used to compress the node-smol binary

- **binflate/src/** → bump: `binflate`
  - Reason: Independent tool (extraction/decompression utility)

**Node-smol additions directory:**
The `node-smol-builder/additions/source-patched/src/socketsecurity/` directory aggregates all shared source code:
- `bin-infra/` (from `packages/bin-infra/src/`)
- `binject/` (from `packages/binject/src/`)
- `build-infra/` (from `packages/build-infra/src/`)

These files are gitignored and generated during build by copying from canonical source packages.

**Example:**
```bash
# Changed: packages/build-infra/src/socketsecurity/build-infra/file_utils.c

# Bump these cache versions in .github/cache-versions.json:
"stubs": "v25" → "v26"
"binflate": "v56" → "v57"
"binject": "v76" → "v77"
"binpress": "v76" → "v77"
"node-smol": "v64" → "v65"
```

This ensures CI rebuilds all packages that depend on the changed source files with the correct code.

## General Standards

See `../socket-registry/CLAUDE.md` for additional shared standards including testing, code style, and CI patterns.
