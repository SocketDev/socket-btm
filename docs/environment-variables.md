# Environment Variables Supported in socket-btm

This document lists all environment variables supported by socket-btm packages (node-smol-builder, binject, etc.) for both runtime and build-time configuration.

## Runtime Environment Variables

These variables control the behavior of node-smol binaries at runtime.

### Cache & Directory Configuration

#### `SOCKET_DLX_DIR`
**Description**: Override the base directory for dlx cache and extracted files.
**Default**: `~/.socket/_dlx/`
**Example**: `SOCKET_DLX_DIR=/tmp/socket-cache`
**Use Case**: Testing, CI environments, or systems where home directory is read-only.

#### `SOCKET_HOME`
**Description**: Override Socket's home directory (parent of `_dlx/`).
**Default**: `~/.socket/`
**Example**: `SOCKET_HOME=/opt/socket`
**Use Case**: System-wide installations or containerized environments.



### Update Checking

#### `<skip_env>` (Configurable via sea-config.json)
**Description**: Skip automatic update checking in binaries with embedded update config. The environment variable name is specified by the `skip_env` field in the `smol.update` section of `sea-config.json` when building the binary with `binject inject --sea`.
**Default**: `0` (update checking enabled)
**Example**: `SOCKET_SKIP_UPDATE_CHECK=1` (if `"skip_env": "SOCKET_SKIP_UPDATE_CHECK"` was configured in sea-config.json)
**Use Case**: CI environments, air-gapped systems, or when update notifications are unwanted.
**Configuration**: Set via `skip_env` field in the `smol.update` section of `sea-config.json`. See [SEA Config Integration](../packages/binject/sea-config-integration.md#update-checking-configuration) for details.

#### `CI`
**Description**: Indicates running in CI environment (checked by update checker).
**Default**: Not set
**Example**: `CI=true` (set by GitHub Actions, GitLab CI, etc.)
**Use Case**: Automatically disables update checking when detected.

#### `CONTINUOUS_INTEGRATION`
**Description**: Alternative CI environment indicator (checked by update checker).
**Default**: Not set
**Example**: `CONTINUOUS_INTEGRATION=true`
**Use Case**: Legacy CI detection, automatically disables update checking when detected.


### Ephemeral Configuration

These variables are user-controllable but automatically deleted after bootstrap to prevent leaking into child processes.

#### `SMOL_FAKE_ARGV`
**Description**: Controls process.argv behavior in SEA mode (whether to insert virtual entrypoint at argv[1]). Can be set manually by users to override default behavior, or set by wrapper scripts. The environment variable name can be customized via `smol.fakeArgvEnv` in sea-config.json.
**Default**: Not set (auto-detected based on VFS presence)
**Values**: `0`/`false` = don't insert entrypoint, `1`/`true` = insert entrypoint
**Example**: `SMOL_FAKE_ARGV=0`
**Use Case**: Override argv[1] behavior for compatibility with tools that inspect process.argv; automatically cleared after bootstrap regardless of who set it.

### Internal (Ephemeral)

These variables are set by the C++ stub for internal communication with JavaScript bootstrap code, then automatically deleted. Users should never set these manually.

#### `SMOL_CACHE_KEY`
**Description**: Cache key (16-character SHA-512 hash prefix) for the current compressed binary. The C++ stub computes this hash from the binary's compressed data and passes it to JavaScript bootstrap via this environment variable. This allows the JavaScript code to know which cache directory (`~/.socket/_dlx/<cache_key>/`) to use for the extracted binary without recomputing the hash.
**Default**: Computed from binary hash by C++ stub
**Example**: `SMOL_CACHE_KEY=abc123def4567890`
**Use Case**: Internal communication between C++ stub and JavaScript bootstrap; automatically deleted after `process.smol` is initialized.

#### `SMOL_STUB_PATH`
**Description**: Absolute path to the stub binary. The C++ stub sets this when it successfully opens itself via `/proc/self/exe` or other methods, then passes the path to JavaScript bootstrap. This allows JavaScript code to know the original stub location (used for `process.smol.stubPath`) even when the extracted binary is running from cache. On Linux, this is primarily used as a fallback when `/proc/self/exe` is unavailable in restricted environments.
**Default**: Computed by C++ stub from successful open path
**Example**: `SMOL_STUB_PATH=/usr/local/bin/socket`
**Use Case**: Internal communication from C++ stub to JavaScript; enables `process.smol.stubPath` to reference the original compressed binary location; automatically deleted after bootstrap.

#### `SMOL_FAKE_ARGV_NAME`
**Description**: Name of the environment variable to check for fake argv control. The C++ stub reads the configured variable name from embedded SMFG config (`smol.fakeArgvEnv` in sea-config.json) and sets this meta-variable to communicate it to the bootstrap code. This allows the fake argv control variable name to be customized per binary.
**Default**: Set by C++ stub from embedded config (falls back to `SMOL_FAKE_ARGV` if not configured)
**Example**: `SMOL_FAKE_ARGV_NAME=MY_CLI_FAKE_ARGV`
**Use Case**: Internal communication from C++ stub to JavaScript bootstrap about which environment variable name to check for argv control; automatically deleted after bootstrap.

## Build-Time Environment Variables

These variables control the build process for node-smol binaries and SEA injection.

### Build Configuration

#### `BUILD_ALL_FROM_SOURCE`
**Description**: Build all compression tools from source instead of downloading prebuilt binaries.
**Default**: `0` (use prebuilt binaries)
**Example**: `BUILD_ALL_FROM_SOURCE=1`
**Use Case**: Systems where prebuilt binaries are unavailable or untrusted.

#### `BUILD_JOBS`
**Description**: Number of parallel jobs for Node.js compilation.
**Default**: Auto-calculated based on CPU cores and available RAM
**Example**: `BUILD_JOBS=4`
**Use Case**: Override default parallelism for faster builds or memory-constrained systems.

#### `BUILD_MODE`
**Description**: Build mode for node-smol binaries.
**Default**: `dev` (local development), `prod` (when `CI` or `CONTINUOUS_INTEGRATION` is set)
**Values**: `dev` (with debug symbols), `prod` (stripped, optimized)
**Example**: `BUILD_MODE=dev`
**Use Case**: Development builds include debug symbols and inspector support.

#### `BUILD_TOOLS_FROM_SOURCE`
**Description**: Build compression tools (binpress, etc.) from source.
**Default**: `0` (use prebuilt binaries)
**Example**: `BUILD_TOOLS_FROM_SOURCE=1`
**Use Case**: Build only compression tools from source while using other prebuilt components.

### Authentication

#### `GH_TOKEN` / `GITHUB_TOKEN`
**Description**: GitHub personal access token for API requests. `GH_TOKEN` takes precedence if both are set.
**Default**: Not set
**Example**: `GH_TOKEN=ghp_xxxxxxxxxxxx`
**Use Case**:
- **Runtime**: Used by update checker in C++ stub to avoid GitHub API rate limits when checking for updates
- **Build**: Used by release scripts to create GitHub releases via Octokit

## Summary Table

| Variable | Scope | Category | Required | Default |
|----------|-------|----------|----------|---------|
| `SOCKET_DLX_DIR` | Runtime | Cache | No | `~/.socket/_dlx/` |
| `SOCKET_HOME` | Runtime | Cache | No | `~/.socket/` |
| `<skip_env>` (configurable) | Runtime | Updates | No | `0` |
| `CI` | Runtime | Updates | No | Not set |
| `CONTINUOUS_INTEGRATION` | Runtime | Updates | No | Not set |
| `SMOL_FAKE_ARGV` | Runtime | Ephemeral | No | Not set |
| `SMOL_CACHE_KEY` | Runtime | Internal | No | Computed |
| `SMOL_FAKE_ARGV_NAME` | Runtime | Internal | No | Computed |
| `SMOL_STUB_PATH` | Runtime | Internal | No | Computed |
| `BUILD_ALL_FROM_SOURCE` | Build | Build | No | `0` |
| `BUILD_JOBS` | Build | Build | No | Auto |
| `BUILD_MODE` | Build | Build | No | `dev` (local), `prod` (CI) |
| `BUILD_TOOLS_FROM_SOURCE` | Build | Build | No | `0` |
| `GH_TOKEN` | Runtime + Build | Auth | No | Not set |
| `GITHUB_TOKEN` | Runtime + Build | Auth | No | Not set |

## Usage Examples

### Development Build with Custom Cache
```bash
SOCKET_HOME=/tmp/socket-dev BUILD_MODE=dev pnpm build
```

### Skip Update Checks in CI
```bash
# Using Socket CLI's configured skip_env (SOCKET_SKIP_UPDATE_CHECK).
SOCKET_SKIP_UPDATE_CHECK=1 ./socket-cli scan

# CI is automatically detected.
CI=1 ./socket-cli scan

# Generic example (replace with your configured skip_env name).
YOUR_SKIP_ENV_VAR=1 ./your-binary
```

### Build with Parallel Jobs
```bash
BUILD_JOBS=8 pnpm build
```

### Build All Tools from Source
```bash
BUILD_ALL_FROM_SOURCE=1 pnpm build
```

## Security Notes

### Update Checker CI Detection
Update checking is automatically disabled when:
- `CI` or `CONTINUOUS_INTEGRATION` environment variables are set.
- The configured `skip_env` variable is set (e.g., `SOCKET_SKIP_UPDATE_CHECK=1` for Socket CLI).
- Output is not a TTY (non-interactive terminal).

### Token Security
Never commit `GITHUB_TOKEN` or `GH_TOKEN` to version control. Use CI secrets or environment files excluded from git.

**Runtime Usage**: The update checker uses these tokens to authenticate GitHub API requests when checking for new releases. This helps avoid rate limits (60 requests/hour unauthenticated vs 5000 requests/hour authenticated). Tokens are optional at runtime - update checking works without them but may hit rate limits in high-usage scenarios.

**Build Usage**: Release scripts use these tokens to create and manage GitHub releases via the Octokit API.

### Ephemeral Environment Variables
**User-Controllable**: `SMOL_FAKE_ARGV` (or custom name configured via `smol.fakeArgvEnv` in sea-config.json) can be set manually by users or wrapper scripts to control argv behavior. It is automatically cleared after bootstrap to prevent leaking into child processes.

**C++ Stub → JavaScript Communication**: `SMOL_CACHE_KEY`, `SMOL_FAKE_ARGV_NAME`, and `SMOL_STUB_PATH` are set by the C++ stub to pass information to JavaScript bootstrap code. These should never be set manually as they contain computed values from the binary's internal state.

**Configuration**: The C++ stub reads embedded SMFG config (from `sea-config.json`'s `smol` section) and uses it to:
- Set `SMOL_FAKE_ARGV_NAME` to the configured variable name (defaults to `SMOL_FAKE_ARGV`)
- Initialize the fake argv control variable if not already set by the user

All ephemeral variables are automatically deleted after `process.smol` initialization completes.
