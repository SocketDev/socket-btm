# SEA-Enabled Smol Binaries Usage Guide

## Overview

Socket's smol Node.js binaries now support Single Executable Applications (SEA) with optional Brotli compression. This enables creating small, fast, self-contained executables with intelligent caching.

## Key Features

1. **SEA Support Enabled**: No need for --disable-single-executable-application
2. **Brotli Compression**: SEA blobs can be compressed for 70-80% size reduction
3. **Smart Caching**: Each SEA app gets its own cache entry based on SHA-512(spec + blob)
4. **Self-Extracting**: Compressed binaries automatically decompress and cache on first run
5. **Zero Overhead**: Cached binaries execute directly (no decompression)

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Compressed Smol Binary (e.g., socket-smol-darwin)  │
│  ├─ Decompressor stub (~50KB)                       │
│  ├─ SMOL_SPEC marker (optional, for cache key)    │
│  ├─ Compressed Node.js binary (~8-12MB)             │
│  └─ NODE_SEA_BLOB (optional, injected via postject) │
└─────────────────────────────────────────────────────┘
                    │
                    ▼ First Run
           ┌─────────────────┐
           │  Decompress      │
           │  + Cache         │
           │  ~/.socket/_dlx/ │
           └─────────────────┘
                    │
                    ▼ Subsequent Runs
           ┌─────────────────┐
           │  Execute Cached  │
           │  Binary Directly │
           │  (Zero Overhead) │
           └─────────────────┘
```

## Usage Patterns

### Pattern 1: Smol Binary Only (No SEA)

Use the smol binary as a drop-in Node.js replacement:

```bash
# Build the smol binary
pnpm --filter @socketbin/node-smol-builder run build

# Use it like regular Node.js
./dist/socket-smol script.js
```

**Cache Key**: SHA-512 of compressed binary
**Cache Location**: `~/.socket/_dlx/{hash}/node`

---

### Pattern 2: Smol Binary + SEA Injection

Create a single executable application from a JavaScript bundle:

```bash
# Step 1: Create your application bundle
# (Use esbuild, webpack, rollup, etc.)
cat > app.js << 'EOF'
console.log('Hello from SEA!')
EOF

# Step 2: Create SEA configuration
cat > sea-config.json << 'EOF'
{
  "main": "app.js",
  "output": "app.blob",
  "disableExperimentalSEAWarning": true,
  "useCodeCache": true
}
EOF

# Step 3: Generate SEA blob using smol binary
./dist/socket-smol --experimental-sea-config sea-config.json

# Step 4: Copy smol binary and inject SEA blob
cp ./dist/socket-smol ./my-app
npx postject ./my-app NODE_SEA_BLOB app.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
  --macho-segment-name NODE_SEA

# Step 5: Run your single executable
./my-app
# Output: Hello from SEA!
```

**Cache Key**: SHA-512 of compressed binary (unchanged after SEA injection)
**Cache Location**: `~/.socket/_dlx/{hash}/node`
**Note**: SEA blob is preserved in the cached binary

---

### Pattern 3: Compressed Smol Binary (Self-Extracting)

Create an optimally compressed, self-extracting binary:

```bash
# Step 1: Build with compression enabled
COMPRESS_BINARY=1 pnpm --filter @socketbin/node-smol-builder run build

# Step 2: The compressed binary is ready to use
./build/out/Compressed/node script.js
# First run: Decompresses to cache (~100ms overhead)
# Subsequent runs: Zero overhead (executes cached binary)
```

**Cache Key**: SHA-512 of compressed binary OR SMOL_SPEC if embedded
**Cache Location**: `~/.socket/_dlx/{hash}/node`

---

### Pattern 4: Compressed Smol + SEA (Best of Both Worlds)

Combine compression and SEA for maximum flexibility:

```bash
# Step 1: Build compressed smol binary
COMPRESS_BINARY=1 pnpm --filter @socketbin/node-smol-builder run build

# Step 2: Copy compressed binary
cp ./build/out/Compressed/node ./my-compressed-app

# Step 3: Generate SEA blob
cat > app.js << 'EOF'
console.log('Compressed SEA app!')
EOF

cat > sea-config.json << 'EOF'
{
  "main": "app.js",
  "output": "app.blob",
  "disableExperimentalSEAWarning": true
}
EOF

# Use regular Node.js to generate blob (smol binary works too)
node --experimental-sea-config sea-config.json

# Step 4: Inject SEA blob into compressed binary
npx postject ./my-compressed-app NODE_SEA_BLOB app.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
  --macho-segment-name NODE_SEA

# Step 5: Run your compressed SEA app
./my-compressed-app
# First run: Decompresses Node.js, caches it with SEA blob
# Subsequent runs: Executes cached binary with SEA blob (zero overhead)
```

**Cache Key**: SHA-512 of (compressed binary + SEA blob) OR SHA-512 of (SMOL_SPEC + SEA blob)
**Cache Location**: `~/.socket/_dlx/{hash}/node`
**Benefit**: Different SEA apps get different cache entries even if using same smol binary

---

## Automatic Brotli Compression for SEA Blobs

**SEA blobs are automatically compressed** with Brotli during generation (requires patch 013):

```bash
# Step 1: Create sea-config.json
cat > sea-config.json << 'EOF'
{
  "main": "app.js",
  "output": "app.blob",
  "disableExperimentalSEAWarning": true,
  "useCodeCache": true
}
EOF

# Step 2: Generate SEA blob (automatically compressed!)
node --experimental-sea-config sea-config.json
# Output: Socket SEA: Compressed blob: 50000000 → 10000000 bytes (80.0% reduction)

# Step 3: Inject the blob (it's already compressed)
npx postject ./my-app NODE_SEA_BLOB app.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
  --macho-segment-name NODE_SEA

# Step 4: Run (decompression happens automatically at startup)
./my-app
```

### Disabling Compression

If you need an uncompressed blob (e.g., for debugging):

```json
{
  "main": "app.js",
  "output": "app.blob",
  "useCompression": false
}
```

**Compression Stats**:
- Typical SEA blob: 10-50MB
- After automatic Brotli (quality 11): 2-10MB (70-80% reduction)
- Decompression time: ~50-100ms (one-time, at startup)
- **No manual steps required!**

---

## Cache Management

### Cache Location

Smol binaries use the same cache structure as npm/npx/socket-lib:

```
~/.socket/_dlx/
  ├── {hash1}/
  │   ├── node                    # Decompressed Node.js binary
  │   └── .dlx-metadata.json      # Cache metadata (checksum, timestamp)
  ├── {hash2}/
  │   ├── node                    # Different SEA app
  │   └── .dlx-metadata.json
  └── {hash3}/
      ├── node                    # Another SEA app
      └── .dlx-metadata.json
```

### Cache Key Calculation

The cache key is the first 16 characters of SHA-512 hash:

| Scenario | Cache Key |
|----------|-----------|
| Smol binary only | `sha512(compressed_binary).substring(0, 16)` |
| Smol + SMOL_SPEC | `sha512(spec_string).substring(0, 16)` |
| Smol + SEA blob | `sha512(compressed_binary)` (includes injected blob) |
| Smol + SMOL_SPEC + SEA | `sha512(spec_string + sea_blob).substring(0, 16)` |

**Key Insight**: When SMOL_SPEC is embedded, the cache key is based on the spec string (e.g., `@socketbin/cli-darwin-arm64@1.2.3`) plus the SEA blob if present. This enables deterministic caching across different machines and builds.

### Cache Verification

Each cached binary includes integrity verification:

```json
// ~/.socket/_dlx/{hash}/.dlx-metadata.json
{
  "checksum": "sha512-hex-of-decompressed-binary",
  "timestamp": 1704067200000,
  "version": "1.2.3",
  "spec": "@socketbin/cli-darwin-arm64@1.2.3"
}
```

### Manual Cache Clearing

```bash
# Clear all smol binary caches
rm -rf ~/.socket/_dlx/

# Clear specific cache entry
rm -rf ~/.socket/_dlx/{hash}/
```

---

## Performance Characteristics

### First Run (Cache Miss)

| Stage | Time | Notes |
|-------|------|-------|
| Detect SEA blob | ~10ms | Scans for NODE_SEA_FUSE marker |
| Calculate cache key | ~20ms | SHA-512 of spec + blob |
| Decompress binary | ~50-100ms | LZFSE/LZMA decompression |
| Decompress SEA blob | ~50-100ms | Brotli decompression (if compressed) |
| Write to cache | ~50ms | Atomic write + chmod +x |
| **Total** | **~180-280ms** | One-time cost |

### Subsequent Runs (Cache Hit)

| Stage | Time | Notes |
|-------|------|-------|
| Detect SEA blob | ~10ms | Scans for NODE_SEA_FUSE marker |
| Calculate cache key | ~20ms | SHA-512 of spec + blob |
| Verify cache | ~5ms | Check file exists + metadata |
| Execute cached binary | ~0ms | Direct exec, zero overhead |
| **Total** | **~35ms** | Startup overhead only |

---

## Best Practices

### 1. Use SMOL_SPEC for Versioned Releases

Embed a spec string in your binary for deterministic caching:

```bash
# During build
echo "SMOL_SPEC:@myapp/cli-darwin-arm64@1.0.0" >> my-app-compressed
```

This ensures:
- ✅ Same cache key across machines
- ✅ Version-specific cache entries
- ✅ Automatic cache invalidation on version bump

### 2. Compress SEA Blobs for Production

Always use Brotli compression for SEA blobs in production:

```json
{
  "main": "app.js",
  "output": "app.blob",
  "useCodeCache": true,
  "disableExperimentalSEAWarning": true
}
```

Then compress:
```bash
./socketsecurity_brotli2c --input app.blob --output app.blob.br
```

### 3. Test Both Compressed and Uncompressed

During development, test both modes:

```bash
# Development: Fast builds, no compression
pnpm build

# Production: Optimized builds, compression
COMPRESS_BINARY=1 pnpm build --prod
```

### 4. Monitor Cache Size

Smol binaries are ~20-30MB each. With many SEA apps, cache size can grow:

```bash
# Check cache size
du -sh ~/.socket/_dlx/

# Clear old entries (older than 30 days)
find ~/.socket/_dlx/ -type d -mtime +30 -exec rm -rf {} \;
```

---

## Troubleshooting

### Issue: "Cannot find cached binary"

**Cause**: Cache was cleared or corrupted
**Solution**: Binary will automatically decompress and re-cache on next run

### Issue: "SEA blob decompression failed"

**Cause**: Invalid Brotli compression or corrupted blob
**Solution**: Regenerate SEA blob without compression, then compress manually

### Issue: "Cache key collision"

**Cause**: Two different SEA apps have the same cache key (highly unlikely with SHA-512)
**Solution**: Clear cache and rebuild with different SMOL_SPEC

### Issue: "Slow startup on first run"

**Cause**: Normal behavior - decompression takes ~100-200ms
**Solution**: Subsequent runs are instant (cached)

---

## Technical Details

### Decompressor Architecture

The decompressor stub is a ~50KB C++ binary that:

1. Detects if SEA blob is present (NODE_SEA_FUSE marker)
2. Calculates cache key from SMOL_SPEC (if present) + SEA blob (if present)
3. Checks for cached binary at `~/.socket/_dlx/{hash}/node`
4. If cached: Verifies integrity and executes directly
5. If not cached: Decompresses, writes to cache, and executes

### Platform-Specific Details

| Platform | Binary Format | SEA Storage | Compression |
|----------|---------------|-------------|-------------|
| macOS | Mach-O | `__NODE_SEA` segment | LZFSE or LZMA |
| Linux | ELF | `NODE_SEA_BLOB` note | LZMA |
| Windows | PE | `NODE_SEA_BLOB` resource | LZMS |

### SEA Blob Format (with Brotli)

```
┌────────────────────────────────────────┐
│  BROT Magic (4 bytes)                  │  0x42 0x52 0x4F 0x54
├────────────────────────────────────────┤
│  Decompressed Size (8 bytes, LE)      │  uint64_t
├────────────────────────────────────────┤
│  Brotli-Compressed SEA Data            │  Variable size
│  (Original SEA serialized data)        │
└────────────────────────────────────────┘
```

---

## Examples

See `examples/` directory for complete working examples:
- `examples/simple-sea/` - Basic SEA app
- `examples/compressed-sea/` - Compressed SEA app
- `examples/multi-platform/` - Cross-platform SEA distribution

---

## References

- [Node.js SEA Documentation](https://nodejs.org/api/single-executable-applications.html)
- [Postject - SEA Injection Tool](https://github.com/postmanlabs/postject)
- [Brotli Compression](https://github.com/google/brotli)
- [npm/npx Caching Strategy](https://github.com/npm/cli/blob/latest/docs/lib/content/using-npm/scripts.md#:~:text=npm%20will%20cache%20the%20result)
