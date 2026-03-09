# How to Inject SEA and VFS Resources

Step-by-step guide for injecting Single Executable Application (SEA) and Virtual Filesystem (VFS) resources into Node.js binaries.

## Prerequisites

- Built `binject` binary: `packages/binject/build/dev/out/Final/binject`
- Node.js binary to inject into
- SEA blob (compiled JavaScript) or sea-config.json
- VFS source (directory, .tar, or .tar.gz) - optional

## Basic SEA Injection

### 1. Create SEA Blob

Create `sea-config.json`:

```json
{
  "main": "app.js",
  "output": "app.blob"
}
```

Generate blob:

```bash
node --experimental-sea-config sea-config.json
```

### 2. Inject into Binary

```bash
# Copy Node.js binary
cp $(which node) myapp

# Inject SEA blob
binject inject -e myapp -o myapp --sea app.blob

# Test
./myapp  # Runs your app.js
```

## SEA + VFS Injection

### From Directory

```bash
# Inject SEA and VFS from directory
binject inject -e node -o myapp --sea app.blob --vfs ./assets
```

### From TAR Archive

```bash
# Create TAR archive
tar -cvf assets.tar assets/

# Inject
binject inject -e node -o myapp --sea app.blob --vfs assets.tar
```

### From Compressed TAR

```bash
# Create compressed archive
tar -czvf assets.tar.gz assets/

# Inject (auto-detects format)
binject inject -e node -o myapp --sea app.blob --vfs assets.tar.gz
```

## Using sea-config.json

### Basic Config

```json
{
  "main": "app.js",
  "output": "app.blob",
  "disableExperimentalSEAWarning": true
}
```

```bash
# Auto-generate blob and inject
binject inject -e node -o myapp --sea-config sea-config.json
```

### Config with VFS

```json
{
  "main": "app.js",
  "output": "app.blob",
  "vfs": {
    "source": "./assets",
    "mode": "in-memory"
  }
}
```

```bash
binject inject -e node -o myapp --sea-config sea-config.json
```

### VFS Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| `in-memory` | Extract to memory | Small files, fast access |
| `on-disk` | Extract to temp dir | Large files, standard fs |
| `compat` | API only | No files, just API |

```json
{
  "vfs": {
    "source": "./data",
    "mode": "on-disk",
    "compression": "gzip"
  }
}
```

## SMOL Stub Injection

For SMOL-compressed stubs, binject handles extraction and repacking:

```bash
# Inject into SMOL stub (auto-detected)
binject inject -e node-smol -o myapp-compressed --sea app.blob --vfs assets/
```

Flow:
1. Detect SMOL compression
2. Extract to cache (`~/.socket/_dlx/`)
3. Inject resources
4. Re-compress with LZFSE
5. Repack into stub

### Skip Repack (Development)

```bash
# Modify cached binary only, don't repack
binject inject -e node-smol -o myapp-dev --sea app.blob --skip-repack
```

Output is uncompressed (~60 MB), faster for iteration.

## CLI Reference

### Required Flags

```bash
binject inject -e <input> -o <output> --sea <blob>
binject inject -e <input> -o <output> --sea-config <json>
```

### Optional Flags

| Flag | Description |
|------|-------------|
| `--vfs <path>` | VFS source (dir, .tar, .tar.gz) |
| `--vfs-in-memory` | Force in-memory VFS mode |
| `--vfs-on-disk` | Force on-disk VFS mode |
| `--skip-repack` | Don't recompress SMOL stubs |
| `--verbose` | Enable debug output |

### Examples

```bash
# SEA only
binject inject -e node -o myapp --sea app.blob

# SEA + VFS directory
binject inject -e node -o myapp --sea app.blob --vfs ./assets

# SEA + VFS with mode override
binject inject -e node -o myapp --sea app.blob --vfs ./assets --vfs-on-disk

# From sea-config.json
binject inject -e node -o myapp --sea-config sea-config.json

# SMOL stub, skip repack for dev
binject inject -e node-smol -o myapp --sea app.blob --skip-repack
```

## Re-injection (Overwrite)

binject automatically handles re-injection:

```bash
# First injection
binject inject -e node -o myapp --sea v1.blob

# Update with new version (auto-overwrites)
binject inject -e myapp -o myapp --sea v2.blob
```

Flow for re-injection:
1. Detect existing NODE_SEA segment
2. Skip fuse flip (already done)
3. Remove existing segments
4. Add new segments
5. Re-sign (macOS)

## Verifying Injection

### Check Sections

```bash
# macOS
otool -l myapp | grep -A 5 NODE_SEA

# Linux
readelf -S myapp | grep node_sea

# Cross-platform (with LIEF)
python3 -c "import lief; b=lief.parse('myapp'); print([s.name for s in b.sections])"
```

### Test Execution

```bash
# Run injected app
./myapp

# Check if SEA is active
./myapp -e "console.log(require('node:sea').isSea())"
# Output: true
```

## Troubleshooting

### "NODE_SEA segment already exists"

Binary already has SEA injected. binject handles this automatically.

### "Failed to flip NODE_SEA_FUSE"

Input is not a Node.js binary or fuse was already flipped.

### "codesign failed" (macOS)

```bash
# Sign manually
codesign --sign - --force myapp
```

### "Cannot stat extracted binary" (SMOL)

Cache issue during repack. Clear cache:

```bash
rm -rf ~/.socket/_dlx/
```

### VFS Not Found at Runtime

Check VFS mode matches your access pattern:
- `in-memory`: Use `node:sea` API
- `on-disk`: Use standard `fs` module
- `compat`: Only API available, no files

## Next Steps

- [Debug Injection Issues](debug-injection.md) - Troubleshooting
- [Binary Format Specs](../../../bin-infra/docs/binary-formats.md) - Technical details
