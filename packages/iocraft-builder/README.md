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
pnpm --filter iocraft-builder run build        # dev build, incremental via checkpoints
pnpm --filter iocraft-builder run build:force  # force rebuild from scratch
```

First time only: install the Rust toolchain (`cargo` + `rustup`) — the postinstall probes for it and will fail early if missing.

Output: `build/<mode>/<platform-arch>/out/Final/iocraft.<platform-arch>.node` (native Node-API addon, consumed by socket-cli).
