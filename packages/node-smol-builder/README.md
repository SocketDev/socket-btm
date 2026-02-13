# node-smol-builder

Custom Node.js v25.x binary builder with Socket security patches.

## What it does

This package Downloads the Node.js v25.x source code, applies Socket security patches, and then compiles a custom Node.js binary optimized for size and security.

## Building

```bash
pnpm run build              # Build for current platform
pnpm run build:all          # Build for all platforms
```

## Platform Support

Builds for 8 platforms:
- macOS (arm64, x64)
- Linux glibc (x64, arm64)
- Linux musl/Alpine (x64, arm64)
- Windows (x64, arm64)

## Output

Final binary: `build/<mode>/out/Final/node/node` (where `<mode>` is `dev` or `prod`).

Build stages (intermediate, managed by checkpoint system):
- Release → Stripped → Compressed → Final

**Build modes:**

| Mode | Debug Symbols | Inspector | Binary Size | Use Case |
|------|---------------|-----------|-------------|----------|
| `dev` | ✅ Enabled | ✅ Enabled | ~27 MB | Development, debugging |
| `prod` | ❌ Stripped | ❌ Disabled | ~12 MB | Production, distribution |

## Features

- Small ICU (English-only, Unicode escapes supported)
- SEA support with automatic Brotli compression (70-80% reduction)
- No npm, corepack, amaro (TypeScript), NODE_OPTIONS
- No inspector (prod builds only)

## Testing

Run Node.js's official test suite (~4000+ tests) against the built binary:

```bash
pnpm build                  # Build the binary first
pnpm test:node-suite        # Test current build (auto-detects dev/prod)
pnpm test:node-suite:dev    # Test dev build
pnpm test:node-suite:prod   # Test prod build
pnpm test:node-suite -- --verbose  # Show skipped tests
```

The runner expands test patterns, filters out tests for disabled features, and runs tests in parallel.

### Coverage

**Supported** (100% of node-smol APIs):
- Core: process, buffer, stream, timers, events, fs
- Networking: http, https, http2, tls, dns, tcp, udp
- Web APIs: fetch, WebSocket, streams, crypto
- Modules: CommonJS, ESM, hooks
- Async: hooks, local storage, workers, cluster
- Standard library: path, url, util, zlib, etc.

**Excluded** (disabled features):
- ICU/Intl (small-icu, English-only)
- npm, corepack, TypeScript/amaro
- NODE_OPTIONS, inspector/debugger (prod)

## SEA Usage

### sea-config.json

The `sea-config.json` file is used at build time to create SEA blobs. See [Node.js SEA documentation](https://nodejs.org/api/single-executable-applications.html) for full details.

```json
{
  "main": "app.js",
  "output": "app.blob",
  "disableExperimentalSEAWarning": true,
  "useSnapshot": false,
  "useCodeCache": true
}
```

| Field | Type | Description |
|-------|------|-------------|
| `main` | string | Entry point JavaScript file. |
| `output` | string | Output blob filename. |
| `disableExperimentalSEAWarning` | boolean | Suppress SEA warning at startup. |
| `useSnapshot` | boolean | Use V8 startup snapshot (faster cold start). |
| `useCodeCache` | boolean | Cache compiled code (faster warm start). |

> **Note:** `sea-config.json` is for blob creation. For update checking, create an `update-config.json` file and pass it to binject. See [Update Checking](#update-checking).

### Basic SEA (Single Executable Application)

```bash
# Create SEA config
echo '{"main": "app.js", "output": "app.blob", "disableExperimentalSEAWarning": true}' > sea-config.json

# Copy node-smol binary
cp build/prod/out/Final/node ./my-app

# Inject SEA blob using binject (auto-generates blob from .json config)
binject inject -e ./my-app -o ./my-app --sea sea-config.json
```

### SEA + VFS (Virtual Filesystem)

node-smol includes a Virtual Filesystem that embeds entire application directories in TAR format:

**Features:**
- ✅ Embed entire directories (TAR format)
- ✅ Transparent `fs` module access
- ✅ Standard `require()` works
- ✅ Separate from SEA blob (future-proof)
- ✅ Independent updates possible

## Update Checking

Self-extracting binaries include built-in update checking that can be configured at build time.

### Configuration

Update checking is configured when building binaries using binject's `--sea` flag with a sea-config.json file containing a `smol.update` section. See the [SEA Config Integration documentation](../binject/sea-config-integration.md#update-checking-configuration) for configuration details.

**Runtime behavior:**
- Updates skip automatically in CI environments or non-TTY contexts
- Can be disabled via environment variable (configured in `skip_env` field)
- Checks for updates on configurable intervals (default: 24 hours)

### Notification Display

The notification uses `binname` and `command` from the embedded config:

**Default config** (`binname: ""`, `command: "self-update"`):
```
┌─────────────────────────────────────────┐
│  Update available: 1.0.0 → 1.1.0        │
│  Run: self-update                       │
└─────────────────────────────────────────┘
```

**With binname** (`binname: "myapp"`, `command: "self-update"`):
```
┌─────────────────────────────────────────┐
│  Update available: 1.0.0 → 1.1.0        │
│  Run: myapp self-update                 │
└─────────────────────────────────────────┘
```

**Custom command** (`binname: "myapp"`, `command: "upgrade --latest"`):
```
┌─────────────────────────────────────────┐
│  Update available: 1.0.0 → 1.1.0        │
│  Run: myapp upgrade --latest            │
└─────────────────────────────────────────┘
```

When the user accepts the prompt, the stub executes `<binary_path> <command>` to trigger the update (e.g., `./myapp self-update`). Multiple arguments are supported.

**Interactive prompt** (`prompt: true`, `prompt_default: "y"`):
```
┌─────────────────────────────────────────┐
│  Update available: 1.0.0 → 1.1.0        │
│  Run: myapp self-update                 │
└─────────────────────────────────────────┘
Update to 1.1.0? [Y/n] _
```

## Checkpoint System

This package uses incremental checkpoints to speed up builds and CI:

1. **source-copied** - Node.js source downloaded and extracted
2. **source-patched** - 14 Socket security patches applied
3. **binary-released** - Source compiled to binary
4. **binary-stripped** - Debug symbols removed
5. **binary-compressed** - Binary compressed with binpress
6. **finalized** - Final binary ready for distribution

Checkpoints are cached and restored automatically in CI. See `packages/build-infra` for checkpoint implementation details.

## Patches

Socket applies **14 security and size-optimization patches** to Node.js v25.x:
- Security hardening (GCC LTO fixes, ARM64 branch protection)
- Build system fixes (Python 3 compatibility)
- ICU polyfills for small-icu builds
- VFS integration and bootstrap
- Platform-specific fixes (V8 TypeIndex on macOS)

## License

MIT
