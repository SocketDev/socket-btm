# Docker Build

Builds Node.js smol binaries for Linux (glibc and musl).

## Purpose

- **glibc builds**: Use AlmaLinux 8 (glibc 2.28) for maximum compatibility with older Linux distributions. This matches the Node.js project's official build environment (RHEL 8).
- **musl builds**: Use Alpine Linux 3.19 for musl libc builds.

## glibc Compatibility

By building on AlmaLinux 8 with GCC Toolset 13, we get:
- C++20 support (required by Node.js v24+)
- glibc 2.28 compatibility (works on Debian 10+, Ubuntu 20.04+, RHEL 8+, etc.)
- libstdc++ 6.0.25 compatibility (GLIBCXX_3.4.25)

This means the binaries will work on any Linux distribution with glibc 2.28 or later, instead of requiring glibc 2.34+ like Ubuntu 22.04 builds would.

## Setup

### Install Depot CLI (Recommended)

Depot provides 20x faster builds with native ARM64 support:

```bash
brew install depot/tap/depot
depot login
```

### Install Docker (Fallback)

```bash
# Install Docker Desktop or Docker Engine
# For multi-platform builds, enable containerd image store
```

## Local Builds

### Option 1: Depot (Fast, Recommended)

```bash
# Build glibc for current platform.
depot build -f packages/node-smol-builder/docker/Dockerfile.glibc-released .

# Build musl for current platform.
depot build -f packages/node-smol-builder/docker/Dockerfile.musl-released .

# Build multi-platform.
depot build -f packages/node-smol-builder/docker/Dockerfile.glibc-released \
  --platform linux/amd64,linux/arm64 \
  .
```

### Option 2: Docker (Slower)

```bash
# Build for x64.
docker buildx build --platform linux/amd64 \
  -f packages/node-smol-builder/docker/Dockerfile.glibc-released \
  -t node-smol-glibc:x64 \
  .

# Build for ARM64 (requires QEMU, very slow).
docker buildx build --platform linux/arm64 \
  -f packages/node-smol-builder/docker/Dockerfile.glibc-released \
  -t node-smol-glibc:arm64 \
  .

# Build multi-platform.
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -f packages/node-smol-builder/docker/Dockerfile.glibc-released \
  -t node-smol-glibc:latest \
  .
```

## CI/CD

### GitHub Actions

The `.github/workflows/docker-build.yml` workflow uses Depot for fast multi-platform builds:

- **OIDC Authentication**: No secrets required
- **Multi-platform**: Builds for `linux/amd64` and `linux/arm64` simultaneously
- **Native ARM64**: No QEMU emulation, 20x faster than docker buildx
- **Caching**: Uses GitHub Actions cache for faster rebuilds
- **Push to GHCR**: Automatically pushes to GitHub Container Registry

### Manual Trigger

Go to Actions → Docker Build → Run workflow:
- **Image name**: `node-smol-glibc` or `node-smol-musl`
- **Dockerfile**: `packages/node-smol-builder/docker/Dockerfile.glibc-released` or `Dockerfile.musl-released`
- **Context**: `.`
- **Push**: `true` to push to registry
- **Platforms**: `linux/amd64,linux/arm64`

### Workflow Integration

Triggered automatically by GitHub Actions for:
- `linux` platform with `libc: glibc` and `arch: x64`
- `linux` platform with `libc: glibc` and `arch: arm64`
- `linux` platform with `libc: musl` and `arch: x64`
- `linux` platform with `libc: musl` and `arch: arm64`

## Configuration

### depot.json

The Depot project ID is configured in `/depot.json`:

```json
{
  "id": "8fpj9495vw"
}
```

This allows the Depot CLI and GitHub Actions to automatically use the correct project.

## Benefits of Depot

- **20x faster builds**: Native cross-compilation instead of QEMU emulation
- **Multi-platform**: Build for ARM64 and AMD64 simultaneously
- **Persistent cache**: Cache survives between CI runs
- **Zero configuration**: Works with existing Dockerfiles
- **GitHub Actions integration**: Uses OIDC, no tokens needed

## Troubleshooting

### Depot CLI not found

```bash
brew install depot/tap/depot
```

### Authentication failed

```bash
depot login
```

### Slow builds with Docker

Consider using Depot instead. Docker buildx uses QEMU emulation for ARM64 which is 20x slower than Depot's native builds.

### glibc version errors

If you see errors like `GLIBC_2.34 not found`, the binary was built on a system with newer glibc. Rebuild using `Dockerfile.glibc-released` which uses AlmaLinux 8 (glibc 2.28) for maximum compatibility.
