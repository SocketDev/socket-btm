# binject

Alternative to [postject](https://github.com/nodejs/postject) for binary resource injection.

## Features

- Inject resources into executables (Mach-O, ELF, PE)
- Built-in compression support
- List, extract, and verify embedded resources
- Simple Makefile build system

## Setup

First-time setup requires downloading the LIEF library:

```bash
# Download and install LIEF (one-time setup, ~22MB download)
./scripts/setup-lief.mjs

# Build binject
make
```

## Usage

```bash
# Inject resource into binary
binject inject -e ./node -r app.js -s NODE_JS_CODE

# List embedded resources
binject list ./node

# Extract resource
binject extract -e ./node -s NODE_JS_CODE -o app.js

# Run tests
make test
```

## Dependencies

- **LIEF** (0.17.1): C++ library for binary manipulation
  - Automatically downloaded by `setup-lief.sh`
  - Not included in repository (35MB per platform)
  - See `external-tools.json` for details

## Architecture

- Mach-O injection uses LIEF library (like postject)
- Creates `__BINJECT` segment (vs postject's `__POSTJECT`)
- ELF and PE support planned

## License

MIT
