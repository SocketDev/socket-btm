# Claude Code Guidelines for Socket BTM

**MANDATORY**: Act as principal-level engineer. Follow these guidelines exactly.

<!-- BEGIN FLEET-CANONICAL — sync via socket-repo-template/scripts/sync-scaffolding.mjs. Do not edit downstream. -->

## 📚 Fleet Standards

### Identifying users

Identify users by git credentials and use their actual name. Use "you/your" when speaking directly; use names when referencing contributions.

### Parallel Claude sessions

This repo may have multiple Claude sessions running concurrently against the same checkout, against parallel git worktrees, or against sibling clones. Several common git operations are hostile to that.

**Forbidden in the primary checkout:**

- `git stash` — shared store; another session can `pop` yours
- `git add -A` / `git add .` — sweeps files from other sessions
- `git checkout <branch>` / `git switch <branch>` — yanks the working tree out from under another session
- `git reset --hard` against a non-HEAD ref — discards another session's commits

**Required for branch work:** spawn a worktree.

```bash
git worktree add -b <task-branch> ../<repo>-<task> main
cd ../<repo>-<task>
# edit / commit / push from here; primary checkout is untouched
git worktree remove ../<repo>-<task>
```

**Required for staging:** surgical `git add <specific-file>`. Never `-A` / `.`.

**Never revert files you didn't touch.** If `git status` shows unfamiliar changes, leave them — they belong to another session, an upstream pull, or a hook side-effect.

The umbrella rule: never run a git command that mutates state belonging to a path other than the file you just edited.

### Public-surface hygiene

🚨 The four rules below have hooks that re-print the rule on every public-surface `git` / `gh` command. The rules apply even when the hooks are not installed.

- **Real customer / company names** — never write one into a commit, PR, issue, comment, or release note. Replace with `Acme Inc` or rewrite the sentence to not need the reference. (No enumerated denylist exists — a denylist is itself a leak.)
- **Private repos / internal project names** — never mention. Omit the reference entirely; don't substitute "an internal tool" — the placeholder is a tell.
- **Linear refs** — never put `SOC-123`/`ENG-456`/Linear URLs in code, comments, or PR text. Linear lives in Linear.
- **Publish / release / build-release workflows** — never `gh workflow run|dispatch` or `gh api …/dispatches`. Dispatches are irrevocable. The user runs them manually.

### Commits & PRs

- Conventional Commits `<type>(<scope>): <description>` — NO AI attribution.
- **When adding commits to an OPEN PR**, update the PR title and description to match the new scope. Use `gh pr edit <num> --title … --body …`. The reviewer should know what's in the PR without scrolling commits.
- **Replying to Cursor Bugbot** — reply on the inline review-comment thread, not as a detached PR comment: `gh api repos/{owner}/{repo}/pulls/{pr}/comments/{comment_id}/replies -X POST -f body=…`.

### Programmatic Claude calls

🚨 Workflows / skills / scripts that invoke `claude` CLI or `@anthropic-ai/claude-agent-sdk` MUST set all four lockdown flags: `tools`, `allowedTools`, `disallowedTools`, `permissionMode: 'dontAsk'`. Never `default` mode in headless contexts. Never `bypassPermissions`. See `.claude/skills/programmatic-claude-lockdown/SKILL.md`.

### Tooling

- **Package manager**: `pnpm`. Run scripts via `pnpm run foo --flag`, never `foo:bar`. After `package.json` edits, `pnpm install`.
- 🚨 NEVER use `npx`, `pnpm dlx`, or `yarn dlx` — use `pnpm exec <package>` or `pnpm run <script>` # socket-hook: allow npx
- **`minimumReleaseAge`** — never add packages to `minimumReleaseAgeExclude` in CI. Locally, ASK before adding (security control).
- **Backward compatibility** — FORBIDDEN to maintain. Actively remove when encountered.

### Code style

- **Comments** — default to none. Write one only when the WHY is non-obvious to a senior engineer.
- **Completion** — never leave `TODO` / `FIXME` / `XXX` / shims / stubs / placeholders. Finish 100%. If too large for one pass, ask before cutting scope.
- **`null` vs `undefined`** — use `undefined`. `null` is allowed only for `__proto__: null` or external API requirements.
- **Object literals** — `{ __proto__: null, ... }` for config / return / internal-state.
- **Imports** — no dynamic `await import()`. `node:fs` cherry-picks (`existsSync`, `promises as fs`); `path` / `os` / `url` / `crypto` use default imports. Exception: `fileURLToPath` from `node:url`.
- **HTTP** — never `fetch()`. Use `httpJson` / `httpText` / `httpRequest` from `@socketsecurity/lib/http-request`.
- **File existence** — `existsSync` from `node:fs`. Never `fs.access` / `fs.stat`-for-existence / async `fileExists` wrapper.
- **File deletion** — route every delete through `safeDelete()` / `safeDeleteSync()` from `@socketsecurity/lib/fs`. Never `fs.rm` / `fs.unlink` / `fs.rmdir` / `rm -rf` directly — even for one known file.
- **Edits** — Edit tool, never `sed` / `awk`.
- **Inclusive language** — see [`docs/references/inclusive-language.md`](docs/references/inclusive-language.md) for the substitution table.
- **Sorting** — sort lists alphanumerically; details in [`docs/references/sorting.md`](docs/references/sorting.md). When in doubt, sort.
- **`Promise.race` / `Promise.any` in loops** — never re-race a pool that survives across iterations (the handlers stack). See `.claude/skills/promise-race-pitfall/SKILL.md`.

### 1 path, 1 reference

A path is constructed exactly once. Everywhere else references the constructed value.

- **Within a package**: every script imports its own `scripts/paths.mts`. No `path.join('build', mode, …)` outside that module.
- **Across packages**: package B imports package A's `paths.mts` via the workspace `exports` field. Never `path.join(PKG, '..', '<sibling>', 'build', …)`.
- **Workflows / Dockerfiles / shell** can't `import` TS — construct once, reference by output / `ENV` / variable.

Three-level enforcement: `.claude/hooks/path-guard/` blocks at edit time; `scripts/check-paths.mts` is the whole-repo gate run by `pnpm check`; `/path-guard` is the audit-and-fix skill. Find the canonical owner and import from it.

### Background Bash

Never use `Bash(run_in_background: true)` for test / build commands (`vitest`, `pnpm test`, `pnpm build`, `tsgo`). Backgrounded runs you don't poll get abandoned and leak Node workers. Background mode is for dev servers and long migrations whose results you'll consume. If a run hangs, kill it: `pkill -f "vitest/dist/workers"`. The `.claude/hooks/stale-process-sweeper/` `Stop` hook reaps true orphans as a safety net.

### Judgment & self-evaluation

- If the request is based on a misconception, say so before executing.
- If you spot an adjacent bug, flag it: "I also noticed X — want me to fix it?"
- Fix warnings (lint / type / build / runtime) when you see them — don't leave them for later.
- **Default to perfectionist** when you have latitude. "Works now" ≠ "right."
- Before calling done: perfectionist vs. pragmatist views. Default perfectionist absent a signal.
- If a fix fails twice: stop, re-read top-down, state where the mental model was wrong, try something fundamentally different.

### Error messages

An error message is UI. The reader should fix the problem from the message alone. Four ingredients in order:

1. **What** — the rule, not the fallout (`must be lowercase`, not `invalid`).
2. **Where** — exact file / line / key / field / flag.
3. **Saw vs. wanted** — the bad value and the allowed shape or set.
4. **Fix** — one imperative action (`rename the key to …`).

Use `isError` / `isErrnoException` / `errorMessage` / `errorStack` from `@socketsecurity/lib/errors` over hand-rolled checks. Use `joinAnd` / `joinOr` from `@socketsecurity/lib/arrays` for allowed-set lists. Full guidance in [`docs/references/error-messages.md`](docs/references/error-messages.md).

### Token hygiene

🚨 Never emit the raw value of any secret to tool output, commits, comments, or replies. The `.claude/hooks/token-guard/` `PreToolUse` hook blocks the deterministic patterns (literal token shapes, env dumps, `.env*` reads, unfiltered `curl -H "Authorization:"`, sensitive-name commands without redaction). When the hook blocks a command, rewrite — don't bypass.

Behavior the hook can't catch: redact `token` / `jwt` / `access_token` / `refresh_token` / `api_key` / `secret` / `password` / `authorization` fields when citing API responses. Show key _names_ only when displaying `.env.local`. If a user pastes a secret, treat it as compromised and ask them to rotate.

Full hook spec in [`.claude/hooks/token-guard/README.md`](.claude/hooks/token-guard/README.md).

### Agents & skills

- `/security-scan` — AgentShield + zizmor audit
- `/quality-scan` — quality analysis
- Shared subskills in `.claude/skills/_shared/`

<!-- END FLEET-CANONICAL -->

## 🏗️ BTM-Specific

### Node.js Additions (`additions/` directory)

Code embedded into Node.js during early bootstrap. Special constraints:

#### Restrictions

- **No third-party packages** — only built-in modules
- Use `require('fs')` not `require('node:fs')` — `node:` protocol unavailable at bootstrap
- NEVER import from `@socketsecurity/*` packages
- ALWAYS start `.js` files with `'use strict';`

#### Module Naming

All `node:smol-*` modules REQUIRE the `node:` prefix (enforced via `schemelessBlockList` in `lib/internal/bootstrap/realm.js`).

Available: `node:smol-ffi`, `node:smol-http`, `node:smol-https`, `node:smol-ilp`, `node:smol-manifest`, `node:smol-purl`, `node:smol-sql`, `node:smol-versions`, `node:smol-vfs`

#### Primordials

ALWAYS use primordials for Map/Set operations in internal modules: `SafeMap`, `SafeSet`, `MapPrototypeGet/Set/Delete/Has`, `SetPrototypeAdd/Delete/Has`, `ArrayFrom`, `ObjectKeys`. Use `*Ctor` suffix for constructors shadowing globals (`BigIntCtor`, `ErrorCtor`). `.size` is safe on SafeMap/SafeSet.

#### Object Iteration

ALWAYS use `ObjectKeys()` + indexed for-loop (faster than `for...in` with `hasOwnProperty`).

#### C++ Code

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

#### Internal Module Structure

- Use flat `.js` files (Node.js upstream convention), NEVER directories with `index.js`
- `internalBinding` is already in scope — NEVER require it from `'internal/bootstrap/realm'`

#### SEA entry: require-from-VFS route

**Node 25.7+** replaces the ambient `require` inside a CJS SEA entry with embedder hooks that only resolve built-in module names. External loads (file://, absolute paths, VFS paths) fail with `ERR_UNKNOWN_BUILTIN_MODULE`. ALWAYS use `Module.createRequire(scriptPath)` to get a require function that bypasses those hooks — our `createVFSRequire()` in `internal/socketsecurity/smol/bootstrap.js` already does this correctly. NEVER replace that helper with `await import(pathToFileURL(...))`; the `import()` hooks have the same limitation in 25.7+.

### Source Patches (Node.js, iocraft, ink, LIEF)

- **Node.js**: `packages/node-smol-builder/patches/source-patched/*.patch`
- **iocraft**: `packages/iocraft-builder/patches/*.patch`
- **ink**: `packages/ink-builder/patches/*.patch`
- **LIEF**: `packages/lief-builder/patches/lief/*.patch`

#### Format

ALWAYS use standard unified diff (`--- a/`, `+++ b/`). NEVER use `git format-patch` output.

Required headers — one `@<project>-versions` token per patch matching the target:

```diff

### @node-versions: vX.Y.Z     (or @iocraft-versions / @ink-versions / @lief-versions)

### @description: One-line summary
#
--- a/file
+++ b/file
```

##### Patch Rules

- Each patch affects ONE file. Prefer independent patches.
- For multi-file features that cannot be split independently, use an ordered numeric-prefix series (`001-*.patch`, `002-*.patch`, `003-*.patch`) applied in filename order. Each still touches ONE file; dependencies flow in ascending order only.
- Minimal touch, clean diffs, no style changes outside scope
- To regenerate: use `/regenerating-patches` skill
- Manual: `diff -u a/file b/file`, add headers, validate with `patch --dry-run`

#### Version consistency gate

`scripts/check-version-consistency.mts` cross-references `.gitmodules` version comments against each upstream's `package.json` `sources.<upstream>.version` + `.ref` and the actual gitlink SHA. Catches the shape R22-R25 hand-fixed during upstream version audits — a submodule bump that forgot to touch the version table, or a version table that points at a commit the submodule isn't actually on. Runs on every `pnpm run check`.

- **Run locally**: `pnpm run check:version-consistency`
- **See why a match is flagged**: `node scripts/check-version-consistency.mts --explain`
- **Machine-readable output**: `--json`
- **Allowlist transitional drift**: `.github/version-consistency-allowlist.yml`

#### Mirror-docs sync gate

`scripts/check-mirror-docs.mts` enforces the doc-mirror invariant from "Documentation Policy": every public `lib/smol-*.js` module has a matching `docs/additions/lib/<name>.js.md`, and every mirror doc still has a live source. Catches orphaned docs from deleted sources and new public modules that shipped without a doc. Runs on every `pnpm run check`.

- **Run locally**: `pnpm run check:mirror-docs`
- **See why a match is flagged**: `node scripts/check-mirror-docs.mts --explain`
- **Machine-readable output**: `--json`
- **Allowlist orphan/missing exceptions**: `.github/mirror-docs-allowlist.yml`

#### Bug-class regression gate

`scripts/check-bug-classes.mts` encodes the bug classes caught across R14+ quality-scan rounds. It runs on every `pnpm run check` invocation (so it runs in CI via `.github/workflows/ci.yml`) and fails if any code matches a known-bad shape that isn't in the allowlist.

- **Run locally**: `pnpm run check:bug-classes` (or just `pnpm check`)
- **See why a match is flagged**: `node scripts/check-bug-classes.mts --explain`
- **Machine-readable output**: `--json`
- **Allowlist safe exceptions**: add to `.github/bug-class-allowlist.yml` with a `reason` field; entries without a `line` exempt the whole file
- **Add a new class**: edit `scripts/check-bug-classes.mts` CLASSES, seed the allowlist with any pre-existing safe sites, and document in a commit message

The gate is regression-prevention only. It cannot find NEW bug classes the codebase hasn't seen yet — `/quality-scan` still runs periodically for that.

#### Cascade-completeness gate

`scripts/check-cascade-completeness.mts` walks every Makefile `include`, every cross-package TypeScript `import`, and every Dockerfile `COPY` and verifies each discovered dependency is covered by a CASCADE_RULE in `scripts/validate-cache-versions.mts` OR by a hash in the consuming workflow's cache-key composition. Runs on every `pnpm run check` invocation.

- **Run locally**: `pnpm run check:cascade-completeness`
- **See why a match is flagged**: `node scripts/check-cascade-completeness.mts --explain`
- **Machine-readable output**: `--json`
- **Allowlist genuinely non-build-affecting deps**: `.github/cascade-completeness-allowlist.yml`

Catches the shape that powered R18-R27 scope creep — R18 missed `build-infra/wasm-synced/`, R19 missed `curl-builder/{docker,lib,scripts}/`, R20 missed `lief-builder/{lib,scripts}/`, R24 missed root `package.json` + `pnpm-workspace.yaml` across 11 workflows, R27 missed LIEF in stubs.yml. All same shape: dependency exists, builder uses it, cache key doesn't know. One PR's Dockerfile edit or `import { x } from 'foo-builder/bar'` that's missing cascade coverage now fails CI instead of leaking into a later scan round.

#### Patch format gate

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

#### Build System

- **ALWAYS use `pnpm run build`**, NEVER invoke Makefiles directly (build scripts handle dependency downloads)
- **ALWAYS run clean before rebuilding**: `pnpm --filter <pkg> clean && pnpm --filter <pkg> build`
- NEVER manually delete checkpoint files — the clean script knows all locations

##### Toolchain alignment with language upstreams

Keep our pins, source-of-truth URLs, and checksum metadata aligned with where each language project **currently lives and publishes**, not where it used to. When a language or compiler migrates its canonical home, mirror the move in our tooling the same release cycle:

- **`packages/*/external-tools.json`**: update `source`, `sourceTag`, and `notes` so the canonical URL points at the new home.
- **`packages/build-infra/tool-checksums/<tool>-<version>.json`**: record the new `source`, `sourceTag`, `sourceTagSha`, `sourceCommitSha`, `sourceTarball`, `sourceTarballSha256`. Keep `binaryHost` pointing at wherever the prebuilt artifacts actually live (often a separate CDN), with a `binaryHostNote` explaining why.
- **Prebuilt binary URLs stay where the project hosts them.** Don't assume the new source home also hosts binaries — verify, and keep the fields distinct.
- **One concrete precedent**: Zig moved its source from GitHub → Codeberg. The `zig-*.json` tool-checksum files record Codeberg as the `source` + tag SHA, while `binaryHost` stays on `ziglang.org/download` because that's still the official binary distribution.

When in doubt, check the language's own `README`/`index.json`/release metadata for where they're pushing tagged releases now — that's the canonical answer.

##### Source of Truth Architecture

Source packages (`binject`, `bin-infra`, `build-infra`) are canonical. ALL work in source packages, then sync to `additions/`. NEVER make changes only in `additions/` — they will be overwritten.

**The mirrored subdirectories under `additions/source-patched/src/socketsecurity/{bin-infra,binject,build-infra}/` are GITIGNORED** (see `.gitignore` lines 59-61). The `prepare-external-sources.mts` step of the node-smol build populates them by copying from the canonical source packages and then validates the hash matches. If the build fails with "Additions directory out of sync!", the working-tree copy is stale — rerun `pnpm --filter node-smol-builder build` (which will re-sync), or do it manually with `rsync -a --delete packages/<pkg>/src/socketsecurity/<pkg>/ packages/node-smol-builder/additions/source-patched/src/socketsecurity/<pkg>/`. Never "commit" a fix — those paths are untracked on purpose.

##### Cache Version Cascade

When modifying source, bump `.github/cache-versions.json` for all dependents. The full path → consumer mapping lives in `scripts/validate-cache-versions.mts` (`CASCADE_RULES`); the gate runs in `pnpm check` and CI, so missed bumps fail the build instead of leaking into a release.

##### Test Style

**NEVER write source-code-scanning tests.** Write functional tests that verify behavior. For modules requiring the built binary: use integration tests with final binary (`getLatestFinalBinary`), NEVER intermediate stages.

**Test fixtures run by the built binary** (smoke tests, integration tests) MUST use `.mjs`/`.js` extensions, NOT `.mts`. The node-smol binary is built `--without-amaro` so it has no TypeScript stripping support. This only applies to files executed by the built binary — build scripts run by the host Node.js can use `.mts` normally.

##### Fetching npm Packages

**ALWAYS use npm registry directly** (`npm pack` or `https://registry.npmjs.org/`), NEVER CDNs like unpkg.

#### Glossary

##### Binary Formats

- **Mach-O**: macOS/iOS, **ELF**: Linux, **PE**: Windows

##### Build Concepts

- **Checkpoint**: Cached snapshot of build progress for incremental builds
- **Cache Version**: Version in `.github/cache-versions.json` that invalidates CI caches
- **Upstream**: Original Node.js source before patches

##### Node.js Customization

- **SEA**: Single Executable Application (standalone with runtime + app code)
- **VFS**: Virtual File System embedded inside a binary
- **Additions Directory**: Code embedded into Node.js during build

##### Binary Manipulation

- **Binary Injection**: Inserting data into compiled binary without recompilation
- **Section/Segment**: Named regions in executables
- **LIEF**: Library for reading/modifying executable formats

##### Compression

- **zstd**: Zstandard compression (fast decompression ~1.5 GB/s, good ratio)
- **Stub Binary**: Small executable that decompresses and runs main binary

##### Cross-Platform

- **musl**: Lightweight C library for Alpine Linux (vs glibc on most distros)
- **Universal Binary**: macOS binary with ARM64 + x64 code

##### Package Names

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

#### Codex Usage

**Codex is for advice and critical assessment ONLY — never for making code changes.** Proactively consult before complex optimizations (>30min estimated) to catch design flaws early.

#### spawn() Usage

**NEVER change `shell: WIN32` to `shell: true`** — `shell: WIN32` enables shell on Windows (needed) and disables on Unix (not needed). If spawn fails with ENOENT, separate command from arguments.

#### Built-in Module Import Style

- Cherry-pick `fs` (`import { existsSync, promises as fs } from 'node:fs'`), default import `path`/`os`/`url`/`crypto`
- File existence: ALWAYS `existsSync`. NEVER `fs.access`, `fs.stat`-for-existence, or an async `fileExists` wrapper.
- Use `@socketsecurity/lib/spawn` instead of `node:child_process` (except in `additions/`)
- Exception: cherry-pick `fileURLToPath` from `node:url`

#### isMainModule Detection

**ALWAYS use `fileURLToPath(import.meta.url) === path.resolve(process.argv[1])`** — works cross-platform. NEVER use `endsWith()` or raw URL comparison.

#### Platform-Arch and libc

**ALWAYS pass libc parameter for Linux platform operations.** Prefer `getCurrentPlatformArch()` which auto-detects libc. Missing libc causes builds to output to wrong directories.

#### Working Directory

🚨 **NEVER use `process.chdir()`** — pass `{ cwd }` options and absolute paths instead. Breaks tests, worker threads, causes race conditions.

#### Logging

**ALWAYS use `@socketsecurity/lib/logger`** instead of `console.*`. NEVER add emoji/symbols manually (logger provides them). Exception: `additions/` directory.
