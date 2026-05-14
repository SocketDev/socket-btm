// node:smol-manifest — yarn.lock parser (v1 classic + Berry v2+).
//
// Handles the syml-flavored yarn.lock (Classic v1) and the Berry
// metadata header format. Line-walk impl — no syml library
// dependency. Algorithm ported from socket-sdxgen +
// lib/internal/socketsecurity/manifest.js parseYarnLock.
//
// Fix register:
//   - fix4: dependenciesMeta block is consumed for position only.
//           dependenciesMeta.<child>.optional flags a CHILD, never
//           the parent — emitting parent.isOptional based on a child
//           flag inverts the semantics.

#ifndef SRC_SOCKETSECURITY_MANIFEST_PARSER_YARN_H_
#define SRC_SOCKETSECURITY_MANIFEST_PARSER_YARN_H_

#if defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#include <string_view>

#include "manifest.h"

namespace node {
namespace socketsecurity {
namespace manifest {

bool ParseYarnLock(std::string_view content,
                   ParseContext* ctx,
                   ParsedLockfile* out,
                   ParseError* err);

}  // namespace manifest
}  // namespace socketsecurity
}  // namespace node

#endif  // NODE_WANT_INTERNALS
#endif  // SRC_SOCKETSECURITY_MANIFEST_PARSER_YARN_H_
