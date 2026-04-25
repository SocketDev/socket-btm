# versions.js

Internal version parser and comparator. Supports multiple package ecosystems
(npm/SemVer, Maven, PyPI, etc.) behind a single API. Lives at
`additions/source-patched/lib/internal/socketsecurity/versions.js` and is
embedded into the custom `node-smol` binary during build — it is **not** a
user-facing module on `npm`.

## When to reach for this module

Use it any time internal Socket code needs to:

- Parse a version string and ask "is this valid?".
- Test "does version `X` satisfy range `Y`?".
- Compare two versions (`<`, `=`, `>`).
- Find the greatest version that satisfies a range.

If you are in `additions/`, you cannot import `semver` from npm — the
bootstrap only sees core modules. This module is the replacement.

## Why this exists (vs. pulling in the real `semver` package)

Node.js compiles `node-smol` with `--without-amaro` and no third-party
dependencies in the bootstrap layer. So `lib/internal/` modules can only
`require` other core modules. The `semver` npm package is ~2000 LOC with
helpers we do not need (loose mode, coerce, inc, etc.); this file is the
strict-but-small subset Socket cares about.

## Supported range syntaxes

These map 1:1 to npm semver unless noted. All parsing is **strict** —
malformed inputs return `undefined` rather than silently succeeding.

| Range                    | Meaning                                                           |
| ------------------------ | ----------------------------------------------------------------- |
| `1.2.3`                  | Exact match.                                                      |
| `*`, `x`, `X`, `latest`  | Matches any version.                                              |
| `^1.2.3`                 | `>=1.2.3 <2.0.0` (caret).                                         |
| `^0.2.3`                 | `>=0.2.3 <0.3.0` (caret tightens for pre-stable).                 |
| `^0.0.3`                 | Exact patch only.                                                 |
| `~1.2.3`                 | `>=1.2.3 <1.3.0` (tilde pins minor).                              |
| `>=1.2.3`, `>1.2.3`      | Open-ended lower bound.                                           |
| `<=1.2.3`, `<1.2.3`      | Open-ended upper bound.                                           |
| `=1.2.3`                 | Exact (same as bare `1.2.3`).                                     |
| `>=1.0.0 <2.0.0`         | Compound AND-range — both must hold.                              |
| `^1.0.0 \|\| ^2.0.0`     | OR-range — any alternative satisfies.                             |
| `1.2.3 - 2.3.4`          | Hyphen range (inclusive both ends).                               |
| `1.2 - 2.3.4`            | Partial lower pads with 0 → `>=1.2.0 <=2.3.4`.                    |
| `1.2.3 - 2`              | Partial upper becomes exclusive ceiling → `>=1.2.3 <3.0.0-0`.     |

### Partial version coercion

Partials (e.g. `1`, `1.2`, `1.x`) are accepted everywhere that npm accepts
them:

- As an **exact match** / inside `^` / inside `~` / after `>=` etc.: missing
  components pad with `0`. `^1` behaves like `^1.0.0`.
- As the **upper bound of a hyphen range**: partial becomes an exclusive
  ceiling (see `coerceHyphenUpper`). `1 - 2` is `>=1.0.0 <3.0.0-0`, NOT
  `>=1.0.0 <=2.0.0`. This matches npm's semver reference implementation.

If you add new syntax, update both the parser and the tests in
`packages/node-smol-builder/test/`.

## Public API

```js
const versions = require('internal/socketsecurity/versions')

versions.parse('1.2.3', 'npm')          // → { major, minor, patch, prerelease }
versions.satisfies('1.5.0', '^1.0.0', 'npm') // → true
versions.compare('1.2.3', '1.2.4', 'npm')    // → -1 | 0 | 1
versions.maxSatisfying(['1.0.0', '1.2.0'], '^1.0.0', 'npm') // → '1.2.0'
```

The `ecosystem` parameter selects the grammar. `'npm'` is SemVer;
`'maven'` uses Maven's version ordering rules; `'pypi'` uses PEP 440-ish
rules. Unknown ecosystems default to SemVer strictness.

## Why the hyphen upper bound is special

The naive "pad with 0 and use `<=`" approach is wrong for partial upper
bounds. Example:

- `1 - 2` **should** mean `>=1.0.0 <3.0.0-0` (npm spec).
- Padding + `<=` would give `>=1.0.0 <=2.0.0`, which rejects `2.0.1`
  but accepts `2.0.0` — the opposite of what npm does.

`coerceHyphenUpper` returns `{ op, version }` so the caller can emit the
right operator (`<` vs `<=`) based on whether the bound was partial.

## Internal structure

- **Top-level constants**: `RANGE_WILDCARD_REGEX`, `RANGE_XCH_REGEX`,
  `RANGE_AND_SPLIT_REGEX`, `SEMVER_REGEX`. All are wrapped in `hardenRegExp`
  and declared once to avoid re-compilation in hot paths.
- **`tryParse(str, ecosystem)`**: strict parse. Returns `undefined` on
  invalid input.
- **`tryParseOrCoerce(str, ecosystem)`**: tries `tryParse` first, then
  `coercePartialToFull` → re-parse. Used anywhere partial versions are
  acceptable (caret, tilde, hyphen lower).
- **`coercePartialToFull(str)`**: pads missing components with `0`. For
  lower bounds only.
- **`coerceHyphenUpper(str, ecosystem)`**: partial-upper handling (see
  above). Returns `{ op, version }` or `undefined`.
- **`parseComparator(comp, ecosystem)`**: parses a single comparator (e.g.
  `>=1.2.3`, `^1`). Returns `{ op, major, minor, patch, prerelease }` or
  `undefined`.
- **Range cache**: an LRU map keyed by `(range, ecosystem)` caches parsed
  comparator tuples. Size is bounded by `RANGE_CACHE_SIZE`. Eviction is
  insertion-order (via `IteratorPrototypeNext` on the map's key iterator).

## Primordials

All map/set/string/array operations use Node.js primordials (`SafeMap`,
`ArrayPrototypePush`, etc.) so behavior is stable across prototype
pollution. If you add new operations, follow the same pattern — see the
existing `const { ... } = primordials` block at the top of the file.

## Testing changes

Run the functional tests:

```bash
pnpm --filter node-smol-builder test
```

These exercise the built binary (not the source file), so any change must
be picked up by a rebuild. Do **not** add source-code-scanning tests —
test behavior through the public API.
