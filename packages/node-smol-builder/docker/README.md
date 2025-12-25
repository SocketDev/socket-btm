# Alpine Docker Build

Builds Node.js smol binaries for Alpine Linux (musl libc).

## Purpose

Alpine Linux uses musl instead of glibc, requiring Docker container builds.

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
# Build for current platform.
depot build -f packages/node-smol-builder/docker/Dockerfile.musl .

# Build multi-platform.
depot build -f packages/node-smol-builder/docker/Dockerfile.musl \
  --platform linux/amd64,linux/arm64 \
  .

# Build and push to registry.
depot build -f packages/node-smol-builder/docker/Dockerfile.musl \
  --platform linux/amd64,linux/arm64 \
  --push \
  -t ghcr.io/socketdev/node-smol-musl:latest \
  .
```

### Option 2: Docker (Slower)

```bash
# Build for Alpine x64.
docker buildx build --platform linux/amd64 \
  -f packages/node-smol-builder/docker/Dockerfile.musl \
  -t node-smol-alpine:x64 \
  .

# Build for Alpine ARM64 (requires QEMU, very slow).
docker buildx build --platform linux/arm64 \
  -f packages/node-smol-builder/docker/Dockerfile.musl \
  -t node-smol-alpine:arm64 \
  .

# Build multi-platform.
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -f packages/node-smol-builder/docker/Dockerfile.musl \
  -t node-smol-alpine:latest \
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
- **Image name**: `node-smol-musl`
- **Dockerfile**: `packages/node-smol-builder/docker/Dockerfile.musl`
- **Context**: `.`
- **Push**: `true` to push to registry
- **Platforms**: `linux/amd64,linux/arm64`

### Workflow Integration

Triggered automatically by GitHub Actions for:
- `linux-musl-x64` platform
- `linux-musl-arm64` platform

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
