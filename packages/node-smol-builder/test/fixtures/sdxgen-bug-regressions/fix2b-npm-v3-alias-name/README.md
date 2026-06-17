# Fix 2b — npm v2/v3 alias install → pkg.name preference

## Bug

npm v2/v3 encodes aliased installs as `"node_modules/<alias>": { "name": "<real>", "version": "..." }`. Path-derived name extraction returned `sw-cjs` (the alias) instead of `string-width` (the real registry name from `pkg.name`).

## sdxgen reference

`socket-sdxgen/src/parsers/npm/package-lock-v2.mts` — same code path as fix2a.

## Fix shape

Same fix as fix2a: prefer `pkg.name` when present, fall back to path-derived. Both cases (workspace path + alias install) are subsumed by the single preference rule.

## Expected behavior

- `packages[0].name === 'string-width'` (from `pkg.name`, not from path `node_modules/sw-cjs`)
- `_index['string-width'] === 0` — index keyed by the real registry name, not the alias.
  - Note: this differs from v1 alias behavior (fix1) which keys `_index` by the original lockfile key. The v2/v3 path-name resolution lands on the real name directly, so there's no alias key to preserve in the index.
