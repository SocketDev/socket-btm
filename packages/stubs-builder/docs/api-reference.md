# API Reference

C API reference for stubs-builder update checking and notification functions.

## Overview

stubs-builder provides C APIs for:
- Update configuration parsing (JSON and binary formats)
- GitHub Releases API integration
- Version comparison and glob matching
- Curl-based HTTP requests

## update_config.h

### Types

#### update_config_t

Update configuration structure.

```c
typedef struct {
    bool enabled;                                        /* Whether update checking is enabled. */
    long long interval;                                  /* Check interval in milliseconds. */
    long long notify_interval;                           /* Notification interval in milliseconds. */
    bool prompt;                                         /* Whether to show interactive prompts. */
    char prompt_default;                                 /* Default prompt answer: 'y' or 'n'. */
    char binname[UPDATE_CONFIG_MAX_BINNAME_LEN];         /* Binary name for notification display. */
    char command[UPDATE_CONFIG_MAX_COMMAND_LEN];         /* Command/args for notification display. */
    char url[UPDATE_CONFIG_MAX_URL_LEN];                 /* GitHub releases API URL. */
    char tag[UPDATE_CONFIG_MAX_TAG_LEN];                 /* Release tag pattern for matching. */
    char skip_env[UPDATE_CONFIG_MAX_SKIP_ENV_LEN];       /* Env var name to skip updates. */
    char fake_argv_env[UPDATE_CONFIG_MAX_FAKE_ARGV_ENV_LEN]; /* Env var name for fake argv control. */
    char node_version[UPDATE_CONFIG_MAX_NODE_VERSION_LEN]; /* Node.js version (e.g., "25.5.0"). */
} update_config_t;
```

### Functions

#### update_config_init

```c
static void update_config_init(update_config_t *config);
```

Initialize config with default values.

**Defaults:**
- `enabled`: true
- `interval`: 86400000 (24 hours in ms)
- `notify_interval`: 86400000 (24 hours in ms)
- `prompt`: false
- `prompt_default`: 'n'
- `url`: "https://api.github.com/repos/SocketDev/socket-btm/releases"
- `tag`: "node-smol-*"

#### update_config_parse

```c
static int update_config_parse(update_config_t *config, const char *json);
```

Parse update config from JSON string.

**Parameters:**
- `config` - Output configuration structure (initialized with defaults first)
- `json` - JSON string to parse

**Returns:** 0 on success, -1 on error

**Example JSON:**
```json
{
  "enabled": true,
  "interval": 86400000,
  "notify_interval": 86400000,
  "prompt": false,
  "prompt_default": "n",
  "binname": "smol",
  "command": "self-update",
  "url": "https://api.github.com/repos/SocketDev/socket-btm/releases",
  "tag": "node-smol-*",
  "skip_env": "SMOL_SKIP_UPDATE_CHECK"
}
```

#### update_config_from_binary

```c
static int update_config_from_binary(update_config_t *config, const uint8_t *data, size_t size);
```

Deserialize SMFG binary format into update_config_t.

**Parameters:**
- `config` - Output configuration structure
- `data` - Raw SMFG binary data
- `size` - Size of data (must be 1176 bytes for v1 or 1192 bytes for v2)

**Returns:** 0 on success, -1 on error

**Binary Format (SMFG):**
```
Offset 0-3:   Magic (4 bytes): 0x534D4647 ("SMFG")
Offset 4-5:   Version (2 bytes): 1 or 2
Offset 6:     Prompt flag (1 byte)
Offset 7:     Prompt default (1 byte): 'y' or 'n'
Offset 8-15:  Interval (8 bytes, little-endian int64)
Offset 16-23: Notify interval (8 bytes, little-endian int64)
Offset 24+:   String fields with length prefixes
```

#### update_config_should_skip

```c
static bool update_config_should_skip(const update_config_t *config);
```

Check if update checking should be skipped based on environment.

**Checks:**
1. Configured `skip_env` environment variable is set to truthy value
2. `CI` or `CONTINUOUS_INTEGRATION` environment variable is set
3. Not running in a TTY (non-interactive)

**Returns:** true if updates should be skipped

---

## update_checker.h

### Types

#### update_check_result_t

Update check result.

```c
typedef struct {
    bool update_available;                              /* Whether an update is available. */
    char current_version[UPDATE_CHECKER_MAX_VERSION_LEN]; /* Current version string. */
    char latest_version[UPDATE_CHECKER_MAX_VERSION_LEN];  /* Latest version string. */
    char latest_tag[UPDATE_CHECKER_MAX_VERSION_LEN];      /* Full release tag name. */
} update_check_result_t;
```

### Functions

#### check_for_updates

```c
static int check_for_updates(
    const update_config_t *config,
    const char *current_version,
    update_check_result_t *result
);
```

Check GitHub Releases for updates.

**Parameters:**
- `config` - Update configuration (contains URL, tag pattern)
- `current_version` - Current version to compare against
- `result` - Output result structure

**Returns:** 0 on success, -1 on error (network or parse failure)

**Example:**
```c
update_config_t config;
update_config_init(&config);

update_check_result_t result;
if (check_for_updates(&config, "2025-01-15", &result) == 0) {
    if (result.update_available) {
        printf("New version: %s (tag: %s)\n",
               result.latest_version, result.latest_tag);
    }
}
```

#### compare_versions

```c
static int compare_versions(const char *v1, const char *v2);
```

Compare two version strings (simplified semver comparison).

**Handles:**
- Standard semver: "1.0.0", "2.1.3"
- With 'v' prefix: "v1.0.0"
- Date-based: "2025-01-15"

**Returns:** >0 if v1 > v2, <0 if v1 < v2, 0 if equal

#### glob_match

```c
static bool glob_match(const char *pattern, const char *text);
```

Simple glob pattern matching (picomatch-compatible subset).

**Supports:**
- `*` matches zero or more characters
- `?` matches exactly one character
- Literal characters match themselves

**Returns:** true if text matches pattern

#### update_checker_global_init

```c
static void update_checker_global_init(void);
```

Global initialization for update checker. Must be called once at program startup.
Initializes libcurl with `curl_global_init(CURL_GLOBAL_DEFAULT)`.

#### update_checker_global_cleanup

```c
static void update_checker_global_cleanup(void);
```

Global cleanup for update checker. Must be called once at program shutdown.
Cleans up libcurl with `curl_global_cleanup()`.

---

## Constants

### Size Constants

```c
#define UPDATE_CONFIG_MAX_BINNAME_LEN 128
#define UPDATE_CONFIG_MAX_COMMAND_LEN 256
#define UPDATE_CONFIG_MAX_URL_LEN 512
#define UPDATE_CONFIG_MAX_TAG_LEN 128
#define UPDATE_CONFIG_MAX_SKIP_ENV_LEN 64
#define UPDATE_CONFIG_MAX_FAKE_ARGV_ENV_LEN 64
#define UPDATE_CONFIG_MAX_NODE_VERSION_LEN 16

#define UPDATE_CHECKER_MAX_VERSION_LEN 64
#define UPDATE_CHECKER_MAX_RESPONSE_SIZE (256 * 1024)  /* 256KB */
```

### Timing Constants

```c
#define UPDATE_CONFIG_DEFAULT_INTERVAL 86400000LL       /* 24 hours in ms */
#define UPDATE_CONFIG_DEFAULT_NOTIFY_INTERVAL 86400000LL /* 24 hours in ms */
#define UPDATE_CHECKER_TIMEOUT_SECS 10
#define UPDATE_CHECKER_RETRY_COUNT 2
#define UPDATE_CHECKER_RETRY_BASE_MS 5000
#define UPDATE_CHECKER_RETRY_BACKOFF 2
```

### SMFG Binary Format

```c
#define SMFG_MAGIC 0x534D4647  /* "SMFG" */
/* v1: 1176 bytes, v2: 1192 bytes (adds node_version field) */
```

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `GH_TOKEN` | GitHub token for API auth (takes precedence) |
| `GITHUB_TOKEN` | GitHub token for API auth (fallback) |
| `CI` | Skip updates in CI environments |
| `CONTINUOUS_INTEGRATION` | Skip updates in CI environments |
| Configurable via `skip_env` | Custom skip variable |

---

## Error Handling

All functions return -1 on error. Errors are silent by default (no stderr output).

Common errors:
- `SMFG magic not found` - Not a valid SMFG config
- `Unsupported version` - SMFG version not 1 or 2
- `Invalid size` - Binary data not 1176 or 1192 bytes
- Network errors - GitHub API unreachable or returned non-200
- Parse errors - Invalid JSON response from GitHub

---

## Memory Management

All APIs use caller-allocated buffers or stack allocation. No dynamic allocation in public APIs except for HTTP response buffer (freed internally).

```c
// Correct usage - all stack allocation
update_config_t config;
update_config_init(&config);

update_check_result_t result;
check_for_updates(&config, "1.0.0", &result);

// No need to free anything
```

---

## Thread Safety

These APIs are **not thread-safe**. They use:
- Global curl state (curl_global_init/cleanup)
- Static inline functions

Use external locking if needed.

---

## Usage Example

Complete update check flow:

```c
#include "socketsecurity/stubs-builder/update_config.h"
#include "socketsecurity/stubs-builder/update_checker.h"

int main() {
    // Initialize curl
    update_checker_global_init();

    // Parse config from embedded SMFG binary
    update_config_t config;
    if (update_config_from_binary(&config, smfg_data, smfg_size) != 0) {
        fprintf(stderr, "Failed to parse SMFG config\n");
        return 1;
    }

    // Check if we should skip
    if (update_config_should_skip(&config)) {
        return 0;  // Skip silently
    }

    // Check for updates
    update_check_result_t result;
    if (check_for_updates(&config, "2025-01-15", &result) == 0) {
        if (result.update_available) {
            printf("Update available: %s -> %s\n",
                   result.current_version, result.latest_version);
        }
    }

    // Cleanup
    update_checker_global_cleanup();
    return 0;
}
```

---

## Related Documentation

- [Update Checking](update-checking.md) - System overview
- [Config Formats](../binject/docs/config-formats.md) - SMFG binary specification
