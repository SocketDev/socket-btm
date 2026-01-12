# binpress

Binary compression for Mach-O, ELF, and PE executables.

## Platform Support

| Platform | Binary Format | Compression | Library |
|----------|--------------|-------------|---------|
| macOS    | Mach-O       | LZFSE       | Apple Compression Framework |
| Linux    | ELF          | LZFSE       | Open-source lzfse library |
| Windows  | PE           | LZFSE       | Open-source lzfse library |

## Building

```bash
make
```

Outputs `out/binpress` (or `out/binpress.exe` on Windows).

### Prerequisites

- **macOS**: Xcode Command Line Tools (provides clang and Compression framework)
- **Linux**: GCC (lzfse library is built automatically from submodule)
- **Windows**: MinGW or Visual Studio (lzfse library is built automatically from submodule)

## Installation

After building, make binpress available system-wide:

### macOS

```bash
# Option 1: Copy to /usr/local/bin
sudo cp out/binpress /usr/local/bin/

# Option 2: Create symlink
ln -s $(pwd)/out/binpress /usr/local/bin/binpress

# Option 3: Add to PATH (add to ~/.zshrc or ~/.bashrc)
export PATH="$PATH:$(pwd)/out"
```

<details>
<summary>Linux Installation</summary>

```bash
# Option 1: Copy to /usr/local/bin
sudo cp out/binpress /usr/local/bin/

# Option 2: Create symlink
ln -s $(pwd)/out/binpress /usr/local/bin/binpress

# Option 3: Add to PATH (add to ~/.bashrc)
export PATH="$PATH:$(pwd)/out"
```

</details>

<details>
<summary>Windows Installation</summary>

```powershell
# Copy to a directory in your PATH
copy out\binpress.exe C:\Windows\System32\

# Or add to PATH
$env:PATH += ";$(Get-Location)\out"
```

</details>

### Verify Installation

```bash
binpress --help
# Or test with compression
binpress input.bin output.bin
```

## Usage

```
binpress - Create self-extracting binaries and compressed data files

Usage:
  binpress <input> -o <output>              # Create self-extracting stub
  binpress <input> -d <output>              # Create compressed data file
  binpress <input> -o <stub> -d <data>      # Create both outputs
  binpress --help
  binpress --version

Arguments:
  input                Path to binary to compress

Options:
  -o, --output PATH           Output self-extracting stub
  -d, --data PATH             Output compressed data file
  -u, --update PATH           Update existing stub with new data (legacy)
  --target TARGET             Target platform-arch-libc (e.g., linux-x64-musl, darwin-arm64, win32-x64)
  --target-platform PLATFORM  Target platform (linux, darwin, win32)
  --target-arch ARCH          Target architecture (x64, arm64)
  --target-libc VARIANT       Target libc (musl, glibc) - Linux only
  -h, --help                  Show this help message
  -v, --version               Show version information

Examples:
  binpress node -o node-compressed              # Self-extracting binary
  binpress node -d node.data                    # Compressed data file
  binpress node -o node-compressed -d node.data # Both outputs

Note: At least one output (-o or -d) must be specified.
```

## Integration

Used by `node-smol-builder` to create compressed Node.js binaries that are 50-70% smaller than uncompressed builds.

## License

MIT
