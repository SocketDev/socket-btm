# binflate

Binary decompression for Mach-O, ELF, and PE executables.

## Platform Support

| Platform | Binary Format | Compression | Library |
|----------|--------------|-------------|---------|
| macOS    | Mach-O       | LZFSE       | Apple Compression Framework |
| Linux    | ELF          | LZMA        | liblzma (statically linked) |
| Windows  | PE           | LZMS        | Windows Compression API (Cabinet.dll) |

## Building

```bash
make
```

Outputs `out/binflate` (or `out/binflate.exe` on Windows).

### Prerequisites

- **macOS**: Xcode Command Line Tools (provides clang and Compression framework)
- **Linux**: GCC, liblzma-dev, libssl-dev (`apt-get install liblzma-dev libssl-dev` or `yum install xz-devel openssl-devel`)
- **Windows**: MinGW or Visual Studio with Windows SDK

## Installation

After building, make binflate available system-wide:

### macOS

```bash
# Option 1: Copy to /usr/local/bin
sudo cp out/binflate /usr/local/bin/

# Option 2: Create symlink
ln -s $(pwd)/out/binflate /usr/local/bin/binflate

# Option 3: Add to PATH (add to ~/.zshrc or ~/.bashrc)
export PATH="$PATH:$(pwd)/out"
```

<details>
<summary>Linux Installation</summary>

```bash
# Option 1: Copy to /usr/local/bin
sudo cp out/binflate /usr/local/bin/

# Option 2: Create symlink
ln -s $(pwd)/out/binflate /usr/local/bin/binflate

# Option 3: Add to PATH (add to ~/.bashrc)
export PATH="$PATH:$(pwd)/out"
```

</details>

<details>
<summary>Windows Installation</summary>

```powershell
# Copy to a directory in your PATH
copy out\binflate.exe C:\Windows\System32\

# Or add to PATH
$env:PATH += ";$(Get-Location)\out"
```

</details>

### Verify Installation

```bash
# Test with a compressed binary
binflate ./compressed-node --version
```

**Note**: binflate is typically embedded in compressed binaries by binpress and not used as a standalone tool. The compressed binary contains the decompressor and handles execution automatically.

## Usage

```bash
# Decompress and execute a compressed binary
binflate ./compressed-node --version

# Decompression process:
# 1. Reads compressed binary
# 2. Checks cache: ~/.socket/_dlx/<cache-key>/
# 3. If not cached, decompresses to cache
# 4. Executes decompressed binary with arguments
```

## How It Works

1. **Cache Key Generation**: Hash of compressed binary content
2. **Cache Check**: Look for `~/.socket/_dlx/<cache-key>/<binary-name>`
3. **Decompress**: Extract embedded compressed data using platform-specific algorithm
4. **Cache**: Store decompressed binary in cache directory
5. **Execute**: Run decompressed binary with original arguments

## Integration

Created by `binpress` during `node-smol-builder` build process. The compressed binary embeds:
- Original binary (compressed)
- Decompression stub (binflate logic)
- Cache key for decompression

## Cache Management

Decompressed binaries are cached in `~/.socket/_dlx/` for fast subsequent executions. Cache can be cleared manually:

```bash
rm -rf ~/.socket/_dlx/
```

## License

MIT
