// node:smol-manifest — Cargo.lock parser implementation.
//
// =====================================================================
// Source material (in lock-step order, newest → oldest)
// =====================================================================
//
// 1. **socket-lib's TS port** — the v6.0.0 public contract:
//      socket-lib/src/eco/cargo/parse-lockfile.ts
//      (jsParseCargoLock + extractCargoDepName + parseCargoGitSource)
//
// 2. **socket-btm smol JS impl** — note: pre-step-7 smol's manifest.js
//    did NOT include cargo support (parseLockfile threw
//    ERR_UNSUPPORTED for cargo). socket-lib's TS port is the direct
//    reference; the JS-side wiring in step 7 adds a native fast path
//    while leaving the unsupported JS fallback in place (callers on
//    stock Node continue to use socket-lib's TS impl directly).
//
// 3. **socket-sdxgen TS parser** — algorithm oracle, broader spec
//    coverage (851 lines vs socket-lib's focused 325):
//      socket-sdxgen/src/parsers/cargo/index.mts
//
// 4. **cdxgen** (pinned v11.11.0):
//      https://github.com/CycloneDX/cdxgen/blob/v11.11.0/lib/parsers/rust.js
//      (parseCargoLock — the Cargo.lock walker)
//
// 5. **Cargo's own lockfile encoder** — the source of truth for the
//    format we're parsing:
//      https://github.com/rust-lang/cargo/blob/master/src/cargo/core/resolver/encode.rs
//      Lockfile format docs:
//        https://doc.rust-lang.org/cargo/guide/cargo-toml-vs-cargo-lock.html
//        https://doc.rust-lang.org/cargo/reference/resolver.html#lockfile-format
//      The version scalar at the top: 1 (unversioned), 2 (Rust 1.41+),
//        3 (Rust 1.53+), 4 (Rust 1.78+). Each rev adjusts sorting +
//        the source-string shape but the [[package]] field set is
//        stable across all four.
//
// =====================================================================
// Fix register
// =====================================================================
//
//   patch-unused — Cargo `[[patch.unused]]` regression guard. During
//                  the QA pass we suspected entries under that table
//                  were leaking into the parsed packages array. The
//                  existing logic — `trimmed == "[[package]]"` opens
//                  an entry, ANY OTHER section header closes it
//                  (currentEntry = nullptr) — correctly filters them.
//                  This impl preserves that filter explicitly; future
//                  refactors must keep the rule "only [[package]]
//                  opens an entry; all other headers close."
//                  See test/fixtures/sdxgen-bug-regressions/
//                       cargo-patch-unused-no-leak/.
//
// =====================================================================
// Cargo.lock notes
// =====================================================================
//
// - Top-level scalars: `version = 3`, `[[patch.unused]]` arrays, and
//   per-source [metadata] tables. The version scalar drives the
//   `lockVersion` field in the parsed output.
//
// - `[[package]]` repeats per crate. Field set:
//     name = "crate-name"
//     version = "1.2.3"
//     source = "registry+https://github.com/rust-lang/crates.io-index"
//     checksum = "<sha256>"
//     dependencies = [ "dep1 1.0.0", "dep2 2.0.0 (registry+…)" ]
//
//   The `dependencies` array entries come in three shapes (cargo
//   strips redundant components when unambiguous):
//     "name"                                  — name alone (single version)
//     "name 1.2.3"                            — name + version
//     "name 1.2.3 (registry+…)"               — name + version + source
//   We extract just the name (first space-separated token after
//   stripping quotes). Matches socket-lib's extractCargoDepName.
//
// - `dependencies` may be inline `[ "a", "b" ]` OR multi-line:
//     dependencies = [
//      "a 1.0.0",
//      "b 2.0.0",
//     ]
//   Inline form parsed by ParseInlineDeps; multi-line by the
//   inDependencies cursor below.
//
// - Source URL `git+<url>#<commit>` → vcsUrl/vcsCommit split.

#include "parser_cargo.h"

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

size_t NextLf(std::string_view content, size_t from) {
  while (from < content.size() && content[from] != '\n') {
    ++from;
  }
  return from;
}

// Strip one layer of surrounding double-quotes.
std::string_view StripQuotes(std::string_view s) {
  if (s.size() >= 2 && s.front() == '"' && s.back() == '"') {
    return s.substr(1, s.size() - 2);
  }
  return s;
}

// Read the value half of `key = value`. Returns raw text (no quote
// stripping). Source: socket-lib's `valueAfterEquals`.
std::string_view ValueAfterEquals(std::string_view line) {
  size_t eq = line.find('=');
  if (eq == std::string_view::npos) return std::string_view{};
  return TrimAscii(line.substr(eq + 1));
}

// Extract just the crate name from a dependency-array entry.
// Handles the three Cargo shapes ("name", "name ver",
// "name ver (source)"). Source: socket-lib's extractCargoDepName.
std::string_view ExtractCargoDepName(std::string_view entry) {
  std::string_view s = StripQuotes(entry);
  size_t sp = s.find(' ');
  if (sp == std::string_view::npos) return s;
  return s.substr(0, sp);
}

// Parse an inline TOML array of strings: `[ "a", "b" ]`. Returns the
// entries with quotes stripped. Source: socket-lib's parseInlineArray.
void ParseInlineDeps(std::string_view value, ParseContext* ctx,
                     std::vector<std::string_view>* out) {
  size_t lb = value.find('[');
  size_t rb = value.find(']');
  if (lb == std::string_view::npos || rb == std::string_view::npos ||
      rb <= lb) {
    return;
  }
  std::string_view inner = TrimAscii(value.substr(lb + 1, rb - lb - 1));
  if (inner.empty()) return;
  size_t i = 0;
  while (i < inner.size()) {
    // Skip whitespace + commas.
    while (i < inner.size() &&
           (inner[i] == ' ' || inner[i] == '\t' || inner[i] == ',')) {
      ++i;
    }
    if (i >= inner.size()) break;
    if (inner[i] == '"') {
      size_t close = inner.find('"', i + 1);
      if (close == std::string_view::npos) break;
      std::string_view raw = inner.substr(i + 1, close - i - 1);
      out->push_back(ctx->intern.Intern(ExtractCargoDepName(raw)));
      i = close + 1;
    } else {
      size_t comma = inner.find(',', i);
      size_t next =
          comma == std::string_view::npos ? inner.size() : comma;
      std::string_view raw = TrimAscii(inner.substr(i, next - i));
      out->push_back(ctx->intern.Intern(ExtractCargoDepName(raw)));
      i = next;
    }
  }
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

// Per-entry state. Mirrors socket-lib's CargoEntryState.
struct CargoEntry {
  std::string_view name;
  std::string_view version;
  std::string_view source;
  std::string_view checksum;
  std::vector<std::string_view> dependencies;
  bool in_dependencies = false;
};

void FlushEntry(ParseContext* /* ctx */, ParsedLockfile* out, CargoEntry& e) {
  if (e.name.empty()) return;
  PackageRef ref;
  ref.name = e.name;
  ref.version = e.version;
  if (!e.source.empty()) {
    ref.resolved = e.source;
    // Parse git+<url>#<commit> source. Source: socket-lib's
    // parseCargoGitSource.
    if (StartsWith(e.source, "git+")) {
      size_t hash = e.source.find('#');
      if (hash != std::string_view::npos) {
        ref.vcsUrl = e.source.substr(0, hash);
        ref.vcsCommit = e.source.substr(hash + 1);
      } else {
        ref.vcsUrl = e.source;
      }
    }
  }
  if (!e.checksum.empty()) {
    ref.integrity = e.checksum;
  }
  ref.dependencies = std::move(e.dependencies);
  ref.depType = DepType::kProd;
  out->packages.push_back(std::move(ref));
  AddToIndex(out, out->packages.back().name,
             static_cast<uint32_t>(out->packages.size() - 1));
}

}  // namespace

bool ParseCargoLock(std::string_view content,
                    ParseContext* ctx,
                    ParsedLockfile* out,
                    ParseError* /* err */) {
  out->ecosystem = Ecosystem::kCargo;
  // Pre-fill with the v1 default. Top-level `version = N` overrides
  // below.
  out->lockVersion = std::string_view{"1"};

  CargoEntry cur;
  bool has_cur = false;

  size_t pos = 0;
  while (pos < content.size()) {
    size_t eol = NextLf(content, pos);
    std::string_view line = content.substr(pos, eol - pos);
    pos = eol + 1;

    std::string_view trimmed = TrimAscii(line);
    if (trimmed.empty() || trimmed[0] == '#') {
      continue;
    }

    // ---- Section header ----
    //
    // ANY `[...]` line flushes the prior entry. Only `[[package]]`
    // opens a new one. This is the patch-unused / metadata filter:
    // `[[patch.unused]]`, `[metadata]`, `[patch.crates-io]`, etc.
    // all reset currentEntry to nullptr — the per-line key=value
    // walker below short-circuits when currentEntry is null, so
    // their fields don't leak into a phantom PackageRef.
    if (trimmed[0] == '[') {
      if (has_cur) {
        FlushEntry(ctx, out, cur);
        cur = CargoEntry{};
        has_cur = false;
      }
      if (trimmed == "[[package]]") {
        has_cur = true;
      }
      continue;
    }

    // ---- Inside a [[package]] entry ----
    if (has_cur) {
      // Multi-line dependencies array continuation.
      if (cur.in_dependencies) {
        if (trimmed.find(']') != std::string_view::npos) {
          cur.in_dependencies = false;
          continue;
        }
        // Drop trailing comma BEFORE name extraction so the closing
        // quote is adjacent to the value and ExtractCargoDepName
        // can strip both quotes cleanly.
        std::string_view no_comma = trimmed;
        if (!no_comma.empty() && no_comma.back() == ',') {
          no_comma.remove_suffix(1);
        }
        std::string_view dep = ExtractCargoDepName(no_comma);
        if (!dep.empty()) {
          cur.dependencies.push_back(ctx->intern.Intern(dep));
        }
        continue;
      }

      // Single-line key = value.
      if (StartsWith(trimmed, "name")) {
        cur.name = ctx->intern.Intern(
            StripQuotes(ValueAfterEquals(trimmed)));
      } else if (StartsWith(trimmed, "version")) {
        cur.version = ctx->intern.Intern(
            StripQuotes(ValueAfterEquals(trimmed)));
      } else if (StartsWith(trimmed, "source")) {
        cur.source = ctx->intern.Intern(
            StripQuotes(ValueAfterEquals(trimmed)));
      } else if (StartsWith(trimmed, "checksum")) {
        cur.checksum = ctx->intern.Intern(
            StripQuotes(ValueAfterEquals(trimmed)));
      } else if (StartsWith(trimmed, "dependencies")) {
        std::string_view value = ValueAfterEquals(trimmed);
        // Inline form: `dependencies = [ "a", "b" ]` on one line.
        if (value.find('[') != std::string_view::npos &&
            value.find(']') != std::string_view::npos) {
          ParseInlineDeps(value, ctx, &cur.dependencies);
        } else {
          // Multi-line form: `dependencies = [` followed by lines.
          cur.in_dependencies = true;
        }
      }
    } else {
      // Top-level scalars (only `version = N` for the lockVersion
      // captured today).
      if (StartsWith(trimmed, "version")) {
        out->lockVersion = ctx->intern.Intern(
            StripQuotes(ValueAfterEquals(trimmed)));
      }
    }
  }

  if (has_cur) {
    FlushEntry(ctx, out, cur);
  }

  return true;
}

}  // namespace manifest
}  // namespace socketsecurity
}  // namespace node
