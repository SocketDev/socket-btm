# Alphanumeric sorting

**Rule:** sibling items in any list / block should be alphanumerically sorted unless there's a documented ordering reason. Sort fully when editing — don't preserve historical out-of-order layouts.

## Surfaces

### JSON / JSONC
`tsconfig.json`, `package.json`, `.oxlintrc.json`, `.config/*.json`. Keys inside every object alphabetize.

- **Exception:** tsconfig's top-level has a canonical order (`extends` → `compilerOptions` → `include` → `exclude` → `files`). Keys *inside* `compilerOptions` alphabetize.
- **Exception:** package.json's top-level can keep canonical npm convention (`name` / `version` / `description` / ... / `scripts` / `dependencies`). Keys inside `scripts` / `dependencies` / `devDependencies` alphabetize.

### YAML
Workflow files (`.github/workflows/*.yml`), `pnpm-workspace.yaml`. `env:` blocks, `with:` blocks, `catalog:` entries, allowlist arrays alphabetize. `matrix.include[]` entries alphabetize by `platform → arch` (treat as compound key).

- **Exception:** workflow step lists are ordered by pipeline phase, not alpha.
- **Exception:** matrix entries today are x64-before-arm64 across the fleet for historical reasons. New entries follow alpha (`arm64 < x64`); existing entries cascade-fix is a future fleet-wide PR.

### Markdown
README consumer lists, doc bullet lists, fleet-canonical tables. Alphabetize sibling bullets.

- **Exception:** narrative ordering (numbered setup steps, ordered "first do X, then Y"). State the reason in the surrounding prose.
- **NO ELLIPSIS.** Drop `"..."` from list endings. Either list every item alphabetically, or write "N items, see `<source>`."

### Bash / shell variables
Cache-key hash assignments in workflow scripts (e.g. `BIN_INFRA_LIB=$(...)`, `BORINGSSL_PACKAGE_JSON=$(...)`) alphabetize. The hash ORDER doesn't affect correctness, but stable diffs do.

### TypeScript / JavaScript
- **Imports:** already alphabetized by `socket/sort-named-imports`. Trust the lint rule.
- **Exported constants:** when a module exports independent constants (e.g. flag bundles, allowlists), alphabetize.
- **Switch-case branches:** when cases are independent (no fall-through, no early-return semantic dependency), alphabetize.
- **Variable declarations within a scope:** alphabetize when they're sibling sibling consts of the same logical type (e.g. all paths, all URLs, all flags).
- **Exception:** parser tokens, state machines, pipeline ordering — state the reason inline.

## When to fully re-sort vs. just insert

- **Editing a block that's already alpha-sorted:** insert new entries in alpha position.
- **Editing a block that's NOT alpha-sorted:** fully re-sort the block in the same commit. Don't append-and-leave. Don't preserve historical chaos.
- **Cascade-scoped re-sorts** (e.g. all 8 builder workflows' matrix entries): open a dedicated `chore(wheelhouse): cascade alpha-sort <pattern>` PR. Don't slip into unrelated work.

## Provenance

User-confirmed rules ([[../memory/feedback-alphanumeric-sorting-universal]]):
- 2026-04-17 — "properties and configs should be sorted alphanumerically" (JSON config keys; original feedback)
- 2026-05-29 — "sort alphanumeric" (bash variable declarations in workflow YAML — cache-key hashes)
- 2026-05-29 — "alphanumeric, no ellipsis" (README consumer lists)
- 2026-05-29 — "alphanumeric sort, how can we do more alphanumeric sorting" (commented matrix entries in workflow YAML; this doc compiled in response)
