# Claude Code Guidelines for Socket BTM

**MANDATORY**: Act as principal-level engineer. Follow these guidelines exactly.

## Critical Rules

### Destructive Commands - ABSOLUTE PROHIBITION

**NEVER use `rm -rf` with glob patterns matching hidden files**

- **FORBIDDEN FOREVER**: `rm -rf * .*` - Deletes .git directory, destroys repository
- Safe alternatives: `git clean -fdx`, explicit directories (`rm -rf build/ node_modules/`), or `find . -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +`

### Pre-Work

- Before ANY structural refactor on a file >300 LOC: remove dead code, unused exports, unused imports first — commit that cleanup separately before the real work
- Multi-file changes: break into phases (≤5 files each), verify each phase before the next
- When pointed to existing code as a reference: study it before building — working code is a better spec than any description
- Work from raw error data, not theories — if a bug report has no error output, ask for it
- On "yes", "do it", or "go": execute immediately, no plan recap

### Verification Protocol

Before claiming any task is complete:

1. Run the actual command — execute the script, run the test, check the output
2. State what you verified, not just "looks good"
3. **FORBIDDEN**: Claiming "Done" when output shows failures, or characterizing incomplete/broken work as complete
4. Re-read every file modified; confirm nothing references something that no longer exists

### Context & Edit Safety

- After 10+ messages: re-read any file before editing it — do not trust remembered contents
- Read files >500 LOC in chunks using offset/limit; never assume one read captured the whole file
- Before every edit: re-read the file. After every edit: re-read to confirm the change applied correctly
- When renaming anything, search separately for: direct calls, type references, string literals, dynamic imports, re-exports, test files — one grep is not enough
- Tool results over 50K characters are silently truncated — if search returns suspiciously few results, narrow scope and re-run
- For tasks touching >5 files: use sub-agents with worktree isolation to prevent context decay

### Self-Evaluation

- Before calling anything done: present two views — what a perfectionist would reject vs. what a pragmatist would ship
- After fixing a bug: explain why it happened
- If a fix doesn't work after two attempts: stop, re-read the relevant section top-down, state where the mental model was wrong, propose something fundamentally different
- If asked to "step back" or "going in circles": drop everything, rethink from scratch

### Judgment Protocol

- If the user's request is based on a misconception, say so before executing
- If you spot a bug adjacent to what was asked, flag it: "I also noticed X — want me to fix it?"

### Scope Protocol

- Do not add features, refactor, or make improvements beyond what was asked
- Try the simplest approach first; flag architectural issues and wait for approval before restructuring
- When asked to "make a plan," output only the plan — no code until given the go-ahead

### Completion Protocol

- **NEVER claim done with something 80% complete** — finish 100% before reporting
- When a multi-step change doesn't immediately show gains, commit and keep iterating — don't revert
- After EVERY code change: build, test, verify, commit. This is a single atomic unit
- Reverting is a last resort after exhausting forward fixes — and requires explicit user approval

### Fix ALL Issues

- **Fix ALL issues when asked** - Never dismiss as "pre-existing" or "not caused by my changes"
- When asked to fix, lint, or check: fix everything found, regardless of who introduced it

### Documentation Policy

**NEVER create documentation files unless explicitly requested**

- **FORBIDDEN**: Creating README.md, GUIDE.md, HOWTO.md, ARCHITECTURE.md, or docs/ directories
- Only exceptions: Package README.md (1-2 sentences), CLAUDE.md, .claude/ directory

### Backward Compatibility

**NO BACKWARD COMPATIBILITY** - FORBIDDEN to maintain. Actively remove when encountered. No deprecation paths, no re-exports, no `_var` renames. Just delete unused code.

### Prohibited Tools

- 🚨 **NEVER use `npx`, `pnpm dlx`, or `yarn dlx`** — use `pnpm exec <package>` for devDep binaries, or `pnpm run <script>` for package.json scripts
- **minimumReleaseAge**: NEVER add packages to `minimumReleaseAgeExclude` in CI. Locally, ASK before adding — the age threshold is a security control.
- HTTP Requests: NEVER use `fetch()` — use `httpJson`/`httpText`/`httpRequest` from `@socketsecurity/lib/http-request`

### Commit Messages

[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/): `<type>(<scope>): <description>`. NO AI attribution (commit-msg hook auto-strips it).

## Code Style

- Default to NO comments. Only when the WHY is non-obvious to a senior engineer
- NEVER use `null` except for `__proto__: null` or external API requirements; use `undefined`
- ALWAYS use `{ __proto__: null, ... }` for config/return/internal-state objects
- NEVER use dynamic imports (`await import()`)
- Prefer `Promise.allSettled` over `Promise.all` for independent operations
- ALWAYS use `eslint-disable-next-line` above the line, NEVER trailing `eslint-disable-line`
- ALWAYS use Edit tool for code modifications, NEVER sed/awk

### spawn() Usage

**NEVER change `shell: WIN32` to `shell: true`** — `shell: WIN32` enables shell on Windows (needed) and disables on Unix (not needed). If spawn fails with ENOENT, separate command from arguments.

### Built-in Module Import Style

- Cherry-pick `fs` (`import { existsSync, promises as fs } from 'node:fs'`), default import `path`/`os`/`url`/`crypto`
- Use `@socketsecurity/lib/spawn` instead of `node:child_process` (except in `additions/`)
- Exception: cherry-pick `fileURLToPath` from `node:url`

### isMainModule Detection

**ALWAYS use `fileURLToPath(import.meta.url) === path.resolve(process.argv[1])`** — works cross-platform. NEVER use `endsWith()` or raw URL comparison.

### Platform-Arch and libc

**ALWAYS pass libc parameter for Linux platform operations.** Prefer `getCurrentPlatformArch()` which auto-detects libc. Missing libc causes builds to output to wrong directories.

### Logging

**ALWAYS use `@socketsecurity/lib/logger`** instead of `console.*`. NEVER add emoji/symbols manually (logger provides them). Exception: `additions/` directory.

## Node.js Additions (`additions/` directory)

Code embedded into Node.js during early bootstrap. Special constraints:

### Restrictions

- **No third-party packages** — only built-in modules
- Use `require('fs')` not `require('node:fs')` — `node:` protocol unavailable at bootstrap
- NEVER import from `@socketsecurity/*` packages
- ALWAYS start `.js` files with `'use strict';`

### Module Naming

All `node:smol-*` modules REQUIRE the `node:` prefix (enforced via `schemelessBlockList` in `lib/internal/bootstrap/realm.js`).

Available: `node:smol-http`, `node:smol-https`, `node:smol-purl`, `node:smol-versions`, `node:smol-manifest`, `node:smol-ilp`, `node:smol-sql`, `node:smol-vfs`

### Primordials

ALWAYS use primordials for Map/Set operations in internal modules: `SafeMap`, `SafeSet`, `MapPrototypeGet/Set/Delete/Has`, `SetPrototypeAdd/Delete/Has`, `ArrayFrom`, `ObjectKeys`. Use `*Ctor` suffix for constructors shadowing globals (`BigIntCtor`, `ErrorCtor`). `.size` is safe on SafeMap/SafeSet.

### Object Iteration

ALWAYS use `ObjectKeys()` + indexed for-loop (faster than `for...in` with `hasOwnProperty`).

### C++ Code

- **NEVER use C++ exceptions** — Node.js compiled with `-fno-exceptions`. Use status flags.
- **ALWAYS use full `socketsecurity/...` include paths** (e.g., `#include "socketsecurity/http/http_fast_response.h"`)
- `env-inl.h` vs `env.h`: include `env-inl.h` if .cc file uses `Environment*` methods

### Internal Module Structure

- Use flat `.js` files (Node.js upstream convention), NEVER directories with `index.js`
- `internalBinding` is already in scope — NEVER require it from `'internal/bootstrap/realm'`

## Source Patches (Node.js and iocraft)

- **Node.js**: `packages/node-smol-builder/patches/source-patched/*.patch`
- **iocraft**: `packages/iocraft-builder/patches/*.patch`

### Format

ALWAYS use standard unified diff (`--- a/`, `+++ b/`). NEVER use `git format-patch` output.

Required headers:

```diff
# @node-versions: vX.Y.Z         (or @iocraft-versions: vX.Y.Z)
# @description: One-line summary
#
--- a/file
+++ b/file
```

### Patch Rules

- Each patch affects ONE file and does NOT depend on other patches
- Minimal touch, clean diffs, no style changes outside scope
- To regenerate: use `/regenerating-patches` skill
- Manual: `diff -u a/file b/file`, add headers, validate with `patch --dry-run`

## Agents & Skills

- `/security-scan` — AgentShield + zizmor security audit
- `/quality-scan` — comprehensive code quality analysis
- `/quality-loop` — scan and fix iteratively
- Agents: `code-reviewer`, `security-reviewer`, `refactor-cleaner` (in `.claude/agents/`)
- Shared subskills in `.claude/skills/_shared/`

## Build System

- **ALWAYS use `pnpm run build`**, NEVER invoke Makefiles directly (build scripts handle dependency downloads)
- **ALWAYS run clean before rebuilding**: `pnpm --filter <pkg> clean && pnpm --filter <pkg> build`
- NEVER manually delete checkpoint files — the clean script knows all locations

### Source of Truth Architecture

Source packages (`binject`, `bin-infra`, `build-infra`) are canonical. ALL work in source packages, then sync to `additions/`. NEVER make changes only in `additions/` — they will be overwritten.

### Cache Version Cascade

When modifying source, bump `.github/cache-versions.json` for all dependents:

| Changed                                     | Bump                                          |
| ------------------------------------------- | --------------------------------------------- |
| build-infra/src/socketsecurity/build-infra/ | stubs, binflate, binject, binpress, node-smol |
| bin-infra/src/socketsecurity/bin-infra/     | stubs, binflate, binject, binpress, node-smol |
| binject/src/socketsecurity/binject/         | binject, node-smol                            |
| stubs-builder/src/                          | stubs, binpress, node-smol                    |
| binpress/src/                               | binpress, node-smol                           |
| binflate/src/                               | binflate                                      |

### Test Style

**NEVER write source-code-scanning tests.** Write functional tests that verify behavior. For modules requiring the built binary: use integration tests with final binary (`getLatestFinalBinary`), NEVER intermediate stages.

### Fetching npm Packages

**ALWAYS use npm registry directly** (`npm pack` or `https://registry.npmjs.org/`), NEVER CDNs like unpkg.

## Glossary

### Binary Formats

- **Mach-O**: macOS/iOS, **ELF**: Linux, **PE**: Windows

### Build Concepts

- **Checkpoint**: Cached snapshot of build progress for incremental builds
- **Cache Version**: Version in `.github/cache-versions.json` that invalidates CI caches
- **Upstream**: Original Node.js source before patches

### Node.js Customization

- **SEA**: Single Executable Application (standalone with runtime + app code)
- **VFS**: Virtual File System embedded inside a binary
- **Additions Directory**: Code embedded into Node.js during build

### Binary Manipulation

- **Binary Injection**: Inserting data into compiled binary without recompilation
- **Section/Segment**: Named regions in executables
- **LIEF**: Library for reading/modifying executable formats

### Compression

- **zstd**: Zstandard compression (fast decompression ~1.5 GB/s, good ratio)
- **UPX**: Classic executable packer
- **Stub Binary**: Small executable that decompresses and runs main binary

### Cross-Platform

- **musl**: Lightweight C library for Alpine Linux (vs glibc on most distros)
- **Universal Binary**: macOS binary with ARM64 + x64 code

### Package Names

- **binject**: Injects data into binaries (SEA resources, VFS archives)
- **binpress**: Compresses binaries (zstd/UPX)
- **binflate**: Decompresses binaries
- **stubs-builder**: Builds self-extracting stub binaries
- **node-smol-builder**: Builds custom Node.js binary with Socket patches

## Codex Usage

**Codex is for advice and critical assessment ONLY — never for making code changes.** Proactively consult before complex optimizations (>30min estimated) to catch design flaws early.

## General Standards
