# Claude Code Guidelines for Socket BTM

**MANDATORY**: Act as principal-level engineer. Follow these guidelines exactly.

## USER CONTEXT

- Identify users by git credentials; use their actual name, never "the user"
- Use "you/your" when speaking directly; use names when referencing contributions

## CRITICAL RULES

### Destructive Commands - ABSOLUTE PROHIBITION

**NEVER use `rm -rf` with glob patterns matching hidden files**

- **FORBIDDEN FOREVER**: `rm -rf * .*` — destroys the .git directory
- Safe alternatives: `git clean -fdx`, explicit directories (`rm -rf build/ node_modules/`), or `find . -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +`

### Parallel Claude Sessions - Worktree Required

**This repo may have multiple Claude sessions running concurrently against the same checkout, against parallel git worktrees, or against sibling clones.** Several common git operations are hostile to that and silently destroy or hijack the other session's work.

- **FORBIDDEN in the primary checkout** (the one another Claude may be editing):
  - `git stash` — shared stash store; another session can `pop` yours.
  - `git add -A` / `git add .` — sweeps files belonging to other sessions.
  - `git checkout <branch>` / `git switch <branch>` — yanks the working tree out from under another session.
  - `git reset --hard` against a non-HEAD ref — discards another session's commits.
- **REQUIRED for branch work**: spawn a worktree instead of switching branches in place. Each worktree has its own HEAD, so branch operations inside it are safe.

  ```bash
  # From the primary checkout — does NOT touch the working tree here.
  git worktree add -b <task-branch> ../<repo>-<task> main
  cd ../<repo>-<task>
  # edit, commit, push from here; the primary checkout is untouched.
  cd -
  git worktree remove ../<repo>-<task>
  ```

- **REQUIRED for staging**: surgical `git add <specific-file> [<file>…]` with explicit paths. Never `-A` / `.`.
- **If you need a quick WIP save**: commit on a new branch from inside a worktree, not a stash.

The umbrella rule: never run a git command that mutates state belonging to a path other than the file you just edited.

### Pre-Action Protocol

- Before ANY structural refactor on a file >300 LOC: remove dead code first, commit separately
- Multi-file changes: phases of ≤5 files, verify each before the next
- Study existing code before building — working code is a better spec than any description
- Work from raw error data, not theories
- On "yes", "do it", or "go": execute immediately, no plan recap

### Verification Protocol

1. Run the actual command — execute, don't assume
2. State what you verified, not just "looks good"
3. **FORBIDDEN**: Claiming "Done" when output shows failures
4. Re-read every modified file; confirm nothing references removed items

### Context & Edit Safety

- After 10+ messages: re-read files before editing
- Read files >500 LOC in chunks
- Before every edit: re-read. After every edit: re-read to confirm
- When renaming: search direct calls, type refs, string literals, dynamic imports, re-exports, tests
- Tool results over 50K chars are silently truncated — narrow scope and re-run if results seem incomplete
- For tasks touching >5 files: use sub-agents with worktree isolation

### Self-Evaluation

- Present two views before calling done: what a perfectionist would reject vs. what a pragmatist would ship
- After fixing a bug: explain why it happened
- If a fix fails twice: stop, re-read top-down, state where the mental model was wrong, propose something different
- If asked to "step back" or "going in circles": drop everything, rethink from scratch

### Judgment Protocol

- If the user's request is based on a misconception, say so before executing
- If you spot a bug adjacent to what was asked, flag it: "I also noticed X — want me to fix it?"
- You are a collaborator, not just an executor
- Fix warnings when you find them (lint, type-check, build, runtime) — don't leave them for later

### Scope Protocol

- Do not add features or improvements beyond what was asked
- Simplest approach first; flag architectural issues and wait for approval
- When asked to "make a plan," output only the plan

### Completion Protocol

- **NEVER claim done at 80%** — finish 100% before reporting
- When a multi-step change doesn't immediately show gains, commit and keep iterating — don't revert
- After EVERY code change: build, test, verify, commit as one atomic unit
- Reverting requires explicit user approval

### Fix ALL Issues

- **Fix ALL issues when asked** — never dismiss as "pre-existing" or "not caused by my changes"
- **Fix compiler/linker warnings when you see them**. Unused parameters, unused functions, deprecated-declarations, truncation, signedness, shadowing, etc. If a warning is intentional, silence it at the narrowest scope possible (`(void)arg;`, `[[maybe_unused]]`, `#pragma` push/pop around one function), not by disabling project-wide.

### Documentation Policy

**NEVER create documentation files unless explicitly requested**

- All documentation must live in EITHER a `docs/` tree OR a `README.md`. Nothing else.
- Markdown filenames use lowercase-kebab-case (`module-architecture.md`), NOT SCREAMING-CASE.
- Conventional filenames are exempt: `README.md`, `CLAUDE.md`, `LICENSE`, `SECURITY.md`, `SKILL.md`.
- For docs about code in `additions/`, place under `docs/additions/<mirror-path>/<name>.md`.

### Backward Compatibility

**NO BACKWARD COMPATIBILITY** — FORBIDDEN to maintain. Actively remove when encountered. No deprecation paths, no re-exports, no `_var` renames. Just delete unused code.

### Prohibited Tools

- 🚨 **NEVER use `npx`, `pnpm dlx`, or `yarn dlx`** — use `pnpm exec <package>` or `pnpm run <script>` # zizmor: documentation-prohibition
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

### Promise.race in Loops

**NEVER re-race the same pool of promises across loop iterations.** Each call to `Promise.race([A, B, ...])` attaches fresh `.then` handlers to every arm; a promise that survives N iterations accumulates N handler sets. The classic trap is the concurrency limiter that `await Promise.race(executing)` with `executing` shared across iterations. See [nodejs/node#17469](https://github.com/nodejs/node/issues/17469).

- **Safe**: `Promise.race([fresh1, fresh2])` where both arms are created per call (e.g. timeout wrappers).
- **Leaky**: `Promise.race(pool)` inside a loop where `pool` persists across iterations.
- **Fix**: single-waiter signal — each task's own `.then` resolves a one-shot `promiseWithResolvers` that the loop awaits, then replaces. No persistent pool, nothing to stack.

### spawn() Usage

**NEVER change `shell: WIN32` to `shell: true`** — `shell: WIN32` enables shell on Windows (needed) and disables on Unix (not needed). If spawn fails with ENOENT, separate command from arguments.

### Built-in Module Import Style

- Cherry-pick `fs` (`import { existsSync, promises as fs } from 'node:fs'`), default import `path`/`os`/`url`/`crypto`
- File existence: ALWAYS `existsSync`. NEVER `fs.access`, `fs.stat`-for-existence, or an async `fileExists` wrapper.
- Use `@socketsecurity/lib/spawn` instead of `node:child_process` (except in `additions/`)
- Exception: cherry-pick `fileURLToPath` from `node:url`

### isMainModule Detection

**ALWAYS use `fileURLToPath(import.meta.url) === path.resolve(process.argv[1])`** — works cross-platform. NEVER use `endsWith()` or raw URL comparison.

### Platform-Arch and libc

**ALWAYS pass libc parameter for Linux platform operations.** Prefer `getCurrentPlatformArch()` which auto-detects libc. Missing libc causes builds to output to wrong directories.

### Working Directory

🚨 **NEVER use `process.chdir()`** — pass `{ cwd }` options and absolute paths instead. Breaks tests, worker threads, causes race conditions.

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

Available: `node:smol-ffi`, `node:smol-http`, `node:smol-https`, `node:smol-ilp`, `node:smol-manifest`, `node:smol-purl`, `node:smol-sql`, `node:smol-versions`, `node:smol-vfs`

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

**The mirrored subdirectories under `additions/source-patched/src/socketsecurity/{bin-infra,binject,build-infra}/` are GITIGNORED** (see `.gitignore` lines 59-61). The `prepare-external-sources.mts` step of the node-smol build populates them by copying from the canonical source packages and then validates the hash matches. If the build fails with "Additions directory out of sync!", the working-tree copy is stale — rerun `pnpm --filter node-smol-builder build` (which will re-sync), or do it manually with `rsync -a --delete packages/<pkg>/src/socketsecurity/<pkg>/ packages/node-smol-builder/additions/source-patched/src/socketsecurity/<pkg>/`. Never "commit" a fix — those paths are untracked on purpose.

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

**Test fixtures run by the built binary** (smoke tests, integration tests) MUST use `.mjs`/`.js` extensions, NOT `.mts`. The node-smol binary is built `--without-amaro` so it has no TypeScript stripping support. This only applies to files executed by the built binary — build scripts run by the host Node.js can use `.mts` normally.

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
