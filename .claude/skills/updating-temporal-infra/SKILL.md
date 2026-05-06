---
name: updating-temporal-infra
description: Audits parity between packages/temporal-infra/ (the C++ port) and the upstream boa-dev/temporal submodule (the Rust temporal_rs crate). Surfaces drift; never auto-bumps because the port is a semantic re-implementation, not a fork. Use when a temporal_rs upstream bump is contemplated.
user-invocable: true
allowed-tools: Bash(git:*), Bash(node:*), Bash(rg:*), Bash(grep:*), Bash(find:*), Bash(ls:*), Bash(cat:*), Bash(head:*), Bash(tail:*), Bash(diff:*), Read, Edit, Glob, Grep
---

# updating-temporal-infra

Audit drift between `packages/temporal-infra/` (the C++ port) and the
upstream `boa-dev/temporal` submodule (the `temporal_rs` Rust crate).

- **Submodule**: `packages/temporal-infra/upstream/temporal` (boa-dev/temporal)
- **Pinned tag**: `v0.1.0` — locked by upstream Node's
  `deps/crates/Cargo.toml`. Bumping requires a matching upstream Node
  bump first (handled by `updating-node`), so this skill is mostly
  read-only / advisory.
- **Cache bumps**: none directly. The C++ port lives inside
  `node-smol-builder` via additions/source-patched/ copy step at
  build time, so node-smol's own cache bump (driven by
  `updating-node`) covers any port edits that flow through.
- **Kind**: `feature-parity` (xport.json) — the port re-implements
  the Rust crate's externally observable behavior, not the source.
  Tracking is **manual**, not auto-cascaded.

## Why this is read-only

Unlike `updating-libdeflate` / `updating-cjson` / etc. which bump a
single submodule SHA and rebuild, temporal-infra is a **port, not a
fork**:

- The Rust source moves on its own cadence; the C++ port catches up
  manually with each bump.
- Bumps are gated on upstream Node (which vendors temporal_rs in
  `deps/crates/vendor/temporal_rs/`). Bumping temporal-infra ahead
  of upstream Node would diverge the API surface from what V8
  actually links against.
- A blind submodule bump here would put the port out of sync with
  what node-smol actually compiles. That's a parity defect, not an
  update.

So this skill **reports drift** and **flags audit-needed**; it does
NOT auto-bump.

## Process

1. **Verify pinned SHA matches** the canonical `temporal-rs` row in
   `xport.json` (currently `1d1b123` / `v0.1.0`). The two
   submodules — this one + `node-smol-builder/upstream/temporal` —
   must always agree.
2. **Read upstream** at the pinned tag, list the public API surface
   exposed by `temporal_capi` (the C ABI surface, easier to map to
   our C++ port than the Rust API).
3. **Read local port** at `packages/temporal-infra/src/socketsecurity/temporal/`
   and list which `temporal_capi` symbols are implemented vs missing.
4. **Report**:
   - upstream tag/SHA
   - mirroring SHA in node-smol-builder/upstream/temporal (must equal)
   - implemented symbols (count)
   - missing symbols (list)
   - any C++ types whose layout doesn't match the FFI contract
5. **No commits.** Report only. Audit decisions are human.

## When to invoke

- Before bumping the `temporal-rs` xport row (which only happens via
  `updating-node` cascading an upstream Node bump).
- During code review of the port's implementation work (task #217),
  to verify a new symbol implementation matches upstream's signature.
- Quarterly drift checks: even with the lock, occasionally re-audit
  to make sure no drift slipped in via a node-smol patch.

## What this skill does NOT do

- Does NOT run `git checkout <new-tag>` on the submodule. Bumps go
  through `updating-node`'s cascade.
- Does NOT regenerate code from the FFI bindings. The C++ port is
  hand-written.
- Does NOT bump `cache-versions.json`. node-smol's cache covers
  edits via the additions copy step.

## Failure modes

- **SHA drift** between `packages/temporal-infra/upstream/temporal`
  and `packages/node-smol-builder/upstream/temporal`: report as
  CRITICAL — the two MUST agree, otherwise the port targets one
  upstream while V8 links against another.
- **`v0.1.0` no longer pinned by upstream Node**: indicates a
  stealth bump in `deps/crates/Cargo.toml` that `updating-node` did
  not catch. Surface for audit.
- **Public API surface widened in upstream**: list new symbols,
  flag for porting (task #217 follow-on).
