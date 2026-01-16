# build-infra

Shared build utilities for compiling from source.

Used by: node-smol-builder, onnxruntime-builder, yoga-layout-builder, binject, binflate, binpress, and model builders.

## Key Modules

- `checkpoint-manager` - Build stage checkpoints
- `build-helpers` - Environment and file utilities
- `*-installer` - External tool installation (compiler, python, emscripten)
- `*-builder` - Build strategies (cmake, rust, emscripten, c-package)
- `constants` - Build stages, size limits, byte conversions
- `paths` - Standard directory structure
