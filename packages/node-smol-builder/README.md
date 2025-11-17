# node-smol-builder

Minimal Node.js v22.11.0 binaries with SEA (Single Executable Application) support.

## Building

```bash
pnpm build              # Build for current platform
pnpm build --mode=prod  # Production build with V8 Lite Mode
pnpm build --mode=dev   # Development build with full V8
```

## Platform Support

Builds for 8 platforms:
- macOS (arm64, x64)
- Linux glibc (x64, arm64)
- Linux musl/Alpine (x64, arm64)
- Windows (x64, arm64)

## Output

- `build/prod/Release/node` - Compiled binary (~44 MB)
- `build/prod/Stripped/node` - Stripped binary (~23-27 MB)
- `build/prod/Compressed/node` - Compressed binary (~8-12 MB)
- `build/prod/Final/node` - Distribution binary

## Features

- Small ICU (English-only, Unicode escapes supported)
- V8 Lite Mode (prod builds, 5-10x slower JS, normal WASM)
- SEA support with automatic Brotli compression (70-80% reduction)
- No npm, corepack, inspector, sqlite

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
