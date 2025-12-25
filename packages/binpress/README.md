# binpress

Binary compression for Mach-O, ELF, and PE executables.

## Platform Support

| Platform | Binary Format | Compression | Library |
|----------|--------------|-------------|---------|
| macOS    | Mach-O       | LZFSE       | Apple Compression Framework |
| Linux    | ELF          | LZMA        | liblzma |
| Windows  | PE           | LZMS        | Windows Compression API (Cabinet.dll) |

## Building

```bash
make
```

Outputs `out/binpress` (or `out/binpress.exe` on Windows).

### Prerequisites

- **macOS**: Xcode Command Line Tools (provides clang and Compression framework)
- **Linux**: GCC and liblzma-dev (`apt-get install liblzma-dev` or `yum install xz-devel`)
- **Windows**: MinGW or Visual Studio with Windows SDK

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

```bash
# Compress a binary (creates self-extracting executable)
binpress <input> -o <output>

# Use custom stub
binpress <input> -s <stub> -o <output>

# Show help
binpress --help

# Show version
binpress --version
```

### Examples

```bash
# Compress node binary to create self-extracting executable
binpress node -o node-compressed

# Use custom stub
binpress node -s custom-stub -o node-compressed

# The output will be a self-extracting executable that:
# - Decompresses on first run
# - Caches decompressed binary
# - Executes with original arguments
./node-compressed --version  # Works like regular node
```

## Integration

Used by `node-smol-builder` to create compressed Node.js binaries that are 50-70% smaller than uncompressed builds.

## License

MIT
