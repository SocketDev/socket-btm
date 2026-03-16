# Claude Code Guidelines for Socket BTM

**MANDATORY**: Act as principal-level engineer. Follow these guidelines exactly.

## CANONICAL REFERENCE

This is a reference to shared Socket standards. See `../socket-registry/CLAUDE.md` for canonical source.

## Critical Rules

### Destructive Commands - ABSOLUTE PROHIBITION

**NEVER EVER use `rm -rf` with glob patterns that can match hidden files**

- **FORBIDDEN FOREVER**: `rm -rf * .*` - This deletes .git directory and destroys the repository
- **FORBIDDEN FOREVER**: Any variant that expands to hidden files without explicit safeguards
- The pattern `.*` matches `.git` and will irreversibly destroy the entire git repository
- If you need to clean a directory:
  - Use specific file/directory names explicitly
  - Use git commands: `git clean -fdx` (respects .git)
  - Use safer alternatives: `find . -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +`
- Example of the disaster that happened:

  ```bash
  # CATASTROPHIC - NEVER DO THIS
  rm -rf * .*  # Destroyed .git directory, lost all local branches and history

  # SAFE alternatives:
  git clean -fdx              # Clean working tree, preserves .git
  rm -rf build/ node_modules/ # Explicit directories only
  find . -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +  # Safe full clean
  ```

**Why this rule exists:**

- On 2026-03-09, during history squashing, `rm -rf * .*` was executed
- This deleted the .git directory and destroyed all local git state
- Lost the backup branch that was created for safety
- Had to reinitialize git from remote, losing all local work
- This pattern is a repository-destroying footgun that must NEVER be used

**Recovery steps if this happens:**

1. `git init` - Reinitialize repository
2. `git remote add origin <url>` - Re-add remote
3. `git fetch origin` - Fetch remote branches
4. `git checkout -b main origin/main` - Restore main branch
5. All local-only branches are permanently lost

This is the most critical safety rule in this entire document. Violating it destroys the repository.

### Fix ALL Issues

- **Fix ALL issues when asked** - Never dismiss issues as "pre-existing" or "not caused by my changes"
- When asked to fix, lint, or check: fix everything found, regardless of who introduced it
- Always address all issues found during lint/check operations

### Documentation Policy - NO DOCS PROLIFERATION

**NEVER create documentation files unless explicitly requested by the user**

- **FORBIDDEN**: Creating README.md, GUIDE.md, HOWTO.md, ARCHITECTURE.md, or any other documentation files
- **FORBIDDEN**: Creating docs/ directories in packages or the repository root
- **Code is the documentation** - Write self-documenting code with clear names and minimal comments
- **Only exceptions**:
  - Package README.md with 1-2 sentence description (if it doesn't exist)
  - CLAUDE.md guidelines (development rules only)
  - .claude/ directory (functional tooling for Claude Code)
- **If user asks for documentation**: Ask whether they want it in CLAUDE.md or as a standalone file
- **Rationale**: Documentation becomes stale, creates maintenance burden, and clutters repositories

**Examples of FORBIDDEN behavior**:

```bash
# WRONG - creating docs
mkdir docs/
echo "# Architecture" > docs/architecture.md
echo "# API Guide" > packages/foo/docs/api.md

# WRONG - verbose READMEs
cat > packages/foo/README.md << 'EOF'
# Foo Package

## Table of Contents
- Installation
- Usage
- API Reference
- Examples
- Contributing
...50 lines...
EOF

# CORRECT - minimal package README
cat > packages/foo/README.md << 'EOF'
# foo

Does X for Y. Run `pnpm run build` to build.
EOF
```

This policy was established 2026-03-10 after removing 65+ stale documentation files.

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

### Built-in Module Import Style

**Cherry-pick fs, default import path/os/url/crypto, prefer @socketsecurity/lib over child_process**

- For `fs`: cherry-pick sync methods, use promises namespace for async
- For `child_process`: **prefer `@socketsecurity/lib/spawn`** instead of direct `node:child_process` usage
  - Only use `node:child_process` in `additions/` directory (where third-party packages aren't available)
- For `path`, `os`, `url`, `crypto`: use default imports
- Pattern:

  ```javascript
  // CORRECT - cherry-pick fs, use @socketsecurity/lib for spawning
  import { existsSync, readFileSync, promises as fs } from 'node:fs'
  import { spawn } from '@socketsecurity/lib/spawn'
  import path from 'node:path'
  import os from 'node:os'
  import { fileURLToPath } from 'node:url' // Exception: cherry-pick specific exports from url

  // Usage:
  existsSync('/path') // fs: cherry-picked sync method
  readFileSync('/path') // fs: cherry-picked sync method
  await fs.readFile('/path') // fs: async via promises namespace
  await spawn('cmd', ['arg1']) // @socketsecurity/lib: preferred over execSync
  path.join('a', 'b') // path: default import with module prefix
  os.platform() // os: default import with module prefix

  // WRONG - using node:child_process directly (except in additions/)
  import { execSync } from 'node:child_process'
  execSync('cmd arg1') // ❌ Use @socketsecurity/lib/spawn instead

  // WRONG - default import for fs
  import fs from 'node:fs'
  fs.existsSync('/path') // ❌ Don't use default import for fs

  // WRONG - cherry-picking from path/os
  import { join, resolve } from 'node:path'
  import { platform, arch } from 'node:os'
  join('a', 'b') // ❌ Don't cherry-pick from path
  platform() // ❌ Don't cherry-pick from os

  // WRONG - cherry-picking async methods directly
  import { readFile } from 'node:fs/promises' // ❌ Use promises namespace instead
  ```

This pattern is consistent across Socket Security codebases.

### isMainModule Detection Pattern

**ALWAYS use exact URL match for isMainModule, NEVER use endsWith()**

- Use `import.meta.url === \`file://\${process.argv[1]}\`` for main module detection
- NEVER use `process.argv[1]?.endsWith('build.mjs')` or similar patterns
- endsWith() causes race conditions when build scripts import each other
- Pattern:

  ```javascript
  // CORRECT - exact URL match
  const isMainModule = import.meta.url === `file://${process.argv[1]}`

  if (isMainModule) {
    main()
  }

  // WRONG - generic endsWith (causes race conditions)
  const isMainModule = process.argv[1]?.endsWith('build.mjs')
  // This triggers main() when OTHER build.mjs scripts import this module!
  ```

This pattern is critical because build scripts frequently import each other, and endsWith() matches ANY file with that suffix, causing imported modules to execute main() unexpectedly.

### Platform-Arch and libc Parameters

**ALWAYS pass libc parameter for Linux platform operations**

- When calling `getAssetPlatformArch()` or `getPlatformArch()`, always pass the libc parameter
- For Linux, use `isMusl()` from `build-infra/lib/platform-mappings` for runtime detection
- Missing libc causes builds to output to wrong directories (e.g., `linux-x64` instead of `linux-x64-musl`)
- **Prefer `getCurrentPlatformArch()`** which auto-detects libc
- Pattern:

  ```javascript
  // BEST - use getCurrentPlatformArch() which auto-detects libc
  import { getCurrentPlatformArch } from 'build-infra/lib/platform-mappings'

  const platformArch = await getCurrentPlatformArch()

  // CORRECT - explicit libc for getAssetPlatformArch
  import { getAssetPlatformArch, isMusl } from 'build-infra/lib/platform-mappings'

  const libc = process.platform === 'linux' ? ((await isMusl()) ? 'musl' : undefined) : undefined
  const platformArch = getAssetPlatformArch(process.platform, arch, libc)

  // WRONG - missing libc for Linux (outputs to linux-x64 instead of linux-x64-musl)
  const platformArch = getAssetPlatformArch(process.platform, arch)
  ```

This pattern is critical because Linux has two libc variants (glibc and musl) that are ABI-incompatible, and build outputs must be separated by libc variant.

### Logging

**ALWAYS use `@socketsecurity/lib/logger` instead of `console.*` methods**

- Use `getDefaultLogger()` from `@socketsecurity/lib/logger` for all logging
- NEVER use `console.log`, `console.error`, `console.warn`, `console.info` directly
- NEVER add emoji/symbols manually - logger methods provide them automatically (✓, ✗, ⚠, ℹ) with colors
- Exception: `additions/` directory (where third-party packages aren't available)
- Pattern:

  ```javascript
  // CORRECT - use @socketsecurity/lib/logger
  import { getDefaultLogger } from '@socketsecurity/lib/logger'
  const logger = getDefaultLogger()

  logger.info('Starting build process')
  logger.warn('Deprecated configuration detected')
  logger.error('Build failed:', error)
  logger.success('Build completed successfully')

  // WRONG - using console directly (except in additions/)
  console.log('Starting build process') // ❌ Use logger.info() instead
  console.warn('Deprecated config') // ❌ Use logger.warn() instead
  console.error('Build failed:', error) // ❌ Use logger.error() instead

  // WRONG - adding emojis/symbols manually
  logger.info('✓ Build completed') // ❌ logger.success() already adds ✓
  logger.error('✗ Build failed') // ❌ logger.error() already adds ✗
  logger.warn('⚠ Deprecated') // ❌ logger.warn() already adds ⚠
  ```

**Why this matters:**

- Consistent logging format across all packages
- Proper log levels for CI integration
- Colored output and formatting
- Testable logging (can be mocked)
- Structured logging support

This pattern is consistent across Socket Security codebases.

### Patch Quality (Node.js Source Patches)

**MANDATORY**: Keep patches minimal and clean to reduce maintenance burden and merge conflicts.

**Core principles**:

- **Minimal touch**: Only modify the absolute minimum lines needed for functionality
- **Clean diffs**: Avoid shifting line numbers unnecessarily, preserves context for future patches
- **No style changes**: Don't reformat, add comments, or improve code outside the patch scope
- **Surgical edits**: Add new code at the end of functions or in new sections when possible

**Examples**:

✅ **GOOD - Minimal insertion at function end**:

```diff
   }
   return require(normalizedId);
+ }
+
+ // New enhancement code.
+ const hasVFSInfra = smolBootstrap.hasVFSInfrastructure();
+ if (hasVFSInfra) {
+   embedderRequire = smolBootstrap.enhanceRequire(embedderRequire);
+ }

 return [process, embedderRequire, embedderRunCjs];
```

❌ **BAD - Unnecessary line shifts**:

```diff
   }
-  return require(normalizedId);
-}
-
-return [process, embedderRequire, embedderRunCjs];
+  return require(normalizedId);
+}
+
+// New enhancement code.
+const hasVFSInfra = smolBootstrap.hasVFSInfrastructure();
+if (hasVFSInfra) {
+  embedderRequire = smolBootstrap.enhanceRequire(embedderRequire);
+}
+
+return [process, embedderRequire, embedderRunCjs];
```

**Why it matters**:

- Node.js source changes between versions, shifting line numbers
- Minimal patches are easier to rebase when Node.js updates
- Clean diffs make code review and debugging faster
- Less context needed means patches survive upstream refactoring better
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

### Parallel Operations

**Prefer `Promise.allSettled` over `Promise.all` for parallel operations**

- `Promise.allSettled` continues even if some promises reject, providing complete results
- `Promise.all` fails fast on first rejection, losing results from other promises
- Use `Promise.allSettled` when you need to handle partial failures gracefully
- Use `Promise.all` only when ALL operations must succeed (transactions, atomic operations)
- Pattern:

  ```javascript
  // PREFERRED - Promise.allSettled for independent operations
  const results = await Promise.allSettled([
    downloadFile('a.txt'),
    downloadFile('b.txt'),
    downloadFile('c.txt'),
  ])
  const failures = results.filter(r => r.status === 'rejected')
  if (failures.length > 0) {
    throw new Error(
      `Failed to download ${failures.length} files: ${failures.map(r => r.reason?.message || r.reason).join(', ')}`,
    )
  }

  // OK - Promise.all when all must succeed atomically
  await Promise.all([fs.copyFile(src1, dst1), fs.copyFile(src2, dst2)])

  // WRONG - Promise.all for independent operations (loses info on partial failure)
  await Promise.all([
    downloadFile('a.txt'), // If this fails, we lose b.txt and c.txt status
    downloadFile('b.txt'),
    downloadFile('c.txt'),
  ])
  ```

**Benefits of `Promise.allSettled`:**

- Better error messages (shows ALL failures, not just the first)
- Graceful degradation (can continue with partial results)
- Easier debugging (complete picture of what failed)

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
  return items.find(x => x.id === id) // already returns undefined
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

### Fetching npm Package Source

**ALWAYS use npm registry directly, NEVER use unpkg, jsdelivr, or other CDNs**

- When fetching npm package source code, use `npm pack` or the npm registry API directly
- NEVER use unpkg.com, jsdelivr.net, or other CDN mirrors
- CDNs may have caching issues, be unavailable, or serve outdated content
- Example:

  ```bash
  # CORRECT - use npm pack
  npm pack package-name --pack-destination /tmp
  tar -xzf /tmp/package-name-*.tgz -C /destination

  # CORRECT - use npm registry API
  curl -sL "https://registry.npmjs.org/package-name/-/package-name-1.0.0.tgz" | tar -xz

  # WRONG - using unpkg
  curl -sL "https://unpkg.com/package-name@1.0.0/src/index.js"

  # WRONG - using jsdelivr
  curl -sL "https://cdn.jsdelivr.net/npm/package-name@1.0.0/src/index.js"
  ```

This ensures reliable, authoritative source fetching from the official npm registry.

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
  - Example: Segment names are used by node-smol tests, so they belong in `bin-infra/test/helpers/`
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

### Building Packages

**ALWAYS use `pnpm run build`, NEVER invoke Makefiles directly**

- Packages have `scripts/build.mjs` that handles dependency downloads, environment setup, and Make invocation
- Running `make -f Makefile.<platform>` directly bypasses critical setup steps:
  - Downloading prebuilt dependencies (curl, LIEF) from releases
  - Setting up cross-compilation environment variables
  - Running pre-build hooks and validation
- Example:

  ```bash
  # CORRECT - use pnpm run build
  cd packages/stubs-builder
  pnpm run build

  # CORRECT - from monorepo root
  pnpm --filter stubs-builder build

  # WRONG - invoking Makefile directly (bypasses dependency downloads)
  make -f Makefile.macos all  # ❌ Missing curl/LIEF downloads
  ```

- The build.mjs scripts use `beforeBuild` hooks to ensure dependencies are available:
  - stubs-builder: Downloads curl from releases via `ensureCurl()`
  - binject/binpress: Downloads LIEF from releases via `ensureLief()`
- If you need to debug Makefile issues, first run `pnpm run build` to download dependencies, then you can invoke Make directly

This is critical because Makefiles assume dependencies are already available - the pnpm build scripts handle downloading them.

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
build-infra → stubs-builder → binpress → node-smol
                   ↓              ↓
bin-infra ─────────┴──────────────┴─────→ node-smol
                   ↓
binject ───────────┴────────────────────→ node-smol
```

**Cache version bump rules:**

- **build-infra/src/socketsecurity/build-infra/** → bump: `stubs`, `binflate`, `binject`, `binpress`, `node-smol`
  - Reason: Used by stubs-builder (dlx_cache_common.h), binflate, binject, and copied to node-smol additions/

- **bin-infra/src/socketsecurity/bin-infra/** → bump: `stubs`, `binflate`, `binject`, `binpress`, `node-smol`
  - Reason: Used by stubs-builder, binflate, binject (LIEF operations), and copied to node-smol additions/

- **binject/src/socketsecurity/binject/** → bump: `binject`, `node-smol`
  - Reason: Used by binject package and copied to node-smol additions/ (SEA/VFS injection code)

- **stubs-builder/src/** → bump: `stubs`, `binpress`, `node-smol`
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

## Glossary

**For Junior Developers:** This section defines key terms used throughout Socket BTM documentation.

### Binary Formats

- **Mach-O**: macOS/iOS executable format (e.g., `/usr/bin/node` on macOS)
- **ELF**: Linux executable format (e.g., `/usr/bin/node` on Linux)
- **PE**: Windows executable format (e.g., `node.exe` on Windows)

### Build Concepts

- **Checkpoint**: A cached snapshot of build progress (e.g., "source-copied", "compiled", "stripped"). Enables incremental builds by skipping unchanged stages.
- **Progressive Build**: Build system that saves checkpoints after each stage, allowing restart from last checkpoint instead of rebuilding from scratch.
- **Cache Version**: Version number in `.github/cache-versions.json` that invalidates CI caches when source changes (e.g., `"node-smol": "v64"`).
- **Upstream**: The original Node.js source code from nodejs/node repository before Socket's patches are applied.

### Node.js Customization

- **SEA (Single Executable Application)**: A standalone executable containing both Node.js runtime and application code. Users run one file instead of `node app.js`.
- **VFS (Virtual File System)**: A filesystem embedded inside a binary. Files are stored as data within the executable and accessed via normal `fs` APIs.
- **Additions Directory**: Code that gets embedded into Node.js during build (`packages/node-smol-builder/additions/`). Runs during early bootstrap before module system is fully initialized.
- **Source Patches**: Unified diff files that modify Node.js source code. Applied during build to add Socket-specific features.

### Binary Manipulation

- **Binary Injection**: Inserting data into a compiled binary without recompilation. Used to embed VFS archives and SEA resources.
- **Section**: A named region in an executable (e.g., `.text` for code, `.data` for data). We create custom sections for injected data.
- **LIEF**: Library for reading/modifying executable formats. Provides safe APIs for binary manipulation.
- **Segment**: Container for sections in Mach-O binaries. ELF uses program headers, PE uses sections directly.

### Compression

- **LZFSE**: Apple's compression algorithm (fast decompression, good ratio). Used for compressing Node.js binaries.
- **UPX**: Classic executable packer (aggressive compression, slower decompression). Alternative to LZFSE.
- **Self-extracting Binary**: Compressed executable that decompresses itself at runtime. Users see faster downloads, binary unpacks to memory on launch.
- **Stub Binary**: Small executable that decompresses and runs the main binary. Acts as loader/unpacker.

### Cross-Platform Build

- **libc/glibc**: Standard C library on most Linux distributions. Our "linux-x64" builds target glibc systems.
- **musl**: Lightweight C library used by Alpine Linux. Our "linux-x64-musl" builds target musl systems.
- **Universal Binary**: macOS binary containing both ARM64 and x64 code. Single file runs on both Apple Silicon and Intel Macs.
- **Cross-compilation**: Building binaries for a different platform (e.g., building Windows binary on Linux).

### Package Names

- **binject**: Tool to inject data into binaries (SEA resources, VFS archives).
- **binpress**: Tool to compress binaries using LZFSE/UPX.
- **binflate**: Tool to decompress/extract binaries compressed by binpress.
- **stubs-builder**: Builds self-extracting stub binaries used by binpress.
- **node-smol-builder**: Builds custom Node.js binary with Socket patches (~23-27MB).

### Tooling

- **pnpm**: Fast package manager for Node.js. Used for monorepo management.
- **CMake**: Cross-platform build system generator. Used by ONNX Runtime and Yoga Layout builders.
- **Husky**: Git hooks manager. Runs linting/testing before commits.

## General Standards

See `../socket-registry/CLAUDE.md` for additional shared standards including testing, code style, and CI patterns.
