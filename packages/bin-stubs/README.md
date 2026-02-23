# bin-stubs

Platform-specific stub binaries for compressed Node.js executables. These self-extracting stubs handle decompression, caching, and execution of compressed binaries created by `binpress`.

## Platform Support

| Platform | Binary Format | Stub Binary | Compression | Library |
|----------|--------------|-------------|-------------|---------|
| macOS    | Mach-O       | `smol_stub` (Mach-O) | LZFSE | Apple Compression Framework |
| Linux    | ELF          | `smol_stub` (ELF) | LZFSE | lzfse (statically linked from submodule) |
| Windows  | PE           | `smol_stub.exe` (PE) | LZFSE | lzfse (statically linked from submodule) |

## Building

```bash
pnpm run build
```

Outputs platform-specific stub binaries to `build/{mode}/out/Final/`:
- **macOS**: `smol_stub` (Mach-O)
- **Linux**: `smol_stub` (ELF)
- **Windows**: `smol_stub.exe` (PE)

### Prerequisites

- **macOS**: Xcode Command Line Tools (provides clang and Compression framework)
- **Linux**: GCC, CMake 3.28+, Ninja 1.11+
- **Windows**: MSYS2 (provides MinGW toolchain), CMake 3.28+, Ninja 1.11+

#### Optional: curl for HTTPS Update Checking

The build system automatically attempts to download or build curl libraries with mbedTLS for HTTPS update checking support. If curl is not available, stubs will build successfully but without update checking capabilities.

**curl Dependencies (if building from source)**:
- CMake 3.28+
- Ninja 1.11+
- curl and mbedTLS submodules (automatically initialized)

See `external-tools.json` for detailed dependency information.

## How It Works

### Self-Extracting Stub Architecture

When `binpress` compresses a binary, it creates a self-extracting executable by:

1. **Embedding the stub**: Prepends a platform-specific stub binary (`smol_stub`)
2. **Appending compressed data**: Adds the LZFSE-compressed original binary
3. **Adding cache metadata**: Includes cache key for identifying the decompressed version

When a compressed binary is executed, the stub:

1. **Detects execution**: Stub code runs first (prepended to the file)
2. **Generates cache key**: Computes hash of compressed data to identify cached version
3. **Checks cache**: Looks for decompressed binary in `~/.socket/_dlx/<cache_key>/`
4. **Decompresses (if needed)**: Extracts and caches original binary on first run
5. **Executes**: Runs the decompressed binary with original arguments
6. **Update checking (optional)**: Checks for newer versions via HTTPS (if curl support enabled)

### Cache Management

Decompressed binaries are cached at `~/.socket/_dlx/<cache_key>/` for fast subsequent executions.

**Environment Variables:**
- **SOCKET_DLX_DIR**: Override default cache location (default: `~/.socket/_dlx/`)
- **SOCKET_HOME**: Override Socket home directory (default: `~/.socket/`)

**Clear cache manually:**
```bash
rm -rf ~/.socket/_dlx/
```

### Update Checking

Stubs support optional update checking to notify users when newer versions are available:

- **Enable**: Build with curl libraries available (automatic download/build)
- **Disable**: Build without curl (update checking silently skipped)
- **Runtime**: Checks occur in background, never blocks execution
- **Notifications**: Non-intrusive messages when updates are available

## Integration

Used by `binpress` to create self-extracting compressed binaries for `node-smol`:

```
binpress workflow:
1. Read input binary (e.g., node executable)
2. Compress with LZFSE
3. Prepend platform-specific stub (from bin-stubs)
4. Append compressed data + cache metadata
5. Output self-extracting binary
```

The resulting compressed binary:
- Is 50-70% smaller than the original
- Executes transparently (users don't notice decompression)
- Caches decompressed version for fast subsequent runs
- Optionally checks for updates (if built with curl support)

## Smoke Testing

The build system automatically validates each stub binary:
- Verifies binary exists and is executable
- Checks minimum size (>1KB)
- Confirms platform-specific binary format

## Development

### Source Structure

```
src/socketsecurity/bin-stubs/
├── macho_stub.c          # macOS Mach-O stub implementation
├── elf_stub.c            # Linux ELF stub implementation
├── pe_stub.c             # Windows PE stub implementation
├── debug.h               # Debug logging utilities
├── update_checker.h      # Update checking logic (requires curl)
├── update_config.h       # Update configuration
├── update_integration.h  # Update system integration
├── update_metadata.h     # Update metadata parsing
└── update_notifier.h     # Update notification display
```

### Cross-Compilation

Set `TARGET_ARCH` to cross-compile for different architectures:

```bash
TARGET_ARCH=arm64 pnpm run build  # Build ARM64 stub on x64 host
```

## Testing

```bash
pnpm test
```

Runs vitest test suite with extended timeouts for curl/mbedTLS build steps.

## License

MIT
