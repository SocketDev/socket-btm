# socket-btm (Build This Mess)

**"Bless This Mess" → BTM → Build Tree Manager**

Dedicated repository for Socket's build infrastructure, binary builders, and model builders. This repo manages the complex build process for Node.js binaries, ML models, and native dependencies that power Socket's security analysis.

## Overview

socket-btm is the centralized build infrastructure for Socket's binary artifacts:

- **Node.js Smol Binaries**: Optimized, SEA-enabled Node.js builds (~20-30MB vs 50MB)
- **ML Model Builders**: CodeT5 and MiniLM model compilation for offline inference
- **Native Dependencies**: ONNX Runtime and Yoga Layout builds
- **Build Infrastructure**: Shared tools, patches, and build scripts

## Repository Structure

```
socket-btm/
├── packages/
│   ├── build-infra/           # Shared build utilities and helpers
│   ├── node-smol-builder/     # Node.js custom binary builder (SEA-enabled)
│   ├── codet5-models-builder/ # CodeT5 model builder for code analysis
│   ├── minilm-builder/        # MiniLM model builder for embeddings
│   ├── models/                # Compiled ML models (blessed releases)
│   ├── onnxruntime/           # ONNX Runtime native bindings
│   └── yoga-layout/           # Yoga Layout engine for CLI rendering
└── README.md
```

## Key Features

### Node.js Smol Builder

Builds optimized Node.js binaries with:

- **SEA Support**: Single Executable Applications enabled by default
- **Automatic Brotli Compression**: SEA blobs compressed automatically during generation (70-80% reduction)
- **Smart Caching**: Decompressed binaries cached at `~/.socket/_dlx/{hash}/`
- **Size Optimizations**:
  - Small ICU (English-only, supports Unicode escapes)
  - V8 Lite Mode (prod builds)
  - No npm, corepack, inspector, sqlite
  - Binary stripping + optional compression
- **Platform Support**: macOS (ARM64/x64), Linux (glibc/musl × ARM64/x64), Windows (ARM64/x64)
- **Final Size**: ~20-30MB (vs 50MB default Node.js)

See [`packages/node-smol-builder/docs/sea-usage.md`](packages/node-smol-builder/docs/sea-usage.md) for complete usage guide.

### Build Infrastructure Improvements

#### Windows Build Simplifications

Switched from manual `configure.py` invocation to Node.js's standard `vcbuild.bat`:

**Before** (51 lines):
```javascript
const configureCommand = WIN32 ? whichBinSync('python') : './configure'
// + 45 lines of environment variable management
```

**After** (19 lines):
```javascript
const configureCommand = WIN32 ? 'vcbuild.bat' : './configure'
const configureArgs = WIN32 ? ['noprojgen', ...convertToVcbuildFlags(flags)] : flags
```

**Benefits**:
- ✅ 63% code reduction
- ✅ Automatic Visual Studio detection via `vswhere.exe`
- ✅ Zero manual environment configuration
- ✅ Better error messages from vcbuild.bat
- ✅ Matches Node.js core build process exactly

#### SEA + Compression Architecture

Smol binaries support both self-extraction AND SEA injection:

```
┌─────────────────────────────────────────────────────┐
│  Compressed Smol Binary                              │
│  ├─ Decompressor stub (~50KB)                       │
│  ├─ SMOL_SPEC marker (for deterministic caching)  │
│  ├─ Compressed Node.js (~8-12MB)                    │
│  └─ NODE_SEA_BLOB (optional, via postject)          │
└─────────────────────────────────────────────────────┘
                    │
                    ▼ First Run
           ┌─────────────────┐
           │  Decompress      │
           │  SHA-512 cache   │
           │  ~/.socket/_dlx/ │
           └─────────────────┘
                    │
                    ▼ Subsequent Runs
           ┌─────────────────┐
           │  Execute Cached  │
           │  (Zero Overhead) │
           └─────────────────┘
```

**Cache Key Strategy**:
- **With SMOL_SPEC**: `sha512(spec + sea_blob).substring(0, 16)`
- **Without**: `sha512(compressed_binary).substring(0, 16)`
- Different SEA apps → Different cache entries

## Quick Start

### Downloading Pre-Built Binaries

The easiest way to use smol binaries is to download from GitHub Releases:

```bash
VERSION="1.2.0"
PLATFORM="darwin"       # darwin, linux, linux-musl, win32
ARCH="arm64"            # arm64, x64

curl -L "https://github.com/SocketDev/socket-btm/releases/download/node-smol-v${VERSION}/node-smol-${PLATFORM}-${ARCH}.tar.gz" | tar xz

./node --version
```

See [Release Workflow](packages/node-smol-builder/docs/release-workflow.md) for complete documentation.

### Building Smol Node.js

```bash
# Clone the repo
git clone git@github.com:SocketDev/socket-btm.git
cd socket-btm

# Install dependencies
pnpm install

# Build smol binary (compressed by default)
cd packages/node-smol-builder
pnpm build

# Build with production optimizations (V8 Lite, smaller but slower JS)
pnpm build --prod

# Build without compression (faster, larger binary)
pnpm build --no-compress-binary
```

**Output Locations** (all gitignored):
- `build/out/Release/node` - Unstripped binary (44 MB)
- `build/out/Stripped/node` - Stripped binary (20-30 MB)
- `build/out/Compressed/node` - Self-extracting compressed binary (8-12 MB, default)
- `build/out/Final/node` - Distribution binary (compressed by default)
- `dist/socket-smol` - E2E test binary
- `dist/socket-sea` - SEA-ready test binary

**Cleanup:**
```bash
pnpm clean        # Remove all build artifacts
pnpm clean:build  # Remove build/ only
pnpm clean:dist   # Remove dist/ only
```

### Creating a SEA Application

```bash
# Step 1: Build smol binary with compression
COMPRESS_BINARY=1 pnpm build --prod

# Step 2: Create your app
cat > app.js << 'EOF'
console.log('Hello from SEA!')
EOF

# Step 3: Generate SEA configuration
cat > sea-config.json << 'EOF'
{
  "main": "app.js",
  "output": "app.blob",
  "disableExperimentalSEAWarning": true,
  "useCodeCache": true
}
EOF

# Step 4: Generate SEA blob (automatically compressed with Brotli!)
node --experimental-sea-config sea-config.json
# Output: Socket SEA: Compressed blob: 50000000 → 10000000 bytes (80.0% reduction)

# Step 5: Copy and inject the compressed blob
cp build/out/Compressed/node ./my-app
npx postject ./my-app NODE_SEA_BLOB app.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
  --macho-segment-name NODE_SEA

# Step 6: Run
./my-app
# First run: ~200ms (decompress + cache)
# Subsequent: ~35ms (cached execution)
```

## Development Workflow

### Making Changes to Smol Builder

```bash
cd packages/node-smol-builder

# Edit patches
vim patches/013-socketsecurity_sea_brotli_v24.10.0.patch

# Edit build script
vim scripts/build.mjs

# Edit compression tools
vim additions/003-compression-tools/socketsecurity_macho_decompress.cc

# Build and test
pnpm build --clean  # Force clean build
pnpm build          # Incremental build (uses cache)
```

### Adding New Patches

Patches are the **ONLY** way to modify Node.js source:

```bash
cd packages/node-smol-builder

# 1. Make changes to Node.js source
cd build/node-source
# ... edit files ...

# 2. Generate patch
git diff > ../../patches/014-my-feature_v24.10.0.patch

# 3. Add patch header
vim patches/014-my-feature_v24.10.0.patch
# Add:
# # @node-versions: v24.10.0+
# # @description: Brief description
# # @requires: any-dependencies

# 4. Test patch application
pnpm build --clean
```

See [`packages/node-smol-builder/patches/README.md`](packages/node-smol-builder/patches/README.md) (if it exists) for patch creation guide.

## Architecture Deep Dive

### Patch System

All Node.js modifications use Git patches:

| Patch | Purpose |
|-------|---------|
| `001-socketsecurity_bootstrap_preexec` | Bootstrap loader injection point |
| `002-socketsecurity_brotli_builtin` | Brotli-compressed built-in modules |
| `003-socketsecurity_brotli_friend` | Brotli friend declarations |
| `004-socketsecurity_brotli2c_build` | Build brotli2c compression tool |
| `005-socketsecurity_disable_modules` | Disable unnecessary modules |
| `006-socketsecurity_fix_gcc_lto` | GCC LTO compatibility fix |
| `007-socketsecurity_sea_pkg` | ⚠️ **REMOVED** (SEA now enabled by default) |
| `008-socketsecurity_localecompare_polyfill` | Polyfill for small-icu |
| `009-socketsecurity_normalize_polyfill` | Polyfill for small-icu |
| `010-socketsecurity_fix_gyp_py3_hashlib` | Python 3 compatibility |
| `011-socketsecurity_fix_abseil_windows_duplicate_symbols` | Windows build fix |
| `012-socketsecurity_fix_inspector_protocol_windows` | Windows inspector fix |
| `013-socketsecurity_sea_brotli` | ✨ **NEW**: Brotli compression for SEA blobs |

### Compression Tools

Platform-specific decompressors:

| Platform | Decompressor | Compression | Binary Format |
|----------|--------------|-------------|---------------|
| macOS | `socketsecurity_macho_decompress` | LZFSE / LZMA | Mach-O |
| Linux | `socketsecurity_elf_decompress` | LZMA | ELF |
| Windows | `socketsecurity_pe_decompress` | LZMS | PE |

All decompressors:
- ✅ Detect SEA blobs via NODE_SEA_FUSE marker
- ✅ Include SEA blob in cache key calculation
- ✅ Support SMOL_SPEC for deterministic caching
- ✅ Verify cached binary integrity with SHA-512

### Build Cache System

Smart caching at multiple levels:

```
┌─────────────────────────────────────────────────────┐
│  Build Cache (.cache/node.hash)                     │
│  - Tracks patch files, additions, build script      │
│  - Invalidates on content changes                   │
│  - Skips entire build if nothing changed            │
└─────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────┐
│  Compilation Cache (cache/node-compiled-*)          │
│  - Caches compiled Node.js binary                   │
│  - Skips compilation if successful                  │
│  - Restores from cache on subsequent builds         │
└─────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────┐
│  Runtime Cache (~/.socket/_dlx/)                    │
│  - Caches decompressed binaries by SHA-512          │
│  - Separate entry per SEA app                       │
│  - Zero overhead for cached executions              │
└─────────────────────────────────────────────────────┘
```

## Testing

### Unit Tests

```bash
cd packages/node-smol-builder
pnpm test
```

### Integration Tests

```bash
# Build and test smol binary
pnpm build
./dist/socket-smol --version

# Test SEA injection
./scripts/test-sea.mjs

# Test compression
./scripts/test-compression.mjs
```

### E2E Tests

```bash
# From socket-cli repo (after copying binaries)
pnpm --filter @socketsecurity/cli run e2e:smol
pnpm --filter @socketsecurity/cli run e2e:sea
```

## CI/CD

### GitHub Actions Workflows

```yaml
# .github/workflows/build-smol.yml
name: Build Smol Node.js
on: [push, pull_request]
jobs:
  build:
    strategy:
      matrix:
        os: [macos-latest, ubuntu-latest, windows-latest]
        node: ['20', '22']
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
      - run: pnpm install
      - run: pnpm --filter @socketbin/node-smol-builder build --prod
      - run: pnpm --filter @socketbin/node-smol-builder test
```

**Key Differences from socket-cli**:
- ❌ **NO `GYP_MSVS_VERSION`** - vcbuild.bat handles VS detection
- ❌ **NO `GYP_MSVS_OVERRIDE_PATH`** - vswhere.exe finds VS automatically
- ✅ Simpler workflow configuration
- ✅ Better error messages on build failures

## Performance

### Build Times

| Configuration | Time (macOS M1) | Time (Linux x64) | Time (Windows) |
|---------------|-----------------|------------------|----------------|
| Dev build | ~15 min | ~25 min | ~35 min |
| Prod build | ~30 min | ~45 min | ~60 min |
| Clean build | +5 min | +5 min | +10 min |
| Cached build | ~1 min | ~1 min | ~1 min |

### Binary Sizes

| Build Type | Size (stripped) | Size (compressed) | Notes |
|------------|----------------|-------------------|-------|
| Default Node.js v24 | ~50MB | N/A | Full build |
| Smol (dev) | ~40-50MB | ~15-20MB | Full V8 + TurboFan |
| Smol (prod) | ~23-27MB | ~8-12MB | V8 Lite Mode |
| SEA blob (typical) | N/A | ~2-10MB | 70-80% Brotli compression |

### Runtime Performance

| Operation | First Run | Cached Run | Notes |
|-----------|-----------|------------|-------|
| Smol binary only | ~100ms | ~0ms | Decompression overhead |
| Smol + SEA | ~200ms | ~35ms | + SEA blob decompression |
| JavaScript execution | 5-10x slower | 5-10x slower | V8 Lite Mode (prod) |
| WASM execution | Normal speed | Normal speed | Unaffected by V8 Lite |
| I/O operations | Normal speed | Normal speed | No impact |

## Contributing

### Before You Commit

```bash
# Run linter
pnpm lint

# Run type check
pnpm type

# Run tests
pnpm test

# Build to verify
pnpm build
```

### Pull Request Checklist

- [ ] Patches apply cleanly to Node.js v24.10.0
- [ ] Build succeeds on macOS, Linux, and Windows
- [ ] Tests pass
- [ ] Documentation updated
- [ ] CHANGELOG.md updated (user-facing changes only)

## Troubleshooting

### Build Failures

**Error**: `patch does not apply`
```bash
# Regenerate patches for current Node.js version
cd packages/node-smol-builder
pnpm regenerate-patches
```

**Error**: `Visual Studio not found` (Windows)
```bash
# Install Visual Studio 2022 with C++ workload
# OR: Use vcbuild.bat (now automatic!)
```

**Error**: `Python not found`
```bash
# Install Python 3.6+
brew install python     # macOS
apt install python3     # Linux
choco install python    # Windows
```

### Runtime Issues

**Issue**: Slow startup
```bash
# Normal on first run (decompression)
# Subsequent runs should be instant (cached)
# If slow every time, check cache:
ls -lh ~/.socket/_dlx/
```

**Issue**: Cache size growing
```bash
# Each SEA app adds ~20-30MB to cache
# Clear old entries:
find ~/.socket/_dlx/ -type d -mtime +30 -exec rm -rf {} \;
```

## Links

- **Main Repository**: [SocketDev/socket-cli](https://github.com/SocketDev/socket-cli)
- **Build Registry**: [SocketDev/socket-registry](https://github.com/SocketDev/socket-registry)
- **Documentation**: [docs.socket.dev](https://docs.socket.dev)
- **Node.js SEA Docs**: [nodejs.org/api/single-executable-applications.html](https://nodejs.org/api/single-executable-applications.html)

## License

MIT
