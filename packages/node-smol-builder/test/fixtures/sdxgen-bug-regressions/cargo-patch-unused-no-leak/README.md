# Cargo `[[patch.unused]]` — no leak (false positive, regression guard)

## Status

**No fix needed.** During the QA pass we suspected `[[patch.unused]]` entries were leaking as real deps; testing confirmed the existing filter logic — `trimmed === '[[package]]'` else `currentEntry = undefined` — already filters them. This fixture exists as a **regression guard** so a future C++ port doesn't accidentally drop the filter.

## sdxgen reference

`socket-sdxgen/src/parsers/cargo/index.mts` — the section-header dispatch (`[[package]]` opens an entry, anything else closes it).

## Behavior

When the Cargo scanner encounters a `[[...]]` line:

- `[[package]]` → start a new entry.
- `[[anything-else]]` (including `[[patch.unused]]`, `[[bin]]`, `[[dependencies]]` in some shapes) → close the current entry, set `currentEntry = undefined`, do NOT emit a PackageRef from the following key/value lines.

The C++ port must preserve this dispatch shape. Naive impls that just collect every `name`/`version` pair would leak the patch-unused entry.

## Expected behavior

- Exactly one entry: `real-dep`.
- No `phantom` entry from the `[[patch.unused]]` block.
