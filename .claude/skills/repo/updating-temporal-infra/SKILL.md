---
name: updating-temporal-infra
description: Update boa-dev/temporal and audit the local C++ port for parity.
user-invocable: true
allowed-tools: Bash(pnpm:*), Bash(npm:*), Bash(git:*), Bash(node:*), Bash(rg:*), Bash(grep:*), Bash(find:*), Bash(ls:*), Bash(cat:*), Bash(head:*), Bash(tail:*), Bash(diff:*), Read, Edit, Glob, Grep
---

# updating-temporal-infra

Track [`boa-dev/temporal`](https://github.com/boa-dev/temporal) (the
`temporal_rs` Rust crate that backs the ECMAScript Temporal proposal)
at its latest tag, audit our C++ port for parity gaps, bump the
submodule + lockstep row when upstream cuts a new release.

- **Submodule**: `packages/temporal-infra/upstream/temporal`
  (boa-dev/temporal)
- **Tag format**: `vX.Y.Z`, semver-ish; sometimes `temporal_capi-v…`
  on the C ABI side
- **Cache bumps**: `node-smol` (the consuming binary). The C++ port
  is embedded inline via additions/source-patched/, so node-smol's
  cache key MUST invalidate when the port changes.
- **Kind**: `feature-parity` (lockstep.json) — the port re-implements
  the Rust crate's externally observable behavior, not the source.

## Why this tracks-latest — emerging language feature

[`Temporal`](https://tc39.es/proposal-temporal/) is the **Stage 4** ECMAScript proposal (recently promoted from Stage 3) for first-class date/time/timezone/calendar handling. boa-dev/temporal lands fixes on its own cadence — often faster than upstream Node bumps — and the C++ port at `packages/temporal-infra/src/socketsecurity/temporal/` mirrors the canonical Rust crate so the port stays aligned with what the spec is actually doing.

V8's link target is the **vendored copy** inside the Node submodule at `deps/crates/vendor/temporal_rs/`. That's V8's concern; we don't track it explicitly. Our single top-level temporal submodule (`packages/temporal-infra/upstream/temporal`) exists for the C++ port to consume — track-latest, no separate locked copy.

The same logic applies to any **future emerging-feature ports** (decorators, pattern matching, etc.) — the `*-infra` package tracks the proposal cadence; V8's link target stays whatever Node ships.

## Coupling with `/updating-node`

`/updating-node` invokes this skill as a sub-step in its Phase 3 cascade order (between `binsuite` and `node-smol`). When Node cuts a new tag, the cascade refreshes the parity reference and audits the C++ port for drift before building node-smol. If this skill's Phase 2 short-circuits at "already at latest," the cascade proceeds straight to node-smol with no temporal commit.

The reverse coupling does not apply: a standalone temporal bump (this skill invoked directly) does NOT drag in a Node rebuild.

## Process

### Phase 1 — Validate

Clean working directory; `git status --porcelain` empty.

### Phase 2 — Identify latest

```bash
cd packages/temporal-infra/upstream/temporal
git fetch origin --tags
LATEST=$(git tag -l 'v*' --sort=-version:refname | head -1)
CURRENT=$(git describe --tags 2>/dev/null || echo "unknown")
```

If `LATEST == CURRENT`, exit 0 with "already at latest."

### Phase 3 — Bump the temporal submodule

```bash
# Bump the canonical temporal submodule to the latest upstream tag.
git -C packages/temporal-infra/upstream/temporal checkout "$LATEST"
```

Update the `.gitmodules` annotation: `# temporal-vX.Y.Z (canonical temporal submodule; …)` → new tag.

There is exactly one temporal submodule (consolidated from the earlier two-submodule split in commit `67919e29`). V8's link target lives in the vendored Rust crate inside the Node submodule (`deps/crates/vendor/temporal_rs/`) and is unaffected by this bump — bumping the parity reference cannot diverge V8's link target.

### Phase 4 — Update lockstep.json

Edit the `temporal-rs` upstream pin AND the `temporal-infra`
feature-parity row's `notes` to reflect the new tag. Same SHA in
both spots.

### Phase 5 — Parity audit

For each new symbol in `temporal_capi/` upstream, check whether the
local port at `packages/temporal-infra/src/socketsecurity/temporal/`
implements it. List missing ones. **Do not block the bump on
missing symbols** — the bump is mechanical (submodule SHA only);
the port catches up via task #217 follow-on commits. Just log the
delta.

### Phase 6 — Cache bump

Bump `.github/cache-versions.json` `node-smol` entry. The C++ port
flows into node-smol via additions/source-patched/, so a port
edit (or even a submodule bump that the port hasn't caught up to
yet, since the parity audit info ends up in the build) requires
node-smol cache invalidation.

### Phase 7 — Build/test (skip in CI)

```bash
cd packages/node-smol-builder
pnpm run clean && pnpm run build && pnpm test
```

The Temporal smoke test in
`packages/build-infra/test/fixtures/smoke-test-modules.mjs`
exercises the canonical Temporal API surface — same one
boa-dev/temporal tests against. A new tag that breaks that smoke
test = blocker; revert the bump, file an issue.

### Phase 8 — Commit

Two commits per the `updating-node` shape:

1. `chore(temporal): bump boa-dev/temporal v0.1.0 → vX.Y.Z`
2. `chore(temporal-infra): port new symbols + cache bump`

(Commit 2 may be empty for a no-API-change point release.)

## Coordination with ultrathink/acorn

Temporal's runtime API surface (`Temporal.Now.plainDateISO()`,
`Temporal.Duration.from(...)`, etc.) is **regular ECMAScript** —
no new syntax. ultrathink's parsers (rust/go/cpp/typescript)
don't need parser changes; member-expression parsing is already
covered.

What they DO need: **a Temporal-using fixture in the lock-step
test corpus** so all 4 lang impls exercise typical Temporal API
shapes as part of their parity suite. After bumping here, sanity-
check that ultrathink's parser tests still pass on a sample
Temporal-using snippet (`Temporal.Now.zonedDateTimeISO('UTC')`,
`Temporal.PlainDateTime.from('2026-05-06T12:00:00')`,
duration arithmetic, etc.). If a future Temporal proposal change
_does_ introduce new syntax (none on the table), that becomes
a parser update across all 4 ultrathink lang impls.

## When to invoke

- A new tag drops in boa-dev/temporal.
- Quarterly cadence checks even when no tag has dropped — Temporal
  is moving fast; a periodic `git fetch --tags` may surface
  in-progress changes worth tracking.
- Before a Node 26 patch release that bumps `temporal_rs` in its
  `deps/crates/Cargo.toml`.
- If `updating-node` is about to cascade a Node bump that ships a
  newer temporal_rs.

## Failure modes

- **Smoke test regression after bump**: revert the submodule SHA,
  file an issue at boa-dev/temporal, leave the port at the prior
  tag until the upstream bug is fixed.
- **Public API surface widened**: list new symbols, log them as
  follow-ups for task #217 (the implementation work). Don't block
  the SHA bump on having every symbol ported; the port catches
  up incrementally.
- **V8's link target is newer than the parity reference**:
  V8's vendored `deps/crates/vendor/temporal_rs/` (inside the Node
  submodule) is whatever Node ships; the parity reference at
  `packages/temporal-infra/upstream/temporal` is whatever
  boa-dev/temporal cuts. Usually parity is ahead. If V8 is ahead
  (rare — only when Node ships a brand-new temporal_rs before
  boa-dev tags it), consult upstream Node's `deps/crates/Cargo.toml`
  and bump the parity submodule to a commit that matches or
  exceeds V8's pin.
