# bin-infra

Shared infrastructure for binary tooling operations.

## Contents

- `src/` - Shared C source files for binary format handling, compression, and segment operations.
- `make/` - Shared Makefile includes for LIEF and binary infrastructure rules.

## Usage

Used by:
- **binject** - Binary injection tool.
- **binpress** - Binary compression.
- **binflate** - Binary decompression.
- **node-smol-builder** - Self-extracting stubs.

## License

MIT
