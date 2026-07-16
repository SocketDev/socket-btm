# Fix 2a — npm v2/v3 workspace path → pkg.name preference

## Bug

npm v2/v3 lockfiles key workspace entries by relative path (e.g. `packages/ui`) without a `node_modules/` prefix. Path-derived name extraction returned `ui` instead of the explicit `pkg.name === '@my-org/ui'`.

## sdxgen reference

`socket-sdxgen/src/parsers/npm/package-lock-v2.mts` — the `packages` object walker, name-resolution branch.

## Fix shape

When iterating `packages` keys, prefer `pkg.name` when present and non-empty. Fall back to `extractPackageNameFromPath(pkgKey)` only when `pkg.name` is absent or empty.

```ts
const name = (typeof pkg.name === 'string' && pkg.name.length > 0)
  ? pkg.name
  : extractPackageNameFromPath(pkgPath)
```

## Expected behavior

- `packages[0].name === '@my-org/ui'` (from `pkg.name`, not from path `packages/ui`)
- `packages[1].name === 'regular-dep'` (from path, since no `pkg.name` field)
- Both entries materialize — workspace entries are first-class deps in the parsed shape.

## Related

- See `fix2b-npm-v3-alias-name/` for the alias-installs case (same fix path).
