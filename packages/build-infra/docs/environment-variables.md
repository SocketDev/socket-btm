# Environment Variables Reference

Complete reference for environment variables used across build-infra modules.

## DLX Cache Configuration

These variables control the binary extraction cache location.

### SOCKET_DLX_DIR

**Full override of DLX cache directory.**

```bash
# Example: Use custom cache location
export SOCKET_DLX_DIR="/custom/cache"
# Result: Cache at /custom/cache/<cache_key>/node
```

Priority: **1** (highest)

### SOCKET_HOME

**Base directory for Socket tools (appends `/_dlx`).**

```bash
# Example: Use custom Socket home
export SOCKET_HOME="/opt/socket"
# Result: Cache at /opt/socket/_dlx/<cache_key>/node
```

Priority: **2**

### Default Behavior

When no environment variables are set:
- **Unix**: `~/.socket/_dlx/<cache_key>/node`
- **Windows**: `%USERPROFILE%\.socket\_dlx\<cache_key>\node.exe`

### Fallback

If home directory cannot be determined:
- **Unix**: `/tmp/.socket/_dlx/`
- **Windows**: `C:\temp\.socket\_dlx\`

### Cache Directory Structure

```
~/.socket/_dlx/
├── 97f5a39a4b819a25/           # Cache key (SHA-512 first 16 hex chars)
│   ├── node                     # Extracted binary (node.exe on Windows)
│   └── .dlx-metadata.json       # Metadata file
├── a1b2c3d4e5f67890/
│   ├── node
│   └── .dlx-metadata.json
└── ...
```

## Debug Logging

### DEBUG

**Namespace-filtered debug logging (supports patterns).**

```bash
# Enable all debug output
export DEBUG="*"

# Enable specific namespaces
export DEBUG="smol:*"
export DEBUG="binject:extract,binject:inject"

# Exclude namespaces (prefix with -)
export DEBUG="*,-verbose:*"

# Multiple patterns (comma-separated)
export DEBUG="smol:*,binject:*"
```

Pattern matching:
- `*` - Matches everything
- `namespace:*` - Matches all in namespace
- `namespace:specific` - Matches exact namespace
- `-namespace` - Excludes namespace

Usage in code (via `debug_common.h`):
```c
#include "socketsecurity/build-infra/debug_common.h"

DEBUG_INIT("smol:extract");  // Initialize with namespace

DEBUG_LOG("Processing file: %s", filename);
// Output (if DEBUG=smol:*): [smol:extract] Processing file: myapp
```

## Build Configuration

### BUILD_MODE

**Build mode selection (dev or prod).**

```bash
export BUILD_MODE="dev"   # Development build (faster, larger)
export BUILD_MODE="prod"  # Production build (optimized, smaller)
```

Affects:
- Optimization levels
- Debug symbol inclusion
- Compression optimization (wasm-opt in prod)
- Binary stripping

### BUILD_ALL_FROM_SOURCE

**Force building all dependencies from source.**

```bash
export BUILD_ALL_FROM_SOURCE="1"
# Forces source builds instead of downloading prebuilt binaries
```

Useful for:
- Reproducible builds
- Custom patches
- Platforms without prebuilts

### TARGET_ARCH

**Target architecture for cross-compilation.**

```bash
export TARGET_ARCH="arm64"  # Build for ARM64
export TARGET_ARCH="x64"    # Build for x86-64
```

Used by stub builders and binary tools.

## CI/CD Detection

### CI

**Generic CI environment indicator.**

```bash
# Set by most CI systems
export CI="true"
```

Effects:
- Uses 100% CPU cores (vs 75% locally)
- Disables interactive prompts
- Enables verbose logging

### GITHUB_ACTIONS

**GitHub Actions specific detection.**

```bash
# Set automatically by GitHub Actions
export GITHUB_ACTIONS="true"
```

### GITLAB_CI

**GitLab CI specific detection.**

```bash
# Set automatically by GitLab CI
export GITLAB_CI="true"
```

## Tool Installation

### GH_TOKEN / GITHUB_TOKEN

**GitHub API authentication token.**

```bash
export GH_TOKEN="ghp_xxxxxxxxxxxx"
# or
export GITHUB_TOKEN="ghp_xxxxxxxxxxxx"
```

Used for:
- GitHub Releases API access
- Higher rate limits
- Private repository access

Priority: `GH_TOKEN` takes precedence over `GITHUB_TOKEN`

## Emscripten/WASM

### EMSDK

**Emscripten SDK root directory.**

```bash
export EMSDK="/path/to/emsdk"
```

Auto-detected from:
1. `EMSDK` environment variable
2. `~/.emsdk` (default install location)
3. System PATH

### EMSDK_NODE

**Node.js binary for Emscripten.**

```bash
export EMSDK_NODE="/path/to/node"
```

Usually set by `emsdk activate`.

## Rust Toolchain

### CARGO_HOME

**Cargo home directory.**

```bash
export CARGO_HOME="~/.cargo"
```

### RUSTUP_HOME

**Rustup home directory.**

```bash
export RUSTUP_HOME="~/.rustup"
```

## SMOL Stub Variables

### SMOL_FAKE_ARGV_NAME

**Override argv[0] for SMOL stub execution.**

```bash
export SMOL_FAKE_ARGV_NAME="my-custom-name"
```

Used by stubs to report a custom process name.

### SMOL_STUB_PATH

**Override stub binary path.**

```bash
export SMOL_STUB_PATH="/path/to/custom/stub"
```

### SMOL_CACHE_KEY

**Override cache key for extraction.**

```bash
export SMOL_CACHE_KEY="custom_cache_key"
```

## Platform Detection

These are read-only, set by the system:

| Variable | Platform | Example Value |
|----------|----------|---------------|
| `HOME` | Unix | `/home/<user>` |
| `USERPROFILE` | Windows | `<drive>:\<user-profile>` |
| `TMPDIR` | macOS | `/var/folders/<...>/T/` |
| `TEMP` | Windows | `<temp-directory>` |
| `XDG_RUNTIME_DIR` | Linux | `/run/user/<uid>` |

## Priority Summary

For cache directory resolution:

```
1. SOCKET_DLX_DIR (full path override)
2. SOCKET_HOME + "/_dlx"
3. $HOME/.socket/_dlx
4. /tmp/.socket/_dlx (fallback)
```

## Troubleshooting

### Cache not being used

Check cache location:
```bash
# See effective cache directory
ls -la ~/.socket/_dlx/
# or with override
ls -la $SOCKET_DLX_DIR/
```

### Debug output not showing

Ensure DEBUG is set correctly:
```bash
# Test with all debug output
DEBUG="*" ./binflate compressed -o output
```

### Build using wrong mode

Verify BUILD_MODE:
```bash
echo $BUILD_MODE  # Should be "dev" or "prod"
```

## Related Documentation

- [Caching Strategy](caching-strategy.md) - DLX cache architecture
- [C Headers API](c-headers-api.md) - Header file reference
