# version_subset.js

Packument subsetting helper for the `node:smol-http` stack. Takes a full
npm packument (the giant JSON blob `registry.npmjs.org` returns for a
package) plus a version range, and returns a trimmed packument containing
only the versions that match the range.

Lives at
`additions/source-patched/lib/internal/socketsecurity/http/version_subset.js`
and is embedded into `node-smol`. It is **not** published to npm.

## Why this exists

Popular packages ship packuments with hundreds of versions. When an
install only needs versions matching `^5.0.0`, shipping all 600 versions
wastes bandwidth and CPU:

- **~90–95% bandwidth reduction** for the typical case.
- **5–10x faster JSON.parse** on the client.

The Socket registry proxy calls `subsetPackument(packument, range)` to
trim the response before wiring it downstream.

## Relationship to versions.js

There are two semver implementations in this repo and it is easy to get
confused. The split is intentional:

| File                | Used by                           | Notes                                  |
| ------------------- | --------------------------------- | -------------------------------------- |
| `versions.js`       | General comparison logic everywhere | Full range cache, multi-ecosystem.    |
| `version_subset.js` | The registry proxy hot path       | Smaller, focused on subsetting only.   |

When you change range semantics, update **both**. The test suites for
each live under `packages/node-smol-builder/test/`.

## Public API

```js
const { subsetPackument, getSubsetStats, semver } =
  require('internal/socketsecurity/http/version_subset')

// Filter a packument to matching versions.
const subset = subsetPackument(packument, '^1.2.0')

// Report stats (for dashboards / metrics).
const stats = getSubsetStats(packument, subset)
// { bandwidth_saved, original_count, original_size,
//   reduction_percent, subset_count, subset_size }

// Direct semver check — mirrors the node `semver` package API.
semver.satisfies('1.5.0', '^1.0.0') // → true
```

If subsetting drops every version (no match), `subsetPackument` returns
the **original** packument unchanged. That lets the npm client surface its
own "no matching versions" error instead of us faking an empty response.

## Supported range syntax

```
*                 → matches everything
latest            → matches everything (npm dist-tag shortcut)
""                → matches everything (empty range)
1.2.3             → exact match
^1.2.3            → caret (npm semantics — tightens for 0.x)
~1.2.3            → tilde (pin minor)
>=1.2.3  >1.2.3   → open-ended lower bound
<=1.2.3  <1.2.3   → open-ended upper bound
>= 1.2.3          → same as >=1.2.3 (operator+space normalized)
>=1.0.0 <2.0.0    → compound AND-range (space-separated)
^1.0.0 || ^2.0.0  → OR-range
```

Hyphen ranges (e.g. `1.2.3 - 2.3.4`) are **not** supported here — only
`versions.js` has the full hyphen-range implementation. This module is
intentionally narrower.

### `operator + space` normalization

npm accepts `>= 1.0.0` (space between operator and version). Without
normalization, the AND-split would see `[">=", "1.0.0"]` and return
`false` for every version. The module strips the space via
`OPERATOR_SPACE_REGEX` before checking for AND boundaries. All subsequent
operator branches read `normalized` rather than the raw `range` so the
fix applies uniformly.

## Order of checks

Order matters because some range forms contain others as substrings:

1. **Special cases** (`*`, `latest`, `""`) → `true`.
2. **OR ranges** (contain `||`) → recurse per alternative. Must come
   before the AND-split so `^1 || ^2` isn't mistaken for AND.
3. **AND ranges** (normalized range has whitespace) → every part must
   satisfy. Must come after OR.
4. **Single comparator** → exact / `^` / `~` / `>=` / `>` / `<=` / `<`.
5. **Fallback**: exact equality.

Do not reorder without updating the comment block above the branches.

## Strict SEMVER_REGEX

The regex at the top of the file is deliberately strict. It rejects:

- Whitespace anywhere but `.-prerelease.N` sequences.
- Leftover fragments (e.g. `1.0.0 <2.0.0` at top level — must go through
  the AND-split first).
- Malformed prerelease / build tags (e.g. `1.0.0-.foo`, `1.0.0-foo..bar`).

If parsing silently fails on valid-looking input, the regex is probably
the cause.

## Primordials

All operations go through `primordials` (e.g. `ArrayPrototypeEvery`,
`StringPrototypeReplace`). This keeps behavior stable under prototype
pollution, which matters because this code runs on arbitrary packuments
pulled from the registry.

## Testing

```bash
pnpm --filter node-smol-builder test
```

The test suite covers all supported range syntaxes plus edge cases:
operator+space, compound AND-ranges, OR-ranges, prerelease tags, and the
"no matches → return original" fallback. Add new test cases alongside any
range-syntax change.
