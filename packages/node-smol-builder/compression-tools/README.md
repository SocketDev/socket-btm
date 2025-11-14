# Binary Compression Tools

Platform-specific compression tools for Node.js binaries using native OS APIs.

## Building

- **macOS**: `make -f Makefile`
- **Linux**: `make -f Makefile.linux`
- **Windows**: `mingw32-make -f Makefile.windows`

## Why Not UPX?

- 50-60% compression vs our 75-79%
- Breaks macOS code signing
- High AV false positive rate
- Self-modifying code (W^X violations)

## Our Approach

- Native OS compression APIs (Apple Compression, liblzma, Windows Compression API)
- Preserves code signatures
- Zero AV false positives
- External decompressor stub (~90 KB overhead)
