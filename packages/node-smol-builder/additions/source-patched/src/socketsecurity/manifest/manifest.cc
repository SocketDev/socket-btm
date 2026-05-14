// node:smol-manifest — top-level parser dispatch.
//
// Routes (ecosystem, format) → per-format parser. Each parser owns
// its own line-walk; this file is the thin dispatcher only.

#include "manifest.h"

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
        // Stub — parser_npm.cc lands in step 6.
        out->lockVersion = "0";
        out->ecosystem = Ecosystem::kNpm;
        return true;
      default:
        break;
    }
  }
  if (ecosystem == Ecosystem::kCargo && format == LockFormat::kCargo) {
    // Stub — parser_cargo.cc lands in a later commit.
    out->lockVersion = "0.0.0";
    out->ecosystem = Ecosystem::kCargo;
    return true;
  }
  err->message = "Unsupported (ecosystem, format) pair";
  err->code = "ERR_UNSUPPORTED";
  return false;
}

}  // namespace manifest
}  // namespace socketsecurity
}  // namespace node
