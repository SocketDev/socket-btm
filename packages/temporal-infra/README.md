# temporal-infra

Source-only C++ port of [`boa-dev/temporal`](https://github.com/boa-dev/temporal)
(the `temporal_rs` Rust crate that backs Node 26's Temporal global). Drops
the Rust toolchain dependency from socket-btm's Node 26 builds by replacing
the `temporal_rs` linkage chain with V8-optimized C++ that compiles inline
with the rest of the node-smol build pipeline.

## Why source-only

Following the `bin-infra` / `napi-go-infra` pattern, not the `*-builder`
pattern: this package ships **only source**, no Docker, no workflow, no
release. Consumers (currently just `node-smol-builder`) embed the `.cc`
/ `.h` files via their additions/source-patched copy step.

If a second consumer ever needs Temporal outside of node-smol, lift to
a `temporal-builder` (own workflow + binary release) — but only when
that demand materializes. For now: one consumer = one source-only
embed = lowest overhead.

## Layout

- `src/socketsecurity/temporal/` — C++ port of `temporal_rs` API surface.
  The `.cc` / `.h` files are copied into node-smol's
  `additions/source-patched/src/socketsecurity/temporal/` at build time.
- `lib/paths.mts` — TS path helpers exported via the workspace
  `exports` field; node-smol-builder imports these to find the source
  tree without hardcoding paths.
- `test/` — vitest parity tests against the upstream Rust behavior.
- `scripts/` — helpers (parity-check vs upstream, clean, etc.).
- `upstream/temporal/` — git submodule pointing at boa-dev/temporal,
  pinned in `.gitmodules` for parity reference. **Read-only.** The
  port lives in `src/`, not here.

## Naming

Per the `*-infra` convention: source-only utility packages, no
release pipeline. Matches `bin-infra` (binject/binpress/binflate
shared C/C++) and `napi-go-infra` (NAPI helpers for Go-backed
modules).

## xport tracking

`xport.json` row: `temporal-infra` → `boa-dev/temporal`,
kind `feature-parity`. The C++ port re-implements the Rust crate's
externally observable behavior; there's no source-fork relationship.
Bumps to upstream are tracked manually with parity audits, not
auto-cascaded — semantic re-implementations need human review.

## Status

🚧 **Scaffold only.** The actual C++ port is task #217 in the work
tracker. This package defines the home and contract; the
implementation lands in follow-up commits.
