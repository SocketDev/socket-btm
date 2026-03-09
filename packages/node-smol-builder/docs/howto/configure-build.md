# How to Configure Node.js Build

Guide for customizing Node.js build configuration flags.

## Overview

node-smol-builder compiles Node.js from source with customized configure flags to produce an optimized, minimal binary suitable for SMOL compression.

## Build Modes

### Development Mode

```bash
pnpm run build
# or
pnpm run build --dev
```

Characteristics:
- Faster compilation
- Larger binary (~93 MB)
- Debug symbols available
- Suitable for testing

### Production Mode

```bash
pnpm run build --prod
```

Characteristics:
- Optimized compilation (ThinLTO)
- Smaller binary (~61 MB stripped, ~22 MB compressed)
- No debug symbols
- Suitable for distribution

## Configure Flags Reference

### Core Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--ninja` | Enabled | Use Ninja build system (faster) |
| `--without-npm` | Enabled | Exclude npm (saves ~30 MB) |
| `--without-corepack` | Enabled | Exclude corepack |
| `--without-inspector` | Enabled | Exclude Chrome DevTools inspector |

### Internationalization

| Flag | Effect |
|------|--------|
| `--with-intl=small-icu` | Minimal ICU (English only, ~5 MB) |
| `--with-intl=full-icu` | Full ICU (all locales, ~25 MB) |
| `--without-intl` | No ICU (breaks some APIs) |

Default: `--with-intl=small-icu`

### Optimization Flags

| Flag | Mode | Description |
|------|------|-------------|
| `--enable-lto` | prod | Link Time Optimization |
| `--v8-enable-webassembly-trap-based-bounds-checks` | all | Better WASM performance |

### Security Flags

| Flag | Description |
|------|-------------|
| `--openssl-default-cipher-list` | Set default ciphers |
| `--openssl-use-def-ca-store` | Use system CA store |

## Customizing the Build

### Editing Configure Flags

The configure flags are set in `scripts/build-released/build-released.mjs`:

```javascript
const configureFlags = [
  '--ninja',
  '--without-npm',
  '--without-corepack',
  '--without-inspector',
  '--with-intl=small-icu',
  // Add your custom flags here
];
```

### Adding Custom Patches

1. Create patch file in `patches/source-patched/`:
   ```diff
   Socket Security: My custom patch

   Description of changes.

   --- lib/original.js.orig
   +++ lib/original.js
   @@ -1,3 +1,4 @@
    existing line
   +new line
    existing line
   ```

2. Patches are applied in filename order during `source-patched` stage

### Including/Excluding Components

**Include npm:**
```javascript
// Remove this line:
'--without-npm',
```

**Include inspector:**
```javascript
// Remove this line:
'--without-inspector',
```

**Full ICU:**
```javascript
// Change from:
'--with-intl=small-icu',
// To:
'--with-intl=full-icu',
```

## Build Stages

```
Stage 0: source-copied    → Copy Node.js source from upstream/node
Stage 1: source-patched   → Apply Socket patches (14 patches)
Stage 2: binary-released  → Configure and compile
Stage 3: binary-stripped  → Strip debug symbols (prod only)
Stage 4: binary-compressed → LZFSE compression (prod only)
Stage 5: finalized        → Copy to Final output directory
```

### Rebuilding After Config Changes

```bash
# Clean and rebuild from configure stage
pnpm run clean
pnpm run build
```

For faster iteration, skip earlier stages:
```bash
# Only rebuild from binary-released (uses cached source)
pnpm run build --from-checkpoint=source-patched
```

## Platform-Specific Configuration

### macOS

```javascript
// macOS-specific flags
if (process.platform === 'darwin') {
  flags.push('--shared-libuv=false');
}
```

Code signing is handled automatically after build.

### Linux

```javascript
// Linux-specific flags
if (process.platform === 'linux') {
  flags.push('--shared-zlib=false');
  flags.push('--shared-openssl=false');
}
```

Static linking ensures portability across distributions.

### Cross-Platform

Cross-compilation is handled via Docker:

```bash
# Build Linux from macOS
./docker/build.sh
```

## Binary Size Impact

| Configuration | Binary Size | Compressed |
|---------------|-------------|------------|
| Default (dev) | ~93 MB | ~27 MB |
| Default (prod) | ~61 MB | ~22 MB |
| Without ICU | ~50 MB | ~18 MB |
| With npm | ~150 MB | ~45 MB |
| Full ICU | ~85 MB | ~30 MB |

## Common Customizations

### Minimal Build (smallest size)

```javascript
const configureFlags = [
  '--ninja',
  '--without-npm',
  '--without-corepack',
  '--without-inspector',
  '--without-intl',  // Warning: breaks some APIs
  '--enable-lto',
];
```

### Development Build (with debugging)

```javascript
const configureFlags = [
  '--ninja',
  '--without-npm',
  '--without-corepack',
  // Include inspector for debugging:
  // '--without-inspector',
  '--with-intl=small-icu',
  '--debug-node',  // Enable debug symbols
];
```

### Full-Featured Build

```javascript
const configureFlags = [
  '--ninja',
  // Include npm:
  // '--without-npm',
  '--without-corepack',
  // Include inspector:
  // '--without-inspector',
  '--with-intl=full-icu',
];
```

## Troubleshooting

### Configure fails with "unknown option"

Option may not be available in current Node.js version. Check:
```bash
cd upstream/node
./configure --help | grep <option>
```

### Build fails after config change

Clean build artifacts:
```bash
pnpm run clean
pnpm run build
```

### Binary too large

Check which components are included:
```bash
# List linked libraries
otool -L build/dev/out/Final/node  # macOS
ldd build/dev/out/Final/node       # Linux
```

## Related Documentation

- [Build System](../build-system.md) - Pipeline architecture
- [Patch System](../patch-system.md) - Node.js patching
- [Troubleshooting](../troubleshooting.md) - Common issues
