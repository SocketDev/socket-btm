// node:smol-manifest — pnpm-lock.yaml parser.
//
// Handles lockfileVersion {5, 6, 9}. Single line-walk impl that
// detects format from the lockfileVersion header and dispatches
// section/indent logic accordingly. No YAML library dependency —
// pnpm's lockfile is a strict subset (no flow style, no anchors,
// indent-significant blocks only) that's cheaper to walk directly
// than to feed through a generic YAML parser.
//
// Algorithm oracle: socket-sdxgen/src/parsers/pnpm/pnpm-lock-v9.mts.

#ifndef SRC_SOCKETSECURITY_MANIFEST_PARSER_PNPM_H_
#define SRC_SOCKETSECURITY_MANIFEST_PARSER_PNPM_H_

#if defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#include <string_view>

#include "manifest.h"

namespace node {
namespace socketsecurity {
namespace manifest {

// Parse a pnpm-lock.yaml. Returns true on success (fills `out`);
// returns false on fatal failure (fills `err`). Most "malformed"
// lockfiles still parse to a partial / empty packages list rather
// than failing — pnpm's format is forgiving enough that strict
// failure would block scans of real-world lockfiles that have
// drift between pnpm versions.
bool ParsePnpmLock(std::string_view content,
                   ParseContext* ctx,
                   ParsedLockfile* out,
                   ParseError* err);

}  // namespace manifest
}  // namespace socketsecurity
}  // namespace node

#endif  // NODE_WANT_INTERNALS
#endif  // SRC_SOCKETSECURITY_MANIFEST_PARSER_PNPM_H_
