# iocraft-builder

Native Node.js bindings for the [iocraft](https://github.com/ccbrown/iocraft) TUI library via napi-rs.

## Overview

This package builds iocraft (a React-like declarative TUI framework for Rust) as a native Node.js addon, enabling polished terminal user interfaces in Node.js applications with:

- Flexbox layouts (via taffy)
- Mouse support
- Keyboard input handling
- Rich text styling and colors
- Component-based architecture

## Build

```bash
pnpm run build        # Build with checkpoints
pnpm run build:force  # Force rebuild
```

## Usage

The built `.node` file is consumed by socket-cli for TUI rendering.
