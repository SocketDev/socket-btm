# VFS Runtime API Documentation

## Overview

The VFS (Virtual File System) provides runtime APIs for accessing files bundled in the SEA (Single Executable Application) binary. These APIs are available via the `process.smol` namespace.

## API Reference

### `process.smol.mount(vfsPath, options)`

Extract a file or directory from VFS to the real filesystem.

**Introduced**: Node-smol 0.x.x (directory support added in 0.x.x)

#### Signature

```typescript
function mount(vfsPath: string, options?: MountOptions): string
```

#### Parameters

**`vfsPath`** (string, required)
- Path to file or directory in VFS
- Format: `/snapshot/node_modules/<package>/<file>`
- VFS prefix (`/snapshot`) configurable via `NODE_VFS_PREFIX` environment variable
- Supports both Unix-style (`/`) and Windows-style (`\`) path separators
- Trailing slashes optional for directories

**`options`** (object, optional)
- `targetPath` (string): Custom extraction path (overrides default cache directory)

#### Return Value

Returns the absolute path to the extracted file or directory on the real filesystem.

**Extraction location** (when `targetPath` not specified):
- `~/.socket/_dlx/<hash>/<relative-path>`
- Hash is SHA-256 of VFS blob (first 16 hex chars)
- Files are cached - subsequent calls return cached path without re-extraction

#### Path Normalization

The `mount()` function automatically normalizes paths for cross-platform compatibility:

1. **Backslash to forward slash conversion**: `\\snapshot\\node_modules\\foo` → `/snapshot/node_modules/foo`
2. **Trailing slash removal**: `/snapshot/node_modules/foo/` → `/snapshot/node_modules/foo`

All these path variations work identically:
```javascript
process.smol.mount('/snapshot/node_modules/foo')      // Unix-style
process.smol.mount('/snapshot/node_modules/foo/')     // Unix with trailing slash
process.smol.mount('\\snapshot\\node_modules\\foo')   // Windows-style
process.smol.mount('\\snapshot\\node_modules\\foo\\') // Windows with trailing slash
```

#### File Extraction

Extract a single file from VFS:

```javascript
// Extract a single file
const configPath = process.smol.mount('/snapshot/node_modules/my-app/config.json')
const config = require('fs').readFileSync(configPath, 'utf8')

// Extract a native addon
const addonPath = process.smol.mount('/snapshot/node_modules/better-sqlite3/build/Release/better_sqlite3.node')
const addon = require(addonPath)
```

#### Directory Extraction (Recursive)

Extract an entire directory tree with all files and subdirectories:

```javascript
// Extract entire package directory
const pkgDir = process.smol.mount('/snapshot/node_modules/lodash')

// All files in the directory are extracted recursively:
// - lodash/package.json
// - lodash/index.js
// - lodash/fp/curry.js
// - lodash/fp/flow.js
// - ... (all files and subdirectories)

// You can now require files from the extracted directory
const lodash = require(pkgDir)
```

**Directory extraction features**:
- **Recursive**: Extracts all files and subdirectories automatically
- **Cached**: Subsequent calls return same directory without re-extraction
- **Efficient**: Only extracts files not already in cache
- **Structure preserved**: Maintains directory hierarchy exactly as in VFS

#### Custom Extraction Path

Override the default cache location:

```javascript
// Extract to custom location
const customPath = '/tmp/my-extracted-files/config.json'
process.smol.mount('/snapshot/node_modules/app/config.json', {
  targetPath: customPath
})

// File is now at /tmp/my-extracted-files/config.json
```

**Note**: Custom paths bypass caching - file is always extracted to the specified location.

#### Error Handling

The `mount()` function throws errors for various failure conditions:

**File/Directory Not Found in VFS**:
```javascript
try {
  process.smol.mount('/snapshot/node_modules/nonexistent')
} catch (err) {
  // VFS Error: File not found in VFS: /snapshot/node_modules/nonexistent
  //   Expected path format: /snapshot/node_modules/<package>/<file>
  //   Hint: Use DEBUG=smol:vfs:verbose to list all available VFS files
}
```

**Invalid VFS Path (Security Violation)**:
```javascript
try {
  process.smol.mount('/snapshot/node_modules/../../etc/passwd')
} catch (err) {
  // VFS Error: Path traversal detected
  //   Attempted path: /snapshot/node_modules/../../etc/passwd
  //   Resolved to: ../../etc/passwd
  //   This is a security violation - paths must stay within VFS root
}
```

**Extraction Failure (Filesystem Issues)**:
```javascript
try {
  process.smol.mount('/snapshot/node_modules/package')
} catch (err) {
  // VFS Error: Failed to extract directory file
  //   VFS path: /snapshot/node_modules/package/index.js
  //   Extraction mode: on-disk
  //   Error: ENOSPC: no space left on device
  //   Hint: Try NODE_VFS_MODE=in-memory if filesystem is read-only
}
```

#### Performance Characteristics

**File Extraction**:
- **First call**: Extracts file from VFS (~1-5ms for typical files)
- **Subsequent calls**: Returns cached path instantly (~0.1ms)
- **Memory**: Minimal (file content briefly in memory during extraction)

**Directory Extraction**:
- **First call**: Extracts all files recursively (time scales with file count)
- **Subsequent calls**: Returns cached directory instantly
- **Memory**: Files extracted sequentially (not loaded into memory simultaneously)
- **Disk space**: Proportional to total size of directory contents

**Caching behavior**:
- Files remain cached for the lifetime of the process
- Cache directory: `~/.socket/_dlx/<hash>/`
- Hash ensures different VFS contents get separate cache directories
- No automatic cleanup (manual cleanup required if disk space is a concern)

#### Debugging

Enable verbose VFS logging to see extraction details:

```bash
DEBUG=smol:vfs:verbose node your-app.js
```

Output shows:
- VFS initialization
- File lookups (hits and misses)
- Extraction operations
- Cache directory paths
- All available VFS files (when enabled)

List all files in VFS:
```bash
DEBUG=smol:vfs:verbose node -e "process.smol.mount('/snapshot/node_modules/package')" 2>&1 | grep "VFS file:"
```

## Environment Variables

### `NODE_VFS_PREFIX`

Override the VFS path prefix (default: `/snapshot`).

**Example**:
```bash
NODE_VFS_PREFIX=/virtual node app.js
```

Now paths use `/virtual` instead of `/snapshot`:
```javascript
process.smol.mount('/virtual/node_modules/lodash')  // Works
process.smol.mount('/snapshot/node_modules/lodash') // Error: not found
```

**Use cases**:
- Custom VFS namespaces for multiple embedded filesystems
- Avoiding conflicts with application-specific paths
- Testing VFS behavior with different prefixes

### `NODE_VFS_MODE`

Control VFS extraction mode at runtime (overrides sea-config.json setting).

**Values**:
- `in-memory` - Keep files in memory (default)
- `on-disk` - Extract to temporary directory
- `compat` - VFS APIs available but no files bundled

**Example**:
```bash
NODE_VFS_MODE=in-memory node app.js  # Fast access, uses RAM
NODE_VFS_MODE=on-disk node app.js    # Disk-based, saves RAM
```

## Use Cases

### Native Addons

Load native addons (`.node` files) that require filesystem access:

```javascript
// VFS contains: node_modules/better-sqlite3/build/Release/better_sqlite3.node
const addonPath = process.smol.mount('/snapshot/node_modules/better-sqlite3/build/Release/better_sqlite3.node')
const Database = require(addonPath)

const db = new Database(':memory:')
```

**Why mount?** Native addons must be loaded from real files (not virtual paths).

### Configuration Files

Extract configuration files for libraries that expect filesystem paths:

```javascript
// VFS contains: node_modules/my-app/config/prod.json
const configPath = process.smol.mount('/snapshot/node_modules/my-app/config/prod.json')
const config = JSON.parse(require('fs').readFileSync(configPath, 'utf8'))
```

### Executable Scripts

Extract and execute scripts that must run from real files:

```javascript
// VFS contains: node_modules/my-tool/bin/cli.js
const cliPath = process.smol.mount('/snapshot/node_modules/my-tool/bin/cli.js')
require('child_process').spawnSync('node', [cliPath, '--help'])
```

### Package Directories

Extract entire packages for libraries with complex filesystem dependencies:

```javascript
// VFS contains: node_modules/puppeteer/ (entire directory tree)
const puppeteerDir = process.smol.mount('/snapshot/node_modules/puppeteer')

// Puppeteer expects to find:
// - node_modules/puppeteer/lib/
// - node_modules/puppeteer/.local-chromium/
// - node_modules/puppeteer/DeviceDescriptors.js
// All files extracted recursively

const puppeteer = require(puppeteerDir)
```

**When to use directory extraction**:
- Package has many interdependent files
- Package uses `__dirname` or `__filename` internally
- Package expects to read files relative to its root
- Manual extraction of individual files would be tedious

## Security Considerations

### Path Traversal Prevention

The `mount()` function prevents path traversal attacks:

```javascript
// These all throw "Path traversal detected" errors:
mount('/snapshot/node_modules/../../etc/passwd')
mount('/snapshot/node_modules/pkg/../../../etc/passwd')
mount('/snapshot/../etc/passwd')
```

**Defense in depth**:
1. Path normalization converts backslashes to forward slashes
2. Relative path calculation checks for `..` segments
3. VFS path validation ensures paths stay within VFS root
4. VFS lookup fails for paths outside bundled files

### VFS Path Validation

Only paths within the configured VFS prefix are allowed:

```javascript
// Default prefix: /snapshot/node_modules

mount('/snapshot/node_modules/lodash')  // ✅ Allowed
mount('/snapshot/custom/tool')          // ❌ Rejected (not under node_modules)
mount('/other/path/file.js')            // ❌ Rejected (not under /snapshot)
```

**Rationale**: Prevents accessing files outside the intended VFS namespace.

### Extraction Safety

Files are extracted with safe permissions:
- **Directories**: Created with `recursive: true` (mkdirSync)
- **Files**: Written with default permissions (no executable bit unless originally set)
- **Symlinks**: Not supported in VFS (TAR archives contain regular files only)

### Cache Directory Security

Extracted files are cached in user-specific directory:
- **Location**: `~/.socket/_dlx/<hash>/`
- **Permissions**: Inherit from user's home directory
- **Isolation**: Each VFS content hash gets separate cache directory

**Recommendations**:
- Ensure `~/.socket/_dlx/` has appropriate permissions (user-only read/write)
- Periodically clean old cache directories to save disk space
- In multi-user systems, each user gets isolated cache

## Troubleshooting

### "File not found in VFS" Error

**Symptom**:
```
VFS Error: File not found in VFS: /snapshot/node_modules/package/index.js
  Expected path format: /snapshot/node_modules/<package>/<file>
  Hint: Use DEBUG=smol:vfs:verbose to list all available VFS files
```

**Causes**:
1. File not included in VFS archive during build
2. Wrong VFS path (typo, wrong prefix, wrong package name)
3. Custom VFS prefix set via `NODE_VFS_PREFIX`

**Solutions**:
1. List all VFS files: `DEBUG=smol:vfs:verbose node -e ""`
2. Check VFS archive contents: `tar -tzf vfs.tar.gz | grep package`
3. Verify VFS prefix: `console.log(process.env.NODE_VFS_PREFIX || '/snapshot')`
4. Rebuild VFS with correct files included

### "Path traversal detected" Error

**Symptom**:
```
VFS Error: Path traversal detected
  Attempted path: /snapshot/node_modules/../../etc/passwd
```

**Cause**: Path contains `..` segments that would escape VFS root.

**Solution**: Use absolute VFS paths without `..` segments.

### Extraction Fails Silently

**Symptom**: `mount()` returns path, but files don't exist at that location.

**Causes**:
1. In-memory mode selected but files expected on disk
2. Custom `targetPath` used without directory creation
3. Filesystem permissions prevent write

**Solutions**:
1. Use `NODE_VFS_MODE=on-disk` for filesystem-dependent operations
2. Create parent directories before using custom `targetPath`
3. Check filesystem permissions and available space

## Implementation Notes

### VFS Path Resolution

The VFS uses two path formats internally:

1. **User-facing API paths**: `/snapshot/node_modules/package/file.js`
   - Used by `process.smol.mount()` and related APIs
   - Includes VFS prefix (`/snapshot` by default)
   - Configurable via `NODE_VFS_PREFIX`

2. **Internal VFS paths**: `node_modules/package/file.js`
   - Used for VFS archive lookups
   - Relative to VFS root (no prefix)
   - Matches TAR archive structure

**Conversion happens in `toVFSPath()` function**:
- Strips VFS prefix from user path
- Returns relative path for archive lookup
- Falls back to `process.execPath`-relative paths for backwards compatibility

### Caching Strategy

**Cache key**: SHA-256 hash of VFS blob (first 16 hex characters)

**Cache structure**:
```
~/.socket/_dlx/
  ├── abc123def4567890/           # Cache for VFS blob with hash abc123...
  │   ├── node_modules/
  │   │   ├── lodash/
  │   │   │   ├── index.js
  │   │   │   └── ...
  │   │   └── express/
  │   │       └── ...
  │   └── .dlx-metadata.json      # Cache metadata
  └── fedcba9876543210/           # Cache for different VFS blob
      └── ...
```

**Cache metadata** (`.dlx-metadata.json`):
```json
{
  "version": "1",
  "cache_key": "abc123def4567890",
  "timestamp": 1234567890123,
  "source": {
    "type": "vfs",
    "path": "/path/to/binary"
  }
}
```

**Cache invalidation**:
- New VFS content → new hash → new cache directory
- No automatic cleanup (manual deletion required)
- Cache persists across process restarts

### Extraction Providers

Three extraction strategies (configurable via `NODE_VFS_MODE`):

1. **On-Disk Provider** (default)
   - Extracts files to `~/.socket/_dlx/<hash>/`
   - Persistent cache across process restarts
   - Suitable for all use cases

2. **In-Memory Provider**
   - Keeps files in memory (no disk writes)
   - Returns temporary file paths (via `memfs` or similar)
   - Faster but uses more RAM
   - Cache lost on process exit

3. **Compat Provider**
   - VFS APIs available but no files bundled
   - Used for development builds
   - All operations return errors

## Related Documentation

- [VFS Configuration Guide](./vfs-configuration-plan.md) - Configure VFS in sea-config.json
- [SEA Documentation](../README.md) - Single Executable Application overview
- [Binject CLI](../packages/binject/README.md) - Build tool for creating SEA binaries

## Changelog

### 0.x.x (Latest)
- **Added**: Recursive directory extraction support for `mount()`
- **Fixed**: Path normalization handles backslashes and trailing slashes correctly
- **Fixed**: `toVFSPath()` now handles `/snapshot/` prefix paths
- **Fixed**: Return path no longer hardcoded to `node_modules`
- **Improved**: Better error messages with context and hints

### 0.x.x (Previous)
- **Added**: Initial `process.smol.mount()` API for single files
- **Added**: VFS extraction providers (on-disk, in-memory, compat)
- **Added**: Native addon support via automatic extraction
