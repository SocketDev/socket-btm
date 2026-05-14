// node:smol-manifest — Cargo.lock parser (Rust).
//
// Handles the constrained TOML dialect Cargo uses for its lockfile
// (v1, v2, v3, v4 — the `version = N` scalar at the top selects).
// Line-walk impl — no toml++ / @iarna/toml vendoring. The Cargo.lock
// grammar is small enough that hand-rolling the scanner beats
// pulling in a full TOML parser.
//
// Algorithm oracle (in lock-step order, newest → oldest):
//   1. socket-lib/src/eco/cargo/parse-lockfile.ts — v6 public contract
//   2. socket-btm smol JS impl (manifest.js parseCargoLock — actually
//      not present in smol JS, so socket-lib is the direct reference)
//   3. socket-sdxgen/src/parsers/cargo/index.mts — algorithm oracle
//   4. cdxgen v11.11.0 — https://github.com/CycloneDX/cdxgen/blob/v11.11.0/lib/parsers/rust.js
//   5. Cargo's own lockfile writer:
//        https://github.com/rust-lang/cargo/tree/master/src/cargo/core/resolver/encode.rs
//        https://doc.rust-lang.org/cargo/guide/cargo-toml-vs-cargo-lock.html

#ifndef SRC_SOCKETSECURITY_MANIFEST_PARSER_CARGO_H_
#define SRC_SOCKETSECURITY_MANIFEST_PARSER_CARGO_H_

#if defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#include <string_view>

#include "manifest.h"

namespace node {
namespace socketsecurity {
namespace manifest {

bool ParseCargoLock(std::string_view content,
                    ParseContext* ctx,
                    ParsedLockfile* out,
                    ParseError* err);

}  // namespace manifest
}  // namespace socketsecurity
}  // namespace node

#endif  // NODE_WANT_INTERNALS
#endif  // SRC_SOCKETSECURITY_MANIFEST_PARSER_CARGO_H_
