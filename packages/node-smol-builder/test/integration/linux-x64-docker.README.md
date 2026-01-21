# Linux-x64 Docker Integration Tests

Comprehensive integration tests for validating the linux-x64 Docker build pipeline.

## What This Tests

This test suite validates the complete linux-x64 build including:

1. **Node-smol Extraction**
   - Verifies node-smol extracts itself to `~/.socket/_dlx/<hash>/node`
   - Validates cache directory structure and permissions
   - Tests both compressed and uncompressed binary variants

2. **Basic Execution**
   - Tests `--version` command
   - Tests `--eval "console.log('hello world')"`
   - Verifies platform and architecture detection (linux/x64)
   - Validates Node.js version output

3. **SEA (Single Executable Application) Creation**
   - Tests SEA creation using `sea-config.json`
   - Validates binject injection process
   - Tests SEA execution without errors
   - Verifies `require('node:sea').isSea()` returns true

4. **SEA + VFS (Virtual File System)**
   - Tests dual injection of SEA and VFS blobs
   - Validates VFS file access at runtime
   - Tests tar.gz VFS archive handling

5. **Repacking Validation**
   - Tests multiple repack cycles
   - Verifies no extraction errors after repacking
   - Validates no segfaults or corruption
   - Tests stub integrity across multiple injections

6. **Build Artifacts**
   - Validates ELF binary format
   - Checks executable permissions
   - Verifies reasonable binary size

## Prerequisites

### Option 1: Using Depot (Recommended - 20x faster)

```bash
# Install depot
brew install depot/tap/depot

# Login to depot
depot login
```

### Option 2: Using Docker

```bash
# Install Docker Desktop
# Enable containerd image store for multi-platform builds

# Verify docker buildx is available
docker buildx version
```

## Running the Tests

### Quick Start

```bash
# Run with depot (fast)
pnpm --filter node-smol-builder test:linux-x64-docker

# Run with docker (slower)
pnpm --filter node-smol-builder test:linux-x64-docker --docker
```

### Test Variants

```bash
# glibc variant (default, AlmaLinux 8 with glibc 2.28)
pnpm --filter node-smol-builder test:linux-x64-docker:glibc

# musl variant (Alpine Linux)
pnpm --filter node-smol-builder test:linux-x64-docker:musl

# Production build mode
pnpm --filter node-smol-builder test:linux-x64-docker --prod

# Development build mode (default)
pnpm --filter node-smol-builder test:linux-x64-docker --dev
```

### Manual Test Execution

If you already have a built binary:

```bash
# Navigate to node-smol-builder
cd packages/node-smol-builder

# Run the specific test file
pnpm vitest run test/integration/linux-x64-docker.test.mjs
```

## Test Output

The tests will:

1. Build node-smol in Docker (linux/amd64)
2. Extract build artifacts to `packages/node-smol-builder/build/`
3. Run the integration test suite
4. Report pass/fail for each test case

### Expected Output

```
✓ Node-smol binary extraction and execution (5 tests)
  ✓ should extract node-smol to ~/.socket/_dlx/<hash>/node
  ✓ should execute --version successfully
  ✓ should execute --eval hello world
  ✓ should execute --eval with process info

✓ SEA creation with binject (2 tests)
  ✓ should create simple hello world SEA using sea-config.json
  ✓ should create SEA with VFS using sea-config.json

✓ Repacking verification (2 tests)
  ✓ should repack SEA without extraction/execution errors
  ✓ should handle multiple repack cycles without errors

✓ Build artifacts verification (3 tests)
  ✓ should have correct ELF binary format for linux-x64
  ✓ should be executable
  ✓ should have reasonable size

Test Files: 1 passed (1)
Tests: 12 passed (12)
```

## Troubleshooting

### Binary Not Found

If tests fail with "Binary not found":

```bash
# Build the binary first
cd packages/node-smol-builder
pnpm build --dev --platform=linux --arch=x64

# Or use the Docker build script
node scripts/test-linux-x64-docker.mjs
```

### Docker Build Fails

```bash
# Check Docker is running
docker ps

# Check buildx is available
docker buildx version

# Try with depot instead
depot build -f packages/node-smol-builder/docker/Dockerfile.glibc .
```

### Platform Mismatch Errors

The tests automatically detect if the binary is for linux-x64. If you're running on macOS or Windows, the Docker build will create a linux binary that can be tested in the container.

### Extraction Path Not Found

The extraction to `~/.socket/_dlx/<hash>/node` only happens for compressed binaries. Dev builds may be uncompressed and execute directly without extraction.

### SEA Injection Fails

Make sure binject is built:

```bash
cd packages/binject
pnpm build
```

### Segfault Exit Code 139

This indicates a critical issue with the binary. Check:
- Build logs for errors
- LIEF patch application
- Binary corruption during transfer

## CI/CD Integration

These tests are designed to run in CI/CD pipelines:

```yaml
- name: Build and test linux-x64
  run: |
    pnpm --filter node-smol-builder test:linux-x64-docker:glibc
```

## Test Structure

The test file is located at:
```
packages/node-smol-builder/test/integration/linux-x64-docker.test.mjs
```

Key helper functions:
- `getLatestFinalBinary()` - Finds the latest built binary
- `runBinject()` - Wrapper for binject CLI
- `calculateFileHash()` - Computes SHA-256 hash for cache key

## Related Documentation

- [Docker Build README](../../docker/README.md) - Docker build setup
- [E2E Tests](../e2e/e2e.test.mjs) - Complete build pipeline tests
- [SEA Tests](./sea.test.mjs) - SEA-specific integration tests
- [VFS Tests](./vfs.test.mjs) - VFS integration tests

## Support

If you encounter issues:

1. Check the build logs in the Docker output
2. Verify prerequisites are installed (Docker/Depot)
3. Ensure the workspace dependencies are installed (`pnpm install`)
4. Check that binject, binpress, and bin-infra are built
5. Review the test output for specific error messages
