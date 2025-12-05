# Alpine Docker Build

Builds Node.js smol binaries for Alpine Linux (musl libc).

## Purpose

Alpine Linux uses musl instead of glibc, requiring Docker container builds.

## Requirements

- Docker with Buildx
- QEMU (for ARM64 cross-compilation)

## Usage

```bash
# Build for Alpine x64
docker buildx build --platform linux/amd64 -t node-smol-alpine:x64 .

# Build for Alpine ARM64
docker buildx build --platform linux/arm64 -t node-smol-alpine:arm64 .
```

## Workflow Integration

Triggered automatically by GitHub Actions for:
- `linux-musl-x64` platform
- `linux-musl-arm64` platform

Builds use cached layers for faster CI runs.
