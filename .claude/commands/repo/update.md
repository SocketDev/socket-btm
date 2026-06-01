# update - Update dependencies

Invoke the `updating-$ARGUMENTS` skill to update a dependency.

Usage: `/update <name>` (e.g., `/update node` invokes `updating-node`)

## Available Names

- `all` - Update everything (npm + all upstreams)
- `node` - Node.js submodule + patch regeneration
- `curl` - curl and mbedtls submodules
- `lief` - LIEF binary manipulation library
- `stubs` - Self-extracting stub binaries
- `binsuite` - Orchestrate LIEF + stubs updates
- `cjson` - cJSON library
- `libdeflate` - libdeflate compression library
- `zstd` - zstd compression library (Node.js deps lockstep)
- `onnxruntime` - ONNX Runtime ML engine
- `ink` - ink TUI framework
- `iocraft` - iocraft TUI library
- `yoga` - Yoga layout library
- `fast-webstreams` - Vendor fast-webstreams from npm
- `checksums` - Sync SHA-256 checksums from releases

## Routing

- `/update all` invokes the `updating` skill (no suffix)
- All others invoke `updating-<name>`
- Empty argument: list names and ask
- Unknown name: suggest closest match
