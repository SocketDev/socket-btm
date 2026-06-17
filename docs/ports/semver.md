# semver C++ port (node:smol-versions)

This doc maps npm's [`semver`](https://github.com/npm/node-semver) JS
package onto our C++ port at
`packages/node-smol-builder/additions/source-patched/src/socketsecurity/versions/`.
Read this when you bump the upstream pin or are debugging a parity
divergence between `node:smol-versions` and the JS form.

## Where things live

| Concept                         | Upstream (JS)                                          | Port (C++)                                                  |
| ------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------- |
| Parser                          | `internal/parse.js`, `classes/semver.js` constructor   | `ParseSemVer` in `versions.cc`                              |
| Comparison                      | `internal/identifiers.js`, `classes/semver.js#compare` | `CompareSemVer` + `ComparePrerelease` + `CompareIdentifier` |
| Range parser                    | `classes/range.js`                                     | `ParseRange` + `ExpandCaret/Tilde/Partial/Hyphen`           |
| Range matching                  | `functions/satisfies.js`, `classes/range.js#test`      | `RangeSatisfies`                                            |
| Sort                            | `functions/sort.js`                                    | `Sort` (in the binding's JS-callable surface)               |
| `parse(s)`                      | `functions/parse.js`                                   | `ParseSemVer` (with `loose=false`)                          |
| `valid(s)`                      | `functions/valid.js`                                   | `ParseSemVer` returns false for invalid                     |
| `compare(a, b)`                 | `functions/compare.js`                                 | `CompareSemVer`                                             |
| `eq/gt/gte/lt/lte/neq`          | `functions/eq.js` etc.                                 | sign comparisons on `CompareSemVer`                         |
| `coerce(s)`                     | `functions/coerce.js`                                  | TODO Phase 2 — currently delegates to JS                    |
| `inc(v, release)`               | `functions/inc.js`                                     | TODO Phase 2                                                |
| `diff(a, b)`                    | `functions/diff.js`                                    | TODO Phase 2                                                |
| `maxSatisfying / minSatisfying` | `ranges/max-satisfying.js` / `min-satisfying.js`       | TODO Phase 2                                                |

## Parser deviations

The C++ parser is a **single-pass byte scanner**. Upstream uses several
large regexes (the `re[t]` array in `internal/re.js`). Our deviations:

1. **No regex** — every parse decision is a direct byte test. Faster
   on cold starts; tighter inner loop the JIT can't approximate.
2. **Borrowed prerelease/build spans** — we store `(const char*,
size_t)` offsets into the source buffer. The caller keeps the
   buffer alive for the lifetime of the `SemVer`. Upstream allocates
   arrays of identifier strings; we re-scan dot-separated identifiers
   on demand, which is cheap because spans are short.
3. **Numeric overflow** — upstream uses JS Numbers (silently loses
   precision past 2^53). We use `uint64_t` and reject overflow with
   a parse failure. In practice this affects nothing real (no version
   has a 19-digit major).
4. **Loose mode** — upstream's loose mode accepts more permissive
   inputs (some prerelease characters, mismatched separators, etc.).
   Our loose mode only handles the common cases (leading `v` / `=`,
   surrounding whitespace). If a real-world input fails our loose
   parse, fall back to JS semver and add a test case.

## Range deviations

The range parser is the trickiest part of the port. Upstream's range
grammar is documented in
[`classes/range.js`](https://github.com/npm/node-semver/blob/main/classes/range.js).
Our `ParseRange` matches it for the npm/yarn/pnpm manifest subset:

- Comparator chains (`>=1.2.3`, `<2.0.0`)
- Conjunctions (whitespace-separated)
- Disjunctions (`||`)
- Caret (`^X.Y.Z`), tilde (`~X.Y.Z`), hyphen (`X - Y`)
- X-ranges (`*`, `1.x`, `1.2.*`)

**Documented gaps**:

- Build metadata in range comparators is silently ignored both ways.
- Whitespace inside primitive operators (`> = 1.2.3` with spaces) is
  rejected by us; upstream accepts it in loose mode. Adding a test
  case for this is the trigger to add support.
- The `||` separator must have whitespace on at least one side; bare
  `1.0||2.0` is rejected. Upstream is more permissive.

## Comparison

Comparison follows spec § 11 exactly. The trick is identifier-by-
identifier comparison:

- Numeric vs numeric → numerical
- Alphanumeric vs alphanumeric → lexical (memcmp + length tiebreak)
- Numeric vs alphanumeric → numeric is always less

Build metadata is ignored. Empty prerelease beats non-empty.

## Tests

Cross-parity tests live at `test/unit/smol-versions-parity.test.mts`
(in the `node-smol-builder` package). They run a fixed corpus of
~2000 version strings + ranges through both implementations and
assert byte-equal output. New tests get added when:

1. A user reports a parity divergence (file an issue, capture the
   input as a regression test).
2. Upstream adds new range syntax (rare; tracked via the
   `semver` lockstep row).

The corpus is large enough that random-fuzz divergence is unlikely;
a deterministic corpus is more debuggable.

## Updating

When the `semver` upstream pin bumps:

1. `pnpm run lockstep` — surfaces the bump as a row to confirm.
2. Re-read the **CHANGELOG** between pinned-tag and the new tag.
   Look for grammar changes, new range syntax, or comparison
   changes. Most patch / minor bumps are perf / docs / typings only.
3. Run `pnpm test --filter @socketsecurity/btm-node-smol-builder
smol-versions-parity` — full corpus parity. Any divergence is
   either a port bug or an intentional spec change.
4. If the bump introduced a real spec change, port it to C++ and
   add a regression test capturing the new case.

## Phase 2 scope

The TODO entries in the table (`coerce`, `inc`, `diff`,
`maxSatisfying`, `minSatisfying`, `rsort`) are deferred until profile
data shows them on the hot path. socket-lib's current usage doesn't
hit them often enough to justify the C++ surface today.
