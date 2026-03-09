# Configuration Formats Specification

Binary format specifications for SMFG (SMOL Config) and SVFG (VFS Config) embedded in binaries.

## Overview

binject embeds two types of configuration:

1. **SMFG** - SMOL configuration for update checking
2. **SVFG** - VFS configuration for virtual filesystem

Both use binary formats for efficiency and are embedded in dedicated sections.

## SMFG (SMOL Config) Format

Version 2 format. Total size: **1192 bytes**.

### Section Location

| Platform | Segment | Section |
|----------|---------|---------|
| Mach-O | `NODE_SEA` | `__SMOL_VFS_CONFIG` |
| ELF | n/a | `.note.smol_vfs_config` |
| PE | n/a | `.vfs_config` |

### Binary Layout

```
Offset  Size    Field                    Type            Description
──────  ────    ─────                    ────            ───────────
0       4       Magic                    uint32 LE       "SMFG" (0x534D4647)
4       2       Version                  uint16 LE       2
6       1       Prompt                   uint8           Whether to prompt (0=no, 1=yes)
7       1       Prompt Default           char            Default response ('y' or 'n')
8       8       Interval                 int64 LE        Check interval (milliseconds)
16      8       Notify Interval          int64 LE        Notification interval (milliseconds)
24      128     Binname                  char[128]       Binary name (null-terminated)
152     256     Command                  char[256]       Update command (null-terminated)
408     512     URL                      char[512]       GitHub releases API URL
920     128     Tag                      char[128]       Release tag pattern
1048    64      Skip Env                 char[64]        Env var to skip updates
1112    64      Fake Argv Env            char[64]        Env var for fake argv
1176    16      Node Version             char[16]        Node.js version (v2 only)
```

### Field Details

#### Magic (4 bytes)

```c
#define SMOL_CONFIG_MAGIC 0x534D4647  // "SMFG" as uint32
```

Read as ASCII bytes: `S` (0x53) `M` (0x4D) `F` (0x46) `G` (0x47)

#### Version (2 bytes)

| Version | Size | Description |
|---------|------|-------------|
| 1 | 1176 bytes | Original format (no node_version) |
| 2 | 1192 bytes | Current format (adds node_version) |

#### Interval Fields (8 bytes each)

| Field | Default | Description |
|-------|---------|-------------|
| Interval | 86400000 | Check for updates every 24 hours |
| Notify Interval | 86400000 | Show notification every 24 hours |

#### String Fields

All string fields are:
- Fixed-size (padded with null bytes)
- Null-terminated
- UTF-8 encoded

| Field | Max Length | Example |
|-------|------------|---------|
| Binname | 127 chars | `smol` |
| Command | 254 chars | `self-update` |
| URL | 510 chars | `https://api.github.com/repos/SocketDev/socket-btm/releases` |
| Tag | 127 chars | `node-smol-*` |
| Skip Env | 63 chars | `SMOL_SKIP_UPDATE_CHECK` |
| Fake Argv Env | 63 chars | `SMOL_FAKE_ARGV` |
| Node Version | 15 chars | `25.5.0` |

### C Structure

```c
#define SMOL_CONFIG_MAGIC 0x534D4647
#define SMOL_CONFIG_VERSION 2
#define SMOL_CONFIG_SIZE 1192

typedef struct {
    const char *binname;           // Binary name (max 127 chars)
    const char *command;           // Update command (max 254 chars)
    const char *url;               // Update URL (max 510 chars)
    const char *tag;               // Version tag pattern (max 127 chars)
    const char *skip_env;          // Environment variable (max 63 chars)
    const char *fake_argv_env;     // Fake argv env var (max 63 chars)

    bool prompt;                   // Whether to prompt user
    char prompt_default;           // Default response 'y' or 'n'

    int64_t interval;              // Check interval ms (default 86400000)
    int64_t notify_interval;       // Notification interval ms

    const char *node_version;      // Node.js version (max 15 chars)
} smol_update_config_t;
```

### JSON Input Format

binject accepts JSON configuration via sea-config.json `smol.update` section:

```json
{
  "main": "app.js",
  "output": "app.blob",
  "smol": {
    "update": {
      "binname": "myapp",
      "command": "self-update",
      "url": "https://api.github.com/repos/owner/repo/releases",
      "tag": "v*",
      "interval": 86400000,
      "notifyInterval": 86400000,
      "prompt": false,
      "promptDefault": "n",
      "skipEnv": "MYAPP_SKIP_UPDATE",
      "nodeVersion": "25.5.0"
    }
  }
}
```

---

## SVFG (VFS Config) Format

Version 1 format. Total size: **366 bytes**.

### Section Location

| Platform | Segment | Section |
|----------|---------|---------|
| Mach-O | `NODE_SEA` | `__SMOL_VFS_CONFIG` |
| ELF | n/a | `.note.smol_vfs_config` |
| PE | n/a | `.vfs_config` |

### Binary Layout

```
Offset  Size    Field                    Type            Description
──────  ────    ─────                    ────            ───────────
0       4       Magic                    uint32 LE       "SVFG" (0x53564647)
4       2       Version                  uint16 LE       1
6       1       Mode                     uint8           VFS mode
7       1       Compression              uint8           Compression type
8       256     Prefix                   char[256]       Mount prefix path
264     4       Flags                    uint32 LE       Bit flags
268     98      Reserved                 char[98]        Future use
```

### Field Details

#### Magic (4 bytes)

```c
#define SVFG_MAGIC 0x53564647  // "SVFG" as uint32
```

#### Mode (1 byte)

| Value | Name | Description |
|-------|------|-------------|
| 0 | `IN_MEMORY` | Extract VFS to memory |
| 1 | `ON_DISK` | Extract VFS to temp directory |
| 2 | `COMPAT` | API only, no file extraction |

```c
typedef enum {
    VFS_MODE_IN_MEMORY = 0,
    VFS_MODE_ON_DISK = 1,
    VFS_MODE_COMPAT = 2
} vfs_mode_t;
```

#### Compression (1 byte)

| Value | Name | Description |
|-------|------|-------------|
| 0 | `NONE` | Uncompressed TAR |
| 1 | `GZIP` | TAR.GZ (gzip level 9) |

#### Prefix (256 bytes)

Virtual mount prefix for VFS paths.

Example: `/app/assets`

When set, VFS paths are accessed as `/app/assets/file.txt` instead of `/file.txt`.

#### Flags (4 bytes)

| Bit | Name | Description |
|-----|------|-------------|
| 0 | `PRESERVE_SYMLINKS` | Preserve symbolic links in VFS |
| 1 | `STRICT_MODE` | Fail on invalid paths |
| 2-31 | Reserved | Future use |

### C Structure

```c
typedef struct {
    uint32_t magic;           // 0x53564647
    uint16_t version;         // 1
    uint8_t mode;             // VFS mode
    uint8_t compression;      // Compression type
    char prefix[256];         // Mount prefix
    uint32_t flags;
    char reserved[98];
} svfg_config_t;

_Static_assert(sizeof(svfg_config_t) == 366, "SVFG size must be 366");
```

### JSON Input Format

binject accepts JSON configuration via `sea-config.json`:

```json
{
  "main": "app.js",
  "output": "app.blob",
  "vfs": {
    "source": "./assets",
    "mode": "in-memory",
    "compression": "gzip",
    "prefix": "/app/assets"
  }
}
```

---

## Serialization

### Writing SMFG

```c
uint8_t* serialize_smol_config(const smol_update_config_t *config);
```

Returns 1192-byte config data, or NULL on error. Caller must free().

### Reading SMFG

```c
int update_config_from_binary(update_config_t *config, const uint8_t *data, size_t size);
```

Deserializes SMFG binary format. Returns 0 on success, -1 on error.

### Endianness

All multi-byte integers are **little-endian**.

```c
// Reading on big-endian systems
uint32_t magic = le32toh(*(uint32_t*)data);
uint16_t version = le16toh(*(uint16_t*)(data + 4));
```

## Validation Rules

### SMFG Validation

1. Magic must be `0x534D4647`
2. Version must be 1 or 2
3. Size must be 1176 (v1) or 1192 (v2) bytes
4. URL must start with `http://` or `https://`
5. Intervals must be positive

### SVFG Validation

1. Magic must be `0x53564647`
2. Version must be 1
3. Mode must be 0, 1, or 2
4. Compression must be 0 or 1
5. Prefix must be valid path or empty

## Related Documentation

- [inject-sea-vfs.md](howto/inject-sea-vfs.md) - Injection how-to guide
- [smol-injection-flow.md](smol-injection-flow.md) - Injection workflow
