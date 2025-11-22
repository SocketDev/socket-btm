# @socketbin/node-smol-builder

Custom Node.js v24.10.0 binary builder with Socket security patches.

## What it does

This package Downloads the Node.js v24.10.0 source code, applies Socket security patches, and then compiles a custom Node.js binary optimized for size and security.

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

Final binaries are located in `build/out/`:
- `build/out/Release/node` - Compiled binary (~44 MB)
- `build/out/Stripped/node` - Stripped binary (~23-27 MB)
- `build/out/Compressed/node` - Compressed binary (~8-12 MB)
- `build/out/Final/node` - Distribution binary

## Features

- Small ICU (English-only, Unicode escapes supported)
- V8 Lite Mode (prod builds, 5-10x slower JS, normal WASM)
- SEA support with automatic Brotli compression (70-80% reduction)
- No npm, corepack, inspector, sqlite

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
- npm, corepack, SQLite, TypeScript/amaro
- NODE_OPTIONS, inspector/debugger (prod)
- REPL, snapshots

## SEA Usage

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
