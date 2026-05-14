# Fix 3b — pnpm v9 workspace / file / link protocol filter

## Bug

pnpm v9 importer dep values like `workspace:^1.0.0`, `file:./local.tgz`, and `link:packages/my-workspace` are not real registry packages — they reference local workspaces / tarballs / symlinks. Previous impls emitted them as if they were real registry deps with non-semver versions, polluting the index with phantom entries.

## sdxgen reference

`socket-sdxgen/src/parsers/pnpm/pnpm-lock-v9.mts` — importer walker, protocol-prefix guard.

## Fix shape

In the importer-walk, skip emission if the dep value starts with `link:`, `workspace:`, or `file:`:

```ts
if (
  depVersion.length === 0 ||
  StringPrototypeIndexOf(depVersion, 'link:') === 0 ||
  StringPrototypeIndexOf(depVersion, 'workspace:') === 0 ||
  StringPrototypeIndexOf(depVersion, 'file:') === 0
) {
  continue
}
```

The empty-version guard (fix3a) and these protocol filters share the same `continue` chain — both fixes land in one branch.

## Expected behavior

- Only `real-dep` (the inline semver value) materializes as a PackageRef.
- `ws-dep`, `file-dep`, `link-dep` are filtered out entirely — not present in `packages[]` and not present in `_index`.
