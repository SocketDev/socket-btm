# smol-vfs.js -- Public API for the Virtual File System (node:smol-vfs)

## What This File Does

This is the entry point for `require('node:smol-vfs')`. It re-exports
everything from the internal VFS modules as a clean, frozen public API.
It also lazy-loads optional SQL storage providers (SQLite and PostgreSQL)
so they don't add startup cost when not used.

## How It Fits in the VFS System

This is the TOP of the module graph -- the file users import directly:
require('node:smol-vfs') -> this file (smol-vfs.js)
-> vfs/fs.js (unified API layer)
-> vfs/loader.js (parses the TAR blob, manages the VFS map)
-> vfs/tar_parser.js (TAR format parser)
-> internalBinding('smol_vfs') (C++ native binding in node_vfs.cc)

## Key Concepts

- VFS (Virtual File System): Files embedded inside the compiled Node.js
  binary at build time. At runtime, they appear under a virtual path
  prefix (default: /snapshot/). The VFS is read-only.
- SEA (Single Executable Application): A standalone binary that bundles
  Node.js + your app code + embedded files into one executable.
- Lazy loading: SQL providers are loaded only when first accessed via
  Object.defineProperty getters, so they don't slow down startup.

## Usage

```js
import vfs from 'node:smol-vfs'
// or: import { hasVFS, readFileSync, mount } from 'node:smol-vfs';

// Check if running as SEA with embedded files
if (vfs.hasVFS()) {
  // Get configuration
  const cfg = vfs.config()
  console.log(`VFS prefix: ${cfg.prefix}`) // '/snapshot'

  // Read embedded file
  const content = vfs.readFileSync('/snapshot/config.json', 'utf8')

  // List all embedded files
  const files = vfs.listFiles()
  const jsonFiles = vfs.listFiles({ extension: '.json' })

  // Extract native addon to real filesystem
  const realPath = vfs.mountSync('/snapshot/native/addon.node')

  // Extract directory (async, for large extractions)
  const assetsDir = await vfs.mount('/snapshot/assets/')

  // File descriptors (uses real kernel FDs via extraction)
  const fd = vfs.openSync('/snapshot/data.bin', 'r')
  const buf = Buffer.alloc(1024)
  vfs.readSync(fd, buf, 0, 1024, 0)
  vfs.closeSync(fd)
}
```

## Key Differences from node:vfs (Platformatic)

- Read-only: Files embedded at build time, cannot write
- Extract-on-demand: No global fs hijacking, explicit mount()
- SEA-focused: Native addon support, TAR archive format
- Real FDs: Uses real kernel file descriptors (not virtual FD simulation)
