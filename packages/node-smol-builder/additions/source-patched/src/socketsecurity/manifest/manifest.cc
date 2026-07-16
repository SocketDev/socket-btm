// node:smol-manifest — top-level parser dispatch.
//
// Routes (ecosystem, format) → per-format parser. Each parser owns
// its own line-walk; this file is the thin dispatcher only.

#include "manifest.h"

#include "parser_cargo.h"
#include "parser_npm.h"
#include "parser_pnpm.h"
#include "parser_yarn.h"

namespace node {
namespace socketsecurity {
namespace manifest {

bool ParseLockfile(std::string_view content,
                   Ecosystem ecosystem,
                   LockFormat format,
                   ParseContext* ctx,
                   ParsedLockfile* out,
                   ParseError* err) {
  if (ecosystem == Ecosystem::kNpm) {
    switch (format) {
      case LockFormat::kPnpm:
        return ParsePnpmLock(content, ctx, out, err);
      case LockFormat::kYarn:
        return ParseYarnLock(content, ctx, out, err);
      case LockFormat::kNpm:
        return ParseNpmLock(content, ctx, out, err);
      default:
        break;
    }
  }
  if (ecosystem == Ecosystem::kCargo && format == LockFormat::kCargo) {
    return ParseCargoLock(content, ctx, out, err);
  }
  err->message = "Unsupported (ecosystem, format) pair";
  err->code = "ERR_UNSUPPORTED";
  return false;
}

}  // namespace manifest
}  // namespace socketsecurity
}  // namespace node
