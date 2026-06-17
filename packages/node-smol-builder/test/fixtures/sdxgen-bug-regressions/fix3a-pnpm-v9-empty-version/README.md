# Fix 3a — pnpm v9 importer block-style empty version

## Bug

pnpm v9 importer entries can use the block shape:

```yaml
pkg:
  specifier: ^1
  version: 1.0.0
```

The previous impl emitted a PackageRef with empty `version: ""` for the parent line (`pkg:`) BEFORE the indented `version:` property was consumed. Result: two entries for the same package, one with empty version.

## sdxgen reference

`socket-sdxgen/src/parsers/pnpm/pnpm-lock-v9.mts` — importer walker, parent-line emission guard.

## Fix shape

In the importer-walk, after extracting the dep version string from the block shape, skip emission if the version is empty:

```ts
if (depVersion.length === 0) {
  continue
}
```

This guard sits alongside the `link:` / `workspace:` / `file:` filter from fix3b.

## Expected behavior

- Exactly one entry for `lodash` — the one materialized from the `snapshots:` section.
- No entry with `version: ""`.
- `_index['lodash']` resolves to the snapshot-derived entry.
