# binject

Injects data into compiled binaries without recompiling them. Used to embed SEA (Single Executable Application) resources and VFS archives into a Node.js binary, and to embed bundled stubs into binpress. Under the hood it uses LIEF to parse and rewrite Mach-O, ELF, and PE files so the same tool works on macOS, Linux, and Windows.
