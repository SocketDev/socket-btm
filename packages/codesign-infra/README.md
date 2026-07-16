# codesign-infra

A source-only C++ port of the **Mach-O signing core** of
[`apple-codesign`](https://github.com/indygreg/apple-platform-rs) — Apple code
signing (ad-hoc and Developer-ID) that runs on macOS, Linux, or Windows hosts with
no dependency on Apple's `codesign` tool. Crypto is BoringSSL; only Apple's
signature _format_ is ported.

## Architecture

The C++ port reimplements the upstream Rust crate's externally observable signing
behavior: a CodeDirectory (per-page SHA-256 hashes + special slots), an
embedded-signature SuperBlob, the CodeRequirement blob, and the `__LINKEDIT` /
`LC_CODE_SIGNATURE` layout. All cryptographic primitives — SHA-256, RSA, ECDSA
P-256, X.509, PKCS#7/CMS — come from `boringssl-builder`'s libcrypto, never
hand-rolled. The public C ABI is `include/socketsecurity/codesign/codesign.h`.

## Why source-only

Per the `*-infra` convention: a source-only utility package, no release pipeline,
compiled inline by its consumer (binject's re-sign seam, once integrated). Matches
`bin-infra` (binject/binpress/binflate shared C/C++) and `temporal-infra` (a C++
port of a Rust crate).

## Layout

- `include/socketsecurity/codesign/codesign.h` — the public C ABI.
- `src/socketsecurity/codesign/` — the C++ implementation (staged; see the tracker).
- `lib/paths.mts` — single source of truth for the source/include paths.
- `scripts/` — `check-lockstep.mts`, `clean.mts`.

## Testing

`codesign -v` is the contract: every produced signature must verify under Apple's
own tool (macOS-only; Linux/Windows hosts run the structural assertions and skip
`codesign -v`). Phase tests live under `test/`.

## Naming

`*-infra`: source-only, no release pipeline.

## xport tracking

[`xport.json`](../../xport.json) row: `codesign-infra` → `indygreg/apple-platform-rs`
(subpath `apple-codesign`), kind `feature-parity`. The C++ port re-implements the
Rust crate's observable behavior — no source-fork relationship. Upstream bumps are
manual parity audits, not auto-cascaded.

## Status

Scaffold. The signing implementation is staged behind
[`docs/ports/codesign-infra-lockstep.md`](../../docs/ports/codesign-infra-lockstep.md):
phase 1 ad-hoc → 2 Developer-ID cert → 3 verify → 4 binject seam. `codesign.h` is
declared; the bodies are pending.
