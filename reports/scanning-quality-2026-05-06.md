# Quality Scan Report — 2026-05-06

Branch: `main` @ `9cf23c16`
Scans: critical, logic, cache, workflow, workflow-optimization, security (zizmor), documentation, patch-format
Working tree (read-only scan): 4 modified, 1 untracked at scan start.

## Severity counts

| Severity | Count |
| --- | --- |
| Critical | 0 |
| High | 4 |
| Medium | 12 |
| Low | 6 |
| Info / structural-gate | 3 |

Static gates run synchronously: **path-hygiene clean**, **zizmor clean** (3 expected suppressions), **patch-format 3 violations** (numbered-series gaps).

## Critical (0)

None — the C++ additions, JS-binding entrypoints, JSON.parse boundaries, libuv async paths, `String::Utf8Value` deref sites, `Promise.race` loops, and `setInterval`/timer cleanup all checked out. Codebase shows clear evidence of being hardened over prior quality-scan rounds.

## High (4)

### H-1 — `BINARY_RELEASED` checkpoint cacheHash is asymmetric → checkpoint dead, full Node.js rebuild every run
- **File:** `packages/node-smol-builder/scripts/binary-released/shared/build-released.mts:927-939`
- **Pattern:** `createCheckpoint(BINARY_RELEASED, ..., { arch, buildMode, configureFlags, libc, packageName, packageRoot, platform, sourcePaths, withLief })` — `nodeVersion` missing.
- **Reality:** `shouldRun(...)` at `:667-682` does pass `nodeVersion`. So the hash composed at write time omits `node-X.Y.Z`; the hash composed at read time includes it; they never match.
- **Sibling proof:** `binary-stripped/shared/build-stripped.mts:350` and `binary-compressed/shared/build-compressed.mts:207` both pass `nodeVersion` symmetrically.
- **Fix:** add `nodeVersion: nodeVersionRaw,` to the options object in `build-released.mts:927-939`.
- **Impact:** the most expensive checkpoint stage (full Node.js binary build) is invalidated on every run. Wastes CI minutes; masks any other cache-key bug.

### H-2 — `binject` smol-config: UTF-16 length used where UTF-8 byte length required
- **File:** `packages/binject/scripts/update-config-binary.mts:51, 231-262`
- **Pattern:** validates `value.length` (UTF-16 code units) against byte budgets, then writes `binname.length` as the binary length-prefix while `buffer.write(..., 'utf8')` writes UTF-8 bytes capped at `maxLength`.
- **Trigger:** any non-ASCII `binname`/`command`/`url`/`tag`/`skipEnv`/`fakeArgvEnv`/`nodeVersion` (`'café'` → JS `length` = 4, UTF-8 bytes = 5).
- **Fix:** use `Buffer.byteLength(value, 'utf8')` everywhere that lengths are validated and persisted.
- **Impact:** mid-codepoint truncation; embedded smol-config strings deserialize wrong on the C side at `binject/binject.c:547-565`.

### H-3 — Root README + CLAUDE.md + node-smol-modules.md are at v25 / 9 modules; reality is v26 / 12 modules
- **Files:**
  - `README.md:31, :144` — "v25" → should be "v26" (`.gitmodules` `# node-26.0.0`, `.node-version` = `26.0.0`, `engines.node: >=26.0.0`).
  - `CLAUDE.md:213` — module list missing `node:smol-power`, `node:smol-primordial`, `node:smol-util`.
  - `docs/node-smol-modules.md:3` — opens with "the nine built-in `node:smol-*` modules"; ships 12 (per `realm.js` patch and `additions/source-patched/lib/`). Three sections + Quick-Overview rows missing.
- **Fix:** update version strings in README; add the three modules to CLAUDE.md alphabetically; in `docs/node-smol-modules.md` change "nine" → "twelve" and add three sections — the source mirror docs in `docs/additions/lib/smol-{power,primordial,util}.js.md` already have the API surface to summarize.
- **Impact:** new developers will not know about three shipped modules; the module list is the canonical surface.

### H-4 — 9 release/build workflows declare `workflow_dispatch.inputs.build_mode` (snake_case)
- **Files:** `.github/workflows/{binsuite,iocraft,curl,lief,models,node-smol,onnxruntime,opentui,yoga-layout}.yml` (29 occurrences total).
- **Conflict:** CLAUDE.md "Public-surface hygiene" mandates kebab-case for `workflow_dispatch.inputs` keys; the release-workflow-guard hook only recognizes kebab. The same files already use kebab `dry-run` — the snake_case `build_mode` is local drift.
- **Fix:** rename `build_mode` → `build-mode` in every `workflow_dispatch.inputs` and `workflow_call.inputs` block, plus every reference (`inputs.build_mode` → `inputs['build-mode']`, `${{ inputs.build_mode }}` → `${{ inputs['build-mode'] }}`).
- **Impact:** the dry-run bypass logic never triggers for `build_mode`; risk of a future input lookup silently failing the same way.

## Medium (12)

### M-1 — `FileHandle.lock()` doesn't exist; checkpoint locking is dead scaffolding
- **File:** `packages/build-infra/lib/checkpoint-manager.mts:416, 460-461, 730-731, 759`
- **Verified:** Node's `fs.promises.FileHandle` has no `.lock`/`.tryLock`/`.unlock`. The `typeof lockFile.lock === 'function'` guard is always false.
- **Fix:** either delete the lock scaffolding and update comments to reflect that race protection is via rename-atomicity + retry only, OR implement real advisory locking via `proper-lockfile` / a `flock(2)` wrapper.
- **Impact:** documented "checkpoint in use, skipping cleanup" path is unreachable; the system already relies on the retry loop at `:1126-1147` instead.

### M-2 — `setup-build-toolchain.mts` uses `node:child_process` and `process.exit`
- **File:** `packages/node-smol-builder/scripts/setup-build-toolchain.mts:24, 56, 62, 73`
- **Fix:** import `spawnSync` from `@socketsecurity/lib/spawn`; replace `process.exit(1)` with `process.exitCode = 1; return` (or throw).

### M-3 — `ultraviolet-builder/scripts/clean.mts:11` — direct `fs.rm`
### M-4 — `napi-go-infra/scripts/clean.mts:15` — direct `fs.rm`
### M-5 — `build-infra/scripts/update-checksums.mts:95` — `fs.unlink(...).catch(()=>{})` (exactly the pattern `safeDelete` replaces)
### M-6 — `node-smol-builder/scripts/vendor-fast-webstreams/wpt/validate.mts:29, 285, 290, 341` — `rmSync` from `node:fs` (4 sites)

For M-3..M-6: replace with `safeDelete` / `safeDeleteSync` from `@socketsecurity/lib/fs` per CLAUDE.md "File deletion" rule. Bundle as a single `chore: route deletes through safeDelete` PR.

### M-7 — `check-consistency.mts` generates `require('fs').rmSync(...)` into per-package `clean` scripts
- **File:** `scripts/check-consistency.mts:730`
- **Fix:** generate scripts that call `safeDeleteSync` / `safeDelete` instead. This script propagates the rule violation to every sub-package it touches.

### M-8 — `release-checksums/core.mts` uses `null` as failure sentinel; literal `null` in `release-assets.json` permanently disables verification
- **File:** `packages/build-infra/lib/release-checksums/core.mts:56-78`
- **Fix:** track loaded state with an explicit `loaded: boolean` instead of overloading the value field.

### M-9 — `tarball-utils.mts` rejects valid filenames starting with two dots
- **File:** `packages/build-infra/lib/tarball-utils.mts:75`
- **Pattern:** `if (normalized.startsWith('..')) throw …` — false-positives on `..keep`, `..gitignore-template`.
- **Fix:** `normalized === '..' || normalized.startsWith('..' + path.sep) || normalized.startsWith('../')`.

### M-10 — `release-checksums/producer.mts` silently drops files not in `order` array
- **File:** `packages/build-infra/lib/release-checksums/producer.mts:78-88`
- **Fix:** after iterating `order`, append leftover keys (or fail loudly when `checksums` contains entries not in `order`).
- **Impact:** silently incomplete `checksums.txt`.

### M-11 — `check-cascade-completeness.mts` Dockerfile parser only strips `--from=`, not `--chown=`/`--chmod=`/`--link`
- **File:** `scripts/check-cascade-completeness.mts:374-381`
- **Fix:** strip every leading `--<flag>[=value]` token before splitting `sources`.
- **Impact:** false-positive or silent-pass cascade gate as soon as anyone uses standard COPY flags.

### M-12 — Patch numbered-series gaps (`check-patch-format.mts` failures)
- **Files:** `packages/node-smol-builder/patches/source-patched/{027-smol-util-binding,031-smol-primordial-binding,035-smol-versions-native-binding}.patch:1`
- **Fix:** either renumber to close the gaps (025→026, 027→028, …) or add allowlist entries to `.github/patch-format-allowlist.yml` with `rule: numbered-series-gap` and a `reason`. The pattern (every other slot) suggests the binding/external-refs pair is intentional — likely an allowlist entry is the right answer with a one-line reason explaining the pair convention.

## Low (6)

### L-1 — `napi-go-infra/cli/src/resolve.mts` `GO_TARGETS` keys are asset-form (`win-x64`); rejects Node-form (`win32-x64`)
- **File:** `packages/napi-go-infra/cli/src/resolve.mts:23-25, 33-42`
- **Fix:** accept both forms or validate at the boundary with a "asset form expected" message.

### L-2 — `xport.mts` uses `process.exit(1)`
- **File:** `scripts/xport.mts:145, 153, 164, 962`
- **Fix:** `process.exitCode = 1; return` (sibling `verify-release.mts` already uses the right shape).

### L-3 — `package.json` carries legacy `packageManager` inline `+sha512.<hex>` hash
- **File:** `package.json:64`
- **Fix:** `"packageManager": "pnpm@11.0.6"` — pnpm 11 strips it on install; bare form keeps git diffs clean.

### L-4 — `ultraviolet-builder/README.md:6` broken link to nonexistent `../napi-go`
- **Fix:** `[napi-go-infra](../napi-go-infra)`.

### L-5 — Go version requirement inconsistent: `ultraviolet-builder` says ≥1.25, `napi-go-infra` says ≥1.21
- **Files:** `packages/ultraviolet-builder/README.md:39`, `packages/napi-go-infra/README.md:36`
- **Fix:** decide which is correct; align both. (Likely 1.21 is framework floor, 1.25 is ultraviolet-side requirement — say so explicitly.)

### L-6 — `build-infra/README.md:9` and `bin-infra/README.md:7` reference a "Cache Version Cascade table" in CLAUDE.md
- **Reality:** CLAUDE.md describes the cascade in prose; the rules live in `scripts/validate-cache-versions.mts` as `CASCADE_RULES`.
- **Fix:** point readers at `scripts/validate-cache-versions.mts` directly.

### L-7 — `check-version-consistency.mts` non-anchored package-name regex can shadow real version comments
- **File:** `scripts/check-version-consistency.mts:123-141`
- **Pattern:** `^# ([a-z][a-z0-9_-]*)-([^\s]+)` doesn't require the package name to match the following submodule.
- **Fix:** only treat a comment as a version comment when its package name matches the next submodule's `path.basename`, or reset `prevComment` on any non-version comment line.

## Info / structural gates

- **path-hygiene** (`check-paths.mts`): clean.
- **zizmor** v1.23.1 on 16 workflow files: clean (3 suppressed, expected).
- **check-patch-format**: 3 numbered-series gap violations — see M-12.

## Recommended remediation order

1. **H-1** (cache asymmetry) — single-line fix; recovers a full Node.js build per CI run. Highest ROI.
2. **H-4** (snake_case `build_mode`) — wide blast radius (9 workflows) but mechanical; do as one PR.
3. **H-2** (UTF-16 vs UTF-8 length) — correctness bug; non-ASCII users today silently broken.
4. **H-3** (docs drift) — three files; quick edit pass.
5. **M-1** (dead `FileHandle.lock`) — pick removal vs real implementation; document the choice.
6. **M-3 / M-4 / M-5 / M-6 / M-7** (`fs.rm` / `rmSync` / `unlink` + the consistency-script that propagates them) — bundle as a single `chore: route deletes through safeDelete` PR.
7. **M-12** (patch numbered-series gaps) — allowlist with a one-line reason.
8. Remaining Medium/Low items as background follow-ups.

## Coverage caveats

- Critical/logic scans concentrated on `packages/*/src,scripts,lib` and `additions/source-patched/src/socketsecurity/*` — deeper traces of `uws_server.cc` request lifecycle and `binject.c` paths were sampled, not exhaustively walked.
- Workflow scan covered 16 workflows + scripts. Did not lint every single `package.json` script entry across all 30 workspace packages.
- Cache scan focused on `checkpoint-manager.mts` + the four `binary-*` shared builders + the cascade gate. Other caching surfaces (extraction-cache, tarball-utils) were spot-checked.
- Documentation scan covered root + `packages/*/README.md` + `docs/**`, with `pnpm run check:mirror-docs` confirming the mirror state for `lib/smol-*.js`.
