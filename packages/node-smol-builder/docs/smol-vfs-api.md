# node:smol-vfs - Virtual Filesystem for SEA Apps

A read-only embedded filesystem for Single Executable Applications (SEA). This module lets your standalone executable access bundled files without needing them on disk.

## What is VFS?

**VFS** (Virtual File System) is a way to bundle files directly inside your executable. When you build a SEA (Single Executable Application), you can include config files, templates, assets, or even native modules. These files are stored in a TAR archive format embedded in the binary.

**Key concept**: VFS files are read-only and embedded at build time. You cannot write to VFS paths.

## Quick Start

```javascript
import vfs from 'node:smol-vfs';

// Check if running as SEA with embedded files
if (vfs.hasVFS()) {
  // Read an embedded config file
  const config = vfs.readFileSync('/snapshot/config.json', 'utf8');
  console.log(JSON.parse(config));

  // List all embedded files
  const files = vfs.listFiles();
  console.log('Embedded files:', files);
}
```

## When to Use

Use `node:smol-vfs` when you need to:
- Access bundled files from a SEA application
- Load native addons (`.node` files) that are embedded
- Read configuration or template files packaged with your app

## API Reference

### Checking VFS State

#### `hasVFS()`
Returns `true` if running as a SEA with embedded files.

```javascript
if (vfs.hasVFS()) {
  console.log('Running as SEA with embedded files');
} else {
  console.log('Running as normal Node.js');
}
```

#### `config()`
Returns VFS configuration object.

```javascript
const cfg = vfs.config();
// { prefix: '/snapshot', mode: 'on-disk', ... }
```

#### `prefix()`
Returns the VFS mount prefix (default: `/snapshot`).

```javascript
const p = vfs.prefix();  // '/snapshot'
```

#### `size()`
Returns the total size of embedded files in bytes.

```javascript
const bytes = vfs.size();
console.log(`VFS contains ${bytes} bytes`);
```

#### `canBuildSea()`
Returns `true` if this Node.js binary supports SEA building.

### Reading Files

#### `readFileSync(path, options?)`
Read an embedded file synchronously. Works like `fs.readFileSync`.

```javascript
// Read as Buffer
const buffer = vfs.readFileSync('/snapshot/data.bin');

// Read as string
const text = vfs.readFileSync('/snapshot/readme.txt', 'utf8');

// With options object
const json = vfs.readFileSync('/snapshot/config.json', { encoding: 'utf8' });
```

#### `existsSync(path)`
Check if a path exists in VFS.

```javascript
if (vfs.existsSync('/snapshot/config.json')) {
  // File exists
}
```

#### `statSync(path)`
Get file stats (size, isDirectory, etc.).

```javascript
const stats = vfs.statSync('/snapshot/data.bin');
console.log(`Size: ${stats.size} bytes`);
console.log(`Is directory: ${stats.isDirectory()}`);
```

#### `readdirSync(path, options?)`
List directory contents.

```javascript
// Simple list
const files = vfs.readdirSync('/snapshot/assets');

// With file types
const entries = vfs.readdirSync('/snapshot', { withFileTypes: true });
for (const entry of entries) {
  console.log(entry.name, entry.isDirectory() ? 'DIR' : 'FILE');
}
```

### Listing Files

#### `listFiles(options?)`
List all embedded files with optional filtering.

```javascript
// All files
const all = vfs.listFiles();

// Filter by extension
const jsonFiles = vfs.listFiles({ extension: '.json' });

// Filter by prefix
const assets = vfs.listFiles({ prefix: '/snapshot/assets/' });
```

### Extracting Files (Mounting)

VFS files are embedded in the binary. To use them with native modules or external tools, you need to extract them to the real filesystem.

#### `mountSync(vfsPath, options?)`
Extract a VFS file or directory to disk synchronously. Returns the real filesystem path.

```javascript
// Extract a native addon
const realPath = vfs.mountSync('/snapshot/native/addon.node');
const addon = require(realPath);

// Extract to specific location
const path = vfs.mountSync('/snapshot/data.txt', {
  destPath: '/tmp/my-data.txt'
});
```

#### `mount(vfsPath, options?)`
Extract asynchronously (for large files or directories).

```javascript
const assetsDir = await vfs.mount('/snapshot/assets/');
console.log('Assets extracted to:', assetsDir);
```

### File Descriptors

VFS provides real kernel file descriptors by extracting files on-demand.

#### `openSync(path, flags?)`
Open a VFS file and get a real file descriptor.

```javascript
const fd = vfs.openSync('/snapshot/data.bin', 'r');
```

#### `readSync(fd, buffer, offset, length, position)`
Read from a file descriptor.

```javascript
const fd = vfs.openSync('/snapshot/data.bin', 'r');
const buf = Buffer.alloc(1024);
const bytesRead = vfs.readSync(fd, buf, 0, 1024, 0);
vfs.closeSync(fd);
```

#### `fstatSync(fd)`
Get file stats from a file descriptor.

#### `closeSync(fd)`
Close a file descriptor.

### Utility Functions

#### `isVfsFd(fd)`
Check if a file descriptor is from VFS.

```javascript
if (vfs.isVfsFd(fd)) {
  console.log('This FD is from VFS');
}
```

#### `getVfsPath(fd)`
Get the VFS path for a file descriptor.

#### `getRealPath(fd)`
Get the real filesystem path (after extraction) for a file descriptor.

### Streams

#### `createReadStream(path, options?)`
Create a readable stream for a VFS file.

```javascript
const stream = vfs.createReadStream('/snapshot/large-file.bin');
stream.pipe(process.stdout);
```

### Async Operations

#### `promises`
Promise-based versions of file operations.

```javascript
const content = await vfs.promises.readFile('/snapshot/config.json', 'utf8');
const stats = await vfs.promises.stat('/snapshot/data.bin');
const files = await vfs.promises.readdir('/snapshot');
```

### Native Addon Support

#### `handleNativeAddon(path)`
Handle loading a native addon from VFS. Extracts if needed.

```javascript
const addonPath = vfs.handleNativeAddon('/snapshot/native/better_sqlite3.node');
const sqlite = require(addonPath);
```

#### `isNativeAddon(path)`
Check if a path is a native addon (`.node` file).

### Error Class

#### `VFSError`
Custom error class for VFS operations.

```javascript
try {
  vfs.readFileSync('/snapshot/nonexistent.txt');
} catch (err) {
  if (err instanceof vfs.VFSError) {
    console.log('VFS error:', err.code);  // 'ENOENT'
  }
}
```

Error codes:
- `ENOENT` - File not found
- `EISDIR` - Tried to read a directory as a file
- `ENOTDIR` - Tried to list a file as a directory
- `EROFS` - Tried to write (VFS is read-only)
- `EINVAL` - Invalid argument

### Constants (VFS Modes)

```javascript
vfs.MODE_ON_DISK   // Extract files to disk (default)
vfs.MODE_IN_MEMORY // Keep files in memory
vfs.MODE_COMPAT    // Compatibility mode
```

## Common Patterns

### Loading Configuration

```javascript
import vfs from 'node:smol-vfs';

let config;
if (vfs.hasVFS()) {
  // SEA mode: read from embedded files
  config = JSON.parse(vfs.readFileSync('/snapshot/config.json', 'utf8'));
} else {
  // Development mode: read from disk
  config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
}
```

### Loading Native Addons

```javascript
import vfs from 'node:smol-vfs';

let sqlite;
if (vfs.hasVFS()) {
  const path = vfs.handleNativeAddon('/snapshot/better_sqlite3.node');
  sqlite = require(path);
} else {
  sqlite = require('better-sqlite3');
}
```

### Processing Embedded Assets

```javascript
import vfs from 'node:smol-vfs';

if (vfs.hasVFS()) {
  const templates = vfs.listFiles({ extension: '.html' });
  for (const tmpl of templates) {
    const content = vfs.readFileSync(tmpl, 'utf8');
    // Process template...
  }
}
```

## Differences from Platformatic's node:vfs

| Feature | node:smol-vfs | node:vfs (Platformatic) |
|---------|---------------|-------------------------|
| Write support | No (read-only) | Yes |
| File format | TAR archive | Custom |
| fs hijacking | No (explicit mount) | Yes (global override) |
| File descriptors | Real kernel FDs | Virtual FD simulation |
| Native addons | Full support | Limited |
| Focus | SEA applications | General VFS |

## Tips

1. **Always check `hasVFS()`** before using VFS methods in code that runs both in development and production.

2. **Use `mountSync()` for native addons** - they must be on the real filesystem to load.

3. **VFS paths start with the prefix** (default `/snapshot`) - use `vfs.prefix()` to get it.

4. **Errors include familiar codes** like `ENOENT` and `EISDIR` just like regular Node.js `fs` errors.
