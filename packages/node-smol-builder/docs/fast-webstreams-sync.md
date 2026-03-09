# Fast WebStreams ESM-to-CJS Sync

This document describes the fast-webstreams vendor sync system that converts ESM modules to CommonJS for Node.js internal use.

## Overview

The `experimental-fast-webstreams` package provides optimized WebStreams implementations. Since Node.js internals require CommonJS format and primordials protection, this sync system converts the ESM source to compatible CommonJS modules.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│              FAST-WEBSTREAMS SYNC FLOW                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Source:                                                         │
│  node_modules/experimental-fast-webstreams/                      │
│  ├── index.js       (ESM)                                        │
│  ├── readable.js    (ESM)                                        │
│  ├── writable.js    (ESM)                                        │
│  ├── transform.js   (ESM)                                        │
│  ├── writer.js      (ESM)                                        │
│  └── patch.js       (ESM)                                        │
│              │                                                   │
│              ▼                                                   │
│  ┌─────────────────────────────────────────┐                    │
│  │            sync.mjs                      │                    │
│  │  • Convert imports to require()          │                    │
│  │  • Convert exports to module.exports     │                    │
│  │  • Fix circular dependencies             │                    │
│  │  • Add primordials protection            │                    │
│  └─────────────────────────────────────────┘                    │
│              │                                                   │
│              ▼                                                   │
│  Destination:                                                    │
│  additions/source-patched/deps/fast-webstreams/                  │
│  ├── index.js       (CJS)                                        │
│  ├── readable.js    (CJS)                                        │
│  ├── writable.js    (CJS)                                        │
│  ├── transform.js   (CJS)                                        │
│  ├── writer.js      (CJS)                                        │
│  └── patch.js       (CJS)                                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## File Locations

```
packages/node-smol-builder/
├── scripts/vendor-fast-webstreams/
│   ├── sync.mjs        # ESM to CJS conversion
│   └── validate.mjs    # Integration validation
└── additions/source-patched/deps/fast-webstreams/
    ├── index.js        # Generated CJS output
    ├── readable.js
    ├── writable.js
    ├── transform.js
    ├── writer.js
    └── patch.js
```

## Transform Details

### Module Path Conversion

Relative ESM imports are converted to Node.js internal paths:

```javascript
// Input (ESM):
import { FastReadableStream } from './readable.js';

// Output (CJS):
const { FastReadableStream } = require('internal/deps/fast-webstreams/readable');
```

### Import Conversion

```javascript
// Named imports:
// import { X, Y } from './file'
// →
const { X, Y } = require('internal/deps/fast-webstreams/file');

// Default imports:
// import Module from './file'
// →
const Module = require('internal/deps/fast-webstreams/file');
```

### Export Conversion

```javascript
// Named exports:
// export const X = value;
// export function Y() {}
// →
const X = value;
function Y() {}
// ... at end of file:
exports.X = X;
exports.Y = Y;

// Re-exports:
// export { X, Y } from './file'
// →
const _reexport_0 = require('internal/deps/fast-webstreams/file');
exports.X = _reexport_0.X;
exports.Y = _reexport_0.Y;
```

## Circular Dependency Fixes

### patch.js Circular Fix

**Problem:** `patch.js` imports from `index.js`, but `index.js` re-exports from `patch.js`.

```javascript
// Original (circular):
const { FastReadableStream, FastWritableStream, FastTransformStream } =
  require('internal/deps/fast-webstreams/index');

// Fixed (direct imports):
const { FastReadableStream } = require('internal/deps/fast-webstreams/readable');
const { FastTransformStream } = require('internal/deps/fast-webstreams/transform');
const { FastWritableStream } = require('internal/deps/fast-webstreams/writable');
```

### writer.js / writable.js Circular Fix

**Problem:** `writable.js` imports from `writer.js`, and `writer.js` imports from `writable.js`.

**Solution:** Lazy evaluation - access exports at runtime, not at module load.

```javascript
// Original (eager, causes circular):
const { _getDesiredSize, _isWritableStreamLocked } =
  require('internal/deps/fast-webstreams/writable');

// Usage:
_getDesiredSize(stream);

// Fixed (lazy):
const _writable = require('internal/deps/fast-webstreams/writable');

// Usage (deferred access):
_writable._getDesiredSize(stream);
```

## Primordials Protection

Promise methods are replaced with primordials to protect against prototype pollution:

```javascript
// Standard JavaScript:
Promise.resolve(value)
Promise.reject(error)
new Promise(executor)
Promise.all(promises)

// Primordials (prototype-safe):
PromiseResolve(value)
PromiseReject(error)
new SafePromise(executor)
SafePromiseAllReturnVoid(promises)
```

### Primordials Header

Each converted file includes:

```javascript
const {
  PromiseResolve,
  PromiseReject,
  SafePromise,
  SafePromiseAllReturnVoid,
  // ... other primordials
} = primordials;
```

## Validation

The `validate.mjs` script tests fast-webstreams integration in the built binary:

### Test Coverage

| Test | Description |
|------|-------------|
| Global patching | ReadableStream, WritableStream, TransformStream defined |
| ReadableStream | Basic readable stream functionality |
| WritableStream | Basic writable stream functionality |
| TransformStream | Basic transform stream functionality |
| pipeTo | Stream piping between readable and writable |
| pipeThrough | Transform stream piping |
| Byte streams | BYOB reader support |
| Tee | Concurrent stream draining |
| Response integration | Fetch Response body streams |
| Async iteration | `for await...of` support |

### Running Validation

```bash
# After building node-smol
./build/dev/out/Final/node/node scripts/vendor-fast-webstreams/validate.mjs
```

## Usage

### Sync Command

```bash
# Sync from node_modules to additions/
pnpm --filter node-smol-builder run sync:fast-webstreams
```

### Manual Sync

```bash
node packages/node-smol-builder/scripts/vendor-fast-webstreams/sync.mjs
```

## Internal Module Access

In the built Node.js binary, fast-webstreams is accessible via internal require:

```javascript
// In Node.js internals:
const { FastReadableStream } = require('internal/deps/fast-webstreams/readable');
const { FastWritableStream } = require('internal/deps/fast-webstreams/writable');
const { FastTransformStream } = require('internal/deps/fast-webstreams/transform');

// Patch global WebStreams:
const { patchGlobals } = require('internal/deps/fast-webstreams/patch');
patchGlobals(globalThis);
```

## Troubleshooting

### Circular Dependency Errors

If you see `ReferenceError: Cannot access 'X' before initialization`:

1. Check if new circular imports were introduced
2. Apply lazy evaluation pattern (require module, access properties at runtime)
3. Re-run sync and rebuild

### Primordials Errors

If you see `X is not a function` for Promise methods:

1. Verify primordials header is present
2. Check spelling matches Node.js primordials
3. Ensure SafePromise variants are used correctly

### Stream Test Failures

If validation tests fail:

1. Check if upstream fast-webstreams changed API
2. Verify sync completed successfully
3. Run with `--trace-warnings` for more details

## Related Documentation

- [Build System](./build-system.md) - Build pipeline overview
- [Patch System](./patch-system.md) - Source patching
- [Source Packages](./source-packages.md) - Package architecture
