# temporal-infra

Source-only C++ port of the [Stage 4 Temporal proposal](https://tc39.es/proposal-temporal/),
modeled after [`boa-dev/temporal`](https://github.com/boa-dev/temporal)
(the `temporal_rs` Rust crate that V8 14.x links via FFI for Node 26's
Temporal global). The port re-implements only the **Temporal-specific
algorithms**; calendars and timezones delegate to existing system
infrastructure that V8 already links.

## Architecture

Three-layer split, where layers (1) and (2) are **shared with V8 / system**
and only layer (3) is hand-written C++:

| Layer                       | Source                                    | LOC        | Notes                                                                                                                                                                                                                                                         |
| --------------------------- | ----------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **(1) Calendars**           | system **ICU**                            | (linked)   | V8 already depends on ICU. Delegate non-ISO calendars (Gregorian, Hebrew, Islamic, Persian, Buddhist, Japanese, Indian, Coptic, Ethiopian, Chinese, Korean, Roc, Hijri-Umm-al-Qura) to `icu::Calendar` rather than porting `icu_calendar`'s ~50k LOC of Rust. |
| **(2) Timezone DB**         | V8's existing `js-temporal-zoneinfo64.cc` | (linked)   | V8 already ships zoneinfo64 with system tzdata access. Reuse that path; don't re-implement `timezone_provider` / `zoneinfo_rs` / `iana-time-zone`.                                                                                                            |
| **(3) Temporal algorithms** | this package                              | ~6-10k C++ | The actual port: spec arithmetic, normalization, ambiguity resolution, options handling, ISO 8601 / RFC 9557 parsing, formatting.                                                                                                                             |

**Net scope**: ~6-10k LOC of hand-written C++, vs the ~35k LOC of Rust

- ~50k LOC of icu_calendar transitive deps in upstream `temporal_rs`.

## Why source-only

Following the `bin-infra` / `napi-go-infra` pattern, not the `*-builder`
pattern: this package ships **only source**, no Docker, no workflow, no
release. Consumers (currently just `node-smol-builder`) embed the `.cc`
/ `.h` files via their additions/source-patched copy step. Compilation
inherits node-smol's gyp pipeline — same path as `power_binding.cc`,
`util_binding.cc`, etc.

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
- `scripts/` — helpers (parity-check vs upstream, clean, etc.).
- `upstream/temporal/` — git submodule pointing at boa-dev/temporal,
  pinned in `.gitmodules` for parity reference. **Read-only.** The
  port lives in `src/`, not here.

## Testing

vitest doesn't compile C++, so this package has no `test/` dir.
Parity verification happens at two layers:

- **C++ unit / integration**: when the port lands, add gtest cases
  alongside the source under `src/socketsecurity/temporal/test/`,
  driven by node-smol's existing build pipeline.
- **End-to-end Temporal behavior**: the Node 26 Temporal smoke test
  in node-smol's verification job (task #194) covers Date/PlainDate/
  Duration arithmetic against the published Temporal proposal —
  same surface that boa-dev/temporal is tested against.

If a JS-side test is needed (e.g. checking that node-smol exposes
the Temporal global with the right API surface), add it under
`packages/node-smol-builder/test/` — keep this package source-only.

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
tracker. This package defines the home + architecture contract;
the implementation lands in follow-up commits.

### Implementation order (when port work begins)

1. **Primitives** — `Instant`, `PlainDate`, `PlainTime`,
   `PlainDateTime` with ISO calendar only. ~1.5k LOC.
2. **ISO arithmetic** — date math, duration normalization,
   rounding (Temporal `RoundingMode` enum). ~1k LOC.
3. **ixdtf parsing** — ISO 8601 + RFC 9557 (Temporal extension)
   format parser. Either port `ixdtf` (~5k LOC, mechanical) or
   hand-roll a minimal subset (~1k LOC). Decision deferred.
4. **Calendar binding** — wrap `icu::Calendar` to expose the
   non-ISO chronologies via Temporal's `calendar` option. ~500
   LOC of binding code.
5. **TimeZone binding** — call into V8's existing
   `js-temporal-zoneinfo64.cc` for IANA tz lookups. ~300 LOC.
6. **ZonedDateTime + Duration** — the API surfaces that compose
   primitives + calendar + tz. ~2k LOC.
7. **JS bindings** — V8 `FunctionTemplate`s exposing the API as
   the global `Temporal` namespace, using
   `additions/source-patched/src/socketsecurity/temporal/temporal_binding.cc`
   as the glue. ~500 LOC.

### Why not just a thin V8 shim

A pure shim over V8's existing `js-temporal-objects.cc` was
considered (cuts the port to ~1-2k LOC). Rejected because V8's
implementation **still calls `temporal_capi`** under the hood —
shim'ing wouldn't drop the Rust toolchain dep, just hide it.
The full port (delegating only to ICU + zoneinfo64) is the path
that actually achieves the toolchain reduction.
