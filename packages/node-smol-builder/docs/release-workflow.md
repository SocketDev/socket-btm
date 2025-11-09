# Release Workflow

Complete guide for releasing Node.js smol binaries to GitHub Releases for consumption by socket-cli.

## Overview

The release process:
1. Build binaries for all platforms (macOS, Linux, Windows × x64, ARM64)
2. Package binaries with SMOL_SPEC markers for deterministic caching
3. Upload to GitHub Releases as versioned archives
4. socket-cli downloads and uses binaries

## Release Strategy

### Versioning

- **Version source**: `packages/node-smol-builder/package.json`
- **Git tag format**: `node-smol-v{version}` (e.g., `node-smol-v1.2.0`)
- **Semver**: Follow semantic versioning (MAJOR.MINOR.PATCH)

### Release Assets

Each release includes platform-specific archives:

| Platform | Archive | Size | Notes |
|----------|---------|------|-------|
| macOS ARM64 | `node-smol-darwin-arm64.tar.gz` | ~8-12 MB | M1/M2/M3 Macs |
| macOS x64 | `node-smol-darwin-x64.tar.gz` | ~8-12 MB | Intel Macs |
| Linux x64 | `node-smol-linux-x64.tar.gz` | ~8-12 MB | Standard Linux (glibc) |
| Linux ARM64 | `node-smol-linux-arm64.tar.gz` | ~8-12 MB | ARM servers, Raspberry Pi (glibc) |
| Linux musl x64 | `node-smol-linux-musl-x64.tar.gz` | ~8-12 MB | Alpine Linux x64 |
| Linux musl ARM64 | `node-smol-linux-musl-arm64.tar.gz` | ~8-12 MB | Alpine Linux ARM64 |
| Windows x64 | `node-smol-win32-x64.zip` | ~8-12 MB | Standard Windows |
| Windows ARM64 | `node-smol-win32-arm64.zip` | ~8-12 MB | Windows on ARM |

Each archive contains a compressed smol binary with embedded SMOL_SPEC marker. GitHub Releases provides SHA-256 checksums automatically for all assets.

### SMOL_SPEC Marker

Each binary includes an embedded spec string for deterministic cache keys:

```
SMOL_SPEC:@socketbin/node-smol-{platform}-{arch}@{version}\n
```

Example: `SMOL_SPEC:@socketbin/node-smol-darwin-arm64@1.2.0\n`

This enables the self-extracting decompressor to create unique cache entries per version and platform.

---

## Local Release (Manual)

### Prerequisites

1. **GitHub CLI**: Install and authenticate
   ```bash
   brew install gh          # macOS
   gh auth login            # Authenticate
   ```

2. **Built binaries**: Either from local builds or CI cache
   ```bash
   # Build for current platform
   pnpm build --prod

   # Or download from CI artifacts
   gh run download --name node-smol-darwin-arm64
   ```

### Step 1: Update Version

Edit `package.json`:
```json
{
  "version": "1.3.0"
}
```

### Step 2: Create Draft Release

```bash
pnpm release
```

This will:
- Find all cached binaries in `build/cache/node-compiled-*`
- Embed SMOL_SPEC markers
- Create platform-specific archives
- Calculate SHA-256 checksums (for release notes)
- Create **draft** GitHub release
- Upload all archives

**Output:**
```
Node.js Smol Binary Release
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Version: 1.3.0
Tag: node-smol-v1.3.0
Mode: DRAFT

Preparing darwin-arm64...
  Found binary: build/cache/node-compiled-darwin-arm64
  Embedded SMOL_SPEC: @socketbin/node-smol-darwin-arm64@1.3.0
  Creating archive: node-smol-darwin-arm64.tar.gz
  SHA-256: abc123...
  Size: 10.2 MB

✓ Created 8 release archives
✓ Release created as draft!

View release:
  gh release view node-smol-v1.3.0

Publish release:
  gh release edit node-smol-v1.3.0 --draft=false
```

### Step 3: Review and Publish

```bash
# View draft release
gh release view node-smol-v1.3.0 --web

# Publish when ready
gh release edit node-smol-v1.3.0 --draft=false

# Or publish directly in one step
pnpm release:publish
```

### Options

| Command | Effect |
|---------|--------|
| `pnpm release` | Create draft release |
| `pnpm release:publish` | Create and publish immediately |
| `pnpm release:dry-run` | Simulate release (no uploads) |
| `pnpm release --force` | Overwrite existing release |

---

## CI/CD Release (Automated)

### Trigger Methods

#### Method 1: Git Tag (Recommended)

```bash
# Update version in package.json
vim packages/node-smol-builder/package.json

# Commit changes
git add packages/node-smol-builder/package.json
git commit -m "chore: bump version to 1.3.0"

# Create and push tag
git tag node-smol-v1.3.0
git push origin node-smol-v1.3.0
```

This triggers `.github/workflows/release.yml` which:
1. Builds binaries for all 8 platforms in parallel
2. Downloads all artifacts
3. Creates GitHub release

#### Method 2: Manual Workflow Dispatch

```bash
gh workflow run release.yml \
  --field version=1.3.0 \
  --field publish=false
```

Or via GitHub UI:
1. Go to **Actions** → **Release Smol Binaries**
2. Click **Run workflow**
3. Enter version (e.g., `1.3.0`)
4. Choose publish mode (draft or publish)

### CI Workflow Details

**`.github/workflows/release.yml`** includes:

**Build Jobs** (parallel):
- `build-macos-arm64` - macOS M1 runner
- `build-macos-x64` - macOS Intel runner
- `build-linux-x64` - Ubuntu x64 runner
- `build-linux-arm64` - Docker with QEMU (cross-compile)
- `build-linux-musl-x64` - Docker with Alpine (x64)
- `build-linux-musl-arm64` - Docker with Alpine (ARM64)
- `build-windows-x64` - Windows runner
- `build-windows-arm64` - Windows runner (cross-compile)

**Release Job** (after all builds):
- Downloads all 8 binaries
- Renames to expected format
- Runs `scripts/release.mjs`
- Uploads to GitHub Releases

**Timing:**
- Build jobs: 30-60 minutes each (parallel)
- Release job: ~5 minutes
- **Total**: ~60-90 minutes

---

## Usage in socket-cli

### Downloading Binaries

```bash
# Download specific platform
VERSION="1.3.0"
PLATFORM="darwin"       # darwin, linux, linux-musl, win32
ARCH="arm64"            # arm64, x64

curl -L "https://github.com/SocketDev/socket-btm/releases/download/node-smol-v${VERSION}/node-smol-${PLATFORM}-${ARCH}.tar.gz" | tar xz
```

### Verifying Checksums

GitHub Releases provides SHA-256 checksums automatically for all assets. View checksums:

```bash
# View release and checksums
gh release view node-smol-v${VERSION}

# Or download and verify manually
curl -L "https://github.com/SocketDev/socket-btm/releases/download/node-smol-v${VERSION}/node-smol-${PLATFORM}-${ARCH}.tar.gz" -o node-smol.tar.gz
shasum -a 256 node-smol.tar.gz
# Compare with checksum shown in GitHub release notes
```

### Integration Example

**`socket-cli/.node-source/download.sh`**:
```bash
#!/bin/bash
set -e

VERSION="1.3.0"
PLATFORM=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

# Normalize arch
if [ "$ARCH" = "x86_64" ]; then
  ARCH="x64"
elif [ "$ARCH" = "aarch64" ]; then
  ARCH="arm64"
fi

# Normalize platform
if [ "$PLATFORM" = "darwin" ]; then
  PLATFORM="darwin"
elif [ "$PLATFORM" = "linux" ]; then
  PLATFORM="linux"
fi

URL="https://github.com/SocketDev/socket-btm/releases/download/node-smol-v${VERSION}/node-smol-${PLATFORM}-${ARCH}.tar.gz"

echo "Downloading smol binary: ${PLATFORM}-${ARCH} v${VERSION}"
curl -L "$URL" | tar xz

chmod +x node
./node --version
```

---

## Release Checklist

### Pre-Release

- [ ] All tests passing (`pnpm test`)
- [ ] Build succeeds on all platforms
- [ ] Version updated in `package.json`
- [ ] CHANGELOG.md updated (user-facing changes only)
- [ ] Git working tree is clean

### Release

- [ ] Create git tag: `git tag node-smol-v{version}`
- [ ] Push tag: `git push origin node-smol-v{version}`
- [ ] CI builds all platforms (check GitHub Actions)
- [ ] Draft release created successfully
- [ ] Review release notes and assets
- [ ] Publish release

### Post-Release

- [ ] Verify binaries download correctly
- [ ] Test binaries on each platform
- [ ] Update socket-cli to use new version
- [ ] Announce release (if public)

---

## Troubleshooting

### Issue: "Binary not found, skipping {platform}-{arch}"

**Cause**: Binary wasn't built for that platform

**Solution**:
```bash
# Build for specific platform (cross-compile)
PLATFORM=linux ARCH=arm64 pnpm build --prod

# Or download from CI
gh run download --name node-smol-linux-arm64
mv node build/cache/node-compiled-linux-arm64
```

### Issue: "Release {tag} already exists"

**Cause**: Tag was already released

**Solutions**:
```bash
# Option 1: Delete and recreate (destructive)
gh release delete node-smol-v1.3.0 --yes
pnpm release --force

# Option 2: Bump version
# Edit package.json to 1.3.1
pnpm release
```

### Issue: "GitHub CLI not authenticated"

**Cause**: Not logged in to GitHub CLI

**Solution**:
```bash
gh auth login
# Follow prompts
```

### Issue: "Permission denied (create release)"

**Cause**: Missing `contents: write` permission

**Solution**: Update `.github/workflows/release.yml`:
```yaml
permissions:
  contents: write
```

### Issue: "Checksum verification failed"

**Cause**: Binary was corrupted during download

**Solution**:
```bash
# Re-download binary
rm node-smol-*.tar.gz
curl -L {URL} -o node-smol-darwin-arm64.tar.gz

# Get checksum from release notes
gh release view node-smol-v1.3.0

# Verify manually
shasum -a 256 node-smol-darwin-arm64.tar.gz
# Compare with checksum from release notes
```

---

## Advanced Usage

### Building Without Compression

If you need uncompressed binaries for debugging:

```bash
# Build without compression
pnpm build --prod --no-compress-binary

# Release will use uncompressed binaries (~20-30 MB vs 8-12 MB)
pnpm release
```

### Cross-Platform Builds

Use Docker for cross-platform builds:

```bash
# Build Linux ARM64 on macOS
docker run --rm \
  --platform linux/arm64 \
  -v $PWD:/workspace \
  -w /workspace \
  ubuntu:22.04 \
  bash -c "apt-get update && apt-get install -y build-essential python3 && pnpm build --prod"
```

### Custom Release Notes

Edit release notes after creation:

```bash
# Create draft release
pnpm release

# Edit release notes
gh release edit node-smol-v1.3.0 --notes-file CUSTOM_NOTES.md
```

---

## Release Notes Template

**`RELEASE_NOTES.md`**:
```markdown
# Node.js Smol Binary v{version}

Optimized Node.js binaries with SEA support and automatic Brotli compression.

## Highlights

- New feature X
- Improved performance Y
- Fixed bug Z

## Platform Builds

- **node-smol-darwin-arm64.tar.gz** (10.2 MB)
- **node-smol-darwin-x64.tar.gz** (10.5 MB)
- **node-smol-linux-x64.tar.gz** (9.8 MB)
- **node-smol-linux-arm64.tar.gz** (9.9 MB)
- **node-smol-linux-musl-x64.tar.gz** (9.7 MB)
- **node-smol-linux-musl-arm64.tar.gz** (9.8 MB)
- **node-smol-win32-x64.zip** (11.1 MB)
- **node-smol-win32-arm64.zip** (11.0 MB)

## Features

- SEA (Single Executable Application) support enabled
- Automatic Brotli compression for SEA blobs (70-80% reduction)
- Self-extracting compressed binaries with smart caching
- V8 Lite Mode for smaller binaries (prod builds)
- Small ICU (English-only, supports Unicode escapes)

## Checksums

SHA-256 checksums for each archive are available in the release notes and via GitHub's automatic checksum feature.

## Usage

```bash
# Download and extract
curl -L https://github.com/SocketDev/socket-btm/releases/download/node-smol-v{version}/node-smol-darwin-arm64.tar.gz | tar xz

# Verify checksum (view in release notes or use gh CLI)
gh release view node-smol-v{version}

# Use
./node --version
```
```

---

## References

- [GitHub Releases Documentation](https://docs.github.com/en/repositories/releasing-projects-on-github)
- [GitHub CLI Documentation](https://cli.github.com/manual/)
- [Semantic Versioning](https://semver.org/)
