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
- **NEVER revert files you didn't touch.** If `git status` shows files you didn't modify, those belong to another session, an upstream pull, or a hook side-effect — leave them alone. Specifically: do not run `git checkout -- <unrelated-path>` to "clean up" the diff before committing, and do not include unrelated paths in `git add`. Stage only the explicit files you edited.

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

- Present two views before calling done: what a perfectionist would reject vs. what a pragmatist would ship — and let the user decide. If the user gives no signal, default to perfectionist: do the fuller fix.
- After fixing a bug: explain why it happened
- If a fix fails twice: stop, re-read top-down, state where the mental model was wrong, propose something different
- If asked to "step back" or "going in circles": drop everything, rethink from scratch

### Judgment Protocol

- If the user's request is based on a misconception, say so before executing
- If you spot a bug adjacent to what was asked, flag it: "I also noticed X — want me to fix it?"
- You are a collaborator, not just an executor
- Fix warnings when you find them (lint, type-check, build, runtime) — don't leave them for later
- **Default to perfectionist mindset**: when you have latitude to choose, pick the maximally correct option — no shortcuts, no cosmetic deferrals. Fix state that *looks* stale even if not load-bearing. If pragmatism is the right call, the user will ask for it explicitly. "Works now" ≠ "right."

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
- **Mirror-doc filename exemption**: files under `docs/additions/` that mirror a source file (e.g. `version_subset.js.md` mirrors `version_subset.js`) inherit the source filename verbatim, including underscores. This is intentional — the mirror relationship is easier to see when the filenames match.
- **Mirror-doc scope**: place `docs/additions/<mirror-path>/<name>.md` only for (a) **public** `lib/smol-*.js` modules that end users import, and (b) **user-facing internal** modules whose behavior is non-obvious from the source (caches, bootstrap glue, VFS providers, range parsers). Internal one-off helpers and C++ bindings are exempt — the source IS the spec. For a subsystem with many small files, a single architecture overview (e.g. `http/module-architecture.md`) replaces per-file docs.

### Backward Compatibility

**NO BACKWARD COMPATIBILITY** — FORBIDDEN to maintain. Actively remove when encountered. No deprecation paths, no re-exports, no `_var` renames. Just delete unused code.

### Prohibited Tools

- 🚨 **NEVER use `npx`, `pnpm dlx`, or `yarn dlx`** — use `pnpm exec <package>` or `pnpm run <script>` # zizmor: documentation-prohibition
- **minimumReleaseAge**: NEVER add packages to `minimumReleaseAgeExclude` in CI. Locally, ASK before adding — the age threshold is a security control.
- HTTP Requests: NEVER use `fetch()` — use `httpJson`/`httpText`/`httpRequest` from `@socketsecurity/lib/http-request`

### Commit Messages

[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/): `<type>(<scope>): <description>`. NO AI attribution (commit-msg hook auto-strips it).

- **Open PRs:** when adding commits to an OPEN PR, ALWAYS update the PR title and description to match the new scope. A title like `chore: foo` after you've added security-fix and docs commits to it is now a lie. Use `gh pr edit <num> --title "..." --body "..."` (or `--body-file`) and rewrite the body so it reflects every commit on the branch, grouped by theme. The reviewer should be able to read the PR description and know what's in it without scrolling commits.

## Code Style

- Default to NO comments. Only when the WHY is non-obvious to a senior engineer
- NEVER use `null` except for `__proto__: null` or external API requirements; use `undefined`
- ALWAYS use `{ __proto__: null, ... }` for config/return/internal-state objects
- NEVER use dynamic imports (`await import()`)
- Prefer `Promise.allSettled` over `Promise.all` for independent operations
- ALWAYS use `eslint-disable-next-line` above the line, NEVER trailing `eslint-disable-line`
- ALWAYS use Edit tool for code modifications, NEVER sed/awk

### 1 path, 1 reference

**A path is *constructed* exactly once. Everywhere else *references* the constructed value.**

Referencing a single computed path many times is fine — that's the whole point of computing it once. What's banned is *re-constructing* the same path in multiple places, because that's where drift is born.

- **Within a package**: every script imports its own `scripts/paths.mts` (or `lib/paths.mts`). No `path.join('build', mode, ...)` outside that module.
- **Across packages**: when package B consumes package A's output, B imports A's `paths.mts` via the workspace `exports` field. Never `path.join(PKG, '..', '<sibling>', 'build', ...)`. The R28 yoga/ink bug — ink hand-building yoga's wasm path and missing the `wasm/` segment — is the canonical failure mode this rule prevents.
- **Workflows, Dockerfiles, shell scripts**: they can't `import` TS, so they construct the string once and reference it everywhere downstream. Workflows: a "Compute paths" step exposes `steps.paths.outputs.final_dir`; later steps read `${{ steps.paths.outputs.final_dir }}`. Dockerfiles/shell: assign once to a variable / `ENV`, reference by name thereafter. Each canonical construction carries a comment naming the source-of-truth `paths.mts`. **Re-building** the same path in a second step is the violation, not referring to the constructed value many times.
- **Comments**: may describe path *structure* with placeholders ("`<mode>/<arch>`") but should not encode a complete literal path string. The import statement IS the comment.

Code execution takes priority over docs: violations in `.mts`/`.cts`, Makefiles, Dockerfiles, workflow YAML, and shell scripts are blocking. README and doc-comment violations are advisory unless they contain a fully-qualified path with no parametric placeholders.

**Three-level enforcement:**

- **Hook** — `.claude/hooks/path-guard/` blocks `Edit`/`Write` calls that would introduce a violation in a `.mts`/`.cts` file at edit time.
- **Gate** — `scripts/check-paths.mts` runs in `pnpm check`. Fails the build on any violation that isn't allowlisted in `.github/paths-allowlist.yml`.
- **Skill** — `/path-guard` audits the repo and fixes findings; `/path-guard check` reports only; `/path-guard install` drops the gate + hook + rule into a fresh repo.

The mantra is intentionally short so it sticks: **1 path, 1 reference**. When in doubt, find the canonical owner and import from it.

### Inclusive Language

Use precise, neutral terms over historical metaphors that imply hierarchy or exclusion. The substitutes are not euphemisms — they're more *accurate* (a list of allowed values genuinely is an "allowlist"; "whitelist" is a metaphor that hides what the list does).

| Replace                                  | With                                                  |
| ---------------------------------------- | ----------------------------------------------------- |
| `whitelist` / `whitelisted`              | `allowlist` / `allowed` / `allowlisted`               |
| `blacklist` / `blacklisted`              | `denylist` / `denied` / `blocklisted` / `blocked`     |
| `master` (branch, process, copy)         | `main` (branch); `primary` / `controller` (process)   |
| `slave`                                  | `replica`, `worker`, `secondary`, `follower`          |
| `grandfathered`                          | `legacy`, `pre-existing`, `exempted`                  |
| `sanity check`                           | `quick check`, `confidence check`, `smoke test`       |
| `dummy` (placeholder)                    | `placeholder`, `stub`                                 |

Apply across **code** (identifiers, comments, string literals), **docs** (READMEs, CLAUDE.md, markdown), **config files** (YAML, JSON), **commit messages**, **PR titles/descriptions**, and **CI logs** you control.

Two exceptions where the legacy term must remain (because changing it breaks something external):
- **Third-party APIs / upstream code**: when interfacing with an external API field literally named `whitelist`, keep the field name; rename your local variable. E.g. `const allowedDomains = response.whitelist`.
- **Vendored upstream sources**: don't rewrite vendored code (`vendor/**`, `upstream/**`, `**/fixtures/**`). Patch around it if needed.

When you encounter a legacy term during unrelated work, fix it inline — don't defer.

### Sorting

Sort lists alphanumerically (literal byte order, ASCII before letters). Apply this to:

- **Config lists** — `permissions.allow` / `permissions.deny` in `.claude/settings.json`, `external-tools.json` checksum keys, allowlists in workflow YAML.
- **Object key entries** — sort keys in plain JSON config + return-shape literals + internal-state objects. (Exception: `__proto__: null` always comes first, ahead of any data keys.)
- **Import specifiers** — sort named imports inside a single statement: `import { encrypt, randomDataKey, wrapKey } from './crypto.mts'`. Imports that say `import type` follow the same rule. Statement *order* is the project's existing convention (`node:` → external → local → types) — that's separate from specifier order *within* a statement.
- **Method / function source placement** — within a module, sort top-level functions alphabetically. Convention: private functions (lowercase / un-exported) sort first, exported functions second. The first-line `export` keyword is the divider.
- **Array literals** — when the array is a config list, allowlist, or set-like collection. Position-bearing arrays (e.g. argv, anything where index matters semantically) keep their meaningful order.
- **`Set` constructor arguments** — `new Set([...])` and `new SafeSet([...])` literals. The runtime is order-insensitive, so source order is alphanumeric. Same rationale as Array literals: predictable diffs, no merge conflicts on insertions.

When in doubt, sort. The cost of a sorted list that didn't need to be is approximately zero; the cost of an unsorted list that did need to be is a merge conflict.

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

## Error Messages

Errors are a UX surface. Every error message must let the reader fix the problem without reading the source. Four ingredients, in order:

1. **What**: the rule that was violated (the contract, not the symptom)
2. **Where**: the exact file, key, line, or record — never "somewhere in config"
3. **Saw vs. wanted**: the offending value and the allowed shape/set
4. **Fix**: one concrete action to resolve it

Find the balance between terse and meaningful — meaningful does not mean bloated:

- **Library-API errors** (thrown from published helpers, e.g. `@socketsecurity/lib`): terse. A caller catching and asserting on the message needs it short and stable. `name "__proto__" cannot start with an underscore` carries what/where/saw with fix implied.
- **Validator / build-script errors** (build-infra checks, patch/version gates, developer-facing): verbose. The reader is staring at a file and won't re-run the tool to spot the next hit. Every ingredient gets its own words.
- **Programmatic errors** (internal assertions, invariant checks in C++/JS, bootstrap guards): terse, rule-only. No caller will parse the message; terse keeps the check readable.

Baseline rules that apply to all three:

- Write the fix step in the imperative (`run pnpm --filter node-smol-builder clean`), not passive narration (`clean was missing`).
- Never say "invalid" without what made it invalid. `invalid patch header` is a symptom; `patch header must start with "# @node-versions:" (got "# @description")` is a rule.
- If two records collide, name both — not just the second one found.
- Suggest, don't auto-correct. An error that silently repairs state hides the bug in the next run.
- Bloat test: if removing a word loses information, keep it. If removing it loses only rhythm, drop it.

Example — build-script error (verbose form, validator context):

- ✗ `Error: additions out of sync`
- ✓ ``Additions directory out of sync: packages/node-smol-builder/additions/source-patched/src/socketsecurity/binject differs from packages/binject/src/socketsecurity/binject. Run `pnpm --filter node-smol-builder clean && pnpm --filter node-smol-builder build` to re-sync (the paths under additions/ are gitignored by design).``

Example — library helper error (terse form, caller-asserted):

- ✗ `Error: checksum mismatch`
- ✓ `node checksum mismatch: expected <hex>, got <hex>`

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
- **Allocations at JS entrypoints MUST use `std::nothrow` + null-check + `ThrowException`**. Because `-fno-exceptions` turns `std::bad_alloc` into an `abort()` that kills the whole isolate, every `new T(...)` / `std::make_unique<T>(...)` / `std::make_shared<T>(...)` touched at a binding entry point MUST be written as:
  ```cpp
  auto* obj = new (std::nothrow) T(...);
  if (obj == nullptr) {
    isolate->ThrowException(v8::Exception::Error(
        FIXED_ONE_BYTE_STRING(isolate, "Out of memory: ...")));
    return;  // or roll back any partial state first
  }
  ```
  For `std::make_unique`, use `std::unique_ptr<T>(new (std::nothrow) T(...))`. Helper classes like `FFIBinding::GetStateOrThrow` / `CheckObjectPoolOrThrow` / `CheckChunkPoolOrThrow` consolidate this on hot call sites.
  For `std::unordered_map` / `std::vector`: insertion can still `bad_alloc` through the allocator and there is **no nothrow escape at the STL API level** — `emplace` / `insert` / `operator[]=` all go through the same allocator and `std::terminate()` the process on failure. Mitigate by calling `.reserve(N)` once at state construction so typical-workload inserts never rehash (narrows the failure surface to one bounded-small, one-time allocation), and cap user-controlled sizes before `.resize(n)` / `vector<T>(n)` with an explicit bound check.
  For `String::Utf8Value`: always null-check `*utf8` before dereferencing. The internal allocation can fail and leave `*utf8` as nullptr; `std::string::assign(nullptr)` or passing nullptr to libpq crashes. Pattern: `String::Utf8Value utf8(isolate, val); if (*utf8 == nullptr) { isolate->ThrowException(...); return; }`.
  Async work that escapes the current stack (`uv_write`, `uv_queue_work`, `setTimeout`-style) MUST allocate its buffer/state on the heap alongside the libuv request — never on the stack — and `delete` in the callback. Stack buffers passed to async `uv_write` are a use-after-stack bug (libuv reads the buffer at send time, not at `uv_write()` call time). If the uv call returns non-zero, the callback will NOT fire — the caller owns the state and must `delete` it on the error path.
- **ALWAYS use full `socketsecurity/...` include paths** (e.g., `#include "socketsecurity/http/http_fast_response.h"`)
- `env-inl.h` vs `env.h`: include `env-inl.h` if .cc file uses `Environment*` methods

### Internal Module Structure

- Use flat `.js` files (Node.js upstream convention), NEVER directories with `index.js`
- `internalBinding` is already in scope — NEVER require it from `'internal/bootstrap/realm'`

### SEA entry: require-from-VFS route

**Node 25.7+** replaces the ambient `require` inside a CJS SEA entry with embedder hooks that only resolve built-in module names. External loads (file://, absolute paths, VFS paths) fail with `ERR_UNKNOWN_BUILTIN_MODULE`. ALWAYS use `Module.createRequire(scriptPath)` to get a require function that bypasses those hooks — our `createVFSRequire()` in `internal/socketsecurity/smol/bootstrap.js` already does this correctly. NEVER replace that helper with `await import(pathToFileURL(...))`; the `import()` hooks have the same limitation in 25.7+.

## Source Patches (Node.js, iocraft, ink, LIEF)

- **Node.js**: `packages/node-smol-builder/patches/source-patched/*.patch`
- **iocraft**: `packages/iocraft-builder/patches/*.patch`
- **ink**: `packages/ink-builder/patches/*.patch`
- **LIEF**: `packages/lief-builder/patches/lief/*.patch`

### Format

ALWAYS use standard unified diff (`--- a/`, `+++ b/`). NEVER use `git format-patch` output.

Required headers — one `@<project>-versions` token per patch matching the target:

```diff
# @node-versions: vX.Y.Z     (or @iocraft-versions / @ink-versions / @lief-versions)
# @description: One-line summary
#
--- a/file
+++ b/file
```

### Patch Rules

- Each patch affects ONE file. Prefer independent patches.
- For multi-file features that cannot be split independently, use an ordered numeric-prefix series (`001-*.patch`, `002-*.patch`, `003-*.patch`) applied in filename order. Each still touches ONE file; dependencies flow in ascending order only.
- Minimal touch, clean diffs, no style changes outside scope
- To regenerate: use `/regenerating-patches` skill
- Manual: `diff -u a/file b/file`, add headers, validate with `patch --dry-run`

## Version consistency gate

`scripts/check-version-consistency.mts` cross-references `.gitmodules` version comments against each upstream's `package.json` `sources.<upstream>.version` + `.ref` and the actual gitlink SHA. Catches the shape R22-R25 hand-fixed during upstream version audits — a submodule bump that forgot to touch the version table, or a version table that points at a commit the submodule isn't actually on. Runs on every `pnpm run check`.

- **Run locally**: `pnpm run check:version-consistency`
- **See why a match is flagged**: `node scripts/check-version-consistency.mts --explain`
- **Machine-readable output**: `--json`
- **Allowlist transitional drift**: `.github/version-consistency-allowlist.yml`

## Mirror-docs sync gate

`scripts/check-mirror-docs.mts` enforces the doc-mirror invariant from "Documentation Policy": every public `lib/smol-*.js` module has a matching `docs/additions/lib/<name>.js.md`, and every mirror doc still has a live source. Catches orphaned docs from deleted sources and new public modules that shipped without a doc. Runs on every `pnpm run check`.

- **Run locally**: `pnpm run check:mirror-docs`
- **See why a match is flagged**: `node scripts/check-mirror-docs.mts --explain`
- **Machine-readable output**: `--json`
- **Allowlist orphan/missing exceptions**: `.github/mirror-docs-allowlist.yml`

## Agents & Skills

- `/security-scan` — AgentShield + zizmor security audit
- `/quality-scan` — comprehensive code quality analysis
- `/quality-loop` — scan and fix iteratively
- Agents: `code-reviewer`, `security-reviewer`, `refactor-cleaner` (in `.claude/agents/`)
- Shared subskills in `.claude/skills/_shared/`

## Bug-class regression gate

`scripts/check-bug-classes.mts` encodes the bug classes caught across R14+ quality-scan rounds. It runs on every `pnpm run check` invocation (so it runs in CI via `.github/workflows/ci.yml`) and fails if any code matches a known-bad shape that isn't in the allowlist.

- **Run locally**: `pnpm run check:bug-classes` (or just `pnpm check`)
- **See why a match is flagged**: `node scripts/check-bug-classes.mts --explain`
- **Machine-readable output**: `--json`
- **Allowlist safe exceptions**: add to `.github/bug-class-allowlist.yml` with a `reason` field; entries without a `line` exempt the whole file
- **Add a new class**: edit `scripts/check-bug-classes.mts` CLASSES, seed the allowlist with any pre-existing safe sites, and document in a commit message

The gate is regression-prevention only. It cannot find NEW bug classes the codebase hasn't seen yet — `/quality-scan` still runs periodically for that.

## Cascade-completeness gate

`scripts/check-cascade-completeness.mts` walks every Makefile `include`, every cross-package TypeScript `import`, and every Dockerfile `COPY` and verifies each discovered dependency is covered by a CASCADE_RULE in `scripts/validate-cache-versions.mts` OR by a hash in the consuming workflow's cache-key composition. Runs on every `pnpm run check` invocation.

- **Run locally**: `pnpm run check:cascade-completeness`
- **See why a match is flagged**: `node scripts/check-cascade-completeness.mts --explain`
- **Machine-readable output**: `--json`
- **Allowlist genuinely non-build-affecting deps**: `.github/cascade-completeness-allowlist.yml`

Catches the shape that powered R18-R27 scope creep — R18 missed `build-infra/wasm-synced/`, R19 missed `curl-builder/{docker,lib,scripts}/`, R20 missed `lief-builder/{lib,scripts}/`, R24 missed root `package.json` + `pnpm-workspace.yaml` across 11 workflows, R27 missed LIEF in stubs.yml. All same shape: dependency exists, builder uses it, cache key doesn't know. One PR's Dockerfile edit or `import { x } from 'foo-builder/bar'` that's missing cascade coverage now fails CI instead of leaking into a later scan round.

## Patch format gate

`scripts/check-patch-format.mts` validates every `.patch` under `packages/*/patches/` against the canonical format documented in "Source Patches" above and the lessons from R14-R21 quality scans. Runs on every `pnpm run check`.

- **Run locally**: `pnpm run check:patch-format`
- **See why a patch is flagged**: `node scripts/check-patch-format.mts --explain`
- **Machine-readable output**: `--json`
- **Allowlist intentional exceptions**: `.github/patch-format-allowlist.yml`

Rules enforced:
- `# @<project>-versions: vX.Y.Z` header on first non-blank line; project tag must match the patch tree (node/ink/iocraft/lief)
- `# @description:` header present and non-empty
- Standard unified diff (`--- a/`, `+++ b/`), NOT `git format-patch` preamble
- Hunk header counts (`@@ -A,B +C,D @@`) match actual body line counts (blank-line tolerance matches `git apply`)
- One file per patch
- No gaps in numbered-series filenames unless allowlisted

- Rules: `.claude/rules/gitmodules-version-comments.md` — `.gitmodules` version-comment format

## Build System

- **ALWAYS use `pnpm run build`**, NEVER invoke Makefiles directly (build scripts handle dependency downloads)
- **ALWAYS run clean before rebuilding**: `pnpm --filter <pkg> clean && pnpm --filter <pkg> build`
- NEVER manually delete checkpoint files — the clean script knows all locations

### Toolchain alignment with language upstreams

Keep our pins, source-of-truth URLs, and checksum metadata aligned with where each language project **currently lives and publishes**, not where it used to. When a language or compiler migrates its canonical home, mirror the move in our tooling the same release cycle:

- **`packages/*/external-tools.json`**: update `source`, `sourceTag`, and `notes` so the canonical URL points at the new home.
- **`packages/build-infra/tool-checksums/<tool>-<version>.json`**: record the new `source`, `sourceTag`, `sourceTagSha`, `sourceCommitSha`, `sourceTarball`, `sourceTarballSha256`. Keep `binaryHost` pointing at wherever the prebuilt artifacts actually live (often a separate CDN), with a `binaryHostNote` explaining why.
- **Prebuilt binary URLs stay where the project hosts them.** Don't assume the new source home also hosts binaries — verify, and keep the fields distinct.
- **One concrete precedent**: Zig moved its source from GitHub → Codeberg. The `zig-*.json` tool-checksum files record Codeberg as the `source` + tag SHA, while `binaryHost` stays on `ziglang.org/download` because that's still the official binary distribution.

When in doubt, check the language's own `README`/`index.json`/release metadata for where they're pushing tagged releases now — that's the canonical answer.

### Source of Truth Architecture

Source packages (`binject`, `bin-infra`, `build-infra`) are canonical. ALL work in source packages, then sync to `additions/`. NEVER make changes only in `additions/` — they will be overwritten.

**The mirrored subdirectories under `additions/source-patched/src/socketsecurity/{bin-infra,binject,build-infra}/` are GITIGNORED** (see `.gitignore` lines 59-61). The `prepare-external-sources.mts` step of the node-smol build populates them by copying from the canonical source packages and then validates the hash matches. If the build fails with "Additions directory out of sync!", the working-tree copy is stale — rerun `pnpm --filter node-smol-builder build` (which will re-sync), or do it manually with `rsync -a --delete packages/<pkg>/src/socketsecurity/<pkg>/ packages/node-smol-builder/additions/source-patched/src/socketsecurity/<pkg>/`. Never "commit" a fix — those paths are untracked on purpose.

### Cache Version Cascade

When modifying source, bump `.github/cache-versions.json` for all dependents:

| Changed                                     | Bump                                                           |
| ------------------------------------------- | -------------------------------------------------------------- |
| build-infra/lib/                            | all 13 downstream (every builder's scripts import from it)     |
| build-infra/make/                           | stubs, binflate, binject, binpress, node-smol (.mk includes)   |
| build-infra/src/socketsecurity/build-infra/ | stubs, binflate, binject, binpress, node-smol                  |
| build-infra/wasm-synced/                    | yoga-layout, onnxruntime, ink (shared WASM sync helpers)       |
| build-infra/release-assets.json             | all 13 downstream (SHA-256 checksums for offline builds)       |
| build-infra/external-tools.json             | all 13 downstream (foundational toolchain pins)                |
| build-infra/scripts/                        | all 13 downstream (get-checkpoint-chain, smoke-test-binary)    |
| .github/scripts/                            | stubs, binflate, binject, binpress, node-smol (Docker boots)   |
| bin-infra/lib/                              | all 13 downstream                                              |
| bin-infra/make/                             | stubs, binflate, binject, binpress, node-smol (.mk includes)   |
| bin-infra/src/socketsecurity/bin-infra/     | stubs, binflate, binject, binpress, node-smol                  |
| binject/src/socketsecurity/binject/         | binject, binpress, node-smol (binpress compiles smol_config.c) |
| stubs-builder/{docker,make,scripts,src}/    | stubs, binpress, node-smol                                     |
| curl-builder/{docker,lib,scripts}/          | curl, stubs, node-smol (stubs links libcurl; node-smol embeds) |
| binpress/src/                               | binpress, node-smol                                            |
| binflate/src/                               | binflate, node-smol (embedded in self-extracting stub)         |
| lief-builder/{docker,lib,make,patches,scripts}/ | lief, binject, binpress, node-smol                         |
| yoga-layout-builder/{scripts,src}/          | yoga-layout, ink (ink bundles yoga-sync.mjs)                   |

`validate-cache-versions.mts` CASCADE_RULES enforces this mechanically.

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
- **Stub Binary**: Small executable that decompresses and runs main binary

### Cross-Platform

- **musl**: Lightweight C library for Alpine Linux (vs glibc on most distros)
- **Universal Binary**: macOS binary with ARM64 + x64 code

### Package Names

**Core binary-injection suite:**
- **binject**: Injects data into binaries (SEA resources, VFS archives)
- **binpress**: Compresses binaries (zstd)
- **binflate**: Decompresses binaries
- **stubs-builder**: Builds self-extracting stub binaries

**Infrastructure (canonical TypeScript helpers — additions/source-patched/ mirrors these):**
- **build-infra**: Cross-package build helpers (checkpoint-manager, platform-mappings, release-checksums, docker-builder)
- **bin-infra**: Binary-manipulation helpers (zstd bindings, compression utilities)

**Custom Node.js:**
- **node-smol-builder**: Builds custom Node.js binary with Socket patches — provides the `node:smol-*` built-in modules (`smol-ffi`, `smol-http`, `smol-https`, `smol-ilp`, `smol-manifest`, `smol-purl`, `smol-sql`, `smol-versions`, `smol-vfs`)

**Native library builders (each produces a shared/static library consumed by node-smol or stubs):**
- **curl-builder**: Builds libcurl + mbedTLS (used by stubs for HTTP)
- **lief-builder**: Builds LIEF (used by binject for Mach-O/ELF/PE manipulation)
- **libpq-builder**: Builds libpq (PostgreSQL client, used by node:smol-sql)

**Native Node.js addons (each produces a `.node` binary):**
- **iocraft-builder**: Rust → .node; TUI rendering primitives
- **opentui-builder**: Zig → .node; terminal UI layer
- **yoga-layout-builder**: Yoga Layout → WASM; flexbox for ink
- **ink-builder**: React for terminals; consumes yoga-layout and iocraft
- **napi-go**: Go → .node framework; source-distributed N-API binding infrastructure (the napi-rs analog for Go)
- **ultraviolet-builder**: Go → .node via napi-go; Charmbracelet Ultraviolet — kitty/fixterms/SGR terminal decoder (Bubble Tea v2 foundation)

**ML/models:**
- **onnxruntime-builder**: Builds ONNX Runtime → WASM
- **codet5-models-builder**, **minilm-builder**, **models**: Model pipeline (downloads → converts → quantizes → optimizes)

## Codex Usage

**Codex is for advice and critical assessment ONLY — never for making code changes.** Proactively consult before complex optimizations (>30min estimated) to catch design flaws early.
