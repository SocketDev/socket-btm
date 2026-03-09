# How to Build from Source

Step-by-step guide for building node-smol from source.

## Prerequisites

### System Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| RAM | 8 GB | 16 GB |
| Free Disk | 10 GB | 20 GB |
| CPU | 4 cores | 8+ cores |

### Required Tools

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | See `.node-version` | Build scripts |
| Python | 3.11+ | Node.js build |
| Clang/GCC | 14+ | C/C++ compiler |
| Ninja | 1.10+ | Build system |
| pnpm | 8+ | Package manager |

### Platform-Specific

**macOS:**
```bash
xcode-select --install  # Xcode Command Line Tools
brew install ninja python
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt-get install build-essential ninja-build python3
```

**Linux (Fedora/RHEL):**
```bash
sudo dnf install gcc gcc-c++ ninja-build python3
```

## Step 1: Clone and Install

```bash
git clone https://github.com/socketsecurity/socket-btm.git
cd socket-btm
pnpm install
```

## Step 2: Build Dependencies

Build the required packages first:

```bash
# Build LIEF library
pnpm --filter lief-builder run build

# Build self-extracting stubs
pnpm --filter stubs-builder run build

# Build compression tool
pnpm --filter binpress run build

# Build injection tool
pnpm --filter binject run build
```

## Step 3: Build node-smol

### Development Build

```bash
pnpm --filter node-smol-builder run build
```

This creates:
- `build/dev/out/Release/node/node` - Full binary (~93 MB)
- `build/dev/out/Stripped/node/node` - Stripped (~61 MB)
- `build/dev/out/Compressed/node/node` - Compressed (~22 MB)
- `build/dev/out/Final/node/node` - Distribution ready

### Production Build

```bash
pnpm --filter node-smol-builder run build --prod
```

Production enables ThinLTO for smaller binary size.

### Clean Build

```bash
pnpm --filter node-smol-builder run clean
pnpm --filter node-smol-builder run build
```

## Build Stages

The build proceeds through 6 stages:

```
Stage 0: source-copied
├── Clone Node.js from upstream submodule
└── Output: ~200 MB source

Stage 1: source-patched
├── Apply 14 patches
├── Copy additions/
└── Output: ~200 MB patched source

Stage 2: binary-released
├── Configure Node.js
├── Compile with Ninja
└── Output: ~93 MB binary

Stage 3: binary-stripped
├── Strip debug symbols
└── Output: ~61 MB binary

Stage 4: binary-compressed
├── LZFSE compression
└── Output: ~22 MB binary

Stage 5: finalized
├── Copy to Final/
└── Output: ~22 MB distribution binary
```

## Using Checkpoints

### Skip to Specific Stage

```bash
# Start from stripped binary
pnpm run build --from-checkpoint=binary-stripped
```

### Stop at Specific Stage

```bash
# Stop after compilation (no compression)
pnpm run build --stop-at=binary-released
```

### Build Only

```bash
# Only build, skip final stages
pnpm run build --build-only
```

## Expected Timing

| Stage | Dev Build | Prod Build |
|-------|-----------|------------|
| source-copied | ~30 sec | ~30 sec |
| source-patched | ~10 sec | ~10 sec |
| binary-released | ~12 min | ~25 min |
| binary-stripped | ~30 sec | ~30 sec |
| binary-compressed | ~60 sec | ~60 sec |
| finalized | ~5 sec | ~5 sec |
| **Total** | **~15 min** | **~30 min** |

Note: Times vary based on hardware. First build downloads dependencies.

## Verifying the Build

### Check Binary

```bash
# Check binary exists
ls -la build/dev/out/Final/node/node

# Check version
./build/dev/out/Final/node/node --version

# Check binary size
du -h build/dev/out/Final/node/node
# Expected: ~22 MB
```

### Run Tests

```bash
# Run integration tests
pnpm --filter node-smol-builder run test

# Run Node.js test suite (subset)
pnpm --filter node-smol-builder run test:node-suite
```

## Troubleshooting

### "Patch failed to apply"

```bash
# Clean and rebuild
pnpm --filter node-smol-builder run clean
pnpm --filter node-smol-builder run build
```

### "ninja: error: loading 'build.ninja'"

```bash
# Configure wasn't run, clean and rebuild
pnpm --filter node-smol-builder run clean
pnpm --filter node-smol-builder run build
```

### "Cannot find module '@socketsecurity/lib'"

```bash
# Install dependencies
pnpm install
```

### Build hangs at compilation

- Check available RAM (need ~8 GB)
- Reduce parallelism: Edit ninja call to use `-j 4`

### macOS: "codesign failed"

```bash
# Sign manually with ad-hoc signature
codesign --sign - --force build/dev/out/Final/node/node
```

## Output Files

After successful build:

```
build/dev/
├── source/                    # Patched Node.js source
├── out/
│   ├── Release/node/node     # Full binary (93 MB)
│   ├── Stripped/node/node    # Stripped (61 MB)
│   ├── Compressed/node/node  # Compressed (22 MB)
│   └── Final/node/node       # Distribution (22 MB)
├── checkpoints/
│   ├── source-copied.json
│   ├── source-patched.json
│   ├── binary-released.json
│   ├── binary-stripped.json
│   ├── binary-compressed.json
│   └── finalized.json
└── .cache/
    └── cache-validation.hash
```

## Next Steps

- [Rebuild After Edits](rebuild-after-edits.md) - Make changes and rebuild
- Run `pnpm --filter node-smol-builder run test` to verify the build
- See [binject docs](../../../binject/docs/) for SEA/VFS injection
