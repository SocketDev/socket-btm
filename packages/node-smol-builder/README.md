# @socketbin/node-smol-builder

Custom Node.js v24.x binary builder with Socket security patches.

## What it does

This package Downloads the Node.js v24.x source code, applies Socket security patches, and then compiles a custom Node.js binary optimized for size and security.

## Building

```bash
pnpm run build              # Build for current platform
pnpm run build:all          # Build for all platforms
```

## Platform Support

Builds for 8 platforms:
- macOS (arm64, x64)
- Linux glibc (x64, arm64)
- Linux musl/Alpine (x64, arm64)
- Windows (x64, arm64)

## Output

Final binaries are located in `build/<mode>/out/` (where `<mode>` is `dev` or `prod`):
- `build/<mode>/out/Release/node` - Compiled binary (~44 MB)
- `build/<mode>/out/Stripped/node` - Stripped binary (~23-27 MB)
- `build/<mode>/out/Compressed/node` - Compressed binary (~8-12 MB)
- `build/<mode>/out/Final/node` - Distribution binary

**Build modes:**
- `dev` - Debug symbols, inspector enabled (bigger binary)
- `prod` - Stripped, inspector disabled (smaller binary)

## Features

- Small ICU (English-only, Unicode escapes supported)
- SEA support with automatic Brotli compression (70-80% reduction)
- No npm, corepack, amaro (TypeScript), NODE_OPTIONS
- No inspector (prod builds only)

## Testing

Run Node.js's official test suite (~4000+ tests) against the built binary:

```bash
pnpm build                  # Build the binary first
pnpm test:node-suite        # Test current build (auto-detects dev/prod)
pnpm test:node-suite:dev    # Test dev build
pnpm test:node-suite:prod   # Test prod build
pnpm test:node-suite -- --verbose  # Show skipped tests
```

The runner expands test patterns, filters out tests for disabled features, and runs tests in parallel.

### Coverage

**Supported** (100% of node-smol APIs):
- Core: process, buffer, stream, timers, events, fs
- Networking: http, https, http2, tls, dns, tcp, udp
- Web APIs: fetch, WebSocket, streams, crypto
- Modules: CommonJS, ESM, hooks
- Async: hooks, local storage, workers, cluster
- Standard library: path, url, util, zlib, etc.

**Excluded** (disabled features):
- ICU/Intl (small-icu, English-only)
- npm, corepack, TypeScript/amaro
- NODE_OPTIONS, inspector/debugger (prod)

## SEA Usage

### Basic SEA (Single Executable Application)

```bash
# Create SEA config
echo '{"main": "app.js", "output": "app.blob"}' > sea-config.json

# Generate blob (automatically Brotli compressed)
node --experimental-sea-config sea-config.json

# Inject into binary
cp build/prod/Final/node ./my-app
npx postject ./my-app NODE_SEA_BLOB app.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
```

### SEA + VFS (Virtual Filesystem)

node-smol includes a Virtual Filesystem that embeds entire application directories:

```bash
# Build SEA with VFS in one command
./scripts/build-sea-with-vfs.sh ./my-app-dir ./my-app-binary

# Run
./my-app-binary
```

**Features:**
- ✅ Embed entire directories (TAR format)
- ✅ Transparent `fs` module access
- ✅ Standard `require()` works
- ✅ Separate from SEA blob (future-proof)
- ✅ Independent updates possible

## Checkpoint System

This package uses incremental checkpoints to speed up builds and CI:

1. **download** - Node.js source downloaded and extracted
2. **patch** - 6 Socket security patches applied
3. **configure** - Build system configured
4. **compile** - Source compiled to binary
5. **strip** - Debug symbols removed
6. **inject-sea** - SEA capability injected
7. **inject-vfs** - VFS capability injected
8. **compress** - Binary compressed with binpress
9. **finalized** - Final binary ready for distribution

Checkpoints are cached and restored automatically in CI. See `packages/build-infra` for checkpoint implementation details.

## Patches

Socket applies **6 security and size-optimization patches** to Node.js v24.x:
- Security hardening (GCC LTO fixes, ARM64 branch protection)
- Build system fixes (Python 3 compatibility)
- ICU polyfills for small-icu builds
- VFS integration and bootstrap
- Platform-specific fixes (V8 TypeIndex on macOS)

## License

MIT
