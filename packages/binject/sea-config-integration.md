# Smol Config Integration Guide

## Overview

Binject now automatically embeds smol configuration when injecting SEA blobs from `sea-config.json` files. The configuration is extracted from the `smol` section of `sea-config.json` and serialized to a 1176-byte SMFG binary format.

## Configuration Format

### sea-config.json with smol section

```json
{
  "output": "sea-blob.bin",
  "main": "index.js",
  "smol": {
    "fakeArgvEnv": "SMOL_FAKE_ARGV",
    "update": {
      "binname": "my-cli",
      "command": "self-update",
      "url": "https://api.github.com/repos/user/repo/releases",
      "tag": "v*",
      "skipEnv": "MY_CLI_SKIP_UPDATE_CHECK",
      "interval": 86400000,
      "notifyInterval": 86400000,
      "prompt": false,
      "promptDefault": "n"
    }
  }
}
```

### Field Descriptions

**Root `smol` fields:**
- `fakeArgvEnv` (string, optional): Environment variable name for controlling fake argv behavior. Default: `"SMOL_FAKE_ARGV"`
- `vfs` (boolean or object, optional): VFS (Virtual File System) configuration. See VFS Configuration section below.

**Nested `update` fields:**
- `binname` (string, max 127 chars): Binary name for update notifications
- `command` (string, max 254 chars): Command shown in update notifications. Default: `"self-update"`
- `url` (string, max 510 chars): GitHub releases API URL for update checking
- `tag` (string, max 127 chars): Release tag pattern for matching (supports globs)
- `skipEnv` (string, max 63 chars): Environment variable to disable update checking
- `interval` (number): Update check interval in milliseconds. Default: `86400000` (24 hours)
- `notifyInterval` (number): Notification interval in milliseconds. Default: `86400000` (24 hours)
- `prompt` (boolean): Whether to show interactive update prompts. Default: `false`
- `promptDefault` (string): Default prompt response: `"y"` or `"n"`. Default: `"n"`

## VFS Configuration

The `vfs` field in the `smol` section configures the Virtual File System that will be embedded in the SEA binary.

### Configuration Formats

**Minimal (boolean shorthand)**:
```json
{
  "smol": {
    "vfs": true
  }
}
```
This uses default values: `mode: "in-memory"`, `source: "node_modules"`.

**Empty object (same as boolean shorthand)**:
```json
{
  "smol": {
    "vfs": {}
  }
}
```

**Full configuration**:
```json
{
  "smol": {
    "vfs": {
      "mode": "on-disk",
      "source": "dist/vfs.tar.gz"
    }
  }
}
```

**Disable VFS**:
```json
{
  "smol": {
    "vfs": false
  }
}
```
Or simply omit the `vfs` field entirely.

### VFS Field Descriptions

**`mode`** (string, optional): VFS extraction mode. Default: `"in-memory"`
- `"in-memory"` - Keep VFS in memory at runtime (no disk extraction)
- `"on-disk"` - Extract VFS to temporary directory at runtime
- `"compat"` - Enable VFS APIs without bundling files (compatibility mode)

**`source`** (string, optional): Path to VFS source. Default: `"node_modules"`
- Can be a directory path (will be archived and compressed automatically)
- Can be a `.tar` file (will be compressed with gzip level 9)
- Can be a `.tar.gz` or `.tgz` file (used as-is)
- Relative paths are resolved from the sea-config.json directory

### VFS Source Types

**Directory source**:
```json
{
  "vfs": {
    "mode": "on-disk",
    "source": "node_modules"
  }
}
```
Binject will automatically create a tar.gz archive from the directory with gzip level 9 compression.

**TAR source**:
```json
{
  "vfs": {
    "mode": "in-memory",
    "source": "dist/vfs.tar"
  }
}
```
Binject will compress the .tar file with gzip level 9.

**TAR.GZ source**:
```json
{
  "vfs": {
    "mode": "on-disk",
    "source": "dist/vfs.tar.gz"
  }
}
```
Binject will use the compressed archive as-is.

### CLI Flag Override

CLI flags always take precedence over sea-config.json settings:

```bash
# This overrides any vfs config in sea-config.json
binject inject -e node-smol -o output --sea sea-config.json --vfs my-vfs.tar.gz

# This also overrides the config
binject inject -e node-smol -o output --sea sea-config.json --vfs-compat
```

Priority order:
1. CLI flags (`--vfs`, `--vfs-in-memory`, `--vfs-on-disk`, `--vfs-compat`)
2. sea-config.json `smol.vfs` section

### Examples

**Minimal config with defaults**:
```json
{
  "output": "sea-blob.bin",
  "main": "index.js",
  "smol": {
    "vfs": true
  }
}
```
Uses: mode = "in-memory", source = "node_modules"

**Embed node_modules on disk**:
```json
{
  "output": "sea-blob.bin",
  "main": "index.js",
  "smol": {
    "vfs": {
      "mode": "on-disk",
      "source": "node_modules"
    }
  }
}
```

**Embed pre-built archive in memory**:
```json
{
  "output": "sea-blob.bin",
  "main": "index.js",
  "smol": {
    "vfs": {
      "mode": "in-memory",
      "source": "build/vfs.tar.gz"
    }
  }
}
```

**Compatibility mode (no files bundled)**:
```json
{
  "output": "sea-blob.bin",
  "main": "index.js",
  "smol": {
    "vfs": {
      "mode": "compat"
    }
  }
}
```

### VFS Code References

**VFS configuration parsing**:
- `packages/binject/src/json_parser.h` - VFS config structure and parsing
- `packages/binject/src/json_parser.c` - `parse_vfs_config()` implementation
- `packages/binject/src/vfs_utils.h` - VFS utility functions
- `packages/binject/src/vfs_utils.c` - Archive creation and compression

**VFS processing in main.c**:
- `packages/binject/src/main.c` - VFS config integration in inject command

## Binary Format (SMFG)

**Total size**: 1176 bytes

**Structure**:
1. **Header** (8 bytes):
   - Magic: 4 bytes (`0x534D4647` = "SMFG")
   - Version: 2 bytes (currently `1`)
   - Prompt flag: 1 byte (`0` or `1`)
   - Prompt default: 1 byte (`'y'` or `'n'`)

2. **Numeric values** (16 bytes):
   - Interval: 8 bytes (int64, little-endian)
   - Notify interval: 8 bytes (int64, little-endian)

3. **String fields** (1152 bytes):
   - Binname: 128 bytes (1-byte length prefix + 127 data bytes)
   - Command: 256 bytes (2-byte length prefix + 254 data bytes)
   - URL: 512 bytes (2-byte length prefix + 510 data bytes)
   - Tag: 128 bytes (1-byte length prefix + 127 data bytes)
   - Skip env: 64 bytes (1-byte length prefix + 63 data bytes)
   - Fake argv env: 64 bytes (1-byte length prefix + 63 data bytes)

## Integration with binject

### Automatic Embedding

When you run:
```bash
binject inject -e node-smol -o output --sea sea-config.json
```

Binject automatically:
1. Parses `sea-config.json` using cJSON
2. Extracts the `smol` section (if present)
3. Serializes it to 1176-byte SMFG binary format
4. Embeds it in the compressed stub metadata

### No JavaScript Dependencies

All JSON parsing and binary serialization is done in pure C:
- **Parser**: `src/json_parser.c` (uses cJSON library)
- **Serializer**: `src/smol_config.c` (generates SMFG binary)

### Runtime Behavior

At runtime, the compressed stub:
1. Reads the embedded SMFG config from binary metadata
2. Deserializes it into `update_config_t` struct
3. Sets `SMOL_FAKE_ARGV_NAME` environment variable (tells bootstrap which variable to check)
4. Sets the configured fake argv control variable (e.g., `SMOL_FAKE_ARGV`)
5. Passes update config to update checker

The JavaScript bootstrap code:
1. Reads `SMOL_FAKE_ARGV_NAME` to determine which env var to check
2. Checks that variable's value (`0`/`false` = disable, `1`/`true` = enable, empty = auto)
3. Cleans up ephemeral environment variables after bootstrap

## Migration from --update-config

The `--update-config` flag has been **removed**. To migrate:

### Before (old approach):
```bash
binject inject -e node-smol -o output --sea sea-blob.bin --update-config update-config.json
```

### After (new approach):
Add the `smol` section to your `sea-config.json`:
```json
{
  "output": "sea-blob.bin",
  "main": "index.js",
  "smol": {
    "update": {
      "binname": "my-cli",
      "url": "https://api.github.com/repos/user/repo/releases",
      "tag": "v*"
    }
  }
}
```

Then run:
```bash
binject inject -e node-smol -o output --sea sea-config.json
```

## Code References

**Parsing and serialization**:
- `packages/binject/src/json_parser.h` - sea-config.json parser
- `packages/binject/src/json_parser.c` - Parser implementation
- `packages/binject/src/smol_config.h` - SMFG serializer
- `packages/binject/src/smol_config.c` - Serializer implementation

**Runtime deserialization**:
- `packages/bin-infra/stubs/src/update_config.h` - Contains `update_config_from_binary()` function

**Stub integration**:
- `packages/bin-infra/stubs/src/elf_stub.c` - Linux ELF stub (reads SMFG config)
- `packages/bin-infra/stubs/src/macho_stub.c` - macOS Mach-O stub
- `packages/bin-infra/stubs/src/pe_stub.c` - Windows PE stub

**Bootstrap**:
- `packages/node-smol-builder/additions/source-patched/js/smol/smol_bootstrap.js` - Checks configured fake argv env var

## Testing

Run binject tests:
```bash
cd packages/binject
make test  # macOS/Linux
```

The tests verify:
- JSON parsing correctness
- Binary serialization format
- Stub integration
- Bootstrap behavior
