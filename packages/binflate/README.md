# binflate

CLI tool for extracting compressed binaries without executing them. Supports Mach-O, ELF, and PE executables.

## Platform Support

| Platform | Binary Format | Compression | Library |
|----------|--------------|-------------|---------|
| macOS    | Mach-O       | LZFSE       | Apple Compression Framework |
| Linux    | ELF          | LZFSE       | lzfse (statically linked from submodule) |
| Windows  | PE           | LZFSE       | lzfse (statically linked from submodule) |

## Building

```bash
pnpm run build
```

Outputs to `build/prod/out/Final/binflate` (or `binflate.exe` on Windows).

### Prerequisites

- **macOS**: Xcode Command Line Tools (provides clang and Compression framework)
- **Linux**: GCC (lzfse library is built automatically from submodule)
- **Windows**: MSYS2 (provides GCC toolchain and build environment)

## Installation

After building, make binflate available system-wide:

### macOS / Linux

```bash
# Option 1: Copy to /usr/local/bin
sudo cp build/prod/out/Final/binflate /usr/local/bin/

# Option 2: Add to PATH (add to ~/.zshrc or ~/.bashrc)
export PATH="$PATH:$(pwd)/build/prod/out/Final"
```

<details>
<summary>Windows Installation</summary>

```powershell
# Copy to a directory in your PATH
copy build\prod\out\Final\binflate.exe C:\Windows\System32\

# Or add to PATH
$env:PATH += ";$(Get-Location)\build\prod\out\Final"
```

</details>

### Verify Installation

```bash
# Test with a compressed binary
binflate ./compressed-node -o ./decompressed-node
```

**Note**: binflate is primarily a standalone extraction tool. For production use, compressed binaries created by binpress contain self-extracting stubs (from bin-stubs) that handle decompression, caching, and execution automatically.

## Usage

```bash
# Extract compressed binary to specified output path
binflate <compressed_binary> -o <output_path>
binflate <compressed_binary> --output <output_path>

# Examples:
binflate ./compressed-node -o ./decompressed-node
binflate ./compressed-app --output ./extracted-app
```

## How It Works

1. **Read Compressed Binary**: Parse the input file to locate compressed data segment
2. **Platform Detection**: Identify binary format (Mach-O, ELF, or PE)
3. **Decompress**: Extract compressed data using platform-specific LZFSE decompression
4. **Write Output**: Save decompressed binary to specified output path
5. **Set Permissions**: Make output executable (Unix platforms)

## Integration

binflate provides the decompression core used by `binpress` during the `node-smol-builder` build process:

- **binflate**: CLI extraction tool (this package) - extracts compressed binaries to a specified output path
- **binpress**: Combines binflate decompression logic with self-extracting stubs (from bin-stubs) to create compressed binaries
- **Self-extracting stubs**: Handle decompression, caching at `~/.socket/_dlx/<hash>/`, and execution automatically

The compressed binaries created by binpress embed:
- Self-extracting stub (decompression + cache + execution logic)
- Original binary (compressed with LZFSE)
- Cache key for identifying the decompressed version

### Cache Management (Self-Extracting Binaries Only)

When compressed binaries created by binpress are executed, the embedded self-extracting stub caches decompressed binaries in `~/.socket/_dlx/` for fast subsequent executions. This caching behavior can be controlled with environment variables:

- **SOCKET_DLX_DIR**: Override default cache location (default: `~/.socket/_dlx/`)
- **SOCKET_HOME**: Override Socket home directory (default: `~/.socket/`)

Cache can be cleared manually:

```bash
rm -rf ~/.socket/_dlx/
```

**Note**: binflate itself does NOT use caching. It simply extracts compressed binaries to the specified output path. Only the self-extracting stubs embedded in compressed binaries by binpress implement caching and execution.

## License

MIT
