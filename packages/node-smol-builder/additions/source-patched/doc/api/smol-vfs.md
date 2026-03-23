# VFS

<!--introduced_in=v23.0.0-->

> Stability: 1 - Experimental

<!-- source_link=lib/smol-vfs.js -->

Virtual Filesystem for Single Executable Applications (SEA). Provides read-only
access to files embedded at build time, with support for native addons and
real kernel file descriptors.

```mjs
import vfs from 'node:smol-vfs';
// or
import { hasVFS, readFileSync, mount } from 'node:smol-vfs';
```

```cjs
const vfs = require('node:smol-vfs');
// or
const { hasVFS, readFileSync, mount } = require('node:smol-vfs');
```

## Overview

The VFS module provides access to files embedded in a Single Executable
Application (SEA). Key features:

* **Read-only**: Files are embedded at build time
* **Extract-on-demand**: Explicit `mount()` for files needing real paths
* **Real file descriptors**: Uses actual kernel FDs via extraction
* **Native addon support**: Automatic extraction and loading

## Core functions

### `hasVFS()`

<!-- YAML
added: v23.0.0
-->

* Returns: {boolean} `true` if running as SEA with embedded files.

Check if the VFS is available.

```mjs
import { hasVFS, readFileSync } from 'node:smol-vfs';

if (hasVFS()) {
  const config = readFileSync('/snapshot/config.json', 'utf8');
  console.log('Running as SEA with embedded config');
} else {
  console.log('Running as regular Node.js');
}
```

### `config()`

<!-- YAML
added: v23.0.0
-->

* Returns: {Object} VFS configuration.
  * `prefix` {string} VFS path prefix (e.g., `'/snapshot'`).
  * `size` {number} Total size of embedded files in bytes.

Get VFS configuration.

```mjs
const cfg = vfs.config();
console.log(`VFS prefix: ${cfg.prefix}`);
console.log(`Total size: ${cfg.size} bytes`);
```

### `prefix()`

<!-- YAML
added: v23.0.0
-->

* Returns: {string} The VFS path prefix.

### `size()`

<!-- YAML
added: v23.0.0
-->

* Returns: {number} Total size of embedded files in bytes.

### `canBuildSea()`

<!-- YAML
added: v23.0.0
-->

* Returns: {boolean} `true` if the current Node.js build supports SEA.

## File operations (sync)

These functions mirror the `node:fs` synchronous API for VFS paths.

### `existsSync(path)`

<!-- YAML
added: v23.0.0
-->

* `path` {string} VFS path to check.
* Returns: {boolean}

### `readFileSync(path[, options])`

<!-- YAML
added: v23.0.0
-->

* `path` {string} VFS path to read.
* `options` {Object|string}
  * `encoding` {string} Character encoding. **Default:** `null` (Buffer)
* Returns: {Buffer|string}

Read an embedded file.

```mjs
// Read as Buffer
const buffer = vfs.readFileSync('/snapshot/data.bin');

// Read as string
const json = vfs.readFileSync('/snapshot/config.json', 'utf8');
const config = JSON.parse(json);
```

### `statSync(path)`

<!-- YAML
added: v23.0.0
-->

* `path` {string} VFS path.
* Returns: {fs.Stats}

### `lstatSync(path)`

<!-- YAML
added: v23.0.0
-->

* `path` {string} VFS path.
* Returns: {fs.Stats}

### `readdirSync(path[, options])`

<!-- YAML
added: v23.0.0
-->

* `path` {string} VFS directory path.
* `options` {Object}
  * `withFileTypes` {boolean} Return `Dirent` objects. **Default:** `false`
* Returns: {string[]|fs.Dirent[]}

### `accessSync(path[, mode])`

<!-- YAML
added: v23.0.0
-->

* `path` {string} VFS path.
* `mode` {number} Access mode. **Default:** `fs.constants.F_OK`

### `realpathSync(path)`

<!-- YAML
added: v23.0.0
-->

* `path` {string} VFS path.
* Returns: {string} Resolved path.

### `readlinkSync(path)`

<!-- YAML
added: v23.0.0
-->

* `path` {string} VFS symbolic link path.
* Returns: {string} Link target.

## File descriptor operations

These functions use real kernel file descriptors by extracting files to a
temporary location.

### `openSync(path, flags)`

<!-- YAML
added: v23.0.0
-->

* `path` {string} VFS path.
* `flags` {string|number} File open flags (`'r'`, etc.).
* Returns: {number} File descriptor.

Opens a VFS file and returns a real file descriptor.

```mjs
const fd = vfs.openSync('/snapshot/data.bin', 'r');
const buffer = Buffer.alloc(1024);
vfs.readSync(fd, buffer, 0, 1024, 0);
vfs.closeSync(fd);
```

### `readSync(fd, buffer, offset, length, position)`

<!-- YAML
added: v23.0.0
-->

* `fd` {number} File descriptor from `openSync()`.
* `buffer` {Buffer} Buffer to read into.
* `offset` {number} Offset in buffer to start writing.
* `length` {number} Number of bytes to read.
* `position` {number|null} Position in file to read from.
* Returns: {number} Bytes read.

### `closeSync(fd)`

<!-- YAML
added: v23.0.0
-->

* `fd` {number} File descriptor to close.

### `fstatSync(fd)`

<!-- YAML
added: v23.0.0
-->

* `fd` {number} File descriptor.
* Returns: {fs.Stats}

### `isVfsFd(fd)`

<!-- YAML
added: v23.0.0
-->

* `fd` {number} File descriptor.
* Returns: {boolean} `true` if FD is from VFS.

### `getVfsPath(fd)`

<!-- YAML
added: v23.0.0
-->

* `fd` {number} File descriptor.
* Returns: {string|undefined} Original VFS path.

### `getRealPath(fd)`

<!-- YAML
added: v23.0.0
-->

* `fd` {number} File descriptor.
* Returns: {string|undefined} Extracted file's real path.

## Async operations

### `promises`

<!-- YAML
added: v23.0.0
-->

Promise-based API matching `node:fs/promises`.

```mjs
import { promises as vfsPromises } from 'node:smol-vfs';

const content = await vfsPromises.readFile('/snapshot/config.json', 'utf8');
const files = await vfsPromises.readdir('/snapshot/assets');
```

## Streams

### `createReadStream(path[, options])`

<!-- YAML
added: v23.0.0
-->

* `path` {string} VFS path.
* `options` {Object} Stream options.
* Returns: {fs.ReadStream}

Create a readable stream from a VFS file.

```mjs
import { createReadStream } from 'node:smol-vfs';
import { createWriteStream } from 'node:fs';

const src = createReadStream('/snapshot/large-file.bin');
const dst = createWriteStream('/tmp/extracted.bin');
src.pipe(dst);
```

## VFS-specific operations

### `listFiles([options])`

<!-- YAML
added: v23.0.0
-->

* `options` {Object}
  * `extension` {string} Filter by file extension. **Optional.**
  * `prefix` {string} Filter by path prefix. **Optional.**
* Returns: {string[]} Array of VFS paths.

List all embedded files.

```mjs
// All files
const allFiles = vfs.listFiles();

// Only JSON files
const jsonFiles = vfs.listFiles({ extension: '.json' });

// Only files in /snapshot/assets/
const assets = vfs.listFiles({ prefix: '/snapshot/assets/' });
```

### `mount(path)`

<!-- YAML
added: v23.0.0
-->

* `path` {string} VFS path to extract.
* Returns: {Promise<string>} Real filesystem path.

Extracts a VFS file or directory to a temporary location, returning the real
path. Use for files that need a real filesystem path (e.g., native addons,
external tools).

```mjs
// Extract a single file
const realPath = await vfs.mount('/snapshot/native/addon.node');

// Extract a directory
const assetsDir = await vfs.mount('/snapshot/assets/');
```

### `mountSync(path)`

<!-- YAML
added: v23.0.0
-->

* `path` {string} VFS path to extract.
* Returns: {string} Real filesystem path.

Synchronous version of `mount()`.

```mjs
const addonPath = vfs.mountSync('/snapshot/native/addon.node');
const addon = require(addonPath);
```

## Native addon support

### `handleNativeAddon(path)`

<!-- YAML
added: v23.0.0
-->

* `path` {string} VFS path to native addon.
* Returns: {string} Real path to extracted addon.

Extracts and prepares a native addon for loading.

```mjs
const addonPath = vfs.handleNativeAddon('/snapshot/native/binding.node');
const binding = require(addonPath);
```

### `isNativeAddon(path)`

<!-- YAML
added: v23.0.0
-->

* `path` {string} File path.
* Returns: {boolean} `true` if path is a native addon (`.node` extension).

## Constants

### `MODE_COMPAT`

<!-- YAML
added: v23.0.0
-->

Compatibility mode - uses real filesystem when available.

### `MODE_IN_MEMORY`

<!-- YAML
added: v23.0.0
-->

In-memory mode - keeps extracted files in memory.

### `MODE_ON_DISK`

<!-- YAML
added: v23.0.0
-->

On-disk mode - extracts files to temporary directory.

## Error handling

### Class: `VFSError`

<!-- YAML
added: v23.0.0
-->

Error class for VFS-related errors.

* `code` {string} Error code (e.g., `'ENOENT'`, `'EACCES'`)
* `path` {string} VFS path that caused the error

```mjs
import { readFileSync, VFSError } from 'node:smol-vfs';

try {
  readFileSync('/snapshot/nonexistent.txt');
} catch (err) {
  if (err instanceof VFSError && err.code === 'ENOENT') {
    console.log(`File not found: ${err.path}`);
  }
}
```

## Debugging

### `getCacheStats()`

<!-- YAML
added: v23.0.0
-->

* Returns: {Object} Cache statistics.
  * `extractedFiles` {number} Number of files extracted to disk.
  * `openDescriptors` {number} Currently open file descriptors.
  * `cacheSize` {number} Size of in-memory cache.

## Example: SEA application

```mjs
import { hasVFS, readFileSync, mount, listFiles } from 'node:smol-vfs';

if (!hasVFS()) {
  console.error('This application must be run as a SEA');
  process.exit(1);
}

// Load embedded configuration
const config = JSON.parse(
  readFileSync('/snapshot/config.json', 'utf8')
);

// List all embedded templates
const templates = listFiles({
  prefix: '/snapshot/templates/',
  extension: '.html'
});
console.log(`Found ${templates.length} templates`);

// Extract assets directory for external tool
const assetsDir = await mount('/snapshot/assets/');
console.log(`Assets extracted to: ${assetsDir}`);

// Load native addon
import { handleNativeAddon } from 'node:smol-vfs';
const binding = require(handleNativeAddon('/snapshot/native/crypto.node'));
```

## Comparison with `node:sea`

| Feature | `node:sea` | `node:smol-vfs` |
|---------|-----------|-----------------|
| Get assets | `sea.getAsset()` | `readFileSync()` |
| Asset as buffer | `sea.getAssetAsBlob()` | `readFileSync()` |
| Raw buffer | `sea.getRawAsset()` | `readFileSync()` |
| File listing | Not available | `listFiles()` |
| Directory reading | Not available | `readdirSync()` |
| File descriptors | Not available | `openSync()`, etc. |
| Streams | Not available | `createReadStream()` |
| Native addons | Manual | `handleNativeAddon()` |
| Extraction | Manual | `mount()`, `mountSync()` |
