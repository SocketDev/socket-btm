# WASM Sync Transforms

This document describes the WASM synchronous wrapper generation system used across socket-btm packages.

## Overview

The WASM sync transform system converts async ESM WebAssembly modules into synchronous CommonJS/ESM wrappers with embedded WASM binaries. This enables WASM modules to be loaded synchronously at Node.js startup.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    WASM SYNC TRANSFORM FLOW                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Input:                                                          │
│  ┌──────────────┐  ┌──────────────┐                             │
│  │  module.mjs  │  │  module.wasm │                             │
│  │  (async ESM) │  │  (binary)    │                             │
│  └──────┬───────┘  └──────┬───────┘                             │
│         │                 │                                      │
│         ▼                 ▼                                      │
│  ┌─────────────────────────────────────┐                        │
│  │         transform.mjs               │                        │
│  │  • Remove async/await               │                        │
│  │  • Remove imports/exports           │                        │
│  │  • Convert WebAssembly.instantiate  │                        │
│  │    to synchronous instantiation     │                        │
│  └──────────────┬──────────────────────┘                        │
│                 │                                                │
│        ┌───────┴───────┐                                        │
│        ▼               ▼                                        │
│  ┌───────────┐   ┌───────────┐                                  │
│  │ sync.cjs  │   │ sync.mjs  │                                  │
│  │ (CommonJS)│   │  (ESM)    │                                  │
│  │ + base64  │   │ + base64  │                                  │
│  │   WASM    │   │   WASM    │                                  │
│  └───────────┘   └───────────┘                                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Core Components

### File Structure

```
packages/build-infra/wasm-synced/
├── transform.mjs           # AST transformations (3-pass)
├── generate-sync-cjs.mjs   # CommonJS wrapper generator
├── generate-sync-esm.mjs   # ESM wrapper generator
├── generate-sync-phase.mjs # Build phase integration
└── wasm-sync-wrapper.mjs   # Unified wrapper generator

packages/build-infra/lib/
└── wasm-pipeline.mjs       # WASM optimization and build orchestration
```

### Transform Pipeline (3-Pass)

**Pass 1: Initial Replacements (CJS only)**
```javascript
// For CommonJS output only:
import.meta.url → __importMetaUrl
```

**Pass 2: AST-Based Transformations**
- Remove all `export` statements
- Remove all `import` statements
- Remove `async` keyword from function declarations
- Remove `await` expressions
- Replace `WebAssembly.instantiate()` calls
- Handle Promise patterns and chains
- Fix module declarations

**Pass 3: Synchronous Instantiation**

Identifies async wrapper functions and replaces with synchronous code:

```javascript
// Before (async):
async function instantiateWasm(imports) {
  const response = await fetch(wasmUrl);
  const bytes = await response.arrayBuffer();
  return WebAssembly.instantiate(bytes, imports);
}

// After (sync):
function instantiateWasm(imports) {
  var module = new WebAssembly.Module(wasmBinary);
  var instance = new WebAssembly.Instance(module, imports);
  return { instance: instance, module: module };
}
```

## Output Formats

### CommonJS Output (sync.cjs)

```javascript
'use strict';

// Polyfill import.meta.url for CommonJS
var __importMetaUrl = require('node:url').pathToFileURL(__filename).href;

// Embedded base64-encoded WASM binary
var base64Wasm = 'AGFzbQEAAAA...';

// Decode WASM binary
var wasmBinary = Uint8Array.from(atob(base64Wasm), c => c.charCodeAt(0));

// [Transformed glue code here]

// Export synchronously initialized module
module.exports = initFunctionName({ wasmBinary });
```

### ESM Output (sync.mjs)

```javascript
// Embedded base64-encoded WASM binary
const base64Wasm = 'AGFzbQEAAAA...';

// Decode WASM binary
const wasmBinary = Uint8Array.from(atob(base64Wasm), c => c.charCodeAt(0));

// [Transformed glue code here]

// Export synchronously initialized module
export default initFunctionName({ wasmBinary });
```

## Package Configurations

### ONNX Runtime Builder

```javascript
// packages/onnxruntime-builder/scripts/wasm-synced/shared/generate-sync.mjs
{
  description: 'Built with WASM threading + SIMD for synchronous instantiation.',
  expectedExports: 50,
  exportName: 'ort',
  fileBaseName: 'ort',
  initFunctionName: 'ortWasmThreaded',
  packageName: 'onnxruntime'
}
```

### Yoga Layout Builder

```javascript
// packages/yoga-layout-builder/scripts/wasm-synced/shared/generate-sync.mjs
{
  description: 'Built with aggressive size optimizations for synchronous instantiation.',
  expectedExports: buildMode => (buildMode === 'prod' ? 8 : 11),
  exportName: 'yoga',
  fileBaseName: 'yoga',
  initFunctionName: 'Module',
  packageName: 'yoga-layout'
}
```

## Build Integration

### Generate Sync Phase

The `generate-sync-phase.mjs` handles build integration:

1. **Checkpoint validation** - Check if rebuild needed
2. **Clean output directory** - Remove stale files
3. **Copy source files** - From Optimized (prod) or Release (dev)
4. **Generate wrappers** - Create sync.cjs and sync.mjs
5. **Smoke test** - Verify output:
   - File exists and not empty
   - Module loads with `require()`
   - Module is NOT a Promise (synchronous)
   - Export count matches expected
6. **Create checkpoint** - For build caching

### Smoke Test Validation

```javascript
// Verify synchronous loading
const module = require('./sync.cjs');

// Must NOT be a Promise
if (module instanceof Promise) {
  throw new Error('Module is async, expected sync');
}

// Verify expected exports
const exportCount = Object.keys(module).length;
if (exportCount !== expectedExports) {
  throw new Error(`Expected ${expectedExports} exports, got ${exportCount}`);
}
```

## WASM Pipeline

### Validation and Optimization

```javascript
// packages/build-infra/lib/wasm-pipeline.mjs

// Run wasm-opt with optimization flags
optimizeWasm(inputPath, outputPath, flags)
```

## Key Transformations

### WebAssembly.instantiate Conversion

```javascript
// Async pattern (input):
WebAssembly.instantiate(bytes, imports)
  .then(result => {
    instance = result.instance;
    module = result.module;
  });

// Sync pattern (output):
var module = new WebAssembly.Module(wasmBinary);
var instance = new WebAssembly.Instance(module, imports);
```

### Import/Export Removal

```javascript
// Input (ESM):
import { foo } from './bar.js';
export function baz() { ... }
export default init;

// Output (transformed):
// (imports removed, code inlined)
function baz() { ... }
// (exports handled by wrapper)
```

### Async/Await Removal

```javascript
// Input:
async function load() {
  const data = await fetch(url);
  return await process(data);
}

// Output:
function load() {
  const data = fetch(url);
  return process(data);
}
```

## Troubleshooting

### Module Still Async

If the smoke test fails with "Module is async":
- Check transform.mjs Pass 3 is identifying the init function
- Verify WebAssembly.instantiate calls are being replaced
- Ensure all async/await keywords are removed

### Export Count Mismatch

If export count doesn't match:
- Verify `expectedExports` config is correct for build mode
- Check if WASM was built with correct flags
- Ensure all exports are being exposed through wrapper

### WASM Validation Failed

If WASM magic number check fails:
- Verify source WASM file exists
- Check file isn't truncated
- Ensure wasm-opt didn't corrupt output

## Related Documentation

- [Caching Strategy](./caching-strategy.md) - Build checkpoint system
