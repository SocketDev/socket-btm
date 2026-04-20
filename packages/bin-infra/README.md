# bin-infra

Shared infrastructure for the binary tooling packages (binject, binpress, binflate). Provides LIEF wrappers for reading and writing Mach-O / ELF / PE files, segment-name helpers, and a cross-platform Makefile selector so each tool has one consistent way to invoke its build.

You normally don't use this package directly — it's a workspace dependency of binject, binpress, and binflate.
