# Node Smol Builder Tests

Test suite for the Node.js smol binary builder with SEA support and automatic Brotli compression.

## Test Files

### `package.test.mjs`

Package structure and configuration validation tests:
- Package.json metadata validation
- Build script presence and structure
- Documentation completeness
- Build directory structure

**Run**: `pnpm test package.test.mjs`

### `sea.test.mjs`

SEA (Single Executable Application) integration tests:
- Plain JavaScript blob generation (`.js`)
- Pre-compressed Brotli blob support (`.js.br`)
- Compression flag handling (`useCompression: true/false`)
- Hello-world execution tests
- Blob size comparisons
- Error handling

**Run**: `pnpm test sea.test.mjs`

**Prerequisites**: Requires built smol binary at `build/out/Final/node`
- Run `pnpm build` first to create the binary
- Tests are automatically skipped if binary doesn't exist

## Running Tests

```bash
# Run all tests
pnpm test

# Run specific test file
pnpm test package.test.mjs
pnpm test sea.test.mjs

# Watch mode
pnpm test:watch

# Run SEA tests (requires built binary)
pnpm build
pnpm test sea.test.mjs
```

## SEA Test Coverage

The SEA tests verify:

1. **Plain JavaScript Blob**:
   - Automatic Brotli compression (default)
   - Successful execution of hello-world
   - Output validation

2. **Pre-compressed Brotli Blob**:
   - Manual compression with `.js.br` format
   - Correct handling of pre-compressed input
   - Execution and output validation

3. **Compression Disabled**:
   - `useCompression: false` flag
   - Larger blob size without compression
   - Successful execution

4. **Compression Enabled Explicitly**:
   - `useCompression: true` flag (explicit)
   - Smaller blob size with compression
   - Successful execution

5. **Error Handling**:
   - Invalid sea-config.json
   - Missing JavaScript files
   - Graceful failure with error messages

## Test Structure

```
test/
├── README.md           # This file
├── package.test.mjs    # Package structure tests
└── sea.test.mjs        # SEA integration tests
```

## Test Artifacts

Test artifacts are created in the system temp directory (`os.tmpdir()/socket-btm-sea-tests/`) and automatically cleaned up after test runs:

```
/tmp/socket-btm-sea-tests/  (or %TEMP% on Windows)
├── hello-plain-js/
├── hello-brotli-blob/
├── hello-no-compression/
├── hello-compression-on/
├── invalid-config/
└── missing-js/
```

**Benefits**:
- No project pollution with test artifacts
- Automatic OS-level cleanup on reboot
- Works across all platforms (macOS, Linux, Windows)
- No gitignore needed for test artifacts

## CI/CD

These tests are designed to run in CI environments:
- Package tests run on every commit (fast, no build required)
- SEA tests run after successful binary builds (slower, requires build)
- Tests gracefully skip if prerequisites aren't met

## Debugging

To debug SEA tests:

```bash
# Build with verbose logging
pnpm build --verbose

# Check binary exists
ls -lh build/out/Final/node

# Run single SEA test
pnpm test sea.test.mjs -t "plain JavaScript blob"

# Inspect test artifacts (before cleanup runs)
ls -la $(node -e "console.log(require('os').tmpdir())")/socket-btm-sea-tests/

# Keep test artifacts for inspection
# Comment out the afterAll cleanup in sea.test.mjs
```

## Performance

- **Package tests**: ~100ms (no I/O)
- **SEA tests**: ~5-10 seconds (includes postject injection)
- **Total**: ~10 seconds with built binary

## Dependencies

- **vitest**: Test runner
- **@socketsecurity/lib**: Spawn utility for process execution
- **postject**: SEA blob injection (via npx, auto-installed)

## Known Issues

1. **postject Installation**: First run may be slower due to npx downloading postject
2. **Platform Differences**: SEA injection varies by platform (Mach-O, ELF, PE)
3. **Binary Size**: Tests assume binary is within expected size ranges

## Future Improvements

- [ ] Add Windows-specific tests (PE injection)
- [ ] Add Linux-specific tests (ELF injection)
- [ ] Test SMOL_SPEC marker in SEA binaries
- [ ] Test cache key calculation with different SEA blobs
- [ ] Benchmark compression ratios
- [ ] Test large JavaScript payloads (>10MB)
