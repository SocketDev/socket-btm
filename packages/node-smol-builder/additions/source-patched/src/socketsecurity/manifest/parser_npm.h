// node:smol-manifest — npm package-lock.json parser (v1/v2/v3).
//
// Handles both legacy v1 (`dependencies` recursive tree) and modern
// v2/v3 (`packages` flat map). Uses an inlined minimal JSON parser
// — npm lockfiles are well-formed JSON without any oddities we'd
// need a full library for.
//
// Algorithm oracle:
//   socket-sdxgen/src/parsers/npm/package-lock-v{1,2}.mts +
//   lib/internal/socketsecurity/manifest.js parsePackageLock.
//
// Fix register:
//   - fix1:  v1 alias extraction — `version: "npm:<real>@<ver>"`
//            recovers the real registry identity, while `_index`
//            stays keyed by the original alias (socket-lib v6
//            contract).
//   - fix2a: v2/v3 workspace path entries prefer pkg.name over
//            path-derived names.
//   - fix2b: v2/v3 aliased installs (`node_modules/<alias>`) prefer
//            pkg.name over the alias from the path.

#ifndef SRC_SOCKETSECURITY_MANIFEST_PARSER_NPM_H_
#define SRC_SOCKETSECURITY_MANIFEST_PARSER_NPM_H_

#if defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#include <string_view>

#include "manifest.h"

namespace node {
namespace socketsecurity {
namespace manifest {

bool ParseNpmLock(std::string_view content,
                  ParseContext* ctx,
                  ParsedLockfile* out,
                  ParseError* err);

}  // namespace manifest
}  // namespace socketsecurity
}  // namespace node

#endif  // NODE_WANT_INTERNALS
#endif  // SRC_SOCKETSECURITY_MANIFEST_PARSER_NPM_H_
