# Update Config Integration Guide

## Overview

The `--update-config` flag allows embedding update checking configuration in compressed node-smol binaries. This document describes how to integrate update config validation into binject's C code.

## JavaScript Module

**Location**: `scripts/update-config-binary.mjs`

**Functions**:
- `parseConfigFile(filePath)` - Read and validate update-config.json file
- `serializeUpdateConfig(config)` - Validate and serialize config object to binary
- `parseAndSerialize(jsonString)` - Parse JSON string and serialize

**Output**: 1112-byte binary buffer with validation

## Integration Steps

### 1. Call from binject's main.c

When the `--update-config` flag is provided:

```c
// In main.c inject command parsing
const char *update_config_path = NULL;

for (int i = 2; i < argc; i++) {
    // ... existing flags ...
    } else if (strcmp(argv[i], "--update-config") == 0) {
        if (i + 1 < argc) update_config_path = argv[++i];
    }
}

// After parsing, if update_config_path is set
if (update_config_path) {
    // Call Node.js to validate and serialize config
    update_config_binary = generate_update_config_binary(update_config_path);
    if (!update_config_binary) {
        fprintf(stderr, "Error: Failed to generate update config binary\n");
        return BINJECT_ERROR;
    }
}
```

### 2. Generate Binary via Node.js

```c
/**
 * Generate update config binary from JSON file using Node.js validator.
 * Returns malloc'd buffer that caller must free, or NULL on error.
 */
static uint8_t* generate_update_config_binary(const char *config_path) {
    char command[4096];

    // Build Node.js command to run validator
    snprintf(command, sizeof(command),
        "node -e \"import('./scripts/update-config-binary.mjs').then(m => {"
        "  const buf = m.parseConfigFile('%s');"
        "  process.stdout.write(buf);"
        "})\"",
        config_path);

    // Execute and capture binary output
    FILE *fp = popen(command, "r");
    if (!fp) {
        fprintf(stderr, "Error: Failed to execute update config validator\n");
        return NULL;
    }

    // Allocate buffer for binary config (1112 bytes)
    uint8_t *buffer = malloc(1112);
    if (!buffer) {
        pclose(fp);
        return NULL;
    }

    // Read binary output
    size_t bytes_read = fread(buffer, 1, 1112, fp);
    int status = pclose(fp);

    if (status != 0 || bytes_read != 1112) {
        fprintf(stderr, "Error: Update config validation failed\n");
        free(buffer);
        return NULL;
    }

    return buffer;
}
```

### 3. Write to Binary Format

After reading platform metadata (3 bytes):

```c
// Write update config flag and binary
if (update_config_binary) {
    uint8_t has_config = 1;
    fwrite(&has_config, 1, 1, output_fp);
    fwrite(update_config_binary, 1, 1112, output_fp);
    free(update_config_binary);
} else {
    uint8_t has_config = 0;
    fwrite(&has_config, 1, 1, output_fp);
}
```

## Binary Format

```
[has_update_config flag] (1 byte: 0=no, 1=yes)
[update config binary] (1112 bytes if flag=1):
  - Magic (4 bytes): 0x55504446 ("UPDF")
  - Version (2 bytes): 1
  - Config data (1106 bytes): validated fields
```

## Validation Features

✅ **Type checking**: Ensures strings, booleans, numbers are correct types
✅ **Length limits**: Enforces max lengths (binname: 127, command: 254, url: 510, etc.)
✅ **URL validation**: Requires http:// or https://
✅ **Number ranges**: Validates intervals are >= 0
✅ **prompt_default normalization**: Converts "yes"/"no" to "y"/"n"
✅ **File reading**: Handles missing files, invalid JSON

## Error Messages

When validation fails, binject will exit with clear error messages:

```
Error: Invalid update config field 'url': must start with http:// or https://, got 'example.com'
Error: Invalid update config field 'binname': exceeds maximum length of 127 bytes (got 150)
Error: Failed to read update config file 'config.json': ENOENT: no such file or directory
```

## Testing

Run tests:
```bash
npm test -- update-config-validation.test.mjs
```

35 tests cover:
- Valid configurations
- String length limits
- Type validation
- URL validation
- prompt_default normalization
- File parsing
- Binary format correctness
