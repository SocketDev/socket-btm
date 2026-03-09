# Update Checking System

Architecture and configuration guide for the self-extracting stub update checking system.

## Overview

SMOL stubs can optionally check for updates when executed. The system:
1. Reads update configuration from embedded SMFG config
2. Checks GitHub Releases API for newer versions
3. Notifies users or blocks execution based on configuration

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    UPDATE CHECKING FLOW                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Stub Execution                                                  │
│       ↓                                                          │
│  Read SMFG Config from __PRESSED_DATA section                   │
│       ↓                                                          │
│  Check if UPDATE_ENABLED flag is set                            │
│       ├── No: Continue to decompression                          │
│       └── Yes: ↓                                                 │
│  Read .dlx-metadata.json for last check timestamp               │
│       ↓                                                          │
│  If (now - last_check) < check_interval: Skip check             │
│       ↓                                                          │
│  Query GitHub Releases API                                       │
│       ↓                                                          │
│  Match releases against glob pattern                            │
│       ↓                                                          │
│  If newer version found:                                         │
│       ├── NOTIFY_ONLY: Show notification, continue               │
│       └── SHOW_PROMPT: Ask user, optionally exit                │
│       ↓                                                          │
│  Update .dlx-metadata.json with check timestamp                 │
│       ↓                                                          │
│  Continue to decompression/execution                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Configuration

### SMFG Binary Format

Update configuration is embedded in the SMFG (SMOL Config) section:

| Field | Size | Description |
|-------|------|-------------|
| Update URL | 512 bytes | GitHub Releases API URL |
| Glob Pattern | 256 bytes | Version tag pattern |
| Notification | 256 bytes | Message to display |
| Flags | 4 bytes | Behavior flags |
| Check Interval | 4 bytes | Seconds between checks |
| Timeout | 4 bytes | API request timeout |

### JSON Configuration

Configure via sea-config.json or CLI:

```json
{
  "smolConfig": {
    "updateUrl": "https://api.github.com/repos/owner/repo/releases",
    "globPattern": "v*",
    "notificationTitle": "Update available!",
    "checkInterval": 86400,
    "timeout": 5,
    "showPrompt": true,
    "promptDefaultYes": false
  }
}
```

### CLI Flags

```bash
# Enable update checking
binject inject -e node -o myapp --sea app.blob \
  --smol-update-url "https://api.github.com/repos/owner/repo/releases" \
  --smol-glob-pattern "v*" \
  --smol-check-interval 86400 \
  --smol-show-prompt
```

## Behavior Flags

| Flag | Description |
|------|-------------|
| `UPDATE_ENABLED` | Enable the update checking system |
| `NOTIFY_ONLY` | Show notification but don't block |
| `SHOW_PROMPT` | Show y/n prompt to user |
| `PROMPT_DEFAULT_YES` | Default prompt answer is yes |

### Flag Combinations

| Flags | Behavior |
|-------|----------|
| None | No update checking |
| `UPDATE_ENABLED` | Silent check, no notification |
| `UPDATE_ENABLED + NOTIFY_ONLY` | Show notification, continue execution |
| `UPDATE_ENABLED + SHOW_PROMPT` | Ask user, exit if they decline |
| `UPDATE_ENABLED + SHOW_PROMPT + PROMPT_DEFAULT_YES` | Ask user, default to yes |

## GitHub API Integration

### Releases API

The stub queries the GitHub Releases API:

```
GET https://api.github.com/repos/{owner}/{repo}/releases
```

Response handling:
1. Parse JSON array of releases
2. Filter by `tag_name` matching glob pattern
3. Compare versions against current
4. Extract download URLs if needed

### Authentication

For private repos or higher rate limits:

```bash
export GH_TOKEN="ghp_xxxxxxxxxxxx"
# or
export GITHUB_TOKEN="ghp_xxxxxxxxxxxx"
```

### Rate Limiting

- Unauthenticated: 60 requests/hour
- Authenticated: 5000 requests/hour

The stub caches check results via `check_interval` to avoid rate limits.

## Version Comparison

### Glob Pattern Matching

| Pattern | Matches | Doesn't Match |
|---------|---------|---------------|
| `v*` | v1.0.0, v2.3.1 | 1.0.0, release-1 |
| `v1.*` | v1.0.0, v1.9.9 | v2.0.0 |
| `*` | Everything | - |
| `release-*` | release-1.0 | v1.0.0 |

### Semantic Version Comparison

Versions are compared semantically:
```
v1.0.0 < v1.0.1 < v1.1.0 < v2.0.0
```

Pre-release versions are handled:
```
v1.0.0-alpha < v1.0.0-beta < v1.0.0
```

## Notification Display

### Terminal Detection

The stub detects terminal capabilities:
- TTY vs non-TTY
- UTF-8 support
- ANSI color support

### Box Drawing

With UTF-8 and colors:
```
╭──────────────────────────────╮
│  Update available!           │
│                              │
│  Current: v1.0.0             │
│  Latest:  v1.2.0             │
│                              │
│  Continue? [y/N]             │
╰──────────────────────────────╯
```

Without UTF-8 (ASCII fallback):
```
+------------------------------+
|  Update available!           |
|                              |
|  Current: v1.0.0             |
|  Latest:  v1.2.0             |
|                              |
|  Continue? [y/N]             |
+------------------------------+
```

### Non-Interactive Mode

When stdout is not a TTY:
- No prompts
- Log-style output to stderr
- Honor `NOTIFY_ONLY` flag

## Cache Integration

### Metadata Storage

Update check state is stored in `.dlx-metadata.json`:

```json
{
  "version": "1.0.0",
  "cache_key": "97f5a39a4b819a25",
  "update_check": {
    "last_check": 1699123456789,
    "last_notification": 1699123456789,
    "latest_known": "v1.2.0"
  }
}
```

### Check Interval

Checks are skipped if:
```
(current_time - last_check) < check_interval
```

Default: 86400 seconds (daily)

## Error Handling

### Network Errors

| Error | Behavior |
|-------|----------|
| Timeout | Continue without check |
| DNS failure | Continue without check |
| HTTP 4xx/5xx | Continue without check |
| Parse error | Continue without check |

Update checks never block execution on network errors.

### Configuration Errors

| Error | Behavior |
|-------|----------|
| Invalid URL | Skip update checking |
| Invalid glob | Skip update checking |
| Missing SMFG | Skip update checking |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GH_TOKEN` | GitHub API token |
| `GITHUB_TOKEN` | Fallback token |
| `SMOL_SKIP_UPDATE_CHECK` | Disable update checking |
| `CI` | Disables interactive prompts |

## Platform Differences

### macOS

- Uses system curl (via mbedTLS)
- Respects system proxy settings
- UTF-8 terminal detection via `LC_ALL`/`LANG`

### Linux

- Uses bundled curl with mbedTLS
- Respects HTTP_PROXY/HTTPS_PROXY
- Terminal detection via `TERM` environment variable

### Windows

- Uses bundled curl with mbedTLS
- Respects system proxy (WinHTTP)
- Console mode detection for UTF-8

## Troubleshooting

### Update check not working

1. Verify SMFG config is embedded:
   ```bash
   # Check for SMFG magic in binary
   strings myapp | grep SMFG
   ```

2. Check configuration:
   ```bash
   DEBUG="*" ./myapp
   ```

3. Test API manually:
   ```bash
   curl https://api.github.com/repos/owner/repo/releases
   ```

### Rate limited

1. Set authentication:
   ```bash
   export GH_TOKEN="ghp_xxxx"
   ```

2. Increase check interval:
   ```json
   { "checkInterval": 604800 }  // Weekly
   ```

### Prompt not showing

1. Verify TTY:
   ```bash
   # Should show prompt
   ./myapp

   # Won't show prompt (piped)
   echo | ./myapp
   ```

2. Check flags include `SHOW_PROMPT`

## Related Documentation

- [Config Formats](../binject/docs/config-formats.md) - SMFG binary format
- [stubs-builder README](README.md) - Stub overview
