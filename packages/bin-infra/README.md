# bin-infra

Shared infrastructure for the binary tooling packages (binject, binpress, binflate). Provides LIEF wrappers for reading and writing Mach-O / ELF / PE files, segment-name helpers, and a cross-platform Makefile selector so each tool has one consistent way to invoke its build.

You normally don't use this package directly — it's a workspace dependency of binject, binpress, and binflate. There is no `pnpm run build` here; building those consumer packages pulls in bin-infra as source.

When you edit files under `lib/`, `make/`, or `src/socketsecurity/bin-infra/`, also bump the matching entry in `.github/cache-versions.json` (see the "Cache Version Cascade" table in the root `CLAUDE.md`).
