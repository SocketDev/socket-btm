# VFS Configuration via sea-config.json

## Overview

This document outlines the design for configuring VFS (Virtual File System) options directly in `sea-config.json`, eliminating the need for separate `--vfs*` CLI flags when using binject.

## Current State

**CLI Flags** (binject):
- `--vfs <path>` - Embed TAR.GZ archive for on-disk extraction
- `--vfs-in-memory` - Enable in-memory VFS (keeps files in memory)
- `--vfs-on-disk` - Enable on-disk VFS (extracts to temp directory)
- `--vfs-compat` - Enable VFS support without bundling files

**Limitations**:
- Requires passing multiple CLI arguments to binject
- No way to specify VFS options in sea-config.json
- Separation between SEA config and VFS config
- Cannot version-control VFS configuration alongside SEA config

## Proposed Configuration Format

### Basic VFS Configuration

**Minimal (uses defaults)**:
```json
{
  "output": "sea-blob.bin",
  "main": "index.js",
  "smol": {
    "vfs": true
  }
}
```
or:
```json
{
  "smol": {
    "vfs": {}
  }
}
```
Both use defaults: `mode: "in-memory"`, `source: "node_modules"`

**With explicit values**:
```json
{
  "output": "sea-blob.bin",
  "main": "index.js",
  "smol": {
    "fakeArgvEnv": "SMOL_FAKE_ARGV",
    "vfs": {
      "mode": "on-disk",
      "source": "dist/vfs.tar.gz"
    },
    "update": {
      "binname": "my-cli",
      "url": "https://api.github.com/repos/user/repo/releases"
    }
  }
}
```

**Note**: Command-line flags (`--vfs`, `--vfs-in-memory`, etc.) take precedence over sea-config.json values.

### VFS Configuration Fields

#### `smol.vfs.mode` (string, optional, defaults to "in-memory")
Specifies how VFS files are handled at runtime.

**Values**:
- `"in-memory"` - Keep VFS files in memory (default)
  - Maps to `--vfs-in-memory` CLI flag (or `--vfs <path>` without mode flags)
  - Best for small assets, JSON configs, templates
  - Faster access, no disk I/O
  - Limited by available RAM

- `"on-disk"` - Extract VFS archive to temporary directory at runtime
  - Maps to `--vfs-on-disk` CLI flag
  - Best for large files, native addons, executables
  - Files extracted to `~/.socket/_dlx/<hash>/vfs/`

- `"compat"` - Enable VFS API compatibility without bundling files
  - Maps to `--vfs-compat` CLI flag
  - Sets up VFS APIs (e.g., `require.resolve.paths`) without embedding files
  - Useful for development builds where files are loaded from disk
  - No VFS archive needed

#### `smol.vfs.source` (string, optional, defaults to "node_modules")
Path to VFS content.

**Formats**:
1. **TAR Archive**: `"dist/vfs.tar"`
   - Pre-built uncompressed tar archive
   - Binject will compress with gzip level 9 automatically

2. **TAR.GZ Archive**: `"dist/vfs.tar.gz"`
   - Pre-built gzip-compressed tar archive (recommended for CI)
   - Used as-is by binject (no re-compression)

3. **Directory**: `"dist/vfs/"`
   - Directory path (trailing slash recommended but not required)
   - Binject creates TAR.GZ archive automatically at build time
   - Uses gzip level 9 (maximum compression) automatically

4. **Relative vs Absolute**:
   - Relative paths resolved from sea-config.json directory
   - Absolute paths used as-is

**Note**: Binject always uses gzip level 9 (maximum compression) when creating archives from directories or compressing .tar files. This is automatic and not configurable.

## Configuration Examples

### Example 1: Minimal Configuration (Defaults)

**Option A - Boolean shorthand**:
```json
{
  "output": "sea-blob.bin",
  "main": "index.js",
  "smol": {
    "vfs": true
  }
}
```

**Option B - Empty object**:
```json
{
  "output": "sea-blob.bin",
  "main": "index.js",
  "smol": {
    "vfs": {}
  }
}
```

**Build workflow**:
```bash
# Binject will archive node_modules/ with in-memory mode
binject inject -e node-smol -o output --sea sea-config.json
```

**Defaults used**:
- `mode: "in-memory"` - VFS kept in memory
- `source: "node_modules"` - Archives node_modules directory

**Use case**: Quick setup, small projects with few dependencies.

### Example 2: Pre-built Archive (Recommended for Production)

```json
{
  "output": "sea-blob.bin",
  "main": "index.js",
  "smol": {
    "vfs": {
      "mode": "on-disk",
      "source": "build/vfs.tar.gz"
    }
  }
}
```

**Build workflow**:
```bash
# Step 1: Build VFS archive separately
pnpm run build:vfs  # Creates build/vfs.tar.gz

# Step 2: Inject SEA with VFS
binject inject -e node-smol -o output --sea sea-config.json
```

### Example 3: Directory Archiving (Development)

```json
{
  "output": "sea-blob.bin",
  "main": "index.js",
  "smol": {
    "vfs": {
      "mode": "on-disk",
      "source": "dist/vfs/"
    }
  }
}
```

**Build workflow**:
```bash
# Single step: binject archives directory automatically with gzip level 9
binject inject -e node-smol -o output --sea sea-config.json
```

**Note**: Binject automatically creates TAR.GZ with maximum compression (gzip level 9) from the directory.

### Example 4: TAR File Compression

```json
{
  "output": "sea-blob.bin",
  "main": "index.js",
  "smol": {
    "vfs": {
      "mode": "on-disk",
      "source": "dist/vfs.tar"
    }
  }
}
```

**Build workflow**:
```bash
# Create uncompressed tar archive
tar -cf dist/vfs.tar -C dist/vfs .

# Binject compresses with gzip level 9 automatically
binject inject -e node-smol -o output --sea sea-config.json
```

**Use case**: Separate tar creation from compression (useful for reproducible builds).

### Example 5: In-Memory VFS (Small Assets)

```json
{
  "output": "sea-blob.bin",
  "main": "index.js",
  "smol": {
    "vfs": {
      "mode": "in-memory",
      "source": "assets/templates.tar.gz"
    }
  }
}
```

**Use case**: Small static assets (templates, configs) loaded entirely into memory.

### Example 6: VFS Compat Mode (Development)

```json
{
  "output": "sea-blob.bin",
  "main": "index.js",
  "smol": {
    "vfs": {
      "mode": "compat",
      "source": "node_modules"
    }
  }
}
```

**Use case**: Development builds where VFS APIs (e.g., `require.resolve.paths`) are set up but files loaded from disk during development.

**Note**: Source is still required but ignored in compat mode.

### Example 7: No VFS (Disabled)

Both options are equivalent - no VFS is configured:

**Option A - Omit vfs field**:
```json
{
  "output": "sea-blob.bin",
  "main": "index.js",
  "smol": {
    "update": { ... }
  }
}
```

**Option B - Explicit false**:
```json
{
  "output": "sea-blob.bin",
  "main": "index.js",
  "smol": {
    "vfs": false,
    "update": { ... }
  }
}
```

**Use case**: When you don't need VFS functionality. Both options have identical behavior.

### Example 8: Multiple VFS Configurations (Future)

```json
{
  "output": "sea-blob.bin",
  "main": "index.js",
  "smol": {
    "vfs": [
      {
        "mode": "in-memory",
        "source": "assets/templates.tar.gz",
        "mount": "/templates"
      },
      {
        "mode": "on-disk",
        "source": "dist/external-tools.tar.gz",
        "mount": "/external-tools"
      }
    ]
  }
}
```

**Note**: Multiple VFS support is future work. Initial implementation supports single VFS only.

## Implementation Plan

### Phase 1: JSON Schema and Parsing

#### 1.1 Update `sea_config_t` Structure

**File**: `packages/binject/src/json_parser.h`

```c
typedef struct {
    char *mode;        // "on-disk", "in-memory", "compat"
    char *source;      // path to archive (.tar, .tar.gz) or directory
} vfs_config_t;

typedef struct {
    char *output;           // "output" field
    char *main;             // "main" field
    cJSON *smol;            // "smol" section (detached)
    vfs_config_t *vfs;      // parsed VFS config (if present)
} sea_config_t;
```

#### 1.2 Parse VFS Configuration

**File**: `packages/binject/src/json_parser.c`

Add function to parse `smol.vfs` section:

```c
/**
 * Parse VFS configuration from smol.vfs object.
 * Returns NULL if no VFS section or on error.
 */
vfs_config_t* parse_vfs_config(cJSON *smol) {
    if (!smol || !cJSON_IsObject(smol)) {
        return NULL;
    }

    cJSON *vfs = cJSON_GetObjectItem(smol, "vfs");
    if (!vfs || !cJSON_IsObject(vfs)) {
        return NULL;  // No VFS config
    }

    vfs_config_t *config = calloc(1, sizeof(vfs_config_t));
    if (!config) {
        return NULL;
    }

    // Parse mode (required)
    cJSON *mode = cJSON_GetObjectItem(vfs, "mode");
    if (!mode || !cJSON_IsString(mode)) {
        fprintf(stderr, "Error: VFS mode is required\n");
        free(config);
        return NULL;
    }
    config->mode = strdup(mode->valuestring);

    // Validate mode
    if (strcmp(config->mode, "on-disk") != 0 &&
        strcmp(config->mode, "in-memory") != 0 &&
        strcmp(config->mode, "compat") != 0) {
        fprintf(stderr, "Error: Invalid VFS mode: %s\n", config->mode);
        free_vfs_config(config);
        return NULL;
    }

    // Parse source (required unless mode is "compat")
    cJSON *source = cJSON_GetObjectItem(vfs, "source");
    if (strcmp(config->mode, "compat") != 0) {
        if (!source || !cJSON_IsString(source)) {
            fprintf(stderr, "Error: VFS source is required for mode '%s'\n", config->mode);
            free_vfs_config(config);
            return NULL;
        }
        config->source = strdup(source->valuestring);
    }

    return config;
}

void free_vfs_config(vfs_config_t *config) {
    if (!config) {
        return;
    }
    free(config->mode);
    free(config->source);
    free(config);
}
```

#### 1.3 Integrate into `parse_sea_config()`

Update `parse_sea_config()` to parse VFS config:

```c
sea_config_t* parse_sea_config(const char *config_path) {
    // ... existing parsing ...

    // Parse VFS config from smol section
    if (config->smol) {
        config->vfs = parse_vfs_config(config->smol);
    }

    return config;
}
```

### Phase 2: VFS Archive Preparation

#### 2.1 Detect Source Type

**File**: `packages/binject/src/main.c`

Add helper to determine if source is archive or directory:

```c
/**
 * Check if path is a TAR/TAR.GZ archive or directory.
 * Returns:
 *   0 = .tar.gz archive (already compressed)
 *   1 = .tar archive (needs compression)
 *   2 = directory (needs archiving + compression)
 *   -1 = error (doesn't exist or invalid)
 */
int detect_vfs_source_type(const char *path) {
    struct stat st;
    if (stat(path, &st) != 0) {
        fprintf(stderr, "Error: VFS source not found: %s\n", path);
        return -1;
    }

    if (S_ISDIR(st.st_mode)) {
        return 2;  // Directory
    }

    if (S_ISREG(st.st_mode)) {
        size_t len = strlen(path);

        // Check for .tar.gz extension
        if (len > 7 && strcmp(path + len - 7, ".tar.gz") == 0) {
            return 0;  // Compressed archive (use as-is)
        }

        // Check for .tar extension
        if (len > 4 && strcmp(path + len - 4, ".tar") == 0) {
            return 1;  // Uncompressed archive (needs compression)
        }

        fprintf(stderr, "Error: VFS source must be .tar, .tar.gz, or directory: %s\n", path);
        return -1;
    }

    fprintf(stderr, "Error: Invalid VFS source type: %s\n", path);
    return -1;
}
```

#### 2.2 Create Archive from Directory

Add function to create TAR.GZ from directory (always uses gzip level 9):

```c
/**
 * Create TAR.GZ archive from directory.
 * Always uses gzip level 9 (maximum compression).
 * Returns path to temporary archive file, or NULL on error.
 * Caller must free returned string and delete file.
 */
char* create_vfs_archive_from_dir(const char *dir_path) {
    // Create temp file for archive
    char template[] = "/tmp/binject-vfs-XXXXXX.tar.gz";
    int fd = mkstemps(template, 7);
    if (fd == -1) {
        fprintf(stderr, "Error: Failed to create temp file\n");
        return NULL;
    }
    close(fd);

    char *archive_path = strdup(template);

    // Build tar command with gzip level 9
    char cmd[2048];
    snprintf(cmd, sizeof(cmd),
             "tar -czf '%s' -C '%s' . && gzip -9 -f '%s'",
             archive_path, dir_path, archive_path);

    printf("Creating VFS archive from directory (gzip level 9): %s\n", archive_path);
    int result = system(cmd);
    if (result != 0) {
        fprintf(stderr, "Error: Failed to create VFS archive\n");
        unlink(archive_path);
        free(archive_path);
        return NULL;
    }

    printf("Created VFS archive (%ld bytes)\n", (long)get_file_size(archive_path));
    return archive_path;
}

/**
 * Compress .tar file to .tar.gz with gzip level 9.
 * Returns path to compressed file, or NULL on error.
 * Caller must free returned string and delete file.
 */
char* compress_tar_archive(const char *tar_path) {
    // Create temp file for compressed archive
    char template[] = "/tmp/binject-vfs-XXXXXX.tar.gz";
    int fd = mkstemps(template, 7);
    if (fd == -1) {
        fprintf(stderr, "Error: Failed to create temp file\n");
        return NULL;
    }
    close(fd);

    char *compressed_path = strdup(template);

    // Compress with gzip level 9
    char cmd[2048];
    snprintf(cmd, sizeof(cmd),
             "gzip -9 -c '%s' > '%s'",
             tar_path, compressed_path);

    printf("Compressing VFS archive (gzip level 9): %s\n", compressed_path);
    int result = system(cmd);
    if (result != 0) {
        fprintf(stderr, "Error: Failed to compress VFS archive\n");
        unlink(compressed_path);
        free(compressed_path);
        return NULL;
    }

    printf("Compressed VFS archive (%ld bytes)\n", (long)get_file_size(compressed_path));
    return compressed_path;
}
```

### Phase 3: Integration with Injection

#### 3.1 Update Injection Logic

**File**: `packages/binject/src/main.c`

Update `inject` command to use VFS config from sea-config.json:

```c
// In inject command handler

// IMPORTANT: CLI flags take priority over sea-config.json
// If --vfs* flags provided, use those instead of parsing config

sea_config_t *config = parse_sea_config(sea_resource);
if (!config) {
    fprintf(stderr, "Error: Failed to parse sea-config.json\n");
    return 1;
}

char *vfs_archive_path = NULL;
char *temp_vfs_archive = NULL;  // Track if we created temp file
bool vfs_on_disk = false;
bool vfs_in_memory = false;
bool vfs_compat = false;

// Check if VFS flags provided via CLI (priority 1)
if (cli_vfs_flag_provided || cli_vfs_mode_provided) {
    // Use CLI flags, ignore sea-config.json vfs section
    if (config->vfs) {
        printf("Note: CLI VFS flags override sea-config.json vfs section\n");
    }
    // ... existing CLI flag handling ...
}
// Otherwise, use sea-config.json vfs section (priority 2)
else if (config->vfs) {
    // Determine VFS mode
    if (strcmp(config->vfs->mode, "compat") == 0) {
        vfs_compat = true;
        printf("VFS: compat mode (API compatibility, no files embedded)\n");
    } else {
        // Resolve source path (relative to sea-config.json directory)
        char *resolved_source = resolve_relative_path(sea_resource, config->vfs->source);

        // Detect source type
        int source_type = detect_vfs_source_type(resolved_source);
        if (source_type == -1) {
            free(resolved_source);
            free_sea_config(config);
            return 1;
        }

        if (source_type == 2) {
            // Directory - create TAR.GZ with gzip level 9
            printf("VFS: creating archive from directory '%s' (gzip level 9)\n", resolved_source);
            temp_vfs_archive = create_vfs_archive_from_dir(resolved_source);
            if (!temp_vfs_archive) {
                free(resolved_source);
                free_sea_config(config);
                return 1;
            }
            vfs_archive_path = temp_vfs_archive;
        } else if (source_type == 1) {
            // .tar file - compress with gzip level 9
            printf("VFS: compressing tar archive '%s' (gzip level 9)\n", resolved_source);
            temp_vfs_archive = compress_tar_archive(resolved_source);
            if (!temp_vfs_archive) {
                free(resolved_source);
                free_sea_config(config);
                return 1;
            }
            vfs_archive_path = temp_vfs_archive;
        } else {
            // .tar.gz file - use as-is
            printf("VFS: using compressed archive '%s'\n", resolved_source);
            vfs_archive_path = resolved_source;
        }

        // Set mode flags
        if (strcmp(config->vfs->mode, "on-disk") == 0) {
            vfs_on_disk = true;
            printf("VFS: mode=on-disk (extract to temp directory)\n");
        } else if (strcmp(config->vfs->mode, "in-memory") == 0) {
            vfs_in_memory = true;
            printf("VFS: mode=in-memory (keep in RAM)\n");
        }
    }
}

// Serialize smol config
uint8_t *smol_config_binary = NULL;
if (config->smol) {
    smol_config_binary = serialize_smol_config(config->smol);
}

// Call binject_batch with VFS parameters
int result = binject_batch(
    executable,
    blob_resource,
    output,
    smol_config_binary,
    vfs_archive_path,      // VFS archive path (or NULL)
    vfs_on_disk,           // VFS on-disk flag
    vfs_in_memory,         // VFS in-memory flag
    vfs_compat             // VFS compat flag
);

// Cleanup
if (temp_vfs_archive) {
    unlink(temp_vfs_archive);
    free(temp_vfs_archive);
}
free_sea_config(config);
free(smol_config_binary);

return result == 0 ? 0 : 1;
```

#### 3.2 Update `binject_batch()` Signature

**File**: `packages/binject/src/binject.h`

```c
int binject_batch(
    const char *executable,
    const char *blob,
    const char *output,
    const uint8_t *smol_config_binary,
    const char *vfs_archive,      // VFS archive path (NULL if no VFS)
    bool vfs_on_disk,             // Extract VFS to disk
    bool vfs_in_memory,           // Keep VFS in memory
    bool vfs_compat               // VFS compat mode
);
```

### Phase 4: Backward Compatibility

#### 4.1 CLI Flags Take Precedence

**Priority order** (highest to lowest):
1. CLI flags (`--vfs`, `--vfs-in-memory`, `--vfs-on-disk`, `--vfs-compat`)
2. sea-config.json `smol.vfs` section
3. No VFS

If user provides both sea-config.json VFS config AND CLI flags, CLI flags take precedence:

```c
// Priority 1: CLI flags override sea-config.json
if (cli_vfs_flag_provided || cli_vfs_mode_provided) {
    // Use CLI flags, ignore sea-config.json vfs section
    if (config->vfs) {
        printf("Note: CLI VFS flags override sea-config.json vfs section\n");
    }
    // ... handle CLI flags ...
}
// Priority 2: sea-config.json vfs section
else if (config->vfs) {
    // Use sea-config.json vfs section
    // ... handle config ...
}
```

#### 4.2 Migration Path

**Old approach** (still supported):
```bash
binject inject -e node-smol -o output --sea sea-config.json --vfs dist/vfs.tar.gz
```

**New approach** (recommended):
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
```bash
binject inject -e node-smol -o output --sea sea-config.json
```

### Phase 5: Documentation

#### 5.1 Update sea-config-integration.md

Add VFS configuration section with examples.

#### 5.2 Update binject --help

Update help text to mention VFS configuration in sea-config.json:

```
VFS Options:
  --vfs <path>         Path to VFS archive (overrides sea-config.json)
  --vfs-in-memory      Keep VFS in memory (overrides sea-config.json)
  --vfs-on-disk        Extract VFS to disk (overrides sea-config.json)
  --vfs-compat         Enable VFS compat mode (overrides sea-config.json)

Note: VFS options can be configured in sea-config.json under smol.vfs.
      CLI flags take precedence over sea-config.json.
```

## Validation Rules

1. **VFS field validation**:
   - Can be boolean (`true`/`false`), object, or omitted
   - `true` = use all defaults (in-memory, node_modules)
   - `false` = no VFS (same as omitting the field)
   - missing = no VFS (same as `false`)
   - `{}` = use all defaults (same as `true`)
   - Object = explicit configuration

2. **Mode validation**:
   - Optional, defaults to `"in-memory"`
   - If provided, must be one of: `"on-disk"`, `"in-memory"`, `"compat"`

3. **Source validation**:
   - Optional, defaults to `"node_modules"`
   - If provided, must exist (file or directory)
   - If file, must have `.tar` or `.tar.gz` extension
   - If directory, must be readable
   - Ignored in compat mode (but validated if provided)

3. **Path resolution**:
   - Relative paths resolved from sea-config.json directory
   - Absolute paths used as-is
   - Symlinks followed
   - Path traversal prevented

4. **Compression** (automatic):
   - Always uses gzip level 9 (maximum compression)
   - Applied when source is directory or .tar file
   - .tar.gz files used as-is (no re-compression)

## Error Handling

**Parse Errors**:
- Invalid mode → fatal error, exit 1
- Missing source (non-compat) → fatal error, exit 1
- Invalid source extension → fatal error, exit 1

**Runtime Errors**:
- Source not found → fatal error, exit 1
- Archive creation failed (directory source) → fatal error, exit 1
- Compression failed (.tar source) → fatal error, exit 1
- Archive too large (>1GB) → fatal error, exit 1
- VFS injection failed → fatal error, exit 1

**Warnings** (non-fatal):
- CLI flags override sea-config.json → informational message
- Archive size >100MB → performance warning

## Security Considerations

1. **Path Traversal**: Validate source paths don't escape project directory
2. **Archive Size**: Warn if VFS archive >100MB, error if >1GB
3. **Temporary Files**: Clean up temp archives even on error
4. **File Permissions**: Preserve file permissions in VFS archives

## Testing Strategy

### Unit Tests

1. Parse valid VFS configurations
2. Parse invalid VFS configurations (error cases)
3. Detect source type (archive vs directory)
4. Create archives from directories
5. Validate compression settings

### Integration Tests

1. Inject SEA with on-disk VFS
2. Inject SEA with in-memory VFS
3. Inject SEA with compat mode VFS
4. Inject SEA with directory source (archiving)
5. Inject SEA with pre-built archive source
6. CLI flags override sea-config.json
7. Runtime VFS extraction and access

### Cross-Platform Tests

1. Test on macOS (tar BSD vs GNU)
2. Test on Linux (GNU tar)
3. Test on Windows (require tar.exe in PATH or bundle)

## Future Enhancements

### Multiple VFS Mounts

Support multiple VFS archives with different mount points:

```json
{
  "smol": {
    "vfs": [
      {
        "mode": "in-memory",
        "source": "assets/templates.tar.gz",
        "mount": "/templates"
      },
      {
        "mode": "on-disk",
        "source": "external-tools.tar.gz",
        "mount": "/external-tools"
      }
    ]
  }
}
```

### Alternative Compression Algorithms (Future)

Currently uses gzip level 9 (maximum compression) exclusively. Future versions could support:
- `"zstd"` - Zstandard (faster compression/decompression, similar ratio)
- `"lz4"` - LZ4 (very fast, lower compression ratio, good for development builds)
- `"brotli"` - Brotli (better compression than gzip, slower)

**Note**: Would require configuration in sea-config.json and node-smol runtime support.

### Lazy Extraction

On-disk mode could support lazy extraction:
- Extract files only when accessed
- Reduces startup time for large VFS
- Requires FUSE or similar filesystem hooks

### Encryption

Add encryption support for sensitive VFS content:

```json
{
  "smol": {
    "vfs": {
      "mode": "on-disk",
      "source": "secure.tar.gz",
      "encryption": {
        "algorithm": "aes-256-gcm",
        "keyEnv": "VFS_ENCRYPTION_KEY"
      }
    }
  }
}
```

## Summary

This design enables VFS configuration directly in sea-config.json, providing:

✅ **Single Source of Truth**: All SEA configuration in one file
✅ **Version Control**: VFS config tracked with application code
✅ **Simplified Workflow**: No need to remember CLI flags
✅ **Sensible Defaults**: Minimal config `{"vfs": {}}` uses node_modules in-memory
✅ **CLI Priority**: Command flags always override config (developer-friendly)
✅ **Flexible**: Supports .tar, .tar.gz archives, or directories
✅ **Automatic Compression**: Always uses gzip level 9 (no configuration needed)
✅ **Validated**: Comprehensive error checking at build time

**Key Design Principles**:
- **Minimal configuration**: `{"vfs": true}` or `{"vfs": {}}` uses sensible defaults
- **Boolean shorthand**: `"vfs": true` for quick enablement with defaults
- **Defaults**: `mode: "in-memory"`, `source: "node_modules"`
- **CLI flags take precedence** over sea-config.json (priority 1)
- **Automatic compression** with gzip level 9 (no user configuration)
- **Multiple source types**: .tar, .tar.gz, and directory sources
- **Compat mode** enables VFS APIs without embedding files

**Implementation Priority**: High (complements smol config refactoring)
**Estimated Effort**: 12-16 hours
**Dependencies**: Requires cJSON integration (already complete ✅)
