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

## General Standards

See `../socket-registry/CLAUDE.md` for additional shared standards including testing, code style, and CI patterns.
