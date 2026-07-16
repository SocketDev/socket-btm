// node:smol-manifest — yarn.lock parser implementation.
//
// =====================================================================
// Source material (in lock-step order, newest → oldest)
// =====================================================================
//
// 1. **socket-lib's TS port** — the v6.0.0 public contract:
//      socket-lib/src/eco/npm/yarnpkg/yarn/parse-lockfile.ts
//      socket-lib/src/eco/npm/yarnpkg/yarn/parse-yarn-descriptor.ts
//
// 2. **socket-btm smol JS impl** — stock-Node fallback:
//      additions/source-patched/lib/internal/socketsecurity/manifest.js
//      (parseYarnLock, parseYarnDescriptor)
//
// 3. **socket-sdxgen TS parsers** — algorithm oracle:
//      socket-sdxgen/src/parsers/yarn-classic/yarn-lock-v1.mts
//      socket-sdxgen/src/parsers/yarn-berry/yarn-lock-v2.mts
//      socket-sdxgen/src/parsers/zpm/yarn-lock-v6.mts (zpm fork)
//    sdxgen uses `@yarnpkg/parsers.parseSyml` (a real syml grammar
//    parser). We line-walk instead because syml-as-yarn-uses-it is a
//    strict subset (column-0 descriptors, 2-space property indent,
//    4-space dep indent, no anchors/aliases).
//
// 4. **cdxgen** (pinned v11.11.0) baseline:
//      https://github.com/CycloneDX/cdxgen/blob/v11.11.0/lib/parsers/js.js
//      (parseYarnLock)
//
// 5. **yarn lockfile format docs**:
//      classic (v1): https://github.com/yarnpkg/yarn/blob/master/src/lockfile/parse.js
//                    (syml grammar — pre-Berry)
//      berry (v2+):  https://yarnpkg.com/configuration/yarnrc#lockfileVersion
//      protocols:    https://yarnpkg.com/protocol/
//                    (npm:, workspace:, patch:, portal:, etc.)
//
// =====================================================================
// Fix register
// =====================================================================
//
//   fix4 — dependenciesMeta inversion.
//          `dependenciesMeta.<child>.optional = true` flags a CHILD
//          as optional (e.g., `react`'s `fsevents` is an optional
//          peer). Earlier impls were:
//          (a) synthesizing a phantom PackageRef from the child, AND
//          (b) flipping the PARENT's `isOptional` based on any
//              child flag — inverted semantics.
//          The C++ port consumes the block for position only.
//          See the `dependenciesMeta:` branch below.
//
// =====================================================================
// Yarn-specific notes
// =====================================================================
//
// - Berry detection: `__metadata:` block at column 0 is unique to
//   v2+. Classic v1 has only comments + descriptor blocks.
//
// - Workspace entries (Berry) come in two flavors:
//     (a) `@workspace:` protocol — `"foo@workspace:packages/foo":`
//         These are project-local; skip the whole block.
//     (b) Soft links — `linkType: soft` on a real-looking entry.
//         Also skipped per the JS impl.
//
// - Multi-spec descriptors: `"foo@^1.0.0, foo@^1.1.0":` declares the
//   same package under two ranges. We take only the first (matches
//   manifest.js + sdxgen).

#include "parser_yarn.h"

#include <cstdint>
#include <string_view>

#include "manifest.h"

namespace node {
namespace socketsecurity {
namespace manifest {

namespace {

bool StartsWith(std::string_view s, std::string_view prefix) {
  return s.size() >= prefix.size() &&
         s.substr(0, prefix.size()) == prefix;
}

bool EndsWith(std::string_view s, std::string_view suffix) {
  return s.size() >= suffix.size() &&
         s.substr(s.size() - suffix.size()) == suffix;
}

std::string_view TrimAscii(std::string_view s) {
  size_t lo = 0;
  while (lo < s.size() && (s[lo] == ' ' || s[lo] == '\t')) {
    ++lo;
  }
  size_t hi = s.size();
  while (hi > lo &&
         (s[hi - 1] == ' ' || s[hi - 1] == '\t' || s[hi - 1] == '\r')) {
    --hi;
  }
  return s.substr(lo, hi - lo);
}

// Strip a single layer of surrounding double-quotes if present.
std::string_view StripQuotes(std::string_view s) {
  if (s.size() >= 2 && s.front() == '"' && s.back() == '"') {
    return s.substr(1, s.size() - 2);
  }
  return s;
}

size_t NextLf(std::string_view content, size_t from) {
  while (from < content.size() && content[from] != '\n') {
    ++from;
  }
  return from;
}

// Read property value: handles both `key value` and `key: value` forms
// (yarn classic uses space-separated; Berry uses colon-separated).
std::string_view ReadPropValue(std::string_view prop_line,
                               size_t key_len_with_space) {
  // `key: value` form — find the colon and take everything after it.
  size_t colon = prop_line.find(':');
  if (colon != std::string_view::npos) {
    return TrimAscii(prop_line.substr(colon + 1));
  }
  // `key value` form — skip past `<key> ` (the key_len_with_space arg
  // already includes the trailing space).
  if (prop_line.size() <= key_len_with_space) {
    return std::string_view{};
  }
  return TrimAscii(prop_line.substr(key_len_with_space));
}

// Yarn descriptor parser — extracts the package name from
// `name@range`, `@scope/name@range`, `name@npm:real@range`,
// `patch:name@npm:real@…`, etc. Mirrors the JS impl's branches.
std::string_view ParseYarnDescriptor(std::string_view descriptor) {
  // patch: protocol.
  if (StartsWith(descriptor, "patch:")) {
    std::string_view after = descriptor.substr(6);
    size_t npm_idx = after.find("@npm:");
    size_t npm_enc_idx = after.find("@npm%3A");
    size_t ws_idx = after.find("@workspace:");
    // Use the first valid occurrence.
    if (npm_enc_idx != std::string_view::npos &&
        npm_enc_idx > 0 &&
        (npm_idx == std::string_view::npos || npm_enc_idx < npm_idx)) {
      npm_idx = npm_enc_idx;
    }
    if (npm_idx != std::string_view::npos && npm_idx > 0) {
      return after.substr(0, npm_idx);
    }
    if (ws_idx != std::string_view::npos && ws_idx > 0) {
      return after.substr(0, ws_idx);
    }
  }

  // Berry @npm: protocol — `name@npm:^1.0.0`. The LHS is the name
  // (matches socket-lib's parseYarnDescriptor, which is the v6.0.0
  // public contract). Note: yarn's "npm aliases" — where one name
  // points at another via `aliasName@npm:realName@range` — are NOT
  // unwrapped here; the alias surfaces as the registered name. This
  // matches the JS impls in socket-btm + socket-lib.
  size_t at_npm = descriptor.find("@npm:");
  if (at_npm != std::string_view::npos && at_npm > 0) {
    return descriptor.substr(0, at_npm);
  }

  // Berry @workspace: protocol — LHS is the package name.
  size_t at_ws = descriptor.find("@workspace:");
  if (at_ws != std::string_view::npos && at_ws > 0) {
    return descriptor.substr(0, at_ws);
  }

  // Classic: `name@^1.0.0` or `@scope/name@^1.0.0` — last @ splits.
  size_t at = descriptor.rfind('@');
  if (at != std::string_view::npos && at > 0) {
    return descriptor.substr(0, at);
  }

  return descriptor;
}

void AddToIndex(ParsedLockfile* out, std::string_view name, uint32_t idx) {
  for (auto& [k, v] : out->index) {
    if (k == name) {
      if (std::holds_alternative<uint32_t>(v)) {
        std::vector<uint32_t> vec{std::get<uint32_t>(v), idx};
        v = std::move(vec);
      } else {
        std::get<std::vector<uint32_t>>(v).push_back(idx);
      }
      return;
    }
  }
  out->index.emplace_back(name, PackageIndexValue{idx});
}

// Skip the indented block starting at `pos`. The block is terminated
// by either EOF or a non-indented line. Updates `pos` to point at the
// terminating line's start. Used for fix4 (dependenciesMeta consume),
// the __metadata header, and workspace-protocol entries.
void SkipIndentedBlock(std::string_view content, size_t& pos) {
  while (pos < content.size()) {
    size_t eol = NextLf(content, pos);
    std::string_view line = content.substr(pos, eol - pos);
    if (line.empty() || (line[0] != ' ' && line[0] != '\t')) {
      return;
    }
    pos = eol + 1;
  }
}

}  // namespace

bool ParseYarnLock(std::string_view content,
                   ParseContext* ctx,
                   ParsedLockfile* out,
                   ParseError* /* err */) {
  // Berry detection via __metadata: marker.
  bool is_berry = content.find("__metadata:") != std::string_view::npos;
  out->lockVersion = is_berry ? std::string_view{"berry"}
                              : std::string_view{"1"};
  out->ecosystem = Ecosystem::kNpm;

  size_t pos = 0;
  while (pos < content.size()) {
    size_t eol = NextLf(content, pos);
    std::string_view line = content.substr(pos, eol - pos);
    pos = eol + 1;

    // Skip empty lines + comments.
    std::string_view trimmed = TrimAscii(line);
    if (trimmed.empty() || line[0] == '#') {
      continue;
    }

    // __metadata: header — consume the block.
    if (trimmed == "__metadata:") {
      SkipIndentedBlock(content, pos);
      continue;
    }

    // Package declaration: starts at column 0, ends with `:`. Indented
    // lines are properties of the most-recent declaration.
    if (line[0] == ' ' || line[0] == '\t' || !EndsWith(trimmed, ":")) {
      continue;
    }

    // Drop trailing colon, strip quotes.
    std::string_view spec = TrimAscii(trimmed.substr(0, trimmed.size() - 1));
    spec = StripQuotes(spec);
    // Multiple specs joined by comma — take only the first.
    size_t comma = spec.find(',');
    if (comma != std::string_view::npos) {
      spec = TrimAscii(spec.substr(0, comma));
      spec = StripQuotes(spec);
    }

    // Skip workspace: protocol entries entirely.
    if (spec.find("@workspace:") != std::string_view::npos) {
      SkipIndentedBlock(content, pos);
      continue;
    }

    std::string_view name = ParseYarnDescriptor(spec);

    // Per-entry property accumulators.
    std::string_view version;
    std::string_view resolved;
    std::string_view integrity;
    std::string_view checksum;
    std::string_view link_type;
    std::vector<std::string_view> dependencies;
    bool is_optional = false;

    // Walk indented property lines.
    while (pos < content.size()) {
      size_t peol = NextLf(content, pos);
      std::string_view pline = content.substr(pos, peol - pos);
      if (pline.empty() || (pline[0] != ' ' && pline[0] != '\t')) {
        break;
      }
      std::string_view prop = TrimAscii(pline);
      pos = peol + 1;

      if (StartsWith(prop, "version ") || StartsWith(prop, "version:")) {
        version = ctx->intern.Intern(StripQuotes(ReadPropValue(prop, 8)));
      } else if (StartsWith(prop, "resolved ") ||
                 StartsWith(prop, "resolved:")) {
        resolved = ctx->intern.Intern(StripQuotes(ReadPropValue(prop, 9)));
      } else if (StartsWith(prop, "integrity ") ||
                 StartsWith(prop, "integrity:")) {
        integrity = ctx->intern.Intern(ReadPropValue(prop, 10));
      } else if (StartsWith(prop, "checksum ") ||
                 StartsWith(prop, "checksum:")) {
        checksum = ctx->intern.Intern(ReadPropValue(prop, 9));
      } else if (StartsWith(prop, "linkType")) {
        link_type = ctx->intern.Intern(ReadPropValue(prop, 9));
      } else if (StartsWith(prop, "resolution")) {
        std::string_view rv = StripQuotes(ReadPropValue(prop, 11));
        if (StartsWith(rv, "http://") || StartsWith(rv, "https://")) {
          resolved = ctx->intern.Intern(rv);
        }
      } else if (StartsWith(prop, "optional ") ||
                 StartsWith(prop, "optional:")) {
        std::string_view ov = ReadPropValue(prop, 9);
        if (ov.find("true") != std::string_view::npos) {
          is_optional = true;
        }
      } else if (StartsWith(prop, "dependencies:")) {
        // Walk the nested dep block (4-space indented children).
        while (pos < content.size()) {
          size_t deol = NextLf(content, pos);
          std::string_view dline = content.substr(pos, deol - pos);
          if (dline.size() < 4 || dline[0] != ' ' || dline[1] != ' ' ||
              dline[2] != ' ' || dline[3] != ' ') {
            break;
          }
          std::string_view dep_line = TrimAscii(dline);
          size_t dcolon = dep_line.find(':');
          if (dcolon != std::string_view::npos && dcolon > 0) {
            dependencies.push_back(
                ctx->intern.Intern(dep_line.substr(0, dcolon)));
          }
          pos = deol + 1;
        }
        continue;
      } else if (StartsWith(prop, "dependenciesMeta:")) {
        // ---- FIX 4: dependenciesMeta consume-only ----
        //
        // Source: manifest.js parseYarnLock lines 731-755 +
        //         socket-sdxgen/src/parsers/yarn-classic/yarn-lock-v1.mts
        //         (which deliberately ignores dependenciesMeta in
        //         `parsePackage`).
        //
        // Berry semantics:
        //   "react@npm:^18":
        //     version: 18.0.0
        //     dependenciesMeta:
        //       fsevents:
        //         optional: true   <-- flags react's `fsevents`
        //                              dep as optional, NOT react.
        //
        // Earlier impls were doing two wrong things at once:
        //   (a) synthesizing a PackageRef for `fsevents` from the
        //       metadata block — but it has no version / resolved
        //       / integrity, so the entry is malformed.
        //   (b) flipping the PARENT's `isOptional` to true based
        //       on any child's optional flag — inverted semantics,
        //       made every package with `fsevents`-like deps show
        //       up as optional in SBOMs.
        //
        // Correct behavior: consume the block for cursor advance
        // only. The block is 4-space indented (one level deeper
        // than the parent's properties); we skip lines until we
        // see something at a shallower indent.
        //
        // See test/fixtures/sdxgen-bug-regressions/fix4-yarn-depsmeta-inversion/.
        while (pos < content.size()) {
          size_t meol = NextLf(content, pos);
          std::string_view mline = content.substr(pos, meol - pos);
          if (mline.size() < 4 || mline[0] != ' ' || mline[1] != ' ' ||
              mline[2] != ' ' || mline[3] != ' ') {
            break;
          }
          pos = meol + 1;
        }
        continue;
      }
    }

    // Skip Berry soft workspace links.
    if (is_berry && link_type == "soft") {
      continue;
    }

    if (!name.empty() && !version.empty()) {
      PackageRef ref;
      ref.name = ctx->intern.Intern(name);
      ref.version = version;
      if (!resolved.empty()) {
        ref.resolved = resolved;
      }
      if (!integrity.empty()) {
        ref.integrity = integrity;
      } else if (!checksum.empty()) {
        ref.integrity = checksum;
      }
      ref.dependencies = std::move(dependencies);
      ref.isOptional = is_optional;
      ref.depType =
          is_optional ? DepType::kOptional : DepType::kProd;
      out->packages.push_back(std::move(ref));
      AddToIndex(out, out->packages.back().name,
                 static_cast<uint32_t>(out->packages.size() - 1));
    }
  }

  return true;
}

}  // namespace manifest
}  // namespace socketsecurity
}  // namespace node
