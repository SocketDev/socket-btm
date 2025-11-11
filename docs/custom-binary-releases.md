# Custom Binary Releases for Socket CLI

This document describes how to build, upload, and reference custom Node.js binaries (including smol builds) for use in Socket CLI's SEA (Single Executable Application) platform binaries.

## Overview

Socket CLI uses 8 platform-specific SEA binaries. Each binary is composed of:

1. **Node.js Binary** (official OR custom)
2. **SEA Blob** (Socket CLI code fused via postject)

This system allows Socket to:
- Use official Node.js v24.10.0 binaries by default
- Override with custom smol binaries for optimized size/performance
- Support any custom Node.js build uploaded to GitHub releases

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  socket-btm (This Repo)                                   │
│  ├─ Build custom Node.js binaries (smol)                 │
│  ├─ Upload to GitHub Releases                            │
│  └─ Provide URLs for socket-cli to download              │
└──────────────────────────────────────────────────────────┘
                          │
                          │ GitHub Releases
                          │
                          ▼
┌──────────────────────────────────────────────────────────┐
│  socket-cli (Consumer)                                    │
│  ├─ Downloads Node binary (official or custom)           │
│  ├─ Generates SEA blob from CLI code                     │
│  ├─ Fuses blob into binary with postject                 │
│  └─ Publishes 8 platform binaries to npm                 │
└──────────────────────────────────────────────────────────┘
```

## Building Custom Binaries

### Prerequisites

- Node.js 22.6+
- pnpm 10.16+
- Git
- Platform-specific build tools:
  - **macOS**: Xcode Command Line Tools
  - **Linux**: GCC/Clang, make
  - **Windows**: Visual Studio 2022 with C++ workload

### Build Smol Binaries

```bash
# Clone socket-btm
git clone git@github.com:SocketDev/socket-btm.git
cd socket-btm

# Install dependencies
pnpm install

# Build smol binary for current platform
cd packages/node-smol-builder
pnpm build --prod

# Output: build/out/Final/node (or node.exe on Windows)
```

**Build Options:**

```bash
# Development build (faster compile, larger binary)
pnpm build

# Production build (slower compile, smaller binary, V8 Lite)
pnpm build --prod

# Skip compression (faster, larger)
pnpm build --no-compress-binary

# Force clean build
pnpm build --clean
```

### Cross-Platform Builds

To build for multiple platforms, use CI/CD or cross-compilation tools:

```bash
# macOS → Linux (requires Docker)
docker run --rm -v $(pwd):/work -w /work/packages/node-smol-builder \
  node:22-alpine pnpm build --prod

# Linux → macOS (requires osxcross)
# Windows builds require Windows host or CI
```

## Uploading to GitHub Releases

### Manual Release

```bash
# 1. Tag the release
git tag -a node-smol-v1.2.0 -m "Node.js Smol v1.2.0 (based on Node v24.10.0)"
git push origin node-smol-v1.2.0

# 2. Create GitHub release
gh release create node-smol-v1.2.0 \
  --title "Node.js Smol v1.2.0" \
  --notes "Custom Node.js v24.10.0 with Socket optimizations:
- Small ICU (English-only)
- Disabled modules: npm, corepack, inspector, sqlite
- Binary stripping + compression
- SEA support enabled
- ~20-30MB final size (vs 50MB default)"

# 3. Build and upload each platform binary
platforms=("darwin-arm64" "darwin-x64" "linux-arm64" "linux-x64" "linux-musl-arm64" "linux-musl-x64" "win32-arm64" "win32-x64")

for target in "${platforms[@]}"; do
  echo "Building $target..."

  # Build for target platform (requires platform access or cross-compilation)
  pnpm build --prod --platform $target

  # Create tarball
  tar czf node-smol-${target}.tar.gz -C build/out/Final node*

  # Upload to release
  gh release upload node-smol-v1.2.0 node-smol-${target}.tar.gz
done
```

### Automated Release (GitHub Actions)

Create `.github/workflows/release-binaries.yml`:

```yaml
name: Release Custom Binaries

on:
  push:
    tags:
      - 'node-smol-v*'

jobs:
  build:
    strategy:
      matrix:
        include:
          - os: macos-latest
            platform: darwin
            arch: arm64
          - os: macos-latest
            platform: darwin
            arch: x64
          - os: ubuntu-latest
            platform: linux
            arch: arm64
          - os: ubuntu-latest
            platform: linux
            arch: x64
          - os: ubuntu-latest
            platform: linux-musl
            arch: arm64
          - os: ubuntu-latest
            platform: linux-musl
            arch: x64
          - os: windows-latest
            platform: win32
            arch: arm64
          - os: windows-latest
            platform: win32
            arch: x64

    runs-on: ${{ matrix.os }}

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Install dependencies
        run: pnpm install

      - name: Build smol binary
        working-directory: packages/node-smol-builder
        run: pnpm build --prod --platform ${{ matrix.platform }} --arch ${{ matrix.arch }}

      - name: Create tarball
        run: |
          cd packages/node-smol-builder/build/out/Final
          tar czf ../../../../node-smol-${{ matrix.platform }}-${{ matrix.arch }}.tar.gz node*

      - name: Upload to release
        uses: softprops/action-gh-release@v1
        with:
          files: packages/node-smol-builder/node-smol-${{ matrix.platform }}-${{ matrix.arch }}.tar.gz
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Release Naming Convention

Use semantic versioning with platform information:

**Tag Format**: `node-smol-v{MAJOR}.{MINOR}.{PATCH}`

**File Format**: `node-smol-{platform}-{arch}.tar.gz`

**Examples:**
- `node-smol-v1.2.0` (tag)
- `node-smol-darwin-arm64.tar.gz` (file)
- `node-smol-linux-x64.tar.gz` (file)
- `node-smol-win32-x64.tar.gz` (file)

**Platform Identifiers:**
- `darwin` - macOS (glibc)
- `linux` - Linux with glibc
- `linux-musl` - Linux with musl (Alpine)
- `win32` - Windows

**Architecture Identifiers:**
- `arm64` - ARM64 / Apple Silicon
- `x64` - x86-64 / Intel/AMD 64-bit

## Referencing Custom Binaries in socket-cli

Socket CLI can reference custom binaries via environment variables.

### Single Binary Override

```bash
# Override Node binary for one platform
SOCKET_CLI_NODE_BINARY_URL="https://github.com/SocketDev/socket-btm/releases/download/node-smol-v1.2.0/node-smol-darwin-arm64.tar.gz" \
  pnpm build --target darwin-arm64
```

### Base URL for All Platforms

```bash
# Set base URL for all platform downloads
SOCKET_CLI_NODE_BINARY_BASE_URL="https://github.com/SocketDev/socket-btm/releases/download/node-smol-v1.2.0" \
  pnpm build --platforms

# Downloads:
# ${BASE_URL}/node-smol-darwin-arm64.tar.gz
# ${BASE_URL}/node-smol-darwin-x64.tar.gz
# ${BASE_URL}/node-smol-linux-arm64.tar.gz
# ${BASE_URL}/node-smol-linux-x64.tar.gz
# ${BASE_URL}/node-smol-linux-musl-arm64.tar.gz
# ${BASE_URL}/node-smol-linux-musl-x64.tar.gz
# ${BASE_URL}/node-smol-win32-arm64.tar.gz
# ${BASE_URL}/node-smol-win32-x64.tar.gz
```

### Default Behavior

If no custom URL is provided, socket-cli downloads official Node.js binaries:

```bash
# Default: https://nodejs.org/download/release/v24.10.0/node-v24.10.0-{platform}-{arch}.tar.gz
pnpm build --platforms
```

## Implementation in socket-cli

Socket CLI's `packages/cli/src/utils/sea/build.mts:downloadNodeBinary()` should be modified to:

1. Check `SOCKET_CLI_NODE_BINARY_URL` for single binary override
2. Check `SOCKET_CLI_NODE_BINARY_BASE_URL` for base URL
3. Fall back to official Node.js download URL

**Pseudo-code:**

```typescript
export async function downloadNodeBinary(
  version: string,
  platform: string,
  arch: string,
): Promise<string> {
  // Check for explicit binary URL override.
  if (ENV.SOCKET_CLI_NODE_BINARY_URL) {
    return downloadFromUrl(ENV.SOCKET_CLI_NODE_BINARY_URL)
  }

  // Check for base URL override.
  if (ENV.SOCKET_CLI_NODE_BINARY_BASE_URL) {
    const filename = `node-smol-${platform}-${arch}.tar.gz`
    const url = `${ENV.SOCKET_CLI_NODE_BINARY_BASE_URL}/${filename}`
    return downloadFromUrl(url)
  }

  // Default: official Node.js download.
  const baseUrl = ENV.SOCKET_CLI_NODE_DOWNLOAD_URL || 'https://nodejs.org/download/release'
  const url = `${baseUrl}/v${version}/node-v${version}-${platform}-${arch}.tar.gz`
  return downloadFromUrl(url)
}
```

## Version Alignment

**Important**: Custom binaries MUST be based on the same Node.js version that socket-cli expects.

**Current Default**: Node.js v24.10.0

To check socket-cli's expected version:

```bash
cd socket-cli
grep SOCKET_CLI_SEA_NODE_VERSION packages/cli/package.json
# OR check: packages/cli/src/utils/sea/build.mts:getDefaultNodeVersion()
```

**Custom Binary Tags Should Include Base Version:**

```bash
# Tag format: node-smol-v{VERSION}-node{NODE_VERSION}
git tag node-smol-v1.2.0-node24.10.0
git push origin node-smol-v1.2.0-node24.10.0
```

## Testing Custom Binaries

### Local Testing

```bash
# 1. Build custom binary
cd socket-btm/packages/node-smol-builder
pnpm build --prod

# 2. Copy to socket-cli test location
cp build/out/Final/node /tmp/custom-node

# 3. Test in socket-cli
cd socket-cli
SOCKET_CLI_NODE_BINARY_PATH="/tmp/custom-node" \
  pnpm build --target darwin-arm64

# 4. Verify the generated binary
./packages/socketbin-cli-darwin-arm64/bin/socket --version
```

### Release Testing

```bash
# After uploading to GitHub releases, test the download:
SOCKET_CLI_NODE_BINARY_BASE_URL="https://github.com/SocketDev/socket-btm/releases/download/node-smol-v1.2.0" \
  pnpm build --target darwin-arm64
```

## Binary Requirements

Custom binaries must meet these requirements:

1. **SEA Support**: Built with `--experimental-sea-config` support
2. **Postject Compatible**: Must have `NODE_SEA_FUSE` sentinel for injection
3. **Platform Binary**: Must be executable on target platform
4. **No Dependencies**: Should be statically linked or bundle all dependencies
5. **Executable**: Must have execute permissions (Unix) or `.exe` extension (Windows)

For smol binaries, these are automatically satisfied by the build process.

## Troubleshooting

### Binary Download Fails

```bash
# Check URL is accessible
curl -I "https://github.com/SocketDev/socket-btm/releases/download/node-smol-v1.2.0/node-smol-darwin-arm64.tar.gz"

# Verify file exists in GitHub release
gh release view node-smol-v1.2.0

# Check environment variable
echo $SOCKET_CLI_NODE_BINARY_BASE_URL
```

### Postject Injection Fails

```bash
# Verify binary has SEA support
./node --version
./node --experimental-sea-config --help

# Check for NODE_SEA_FUSE marker
strings ./node | grep NODE_SEA_FUSE
```

### Binary Not Executable

```bash
# macOS: Check signature
codesign -dv ./socket

# Linux: Check ELF headers
file ./socket
readelf -h ./socket

# Windows: Check PE headers
dumpbin /headers socket.exe
```

## Security Considerations

### Binary Integrity

All custom binaries should be:
- Built from source in CI/CD (reproducible builds)
- Signed with code signing certificates (macOS, Windows)
- SHA-256 checksums published alongside release

**Example Release with Checksums:**

```bash
# Generate checksums
shasum -a 256 node-smol-*.tar.gz > SHA256SUMS

# Sign checksums (optional)
gpg --detach-sign --armor SHA256SUMS

# Upload both
gh release upload node-smol-v1.2.0 SHA256SUMS SHA256SUMS.asc
```

### Verification in socket-cli

Socket CLI should verify downloaded binaries:

```typescript
// Download binary
const binaryPath = await downloadNodeBinary(version, platform, arch)

// Verify checksum (if provided)
if (ENV.SOCKET_CLI_NODE_BINARY_SHA256) {
  const actualHash = await sha256File(binaryPath)
  if (actualHash !== ENV.SOCKET_CLI_NODE_BINARY_SHA256) {
    throw new Error('Binary checksum mismatch')
  }
}
```

## Related Documentation

- [Node.js SEA Documentation](https://nodejs.org/api/single-executable-applications.html)
- [socket-btm README](../README.md)
- [Smol Builder Documentation](../packages/node-smol-builder/docs/sea-usage.md)
- [socket-cli SEA Build Process](https://github.com/SocketDev/socket-cli/blob/main/docs/sea-build-process.md)
