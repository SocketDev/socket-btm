# build-infra

Shared build utilities for compiling from source.

## Exports

```javascript
// Command execution
import { exec, execCapture } from '@socketsecurity/build-infra/lib/build-exec'

// Build helpers
import { checkDiskSpace, smokeTestBinary } from '@socketsecurity/build-infra/lib/build-helpers'

// Pretty output
import { printHeader, printStep, printSuccess } from '@socketsecurity/build-infra/lib/build-output'

// CMake builder
import { CMakeBuilder } from '@socketsecurity/build-infra/lib/cmake-builder'

// Emscripten builder (C/C++ → WASM)
import { EmscriptenBuilder } from '@socketsecurity/build-infra/lib/emscripten-builder'

// Rust builder (Rust → WASM)
import { RustBuilder } from '@socketsecurity/build-infra/lib/rust-builder'

// Patch management
import { applyPatch, applyPatchDirectory } from '@socketsecurity/build-infra/lib/patch-validator'

// Checkpoint system
import { createCheckpoint, cleanCheckpoint, hasCheckpoint } from '@socketsecurity/build-infra/lib/checkpoint-manager'
```

## Usage

```javascript
import { CMakeBuilder } from '@socketsecurity/build-infra/lib/cmake-builder'

const cmake = new CMakeBuilder(sourceDir, buildDir)
await cmake.configure({ CMAKE_BUILD_TYPE: 'Release' })
await cmake.build({ parallel: true })
```

Used by: node-smol-builder, onnxruntime-builder, yoga-layout-builder, and model builders.
