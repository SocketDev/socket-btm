# stubs-builder

Builds the small platform-specific stub binaries that binpress wraps around a compressed node-smol binary. At runtime the stub runs first, decompresses the embedded payload via binflate, and execs the real binary.

One stub per OS/arch combination — ELF for Linux, Mach-O for macOS, and PE for Windows — all compiled from the C sources in this package using the matching `Makefile.linux`, `Makefile.macos`, or `Makefile.win`.
