# lief-builder

Builds [LIEF](https://lief.re/) — the Library to Instrument Executable Formats — as a static library usable from our C/C++ code. LIEF lets binject and binpress parse and rewrite Mach-O, ELF, and PE files from a single API, which is how we can patch Node.js binaries the same way on every platform.

Prefers a prebuilt artifact from GitHub releases; compiles from the upstream submodule only when needed. The LIEF version is pinned in `.gitmodules` and should match what Node.js uses — see `.claude/skills/updating-lief/SKILL.md`.
