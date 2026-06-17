// node:smol-manifest — npm package-lock.json parser implementation.
//
// =====================================================================
// Source material (in lock-step order, newest → oldest)
// =====================================================================
//
// 1. **socket-lib's TS port** — the v6.0.0 public contract:
//      socket-lib/src/eco/npm/npm/parse-lockfile.ts
//      socket-lib/src/eco/npm/npm/extract-package-name-from-path.ts
//      socket-lib/src/eco/npm/npm/parse-git-url.ts
//
// 2. **socket-btm smol JS impl** — stock-Node fallback:
//      additions/source-patched/lib/internal/socketsecurity/manifest.js
//      (parsePackageLock, extractPackageNameFromPath)
//
// 3. **socket-sdxgen TS parsers** — algorithm oracle:
//      socket-sdxgen/src/parsers/npm/package-lock-v1.mts
//      socket-sdxgen/src/parsers/npm/package-lock-v2.mts
//      socket-sdxgen/src/parsers/npm/npm-shrinkwrap.mts
//      socket-sdxgen/src/parsers/npm/index.mts (format dispatcher)
//
// 4. **cdxgen** (pinned v11.11.0) baseline:
//      https://github.com/CycloneDX/cdxgen/blob/v11.11.0/lib/parsers/js.js
//      (parseLockFile / parsePkgLock — search for those names)
//
// 5. **npm lockfile docs**:
//      v1 spec (legacy): https://docs.npmjs.com/cli/v6/configuring-npm/package-lock-json
//      v2/v3 spec:       https://docs.npmjs.com/cli/v10/configuring-npm/package-lock-json
//      v2/v3 changelog:  https://github.com/npm/cli/blob/latest/CHANGELOG.md
//      arborist (canonical npm lockfile reader/writer):
//        https://github.com/npm/cli/tree/latest/workspaces/arborist
//
// =====================================================================
// Fix register
// =====================================================================
//
//   fix1  — v1 alias extraction. v1 encodes aliased installs as:
//             "deps": {
//               "string-width-cjs": {
//                 "version": "npm:string-width@4.2.3",
//                 ...
//               }
//             }
//           The PackageRef's `name` field must surface the REAL
//           identity ("string-width", not the alias). But `_index`
//           preserves the original alias key so consumers can still
//           look up by the lockfile's declared name. See FlattenV1
//           below — search for "Fix 1".
//
//   fix2a — v2/v3 workspace path → pkg.name preference.
//           Workspace entries are keyed by their relative path
//           (e.g., `packages/ui`) WITHOUT a `node_modules/` prefix,
//           so path-derived name extraction falls through and
//           returns `packages/ui`. Prefer pkg.name when present.
//
//   fix2b — v2/v3 aliased installs prefer pkg.name.
//           Same fix as 2a, different trigger: `node_modules/<alias>`
//           with a `name: "<real>"` field. Same code path.
//
//   Both 2a and 2b land in the v2/v3 walker's name-resolution
//   branch — search for "Fix 2a/2b".
//
// =====================================================================
// JSON parser notes
// =====================================================================
//
// Includes a minimal recursive-descent JSON parser sized for the
// npm-lockfile shape. The parser is non-throwing: malformed input
// returns false from ParseNpmLock with an ERR_INVALID_JSON code.
//
// Why not vendor simdjson? npm lockfiles are typically small (<5MB
// for a 500-package repo) and `JSON.parse` is the JS-side baseline
// we're comparing against. The hand-rolled parser is ~300 lines and
// produces equivalent shape with a single arena allocation per
// escape-bearing string. simdjson would add ~3MB of vendored
// sources and a runtime SIMD-dispatch table for marginal gain at
// our typical sizes — defer until perf measurement justifies it.
//
// Memory shape: every parsed string is a view into the input buffer
// (no copy). Caller's content must outlive the ParsedLockfile.
// Synthesized strings (real names from v1 alias extraction) get
// arena-owned via ctx->intern.

#include "parser_npm.h"

#include <cstdint>
#include <cstdio>
#include <memory>
#include <string>
#include <string_view>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "manifest.h"

namespace node {
namespace socketsecurity {
namespace manifest {

namespace {

// =========================================================================
// Minimal JSON parser
// =========================================================================
//
// Sized for npm-lockfile shape. Supports:
//   - object, array, string, number, bool, null
//   - escape sequences inside strings (\", \\, \/, \b, \f, \n, \r, \t)
//   - \uXXXX unicode escapes for ASCII range; non-ASCII passes through
//     as-is (acceptable for our usage — lockfile keys + values are
//     pure ASCII in practice and we never re-emit the parsed string,
//     only re-view it via std::string_view).
//
// We DON'T copy strings — every JsonValue::s_ is a view into the
// caller's content buffer. For strings with escapes, the parser
// resolves into an arena-owned copy via ctx->arena.

enum class JsonKind : uint8_t {
  kNull = 0,
  kBool,
  kNumber,
  kString,
  kArray,
  kObject,
};

struct JsonValue;
using JsonArray = std::vector<JsonValue>;
// Order-preserving map so v1's recursive walk + v2/v3's index
// assembly produce stable ordering matching the JS impl.
using JsonObject = std::vector<std::pair<std::string_view, JsonValue>>;

struct JsonValue {
  JsonKind kind = JsonKind::kNull;
  // Active member chosen by `kind`. POD types kept inline; the two
  // container types live behind pointers so JsonValue stays small
  // (16 bytes) and movable.
  std::string_view s;
  double n = 0;
  bool b = false;
  // Containers (heap-allocated only when present). Using shared_ptr
  // because JsonValue is held in std::vector which needs moves; we
  // don't actually share structurally — every node is unique — but
  // unique_ptr requires custom copy disabling that complicates the
  // recursive parse helpers. Containers are rarely deeply nested in
  // package-lock files (max ~64 by the depth cap), so heap traffic
  // is bounded.
  std::shared_ptr<JsonArray> a;
  std::shared_ptr<JsonObject> o;
};

class JsonParser {
 public:
  JsonParser(std::string_view text, Arena* arena)
      : text_(text), arena_(arena) {}

  bool Parse(JsonValue* out) {
    SkipWhitespace();
    if (!ParseValue(out)) {
      return false;
    }
    SkipWhitespace();
    return pos_ == text_.size();
  }

 private:
  bool ParseValue(JsonValue* out) {
    SkipWhitespace();
    if (pos_ >= text_.size()) {
      return false;
    }
    char c = text_[pos_];
    switch (c) {
      case '{': return ParseObject(out);
      case '[': return ParseArray(out);
      case '"': return ParseString(out);
      case 't':
      case 'f': return ParseBool(out);
      case 'n': return ParseNull(out);
      default:
        if (c == '-' || (c >= '0' && c <= '9')) {
          return ParseNumber(out);
        }
        return false;
    }
  }

  bool ParseObject(JsonValue* out) {
    out->kind = JsonKind::kObject;
    out->o = std::make_shared<JsonObject>();
    ++pos_;  // consume '{'
    SkipWhitespace();
    if (Peek() == '}') {
      ++pos_;
      return true;
    }
    for (;;) {
      SkipWhitespace();
      JsonValue key;
      if (!ParseString(&key)) {
        return false;
      }
      SkipWhitespace();
      if (Peek() != ':') {
        return false;
      }
      ++pos_;  // consume ':'
      JsonValue val;
      if (!ParseValue(&val)) {
        return false;
      }
      out->o->emplace_back(key.s, std::move(val));
      SkipWhitespace();
      char nc = Peek();
      if (nc == ',') {
        ++pos_;
        continue;
      }
      if (nc == '}') {
        ++pos_;
        return true;
      }
      return false;
    }
  }

  bool ParseArray(JsonValue* out) {
    out->kind = JsonKind::kArray;
    out->a = std::make_shared<JsonArray>();
    ++pos_;  // consume '['
    SkipWhitespace();
    if (Peek() == ']') {
      ++pos_;
      return true;
    }
    for (;;) {
      JsonValue val;
      if (!ParseValue(&val)) {
        return false;
      }
      out->a->push_back(std::move(val));
      SkipWhitespace();
      char nc = Peek();
      if (nc == ',') {
        ++pos_;
        continue;
      }
      if (nc == ']') {
        ++pos_;
        return true;
      }
      return false;
    }
  }

  bool ParseString(JsonValue* out) {
    out->kind = JsonKind::kString;
    if (Peek() != '"') {
      return false;
    }
    ++pos_;
    size_t start = pos_;
    // Fast path: scan for closing `"` without escapes. If we see a
    // backslash, fall through to the slow path that materializes an
    // arena copy.
    while (pos_ < text_.size() && text_[pos_] != '"' &&
           text_[pos_] != '\\') {
      ++pos_;
    }
    if (pos_ >= text_.size()) {
      return false;
    }
    if (text_[pos_] == '"') {
      out->s = text_.substr(start, pos_ - start);
      ++pos_;
      return true;
    }
    // Slow path: copy into arena, expanding escapes as we go.
    // Up to here we've consumed `text_[start..pos_)` with no escapes.
    std::string buf;
    buf.reserve((pos_ - start) + 16);
    buf.append(text_.data() + start, pos_ - start);
    while (pos_ < text_.size() && text_[pos_] != '"') {
      char c = text_[pos_];
      if (c == '\\') {
        ++pos_;
        if (pos_ >= text_.size()) return false;
        char esc = text_[pos_];
        switch (esc) {
          case '"':  buf.push_back('"');  break;
          case '\\': buf.push_back('\\'); break;
          case '/':  buf.push_back('/');  break;
          case 'b':  buf.push_back('\b'); break;
          case 'f':  buf.push_back('\f'); break;
          case 'n':  buf.push_back('\n'); break;
          case 'r':  buf.push_back('\r'); break;
          case 't':  buf.push_back('\t'); break;
          case 'u': {
            // Parse 4 hex digits. ASCII range only — non-ASCII codes
            // pass through as a raw `?` placeholder; lockfile usage
            // never relies on the decoded form (package names and
            // versions are ASCII), so we don't pay UTF-8 encoding
            // costs here.
            if (pos_ + 4 >= text_.size()) return false;
            uint32_t code = 0;
            for (int i = 0; i < 4; ++i) {
              ++pos_;
              char h = text_[pos_];
              uint32_t d;
              if (h >= '0' && h <= '9') d = h - '0';
              else if (h >= 'a' && h <= 'f') d = 10 + (h - 'a');
              else if (h >= 'A' && h <= 'F') d = 10 + (h - 'A');
              else return false;
              code = (code << 4) | d;
            }
            if (code < 0x80) {
              buf.push_back(static_cast<char>(code));
            } else {
              buf.push_back('?');
            }
            break;
          }
          default:
            return false;
        }
        ++pos_;
      } else {
        buf.push_back(c);
        ++pos_;
      }
    }
    if (pos_ >= text_.size()) return false;
    ++pos_;  // closing "
    out->s = arena_->Copy(buf);
    return true;
  }

  bool ParseBool(JsonValue* out) {
    out->kind = JsonKind::kBool;
    if (text_.compare(pos_, 4, "true") == 0) {
      out->b = true;
      pos_ += 4;
      return true;
    }
    if (text_.compare(pos_, 5, "false") == 0) {
      out->b = false;
      pos_ += 5;
      return true;
    }
    return false;
  }

  bool ParseNull(JsonValue* out) {
    out->kind = JsonKind::kNull;
    if (text_.compare(pos_, 4, "null") == 0) {
      pos_ += 4;
      return true;
    }
    return false;
  }

  bool ParseNumber(JsonValue* out) {
    out->kind = JsonKind::kNumber;
    size_t start = pos_;
    if (text_[pos_] == '-') ++pos_;
    while (pos_ < text_.size() && text_[pos_] >= '0' &&
           text_[pos_] <= '9') {
      ++pos_;
    }
    if (pos_ < text_.size() && text_[pos_] == '.') {
      ++pos_;
      while (pos_ < text_.size() && text_[pos_] >= '0' &&
             text_[pos_] <= '9') {
        ++pos_;
      }
    }
    if (pos_ < text_.size() &&
        (text_[pos_] == 'e' || text_[pos_] == 'E')) {
      ++pos_;
      if (pos_ < text_.size() &&
          (text_[pos_] == '+' || text_[pos_] == '-')) {
        ++pos_;
      }
      while (pos_ < text_.size() && text_[pos_] >= '0' &&
             text_[pos_] <= '9') {
        ++pos_;
      }
    }
    std::string_view num = text_.substr(start, pos_ - start);
    // We only need integer interpretation for lockfileVersion; full
    // double parsing is not in the hot path here.
    out->n = 0;
    bool neg = false;
    size_t i = 0;
    if (!num.empty() && num[0] == '-') { neg = true; ++i; }
    for (; i < num.size() && num[i] >= '0' && num[i] <= '9'; ++i) {
      out->n = out->n * 10 + (num[i] - '0');
    }
    if (neg) out->n = -out->n;
    out->s = num;  // keep raw view for stringy callers
    return true;
  }

  void SkipWhitespace() {
    while (pos_ < text_.size()) {
      char c = text_[pos_];
      if (c == ' ' || c == '\t' || c == '\n' || c == '\r') {
        ++pos_;
      } else {
        return;
      }
    }
  }

  char Peek() const {
    return pos_ < text_.size() ? text_[pos_] : '\0';
  }

  std::string_view text_;
  size_t pos_ = 0;
  Arena* arena_;
};

// =========================================================================
// JsonObject helpers
// =========================================================================

const JsonValue* ObjectGet(const JsonObject& obj, std::string_view key) {
  for (const auto& [k, v] : obj) {
    if (k == key) return &v;
  }
  return nullptr;
}

std::string_view AsString(const JsonValue* v) {
  if (v && v->kind == JsonKind::kString) return v->s;
  return std::string_view{};
}

bool AsBool(const JsonValue* v) {
  return v && v->kind == JsonKind::kBool && v->b;
}

// =========================================================================
// Lockfile-specific helpers
// =========================================================================

// Extract the package name from an npm v2/v3 `packages` key.
//   ""                                      → ""
//   "node_modules/foo"                      → "foo"
//   "node_modules/@scope/foo"               → "@scope/foo"
//   "node_modules/a/node_modules/b"         → "b"
//   "node_modules/a/node_modules/@scope/b"  → "@scope/b"
//   "packages/ui"                           → "packages/ui"  (fallback)
//
// The "packages/<workspace>" path is intentionally a fallback only —
// callers using v2/v3 prefer `pkg.name` for workspace entries, which
// is the Fix 2a contract.
std::string_view ExtractNameFromPath(std::string_view path) {
  // Strip "node_modules/" prefix iteratively to find the deepest
  // entry. `lastIndexOf("node_modules/")` returns the position AFTER
  // which the package name starts.
  constexpr std::string_view kNm{"node_modules/"};
  size_t pos = path.rfind(kNm);
  if (pos != std::string_view::npos) {
    return path.substr(pos + kNm.size());
  }
  return path;
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

// Render a number as a string. Lockfile versions are tiny ints
// (1, 2, 3) so we don't need a general formatter. Returns
// arena-owned.
std::string_view IntToView(Arena* arena, int n) {
  if (n == 1) return std::string_view{"1"};
  if (n == 2) return std::string_view{"2"};
  if (n == 3) return std::string_view{"3"};
  // Fallback for unexpected values.
  char buf[16];
  int len = std::snprintf(buf, sizeof(buf), "%d", n);
  return arena->Copy(std::string_view(buf, static_cast<size_t>(len)));
}

DepType ClassifyDep(const JsonObject& pkg) {
  if (AsBool(ObjectGet(pkg, "dev"))) return DepType::kDev;
  if (AsBool(ObjectGet(pkg, "optional"))) return DepType::kOptional;
  if (AsBool(ObjectGet(pkg, "peer"))) return DepType::kPeer;
  return DepType::kProd;
}

// Build a PackageRef from a parsed v2/v3 package entry. `name_view`
// must already be the resolved name (per Fix 2a/2b — caller picks
// pkg.name over the path-derived fallback).
PackageRef BuildRefV2V3(ParseContext* ctx, std::string_view name_view,
                        const JsonObject& pkg) {
  PackageRef ref;
  ref.name = ctx->intern.Intern(name_view);
  std::string_view version = AsString(ObjectGet(pkg, "version"));
  ref.version = ctx->intern.Intern(version.empty()
                                       ? std::string_view{"0.0.0"}
                                       : version);
  std::string_view resolved = AsString(ObjectGet(pkg, "resolved"));
  if (!resolved.empty()) {
    ref.resolved = ctx->intern.Intern(resolved);
  }
  std::string_view integrity = AsString(ObjectGet(pkg, "integrity"));
  if (!integrity.empty()) {
    ref.integrity = ctx->intern.Intern(integrity);
  }
  std::string_view license = AsString(ObjectGet(pkg, "license"));
  if (!license.empty()) {
    ref.license = ctx->intern.Intern(license);
  }
  ref.depType = ClassifyDep(pkg);
  ref.isDev = AsBool(ObjectGet(pkg, "dev"));
  ref.isOptional = AsBool(ObjectGet(pkg, "optional"));
  ref.isPeer = AsBool(ObjectGet(pkg, "peer"));
  ref.isBundled = AsBool(ObjectGet(pkg, "inBundle"));
  // dependencies: keys-of(pkg.dependencies).
  const JsonValue* deps = ObjectGet(pkg, "dependencies");
  if (deps && deps->kind == JsonKind::kObject && deps->o) {
    for (const auto& [k, _] : *deps->o) {
      ref.dependencies.push_back(ctx->intern.Intern(k));
    }
  }
  return ref;
}

// =========================================================================
// v1 (recursive `dependencies`) walker
// =========================================================================
//
// Recursive flatten with cycle guard via visited set. Depth-capped
// at 64 (matches the JS impl) to surface pathological nesting as a
// hard error rather than blowing the stack.

constexpr size_t kMaxV1Depth = 64;

bool FlattenV1(ParseContext* ctx, ParsedLockfile* out,
               const JsonObject& deps,
               std::unordered_set<std::string>* visited,
               size_t depth) {
  if (depth > kMaxV1Depth) {
    return false;
  }
  for (const auto& [alias_name, pkg_v] : deps) {
    if (pkg_v.kind != JsonKind::kObject || !pkg_v.o) continue;
    const JsonObject& pkg = *pkg_v.o;
    std::string_view raw_version = AsString(ObjectGet(pkg, "version"));
    if (raw_version.empty()) raw_version = "0.0.0";

    // ---- FIX 1: v1 alias extraction ----
    //
    // Source: socket-sdxgen/src/parsers/npm/package-lock-v1.mts:96-110
    //         + manifest.js parsePackageLock v1 branch (lines 381-396)
    //         + socket-lib/src/eco/npm/npm/parse-lockfile.ts (the same
    //           alias-detection block in `buildPackageRef`)
    //
    // npm v1 encodes aliased installs as:
    //   "string-width-cjs": {
    //     "version": "npm:string-width@4.2.3",
    //     "resolved": "https://registry.npmjs.org/string-width/-/string-width-4.2.3.tgz"
    //   }
    //
    // The PackageRef's `name` field should be "string-width" (real),
    // not "string-width-cjs" (alias). Emitting the alias produces a
    // malformed purl `pkg:npm/string-width-cjs@npm%3Astring-width%404.2.3`
    // pointing at a non-existent registry package.
    //
    // The contract: real identity on the PackageRef, alias key on
    // `_index`. See the AddToIndex call below (uses alias_name).
    std::string_view real_name = alias_name;
    std::string_view real_version = raw_version;
    if (raw_version.size() >= 4 &&
        raw_version.substr(0, 4) == "npm:") {
      std::string_view rest = raw_version.substr(4);
      // `<real>@<ver>` — lastIndexOf to handle scoped names
      // (`@scope/name@1.0.0` has the version after the LAST `@`).
      size_t at = rest.rfind('@');
      if (at != std::string_view::npos && at > 0) {
        real_name = rest.substr(0, at);
        real_version = rest.substr(at + 1);
      }
    }

    // Cycle key uses the resolved real name + version.
    std::string key(real_name);
    key.push_back('@');
    key.append(real_version);
    if (visited->find(key) != visited->end()) {
      continue;
    }

    // _index keying contract:
    //   socket-lib v6 indexes by ALIAS (the original lockfile key),
    //   NOT the resolved real name. This is the fix1 fixture's
    //   expected shape: `_index: { "string-width-cjs": 0 }` even
    //   though the PackageRef has name === "string-width".
    bool already_indexed = false;
    for (const auto& [k, _] : out->index) {
      if (k == alias_name) {
        already_indexed = true;
        break;
      }
    }
    if (!already_indexed) {
      PackageRef ref;
      ref.name = ctx->intern.Intern(real_name);
      ref.version = ctx->intern.Intern(real_version);
      std::string_view resolved = AsString(ObjectGet(pkg, "resolved"));
      if (!resolved.empty()) {
        ref.resolved = ctx->intern.Intern(resolved);
      }
      std::string_view integrity = AsString(ObjectGet(pkg, "integrity"));
      if (!integrity.empty()) {
        ref.integrity = ctx->intern.Intern(integrity);
      }
      ref.depType = ClassifyDep(pkg);
      ref.isDev = AsBool(ObjectGet(pkg, "dev"));
      ref.isOptional = AsBool(ObjectGet(pkg, "optional"));
      ref.isPeer = AsBool(ObjectGet(pkg, "peer"));
      // requires: keys-of(pkg.requires) — v1 uses `requires` for
      // dep names rather than `dependencies` (which would be the
      // recursive child entries we walk separately).
      const JsonValue* requires_obj = ObjectGet(pkg, "requires");
      if (requires_obj && requires_obj->kind == JsonKind::kObject &&
          requires_obj->o) {
        for (const auto& [k, _] : *requires_obj->o) {
          ref.dependencies.push_back(ctx->intern.Intern(k));
        }
      }
      out->packages.push_back(std::move(ref));
      AddToIndex(out, ctx->intern.Intern(alias_name),
                 static_cast<uint32_t>(out->packages.size() - 1));
    }

    // Recurse into nested `dependencies`.
    const JsonValue* child_deps = ObjectGet(pkg, "dependencies");
    if (child_deps && child_deps->kind == JsonKind::kObject &&
        child_deps->o) {
      visited->insert(key);
      if (!FlattenV1(ctx, out, *child_deps->o, visited, depth + 1)) {
        return false;
      }
      visited->erase(key);
    }
  }
  return true;
}

}  // namespace

bool ParseNpmLock(std::string_view content,
                  ParseContext* ctx,
                  ParsedLockfile* out,
                  ParseError* err) {
  JsonValue root;
  JsonParser p(content, &ctx->arena);
  if (!p.Parse(&root)) {
    err->message = "Invalid JSON";
    err->code = "ERR_INVALID_JSON";
    return false;
  }
  if (root.kind != JsonKind::kObject || !root.o) {
    err->message = "Lockfile root must be an object";
    err->code = "ERR_INVALID_LOCKFILE";
    return false;
  }
  const JsonObject& data = *root.o;
  out->ecosystem = Ecosystem::kNpm;

  // Determine lockVersion. JSON value may be number or string.
  int lock_version = 1;
  const JsonValue* lv = ObjectGet(data, "lockfileVersion");
  if (lv) {
    if (lv->kind == JsonKind::kNumber) {
      lock_version = static_cast<int>(lv->n);
    } else if (lv->kind == JsonKind::kString && !lv->s.empty()) {
      // Parse leading int from the string.
      int v = 0;
      for (char c : lv->s) {
        if (c < '0' || c > '9') break;
        v = v * 10 + (c - '0');
      }
      if (v > 0) lock_version = v;
    }
  }
  out->lockVersion = IntToView(&ctx->arena, lock_version);

  // v2/v3 path: top-level "packages" object.
  const JsonValue* packages = ObjectGet(data, "packages");
  if (packages && packages->kind == JsonKind::kObject && packages->o) {
    for (const auto& [pkg_path, pkg_v] : *packages->o) {
      if (pkg_path.empty()) {
        // Root package — skip.
        continue;
      }
      if (pkg_v.kind != JsonKind::kObject || !pkg_v.o) continue;
      const JsonObject& pkg = *pkg_v.o;

      // ---- FIX 2a/2b: prefer pkg.name over path-derived ----
      //
      // Source: socket-sdxgen/src/parsers/npm/package-lock-v2.mts:
      //         name-resolution branch (~line 145, "if (pkg.name)"
      //         preference over `extractNameFromPath`)
      //         + manifest.js parsePackageLock v2/v3 branch (lines
      //           292-303)
      //         + socket-lib/src/eco/npm/npm/parse-lockfile.ts
      //           parseV2V3 (line 244-248)
      //
      // Two patterns trip path-derived extraction:
      //
      //   2a — Workspace path: "packages/ui" is a top-level key (no
      //        `node_modules/` prefix), so the path-derived name
      //        falls through to the literal `packages/ui`. The
      //        explicit `pkg.name: "@my-org/ui"` is the truth.
      //
      //   2b — Aliased install: "node_modules/sw-cjs" has alias
      //        path-segment, but `pkg.name: "string-width"` is the
      //        real registry name.
      //
      // Both fall under: when pkg.name is a non-empty string, use it;
      // otherwise fall back to ExtractNameFromPath. Single code path.
      std::string_view name_from_path = ExtractNameFromPath(pkg_path);
      std::string_view pkg_name = AsString(ObjectGet(pkg, "name"));
      std::string_view name = !pkg_name.empty() ? pkg_name : name_from_path;

      PackageRef ref = BuildRefV2V3(ctx, name, pkg);
      out->packages.push_back(std::move(ref));
      AddToIndex(out, out->packages.back().name,
                 static_cast<uint32_t>(out->packages.size() - 1));
    }
    return true;
  }

  // v1 path: top-level "dependencies" object.
  const JsonValue* deps = ObjectGet(data, "dependencies");
  if (deps && deps->kind == JsonKind::kObject && deps->o) {
    std::unordered_set<std::string> visited;
    if (!FlattenV1(ctx, out, *deps->o, &visited, 0)) {
      err->message = "Lockfile dependency nesting exceeds 64 levels";
      err->code = "ERR_INVALID_LOCKFILE";
      return false;
    }
    return true;
  }

  // Empty lockfile — neither shape present. Return shape with zero
  // packages.
  return true;
}

}  // namespace manifest
}  // namespace socketsecurity
}  // namespace node
