# Fix 5 — pnpm v9 isDev derivation (DEFERRED)

> **Status: deferred.** The current JS impls in socket-btm + socket-lib do NOT match this fixture's `expected.json` — they emit `vitest` as `depType: 'prod'` / `isDev: false`. The C++ port lands the **correct** derivation from day one. **Do not inherit the partial impl.**
>
> The fixture's test should be `it.skip` / `it.todo` until the C++ port lands.

## Bug

pnpm v9 snapshots don't carry `dev: true` markers the way v5/v6 did. The `isDev` classification has to be derived from the **importers** block:

- Collect prod set from each importer's `dependencies` + `optionalDependencies`.
- Collect devOnly set from each importer's `devDependencies` MINUS the prod set.
- Post-pass classify each snapshot entry: `isDev = !prod.contains(name) && devOnly.contains(name)`.

Tiebreak: any package reachable from a prod dep is prod. This matches npm/pnpm semantics — a package promoted from devDeps to deps by another importer wins as prod.

## sdxgen reference

`socket-sdxgen/src/parsers/pnpm/pnpm-lock-v9.mts` — the second-pass classification after both importer and snapshot walks complete.

## Fix shape (C++ target)

```cpp
// In parser_pnpm.cc, after BOTH the importer and snapshot walks complete:
std::unordered_set<std::string_view> prod_set;
std::unordered_set<std::string_view> dev_only_set;

// Importer walk populates these from `dependencies` / `optionalDependencies`
// (prod_set) and `devDependencies` (dev_only_set, minus anything already
// in prod_set).

// Post-pass classification:
for (PackageRef& ref : result.packages) {
  bool prod = prod_set.contains(ref.name);
  bool dev_only = dev_only_set.contains(ref.name);
  ref.isDev = !prod && dev_only;
  ref.depType = ref.isDev ? DepType::kDev : DepType::kProd;
}
```

## Expected behavior

- `lodash` (from `dependencies`) → `depType: 'prod'`, `isDev: false`.
- `vitest` (from `devDependencies` only) → `depType: 'dev'`, `isDev: true`.
- A hypothetical `picocolors` reachable from both deps + devDeps would land as `prod` (prod wins).

## Test guard

```ts
// In smol-manifest.test.mts:
it.todo('fix5-pnpm-v9-isdev-derivation: vitest classified as dev', () => {
  // Enable when C++ port lands; until then this asserts the deferred contract.
})
```

When the C++ port lands and the equivalence harness produces the expected output, flip `it.todo` to `it` and the fixture becomes a hard gate.
