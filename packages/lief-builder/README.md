# lief-builder

Builds [LIEF](https://lief.re/) — the Library to Instrument Executable Formats — as a static library usable from our C/C++ code. LIEF lets binject and binpress parse and rewrite Mach-O, ELF, and PE files from a single API, which is how we can patch Node.js binaries the same way on every platform.

Prefers a prebuilt artifact from GitHub releases; compiles from the upstream submodule only when needed. The LIEF version is pinned in `.gitmodules` and should match what Node.js uses — see `.claude/skills/updating-lief/SKILL.md`.

## Build

```bash
pnpm --filter lief-builder run build                     # dev build, prefer prebuilt release artifact
pnpm --filter lief-builder run build -- --force          # force compile from source (upstream LIEF)
```

First-time from-source init:

```bash
git submodule update --init --recursive packages/lief-builder/upstream/lief
```

Output: `build/<mode>/<platform-arch>/out/Final/lief/` (`libLIEF.a` + headers). Consumed by binject, binpress, and node-smol-builder.
