---
name: updating-temporal-infra
description: Tracks the boa-dev/temporal submodule (temporal_rs Rust crate) at the latest tag, surfaces parity gaps in the local C++ port, and bumps the submodule SHA forward. Temporal is a Stage 3 emerging proposal — the upstream moves fast, and we want to ride that. Use when boa-dev/temporal cuts a new tag, or proactively on a regular cadence.
user-invocable: true
allowed-tools: Bash(pnpm:*), Bash(npm:*), Bash(git:*), Bash(node:*), Bash(rg:*), Bash(grep:*), Bash(find:*), Bash(ls:*), Bash(cat:*), Bash(head:*), Bash(tail:*), Bash(diff:*), Read, Edit, Glob, Grep
---

# updating-temporal-infra

Track [`boa-dev/temporal`](https://github.com/boa-dev/temporal) (the
`temporal_rs` Rust crate that backs the ECMAScript Temporal proposal)
at its latest tag, audit our C++ port for parity gaps, bump the
submodule + xport row when upstream cuts a new release.

- **Submodule**: `packages/temporal-infra/upstream/temporal`
  (boa-dev/temporal)
- **Tag format**: `vX.Y.Z`, semver-ish; sometimes `temporal_capi-v…`
  on the C ABI side
- **Cache bumps**: `node-smol` (the consuming binary). The C++ port
  is embedded inline via additions/source-patched/, so node-smol's
  cache key MUST invalidate when the port changes.
- **Kind**: `feature-parity` (xport.json) — the port re-implements
  the Rust crate's externally observable behavior, not the source.

## Why this tracks-latest (not locked) — emerging language feature

[`Temporal`](https://tc39.es/proposal-temporal/) is the
**Stage 4** ECMAScript proposal (recently promoted from Stage 3)
for first-class date/time/timezone/calendar handling. Spec:
<https://tc39.es/proposal-temporal/>. Implementations are still
shipping (V8 14.x has it behind a flag), boa-dev/temporal lands
fixes regularly, and divergence between our port and the
canonical Rust implementation is a real risk.

### UNLIKE lief / curl / cjson / libdeflate / etc.

For most upstreams socket-btm vendors, we sync the submodule SHA
to **whatever version upstream Node ships** (via `deps/<name>/`).
That's the right policy for stable C/C++ libraries with frozen
APIs — the goal is reproducible Node builds, not tracking the
library's own cadence.

**Temporal is different.** It's an emerging language feature, not
a stable utility library:

- The TC39 proposal is still settling edge cases (calendar
  ambiguity, ISO week math, leap-second semantics).
- boa-dev/temporal cuts releases on its own cadence, often
  faster than upstream Node bumps.
- V8's Temporal implementation lives in
  `deps/v8/src/objects/js-temporal-objects.cc` and depends on
  the Rust crate via FFI through `temporal_capi`. V8 may pin
  an older boa-dev/temporal than what's current.
- Locking us to V8's pin would mean the C++ port can never
  exercise newer Temporal API shapes than what V8 happens to
  ship — defeats the point of an independent port.

**Two submodules, two policies:**

| Submodule | Policy | Driven by |
|---|---|---|
| `packages/node-smol-builder/upstream/temporal` | **locked** to upstream Node's `deps/crates/Cargo.toml` pin (currently v0.1.0) | `updating-node` cascade |
| `packages/temporal-infra/upstream/temporal` | **track-latest** boa-dev/temporal release | this skill |

**They DO NOT need to agree.** node-smol's submodule is what V8
links against (the Rust crate compiled into the binary).
temporal-infra's submodule is the **parity reference** for the
hand-written C++ port — source of truth for "what should the API
surface look like." A newer parity reference than what V8 ships
against is fine; the C++ port matches the upstream API even when
V8 doesn't expose every new symbol yet.

The annotations in `.gitmodules` make this explicit:

```
# temporal-v0.1.0 (locked: pinned by upstream Node ...)
[submodule "packages/node-smol-builder/upstream/temporal"]
  ...
# temporal-vX.Y.Z (track-latest: bump independently via updating-temporal-infra)
[submodule "packages/temporal-infra/upstream/temporal"]
  ...
```

The same logic applies to any **future emerging-feature ports**
(decorators, pattern matching, etc.) — the *-infra package
tracks the proposal cadence, the node-smol vendor copy stays
locked to whatever Node ships.

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

### Phase 3 — Bump only temporal-infra's submodule

```bash
# Bump temporal-infra to the latest upstream tag.
git -C packages/temporal-infra/upstream/temporal checkout "$LATEST"
```

**Do NOT bump `packages/node-smol-builder/upstream/temporal`** —
that submodule is locked to upstream Node's `deps/crates/Cargo.toml`
pin. Bumping it independently would diverge what V8 links against
from what upstream expects, and is the `updating-node` skill's
job, not this one.

Update `.gitmodules` annotation for THIS submodule only:
`# temporal-vX.Y.Z (track-latest: ...)` → new tag.

### Phase 4 — Update xport.json

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
*does* introduce new syntax (none on the table), that becomes
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
- **node-smol's submodule SHA drifts ahead of temporal-infra's**:
  fine — node-smol's vendored copy is the V8 link target;
  temporal-infra's is the parity reference and may legitimately
  be ahead. Concerning only in the reverse direction (V8 has a
  newer Temporal API than the parity reference), in which case
  consult upstream Node's `deps/crates/Cargo.toml` and decide
  whether to bump temporal-infra forward.
