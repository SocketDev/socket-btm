# WPT (Web Platform Tests) Validation

Validates fast-webstreams integration against the WHATWG Streams specification using the official Web Platform Tests.

## Quick Start

```bash
# Run WPT validation (requires built binary)
node scripts/vendor-fast-webstreams/wpt/validate.mjs

# Force re-fetch WPT tests
node scripts/vendor-fast-webstreams/wpt/validate.mjs --fetch

# Filter to specific test area
node scripts/vendor-fast-webstreams/wpt/validate.mjs --filter=readable-streams

# Verbose output (show all error details)
node scripts/vendor-fast-webstreams/wpt/validate.mjs --verbose
```

## Pass Rate

| Implementation | Passed | Failed | Pass Rate |
|----------------|--------|--------|-----------|
| Native Node 25 | 1099 | 17 | 98.5% |
| fast-webstreams | 1099 | 17 | 98.5% |

fast-webstreams matches native Node 25's pass rate exactly.

## Output Legend

- `✓` (green) - All tests in file pass
- `~` (yellow) - Expected failures only (known issues, matches native)
- `✗` (red) - Unexpected failures (regressions)

## Expected Failures

The 17 failures are tracked in `validate.mjs` as `EXPECTED_FAILURES`. These match native Node 25's failures:

### owning type not implemented (5 tests)

The `owning` stream type is a newer WHATWG spec extension not yet implemented in Node.js.

```
readable-streams/owning-type.any.js
  - ReadableStream can be constructed with owning type
  - ReadableStream of type owning should call start with a ReadableStreamDefaultController
  - ReadableStream should be able to call enqueue with an empty transfer list
  - ReadableStream should check transfer parameter
  - ReadableStream of type owning should transfer enqueued chunks
```

### Tee monkey-patching (7 tests)

WPT tests replace `globalThis.ReadableStream` with a throwing fake and expect `tee()` not to use the global constructor. Fast's `tee()` implementation references the patched global internally, causing failures when tests monkey-patch it.

```
readable-streams/tee.any.js
  - ReadableStream teeing
  - ReadableStreamTee should not pull more chunks than can fit in the branch queue
  - ReadableStreamTee should only pull enough to fill the emptiest queue
  - ReadableStreamTee should not pull when original is already errored
  - ReadableStreamTee stops pulling when original stream errors while branch 1 is reading
  - ReadableStreamTee stops pulling when original stream errors while branch 2 is reading
  - ReadableStreamTee stops pulling when original stream errors while both branches are reading
```

### AsyncIteratorPrototype cross-realm (1 test)

VM context isolation causes cross-realm prototype mismatch. The async iterator's prototype doesn't match the expected `AsyncIteratorPrototype` when running in an isolated VM context.

```
readable-streams/async-iterator.any.js
  - Async iterator instances should have the correct list of properties
```

### BYOB cancel edge cases (2 tests)

Byte stream edge cases with cancel propagation behavior.

```
readable-byte-streams/templated.any.js
  - ReadableStream with byte source (empty) BYOB reader: canceling via the reader should cause the reader to act closed

readable-byte-streams/bad-buffers-and-views.any.js
  - (file-level runner error)
```

### Subclassing (1 test)

Subclassing Fast streams doesn't fully preserve extra methods on the subclass. When constructing a subclass, fast-webstreams returns a `FastReadableStream` instance instead of the subclass instance.

```
readable-streams/general.any.js
  - Subclassing ReadableStream should work
```

## How It Works

1. **Sparse checkout**: WPT `streams/` directory is fetched on-demand from the WPT repo at a pinned SHA (tracked in `.gitmodules`)

2. **Subprocess execution**: Each test file runs as a subprocess inside the built binary, ensuring tests run against the patched fast-webstreams (not native Node.js streams)

3. **Test harness**: `run-file.mjs` provides a WPT testharness.js polyfill with `test()`, `promise_test()`, `async_test()`, and all assertion functions

4. **Expected failures tracking**: Failures are compared against `EXPECTED_FAILURES` map to distinguish regressions from known issues

## Files

| File | Purpose |
|------|---------|
| `validate.mjs` | Main WPT runner with expected failures tracking |
| `run-file.mjs` | Subprocess runner with testharness.js polyfill |
| `streams/` | WPT test files (git-ignored, fetched on demand) |
| `.wpt-version` | Current WPT SHA for cache invalidation |

## Updating Expected Failures

When the output shows:

```
✨ Tests that now PASS (update expected failures list):
  - readable-streams/tee.any.js:SomeTest
```

Remove the passing test from `EXPECTED_FAILURES` in `validate.mjs`.

When the output shows:

```
❌ UNEXPECTED failures (regressions):
  - readable-streams/foo.any.js: NewFailingTest
```

Either fix the regression or add it to `EXPECTED_FAILURES` with a reason.

## CI Integration

The validation exits with:
- **Code 0**: All failures are expected (matches native Node 25)
- **Code 1**: Unexpected failures detected (regressions)

This allows CI to catch regressions while accepting known limitations.
