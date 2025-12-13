# build-infra

Shared build utilities for compiling from source.

## Exports

```javascript
// Command execution
import { exec, execCapture } from 'build-infra/lib/build-exec'

// Build helpers
import { checkDiskSpace, smokeTestBinary } from 'build-infra/lib/build-helpers'

// Pretty output
import { printHeader, printStep, printSuccess } from 'build-infra/lib/build-output'

// CMake builder
import { CMakeBuilder } from 'build-infra/lib/cmake-builder'

// Emscripten builder (C/C++ → WASM)
import { EmscriptenBuilder } from 'build-infra/lib/emscripten-builder'

// Rust builder (Rust → WASM)
import { RustBuilder } from 'build-infra/lib/rust-builder'

// Patch management
import { applyPatch, applyPatchDirectory } from 'build-infra/lib/patch-validator'

// Checkpoint system
import { createCheckpoint, cleanCheckpoint, hasCheckpoint } from 'build-infra/lib/checkpoint-manager'
```

## Usage

```javascript
import { CMakeBuilder } from 'build-infra/lib/cmake-builder'

const cmake = new CMakeBuilder(sourceDir, buildDir)
await cmake.configure({ CMAKE_BUILD_TYPE: 'Release' })
await cmake.build({ parallel: true })
```

Used by: node-smol-builder, onnxruntime-builder, yoga-layout-builder, and model builders.
