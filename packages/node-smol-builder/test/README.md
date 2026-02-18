# Tests

Test suite for node-smol-builder.

## Test Organization

```
test/
├── unit/              # Fast, isolated tests
├── integration/       # Component interaction tests
└── e2e/               # Full pipeline tests
```

## Running Tests

```bash
pnpm test              # Run all tests
pnpm test:unit         # Unit tests only
pnpm test:integration  # Integration tests only
pnpm test:e2e          # E2E tests only
pnpm test:watch        # Watch mode
```

## Unit Tests

Fast tests with no external dependencies:

- `package.test.mjs` - Package structure validation
- `postjected.test.mjs` - C++ compression tools validation

## Integration Tests

Tests requiring built binary (`build/{dev,prod}/out/Final/node/`):

- `sea.test.mjs` - SEA (Single Executable Application) integration
- `vfs.test.mjs` - VFS (Virtual Filesystem) integration
  - SEA fuse injection
  - TAR/TAR.GZ archive handling
  - Dual resource injection (NODE_SEA_BLOB + CUSTOM_VFS_BLOB)
  - VFS extraction to `~/.socket/_dlx/<sha256-hash>/`
  - Path validation and hash format verification
- `compression-extraction.test.mjs` - Binary compression extraction
  - Decompression to `~/.socket/_dlx/<sha512-16chars>/`
  - Cache hit detection and `.dlx-metadata.json` validation
  - LZFSE compression algorithm
  - Content-addressable caching (matches dlxBinary pattern)

## E2E Tests

Complete build pipeline tests:

- `e2e.test.mjs` - Full application build and deployment
  - SEA + VFS dual injection
  - VFS cache extraction and validation
  - Binary compression integration
  - Cross-platform compatibility

## Prerequisites

Integration and E2E tests require a built binary:

```bash
pnpm build  # Build binary first
pnpm test   # Then run tests
```
