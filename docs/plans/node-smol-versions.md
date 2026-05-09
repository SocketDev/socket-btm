# node:smol-versions plan

## Goal

Native semver parser + comparator with the hot subset of the JS
`semver` package's surface, exposed as `node:smol-versions`. Replaces
the per-call parsing cost of the JS form for the call sites that
actually matter in socket-lib's `socket scan` profile.

## Why this is worth doing

socket-lib's `src/versions.ts` (380 lines) wraps a vendored copy of
the JS `semver` package. Every call goes through:

1. JS-level string parsing (regex-driven)
2. Construction of intermediate `SemVer` objects with prerelease /
   build / version arrays
3. JS comparison loops

Per `socket scan` invocation the hot calls are `compareVersions`,
`satisfies`, and `eq` — collectively they're hit thousands of times
during dependency resolution. A native parser bypasses (1) and (2)
entirely.

## Surface — Phase 1 (this plan covers)

The hot subset of the 19 entry points in `src/versions.ts`:

| Native           | JS equivalent      | Why hot                  |
| ---------------- | ------------------ | ------------------------ |
| `compare(a, b)`  | `semver.compare`   | dependency-graph diffing |
| `eq(a, b)`       | `semver.eq`        | exact-match checks       |
| `gt(a, b)`       | `semver.gt`        | upgrade decisions        |
| `gte(a, b)`      | `semver.gte`       | range bounds             |
| `lt(a, b)`       | `semver.lt`        | downgrade detection      |
| `lte(a, b)`      | `semver.lte`       | range bounds             |
| `parse(v)`       | `semver.parse`     | structural inspection    |
| `valid(v)`       | `semver.valid`     | input gates              |
| `satisfies(v,r)` | `semver.satisfies` | range-match (heaviest)   |
| `sort(arr)`      | `semver.sort`      | listing pipelines        |

## Surface — Phase 2 (deferred)

`coerce`, `inc`, `diff`, `maxSatisfying`, `minSatisfying`, `rsort`.
Lower frequency, more spec edge cases. Add only when profile points
at them.

## C++ shape

Standard 4-patch shape:

- `035-smol-versions-binding.patch` — registers `smol_versions` as a
  context-aware internal binding via `NODE_BINDING_CONTEXT_AWARE_INTERNAL`.
  Source: `src/socketsecurity/versions/versions_binding.cc`.
- `036-smol-versions-realm.patch` — adds `node:smol-versions` to the
  schemelessBlockList in `lib/internal/bootstrap/realm.js` so the
  `node:` prefix is forced.
- `037-smol-versions-external-refs.patch` — registers the C entry
  points in the external-references list for V8 startup-snapshot
  reproducibility.
- `038-smol-versions-node-gyp.patch` — adds the binding's `.cc` and
  `.h` to `node.gyp` and the public-shim `lib/smol-versions.js` to the
  built-in modules list.

## Parser design

Single-pass byte scanner, no regex. Inputs are typically ASCII (digit-
heavy with `.`-`-`-`+`-`v` separators), perfect for `FastOneByteString`
fast path on V8 Fast API where it applies.

Internal struct:

```cpp
struct SemVer {
  uint64_t major;
  uint64_t minor;
  uint64_t patch;
  // Prerelease: NUL-separated identifiers ("1.0.0-alpha.1" -> "alpha\0" "1\0").
  // Stack-allocated up to 64 bytes; heap for pathological inputs.
  char prerelease[64];
  uint8_t prerelease_len;
  // Build metadata is lexically ignored for ordering; we keep it for
  // round-trip parse(...).version output but skip it in compare().
  char build[64];
  uint8_t build_len;
};
```

Comparison follows spec § 11:

1. Compare major / minor / patch numerically.
2. If equal and exactly one has a prerelease, the one without
   prerelease is greater.
3. If both have prereleases, compare identifier-by-identifier.
   Numeric identifiers compare numerically; alphanumeric compare
   lexically; numeric < alphanumeric.
4. Build metadata is ignored.

## Range parser — phase 1 minimum

Phase 1 supports the subset of range syntax used by socket-lib's
own deps + npm's manifest format:

- Comparator chains: `>=1.2.3`, `<2.0.0`, `=1.0.0`
- Conjunctions (space-separated): `>=1.2.3 <2.0.0`
- Disjunctions (`||`): `1.x || >=2.0.0`
- Caret (`^1.2.3`): `>=1.2.3 <2.0.0`
- Tilde (`~1.2.3`): `>=1.2.3 <1.3.0`
- Wildcards (`*`, `1.x`, `1.2.*`)
- Hyphen ranges (`1.2.3 - 2.3.4`)

Pre-release inclusion follows the `includePrerelease` option flag,
defaulted to `false` to match `semver`'s default.

## Test strategy

The vendored JS semver has a comprehensive test corpus. Phase 1
ships:

1. **Cross-checked parity** — for ~200 representative inputs, run
   both the native and JS implementations; assert identical output.
   This catches divergence on the long tail.
2. **Spec corpus** — adapt the tests from `semver/test/index.js` for
   `compare`, `gt`/`lt`/`gte`/`lte`, `eq`, `satisfies`. Run under
   `node:test`.
3. **Fuzz** — feed random version strings (10K iterations) and
   assert: parse-or-error parity, compare reflexivity, comparison
   antisymmetry. No flakes allowed; any divergence is a bug.

## socket-lib wiring

Mirror the smol/util.ts + smol/primordial.ts pattern:

- `src/smol/versions.ts` — lazy-loader + `SmolVersionsBinding`
  interface. `getSmolVersions()` is `/*@__NO_SIDE_EFFECTS__*/`.
- `src/versions.ts` — route the 10 hot ops through smol when
  available; fall through to the vendored JS semver otherwise.
- `test/unit/versions.test.mts` — already exists, gets ~30 new
  parity tests against the smol-routed exports.

## Rollout

Phase 1: native parser + comparator + the 10 hot ops. Single PR.
Phase 2: range-parser edge cases + the deferred 6 ops. Separate PR.

## Risk

The biggest unknown is range-parser parity. The JS semver allows
permissive whitespace, mixed comparator order in conjunctions, and
treats some prerelease-vs-stable comparisons in surprising ways.
Phase 1 ships with the cross-checked parity guard turned on so any
divergence shows up in unit tests immediately.

## Estimated effort

Phase 1: ~600 lines of C++, ~200 lines of TypeScript wiring,
~400 lines of parity tests. About a day of focused work.
