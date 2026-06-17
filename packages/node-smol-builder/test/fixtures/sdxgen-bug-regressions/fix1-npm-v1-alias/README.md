# Fix 1 — npm v1 alias extraction

## Bug

npm v1 lockfiles encode aliased installs as `version: "npm:<real-name>@<real-version>"`. Previous impls emitted the alias key directly, producing a malformed purl (`pkg:npm/alias@npm%3Areal%401.0`) pointing at a non-existent registry package.

## sdxgen reference

`socket-sdxgen/src/parsers/npm/package-lock-v1.mts` — alias-detection branch in the v1 dependency walker.

## Fix shape

In the v1 package-ref builder, when `version` starts with `npm:`, slice past the prefix, find the last `@`, and extract:
- `effectiveName = rest[0:atIdx]`
- `version = rest[atIdx+1:]`

The original alias key is preserved in `_index` so consumers can still look up by alias.

## Expected behavior

- `packages[0].name === 'string-width'` (not `'string-width-cjs'`)
- `packages[0].version === '4.2.3'` (not `'npm:string-width@4.2.3'`)
- `_index['string-width-cjs'] === 0` (index keeps alias key → real-name index)
