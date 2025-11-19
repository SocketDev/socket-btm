# Binary Compression Tools

Platform-specific compression tools for Node.js binaries using native OS APIs.

## Requirements

### macOS
- Xcode Command Line Tools or Xcode
- System clang compiler (`/usr/bin/clang`)
- Apple Compression library (libcompression, included in macOS SDK)

**Note**: The Makefile uses system clang (`/usr/bin/clang`) rather than Homebrew's clang to ensure proper access to macOS SDKs and system libraries. The compression library is linked via `-lcompression` (not `-framework Compression` as it's provided as a library in modern macOS).

### Linux
- GCC or Clang
- liblzma development headers (`liblzma-dev` on Debian/Ubuntu)

### Windows
- MinGW or MSVC
- Windows SDK

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
