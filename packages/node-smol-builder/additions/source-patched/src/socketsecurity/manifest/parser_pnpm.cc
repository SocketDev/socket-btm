// node:smol-manifest — pnpm-lock.yaml parser implementation.
//
// =====================================================================
// Source material (in lock-step order, newest → oldest)
// =====================================================================
//
// 1. **socket-lib's TS port** — the v6.0.0 public contract this impl
//    must match byte-for-byte (modulo internal-shape details that
//    don't surface through the binding):
//      socket-lib/src/eco/npm/pnpm/parse-lockfile.ts
//
// 2. **socket-btm smol JS impl** — the existing in-tree pure-JS
//    parser this C++ port REPLACES on the smol fast path. Kept alive
//    as the stock-Node fallback inside the same module:
//      additions/source-patched/lib/internal/socketsecurity/manifest.js
//      (parsePnpmLock, parsePnpmPackageIdV5, parsePnpmPackageIdV6V9)
//
// 3. **socket-sdxgen TS parsers** — the algorithm oracle, with the
//    most production exposure (Socket's batch-ingestion pipeline):
//      socket-sdxgen/src/parsers/pnpm/pnpm-lock-v5.mts
//      socket-sdxgen/src/parsers/pnpm/pnpm-lock-v6.mts
//      socket-sdxgen/src/parsers/pnpm/pnpm-lock-v9.mts
//
// 4. **cdxgen** (pinned v11.11.0) — sdxgen's upstream baseline.
//    cdxgen parses pnpm-lock.yaml via the `yaml` npm package and
//    walks the resulting JS tree; we skip the YAML lib and walk
//    lines directly because the pnpm grammar is a strict subset
//    (indent-significant blocks, no flow style, no anchors).
//      https://github.com/CycloneDX/cdxgen/blob/v11.11.0/lib/parsers/js.js
//      (parsePnpmLock — search for "parsePnpmLock" in that file)
//
// 5. **pnpm lockfile spec** — format reference for v5/v6/v9 shape:
//      https://github.com/pnpm/spec/blob/master/lockfile/9.0.md
//      https://github.com/pnpm/pnpm/blob/main/packages/lockfile-file/
//
// =====================================================================
// Fix register (see test/fixtures/sdxgen-bug-regressions/)
// =====================================================================
//
//   fix3a — Empty-version guard in importer walker. pnpm v9 nests
//           each dep as a block:
//             pkg:
//               specifier: ^1
//               version: 1.0.0
//           Without the guard, the parent `pkg:` line emits a
//           PackageRef with empty version (a phantom entry). See
//           the importer walker's empty-version `continue` below.
//
//   fix3b — workspace/file/link protocol filter. Importer dep
//           values starting with `link:`, `workspace:`, or `file:`
//           are workspace-local refs, not shippable registry
//           artifacts. They MUST NOT enter the parsed packages
//           array. See the importer walker's protocol-prefix
//           `continue` below.
//
//   fix5  — pnpm v9 isDev derivation. v9 snapshots don't carry
//           `dev: true` markers the way v5/v6 did. Classification
//           is derived from the importers block: prod_set ∪
//           optional_set wins over dev_only_set on any name
//           overlap. The JS impl in manifest.js does NOT implement
//           this — every v9 snapshot lands as `depType: prod`.
//           This C++ impl does it correctly from day one, in the
//           POST-PASS at the bottom of ParsePnpmLock.

#include "parser_pnpm.h"

#include <algorithm>
#include <cstdint>
#include <string_view>
#include <unordered_set>

#include "manifest.h"

namespace node {
namespace socketsecurity {
namespace manifest {

namespace {

// --- View helpers --- //

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

size_t IndentOf(std::string_view line) {
  size_t i = 0;
  while (i < line.size() && (line[i] == ' ' || line[i] == '\t')) {
    ++i;
  }
  return i;
}

// Find next LF at-or-after `from`. Returns content.size() if none.
size_t NextLf(std::string_view content, size_t from) {
  while (from < content.size() && content[from] != '\n') {
    ++from;
  }
  return from;
}

// --- Lockfile-version detection --- //
//
// Scans for `lockfileVersion: <X>`. The major version drives format
// branching: v5 (pnpm 5-6, classic shape), v6 (pnpm 7-8, deps inlined),
// v9 (pnpm 9-10, importers + snapshots split).
//
// Mirrors `detectPnpmVersion` in manifest.js (`RE_LOCKFILE_VERSION`)
// and `versionMatch` in sdxgen's `pnpm/index.mts:detectAndParsePnpmLock`.
// cdxgen's equivalent is the `lockfileVersion` capture in
// `lib/parsers/js.js:parsePnpmLock`.

int DetectLockfileVersion(std::string_view content) {
  constexpr std::string_view kKey = "lockfileVersion:";
  size_t pos = content.find(kKey);
  if (pos == std::string_view::npos) {
    return 0;
  }
  pos += kKey.size();
  // Skip spaces and quotes.
  while (pos < content.size() &&
         (content[pos] == ' ' || content[pos] == '\t' ||
          content[pos] == '\'' || content[pos] == '"')) {
    ++pos;
  }
  // Parse digits (only the major matters — `9.0` and `9` both → 9).
  if (pos >= content.size() || content[pos] < '0' || content[pos] > '9') {
    return 0;
  }
  int v = 0;
  while (pos < content.size() && content[pos] >= '0' &&
         content[pos] <= '9') {
    v = v * 10 + (content[pos] - '0');
    ++pos;
  }
  return v;
}

// --- pnpm package-id parsers --- //
//
// v5 key: "/lodash/4.17.21" or "/@scope/name/1.2.3" — leading slash,
// name and version separated by slash. Last slash splits name from
// version. Mirrors `parsePnpmPackageIdV5` in manifest.js + sdxgen's
// `parsePnpmDescriptorV5` in `pnpm/pnpm-lock-v5.mts`.
//
// v6/v9 key: "lodash@4.17.21" or "@scope/name@1.2.3(peer@1)" — no
// leading slash, name and version separated by `@`. The version may
// carry a `(peer@x)` or `_peer-1` suffix that we strip. Mirrors
// `parsePnpmPackageIdV6V9` + sdxgen's `parsePnpmPackageIdV9` in
// `pnpm/pnpm-lock-v9.mts` (which uses `lastIndexOf('@')` plus
// `.split('(')[0]`).
//
// Scoped-name caveat: `@scope/name@1.0.0`'s leading `@` belongs to
// the scope, not the version separator — so the search starts at
// position 1 when descriptor[0] === '@'. cdxgen handles this via the
// same pattern in `lib/parsers/js.js:parsePnpmPackageId`
// (v11.11.0).

struct ParsedPkgId {
  std::string_view name;
  std::string_view version;
};

ParsedPkgId ParsePnpmPkgIdV5(std::string_view key) {
  // Strip leading slash.
  if (!key.empty() && key[0] == '/') {
    key = key.substr(1);
  }
  size_t last_slash = key.rfind('/');
  if (last_slash == std::string_view::npos) {
    return {key, {}};
  }
  return {key.substr(0, last_slash), key.substr(last_slash + 1)};
}

ParsedPkgId ParsePnpmPkgIdV6V9(std::string_view key) {
  // Find the `@` that separates name from version.
  // For scoped packages (`@scope/name@1.2.3`) the FIRST `@` is part
  // of the scope; we want the second one.
  size_t scan = 0;
  if (!key.empty() && key[0] == '@') {
    scan = 1;
  }
  size_t at = key.find('@', scan);
  if (at == std::string_view::npos) {
    return {key, {}};
  }
  std::string_view version = key.substr(at + 1);
  // Strip peer suffix: drop everything from first `(` or `_`.
  size_t under = version.find('_');
  if (under != std::string_view::npos) {
    version = version.substr(0, under);
  }
  size_t paren = version.find('(');
  if (paren != std::string_view::npos) {
    version = version.substr(0, paren);
  }
  return {key.substr(0, at), version};
}

// Strip pnpm version peer suffix used by importer dep values.
// Mirrors the JS impl: drop everything from first `_` then first `(`.
std::string_view StripPeerSuffix(std::string_view v) {
  size_t under = v.find('_');
  if (under != std::string_view::npos) {
    v = v.substr(0, under);
  }
  size_t paren = v.find('(');
  if (paren != std::string_view::npos) {
    v = v.substr(0, paren);
  }
  return v;
}

// --- index management --- //

void AddToIndex(ParsedLockfile* out, std::string_view name, uint32_t idx) {
  for (auto& [k, v] : out->index) {
    if (k == name) {
      // Promote to vector or append.
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

// --- importer walker (fix3a + fix3b + fix5 collection) --- //
//
// Walks the `importers:` section, populating prod_set / dev_only_set
// for the v9 post-pass classification (fix5), AND emitting PackageRefs
// for inline deps the snapshot section doesn't cover. The JS impl
// emits inline-dep PackageRefs eagerly; we do the same so the output
// shape matches.

struct ImporterCursor {
  enum class Section { kNone, kProd, kDev, kOptional };
  Section section = Section::kNone;
  size_t indent = 0;
  bool active = false;
};

}  // namespace

bool ParsePnpmLock(std::string_view content,
                   ParseContext* ctx,
                   ParsedLockfile* out,
                   ParseError* /* err */) {
  int lock_version = DetectLockfileVersion(content);
  // Render lockVersion as a string view into a static lookup table to
  // avoid arena traffic for the common case.
  static constexpr std::string_view kV5{"5"};
  static constexpr std::string_view kV6{"6"};
  static constexpr std::string_view kV9{"9"};
  static constexpr std::string_view kV0{"0"};
  switch (lock_version) {
    case 5: out->lockVersion = kV5; break;
    case 6: out->lockVersion = kV6; break;
    case 9: out->lockVersion = kV9; break;
    default:
      out->lockVersion = kV0;
      break;
  }
  out->ecosystem = Ecosystem::kNpm;

  // Section flags — mutually exclusive.
  bool in_packages = false;
  bool in_snapshots = false;
  bool in_importers = false;

  // Per-package cursor used inside `packages:` / `snapshots:`.
  PackageRef cur;
  bool has_cur = false;
  size_t cur_indent = 0;
  bool cur_in_deps = false;

  // Per-importer cursor used inside `importers:`.
  ImporterCursor imp;

  // Importer-derived classification sets for fix5 (v9 isDev).
  std::unordered_set<std::string_view> prod_set;
  std::unordered_set<std::string_view> dev_only_set;

  // Track which packages came from importer-walk vs snapshot-walk —
  // importer entries set isDev/isOptional immediately based on the
  // current section; snapshot entries are classified in the post-pass.
  // `from_importer[i] == true` means packages[i] was emitted by the
  // importer walker and already has the correct isDev/depType.
  std::vector<bool> from_importer;

  auto flush_cur = [&]() {
    if (!has_cur || cur.name.empty()) {
      return;
    }
    cur.dependencies.shrink_to_fit();
    out->packages.push_back(std::move(cur));
    AddToIndex(out, out->packages.back().name,
               static_cast<uint32_t>(out->packages.size() - 1));
    from_importer.push_back(false);
    has_cur = false;
    cur = PackageRef{};
    cur_in_deps = false;
  };

  // Scan lines.
  size_t pos = 0;
  while (pos < content.size()) {
    size_t eol = NextLf(content, pos);
    std::string_view line = content.substr(pos, eol - pos);
    pos = eol + 1;
    std::string_view trimmed = TrimAscii(line);

    // --- Top-level section detection --- //
    if (trimmed == "packages:") {
      flush_cur();
      in_packages = true;
      in_snapshots = false;
      in_importers = false;
      imp.active = false;
      continue;
    }
    if (trimmed == "snapshots:") {
      flush_cur();
      in_snapshots = true;
      in_packages = false;
      in_importers = false;
      imp.active = false;
      continue;
    }
    if (trimmed == "importers:") {
      flush_cur();
      in_importers = true;
      in_packages = false;
      in_snapshots = false;
      continue;
    }
    // New top-level (column-0 non-empty) header ends every section.
    if (!line.empty() && line[0] != ' ' && line[0] != '\t' &&
        !trimmed.empty()) {
      flush_cur();
      in_packages = false;
      in_snapshots = false;
      in_importers = false;
      imp.active = false;
      continue;
    }

    // --- importers: walker --- //
    if (in_importers) {
      size_t indent = IndentOf(line);

      // Importer entry header (workspace path) — `  pkg-name:` at
      // indent 2.
      if (indent == 2 && EndsWith(trimmed, ":")) {
        imp = ImporterCursor{};
        imp.indent = indent;
        imp.active = true;
        continue;
      }
      if (!imp.active || indent <= imp.indent) {
        continue;
      }

      // Section switch.
      if (StartsWith(trimmed, "devDependencies:")) {
        imp.section = ImporterCursor::Section::kDev;
        continue;
      }
      if (StartsWith(trimmed, "optionalDependencies:")) {
        imp.section = ImporterCursor::Section::kOptional;
        continue;
      }
      if (StartsWith(trimmed, "dependencies:")) {
        imp.section = ImporterCursor::Section::kProd;
        continue;
      }

      if (indent <= imp.indent + 2) {
        continue;
      }

      // Skip the inner block-shape lines (`specifier:`, `version:`,
      // `resolution:`). The parent line of a block-shape entry is
      // emitted with empty version; the empty-version guard below
      // (fix3a) catches it.
      if (StartsWith(trimmed, "specifier:") ||
          StartsWith(trimmed, "version:") ||
          StartsWith(trimmed, "resolution:")) {
        continue;
      }

      size_t colon = trimmed.find(':');
      if (colon == std::string_view::npos || colon == 0) {
        continue;
      }
      std::string_view dep_name = trimmed.substr(0, colon);
      std::string_view dep_version = TrimAscii(trimmed.substr(colon + 1));

      // Track classification membership for fix5 (post-pass v9 isDev).
      // This MUST happen before the protocol/empty filter so workspace
      // names still register as known importer deps.
      std::string_view interned_name = ctx->intern.Intern(dep_name);
      if (imp.section == ImporterCursor::Section::kDev) {
        if (prod_set.find(interned_name) == prod_set.end()) {
          dev_only_set.insert(interned_name);
        }
      } else {
        // prod + optional both count toward prod_set; either wins over dev.
        prod_set.insert(interned_name);
        dev_only_set.erase(interned_name);
      }

      // ---- FIX 3a + 3b: importer-walk skip filters ----
      //
      // Source: manifest.js lines 994-1001 (parsePnpmLock importer
      //         walker) + sdxgen `pnpm/pnpm-lock-v9.mts:processImporter`.
      //         No equivalent guard in cdxgen v11.11.0 — that's
      //         the cdxgen-side bug both sdxgen + socket-btm
      //         correct.
      //
      // 3a — empty dep_version: v9 importer block-shape entries
      //      have the version under a nested `version:` property;
      //      the parent `pkg:` line emits with empty trailing
      //      value. Without this guard the parser pushes a
      //      phantom PackageRef with version: "".
      //
      // 3b — link: / workspace: / file: protocol values are
      //      workspace-local references (not shippable registry
      //      artifacts). Emitting them pollutes the SBOM with
      //      entries that have no valid purl shape.
      //
      // Both filters land in one branch — same `continue` chain.
      if (dep_version.empty() || StartsWith(dep_version, "link:") ||
          StartsWith(dep_version, "workspace:") ||
          StartsWith(dep_version, "file:")) {
        continue;
      }

      // Strip peer suffix (`1.0.0_peer-1` or `1.0.0(foo@2)`).
      std::string_view clean_version = StripPeerSuffix(dep_version);

      // Dedup: only emit each name once. Mirrors the JS impl —
      // `if (packageIndex[depName] === undefined)`.
      bool already = false;
      for (const auto& [k, _] : out->index) {
        if (k == interned_name) {
          already = true;
          break;
        }
      }
      if (already) {
        continue;
      }

      PackageRef ref;
      ref.name = interned_name;
      ref.version = ctx->intern.Intern(clean_version);
      ref.depType = imp.section == ImporterCursor::Section::kDev
                        ? DepType::kDev
                        : (imp.section == ImporterCursor::Section::kOptional
                               ? DepType::kOptional
                               : DepType::kProd);
      ref.isDev = imp.section == ImporterCursor::Section::kDev;
      ref.isOptional = imp.section == ImporterCursor::Section::kOptional;
      out->packages.push_back(std::move(ref));
      AddToIndex(out, out->packages.back().name,
                 static_cast<uint32_t>(out->packages.size() - 1));
      from_importer.push_back(true);
      continue;
    }

    if (!in_packages && !in_snapshots) {
      continue;
    }

    // --- packages: / snapshots: walker --- //
    size_t indent = IndentOf(line);

    // Package entry header — `  /lodash/4.17.21:` (v5) or
    // `  lodash@4.17.21:` (v6/v9). Indent 2 (most pnpm versions) or
    // 4 (some legacy variants). Trailing colon.
    //
    // CRUCIAL: when we're already inside a package entry, only treat
    // a new colon-terminated line as a fresh package header when it
    // appears at the SAME or SHALLOWER indent as the current entry's
    // header. Otherwise inner sub-section headers like
    //   '@pnpm/exe@11.0.0-rc.2':         <-- pkg header (indent 2)
    //     dependencies:                  <-- sub-section (indent 4)
    //   @reflink/reflink: 0.1.19
    // would be mis-parsed as a phantom `dependencies` PackageRef.
    // The JS impl in manifest.js relies on this via its property-loop
    // structure (sub-property checks short-circuit before
    // isPackageEntry fires); the C++ port uses a flat single-pass
    // loop, so the guard has to be explicit here.
    bool is_pkg_entry = indent >= 2 && indent <= 4 &&
                        EndsWith(trimmed, ":") && trimmed.size() > 1 &&
                        (!has_cur || indent <= cur_indent);
    if (is_pkg_entry) {
      flush_cur();

      std::string_view key = trimmed.substr(0, trimmed.size() - 1);
      ParsedPkgId parsed = (!key.empty() && key[0] == '/')
                               ? ParsePnpmPkgIdV5(key)
                               : ParsePnpmPkgIdV6V9(key);

      cur = PackageRef{};
      cur.name = ctx->intern.Intern(parsed.name);
      cur.version = ctx->intern.Intern(parsed.version);
      // Default: prod / not-dev. Will be reclassified per-snapshot
      // by sub-property walks (v5/v6 `dev: true`) and by the v9
      // post-pass below.
      cur.depType = DepType::kProd;
      cur_indent = indent;
      cur_in_deps = false;
      has_cur = true;
      continue;
    }

    // Sub-properties of the current package entry.
    if (has_cur && indent > cur_indent) {
      // dev: true / false  (v5 / v6 — v9 doesn't use this; v9 uses
      // post-pass classification via importers).
      if (StartsWith(trimmed, "dev:")) {
        if (trimmed.find("true") != std::string_view::npos) {
          cur.depType = DepType::kDev;
          cur.isDev = true;
        }
      } else if (StartsWith(trimmed, "optional:")) {
        if (trimmed.find("true") != std::string_view::npos) {
          cur.depType = DepType::kOptional;
          cur.isOptional = true;
        }
      } else if (StartsWith(trimmed, "integrity:")) {
        std::string_view val = TrimAscii(trimmed.substr(10));
        cur.integrity = ctx->intern.Intern(val);
      } else if (StartsWith(trimmed, "resolution:")) {
        // `resolution: {integrity: sha512-..., tarball: https://...}`
        // — parse inline values.
        size_t i_pos = trimmed.find("integrity:");
        if (i_pos != std::string_view::npos) {
          std::string_view rest = TrimAscii(trimmed.substr(i_pos + 10));
          // Strip leading-space / quote / opening-brace cruft.
          while (!rest.empty() &&
                 (rest[0] == ' ' || rest[0] == '\'' || rest[0] == '"' ||
                  rest[0] == '{')) {
            rest.remove_prefix(1);
          }
          // Stop at first space, comma, `}`.
          size_t stop = 0;
          while (stop < rest.size() && rest[stop] != ' ' &&
                 rest[stop] != ',' && rest[stop] != '}' &&
                 rest[stop] != '\'' && rest[stop] != '"') {
            ++stop;
          }
          if (stop > 0) {
            cur.integrity = ctx->intern.Intern(rest.substr(0, stop));
          }
        }
        size_t t_pos = trimmed.find("tarball:");
        if (t_pos != std::string_view::npos) {
          std::string_view rest = TrimAscii(trimmed.substr(t_pos + 8));
          while (!rest.empty() &&
                 (rest[0] == ' ' || rest[0] == '\'' || rest[0] == '"')) {
            rest.remove_prefix(1);
          }
          size_t stop = 0;
          while (stop < rest.size() && rest[stop] != ' ' &&
                 rest[stop] != ',' && rest[stop] != '}' &&
                 rest[stop] != '\'' && rest[stop] != '"') {
            ++stop;
          }
          if (stop > 0) {
            cur.resolved = ctx->intern.Intern(rest.substr(0, stop));
          }
        }
      } else if (StartsWith(trimmed, "dependencies:")) {
        cur.dependencies.clear();
        cur_in_deps = true;
      } else if (cur_in_deps &&
                 (StartsWith(trimmed, "peerDependencies:") ||
                  StartsWith(trimmed, "optionalDependencies:") ||
                  StartsWith(trimmed, "engines:") ||
                  StartsWith(trimmed, "os:") ||
                  StartsWith(trimmed, "cpu:") ||
                  StartsWith(trimmed, "bin:"))) {
        // Exited the dependencies: block via a sibling header.
        cur_in_deps = false;
      } else if (cur_in_deps && indent > cur_indent + 2) {
        size_t colon = trimmed.find(':');
        if (colon != std::string_view::npos && colon > 0) {
          cur.dependencies.push_back(
              ctx->intern.Intern(trimmed.substr(0, colon)));
        }
      }
    }
  }

  // Save last package if any.
  flush_cur();

  // ---- FIX 5: pnpm v9 isDev post-pass classification ----
  //
  // Source: socket-sdxgen/src/parsers/pnpm/pnpm-lock-v9.mts
  //         (the `isDev = !prodNames.has(name) && devOnlyNames.has(name)`
  //         derivation in `parsePnpmLockV9` — search for "isDev").
  //
  // Crucially NOT inherited from the smol JS impl: manifest.js's
  // parsePnpmLock has no equivalent post-pass — every v9 snapshot
  // lands as `depType: prod`. This is the fixture/test-deferred
  // bug the C++ port lands correctly from day one.
  //
  // Algorithm (per sdxgen):
  //   1. Collect prod_set from every importer's `dependencies` +
  //      `optionalDependencies` blocks.
  //   2. Collect dev_only_set from every importer's
  //      `devDependencies` MINUS the prod_set.
  //   3. For each non-importer-emitted PackageRef in the result:
  //      `isDev = !prod_set.contains(name) && dev_only_set.contains(name)`
  //
  // Tiebreak: any package reachable from a prod dep is prod (prod
  // wins on overlap). Matches pnpm's resolution semantics where a
  // package promoted from devDeps to deps by another importer is
  // treated as prod throughout the dependency graph.
  //
  // Skipped on v5/v6 (those use `dev: true` markers on the snapshot
  // itself, captured in the per-package sub-property walker above).
  // Skipped when there's no importer signal — for single-package
  // projects without an importers block, we trust the per-snapshot
  // flags as captured (v5/v6) or leave everything at default-prod
  // (v9 without importers — rare; consumer can supply package.json
  // signal via a higher-layer wrapper, matching sdxgen behavior).
  bool has_importer_signal = !prod_set.empty() || !dev_only_set.empty();
  if (lock_version == 9 && has_importer_signal) {
    for (size_t i = 0; i < out->packages.size(); ++i) {
      if (i < from_importer.size() && from_importer[i]) {
        // Already classified by the importer walker.
        continue;
      }
      PackageRef& ref = out->packages[i];
      bool is_dev = prod_set.find(ref.name) == prod_set.end() &&
                    dev_only_set.find(ref.name) != dev_only_set.end();
      if (is_dev) {
        ref.depType = DepType::kDev;
        ref.isDev = true;
      }
    }
  }

  return true;
}

}  // namespace manifest
}  // namespace socketsecurity
}  // namespace node
