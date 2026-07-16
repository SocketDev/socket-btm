# Fix 4 — yarn `dependenciesMeta` inversion

## Bug

yarn's `dependenciesMeta` section is positional metadata about deps the parent just declared — specifically, it flags certain children as optional from the parent's view (e.g. `dependenciesMeta.fsevents.optional = true` means "this package's `fsevents` dep is optional").

The previous impl was treating each `dependenciesMeta.<child>` line as if it were declaring a new dep entry of its own, AND was flipping the parent's `isOptional` to `true` whenever any child had `optional: true`. Two distinct bugs:

1. **Phantom entries** — `fsevents` was emitted as a PackageRef synthesized from the metadata block, with no real version info.
2. **Parent inversion** — `react`'s `isOptional` was being set to `true` because of `dependenciesMeta.fsevents.optional`, when the parent itself is a normal hard dep.

## sdxgen reference

`socket-sdxgen/src/parsers/yarn-classic/yarn-lock-v1.mts` + `socket-sdxgen/src/parsers/yarn-berry/yarn-lock-v2.mts` — the section walker, `dependenciesMeta` branch.

## Fix shape

When walking yarn's nested-block lines and the current section is `dependenciesMeta`, consume the indented block for position-tracking only — never synthesize a PackageRef, never mutate parent flags:

```ts
if (currentSection === 'dependenciesMeta') {
  consumeIndentedBlock(scanner)
  continue
}
```

## Expected behavior

- Exactly one entry: `react`.
- `react.isOptional === false` — the parent retains its real classification.
- No phantom `fsevents` entry.

## Test history

The previous test asserted the BUGGY behavior (`expect(react.isOptional).toBe(true)`). It was flipped to assert correct semantics during the QA pass; this fixture encodes the corrected expectation.
