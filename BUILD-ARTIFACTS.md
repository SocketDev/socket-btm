# Build Artifact Management Strategy

## Overview

socket-btm uses a **simple, in-tree build approach** with comprehensive `.gitignore` patterns. This document explains how build artifacts are managed.

## Key Principle: Simple & Clean

Since this is a fresh repository, we use the simplest possible approach:
- ✅ Build artifacts in standard locations (`build/`, `dist/`)
- ✅ Comprehensive `.gitignore` catches all artifacts
- ✅ No external build directories needed
- ✅ No Docker required (initially)
- ✅ Easy cleanup with `pnpm clean`

## Directory Structure

```
socket-btm/packages/node-smol-builder/
├── build/                  # IGNORED - Ephemeral build artifacts
│   ├── node-source/        #   Node.js v24.10.0 source (500 MB)
│   ├── out/                #   Compiled binaries (44-600 MB)
│   ├── cache/              #   Binary cache (44 MB)
│   └── .cache/             #   Hash cache (<1 KB)
├── dist/                   # IGNORED - E2E test binaries
│   ├── socket-smol         #   Test binary (8-30 MB)
│   └── socket-sea          #   SEA-ready test binary (20-30 MB)
├── patches/                # TRACKED - Node.js patches (source)
├── additions/              # TRACKED - Node.js additions (source)
│   ├── 002-bootstrap-loader/
│   │   └── internal/
│   │       └── socketsecurity_bootstrap_loader.js  # IGNORED - Generated
│   └── 003-compression-tools/
│       └── socketsecurity_*_decompress  # TRACKED - Pre-built tools
└── scripts/                # TRACKED - Build scripts
```

## What Gets Tracked

### ✅ Source Code (Committed)
- `patches/` - Node.js patches (text files)
- `additions/` - Node.js additions (C++ source, scripts)
- `scripts/` - Build automation scripts
- `docs/` - Documentation
- `package.json`, `README.md`, etc.

### ❌ Build Artifacts (Gitignored)
- `build/` - Entire build directory (500 MB - 2 GB during compilation)
- `dist/` - Test binaries (10-50 MB)
- `.cache/` - Build caches
- `node_modules/` - Dependencies
- `*.log` - Build logs
- Generated files (e.g., `socketsecurity_bootstrap_loader.js`)

## Build Workflow

### Local Development

```bash
# 1. Build
pnpm build
# Creates:
#   build/node-source/    (500 MB - Node.js source)
#   build/out/            (44-600 MB - compiled binaries)
#   dist/socket-smol      (8-30 MB - test binary)

# 2. Test
./dist/socket-smol --version

# 3. Commit (only source changes)
git add patches/013-my-feature.patch
git commit -m "feat: add my feature"
# Build artifacts are NOT committed (gitignored)

# 4. Clean up (optional)
pnpm clean
```

### CI/CD Workflow

```yaml
# .github/workflows/build-smol.yml
- name: Build
  run: pnpm --filter @socketbin/node-smol-builder build

# Artifacts are created in build/ and dist/
# GitHub Actions workspace is ephemeral, so artifacts are auto-cleaned
```

## Cleanup Commands

| Command | Effect | Use Case |
|---------|--------|----------|
| `pnpm clean` | Remove `build/`, `dist/`, `.cache/`, generated files | Standard cleanup |
| `pnpm clean:build` | Remove `build/` only | Keep test binaries |
| `pnpm clean:dist` | Remove `dist/` only | Keep build cache |

## Disk Space Usage

| Phase | Size | Location |
|-------|------|----------|
| Fresh clone | ~5 MB | Source code only |
| After `pnpm install` | ~50 MB | + `node_modules/` |
| During build | 2-3 GB | + `build/node-source/` + compilation |
| After build | 600 MB - 1 GB | + `build/out/` + `dist/` |
| After `pnpm clean` | ~50 MB | Back to just source + deps |

## Why This Approach?

### ✅ Advantages

1. **Simple**: Standard directory structure, no magic
2. **Fast**: No Docker overhead, no symlinks, no path mapping
3. **Debuggable**: Artifacts in expected locations
4. **IDE Friendly**: Standard project structure
5. **Git Clean**: Comprehensive `.gitignore` catches everything
6. **No Migration**: Fresh repo, no legacy patterns

### ❌ When This Doesn't Work

- Cross-platform builds (building Linux on macOS) → Use Docker later
- Reproducible builds (locked toolchains) → Use Docker later
- Shared build artifacts → Use external cache directory

### 🔮 Future Enhancements

If needed later, we can add:
- Docker build mode (`pnpm build:docker`)
- External build directory (`SMOL_BUILD_DIR` env var)
- Cached build artifacts (using CI artifact cache)

But for now: **KISS** (Keep It Simple, Stupid)

## .gitignore Strategy

### Root `.gitignore`

Uses glob patterns to catch artifacts anywhere in the monorepo:

```gitignore
**/build/         # All build directories
**/dist/          # All distribution directories
**/.cache/        # All cache directories
**/node_modules/  # All dependencies
**/*.log          # All log files
```

This approach:
- ✅ Works for all packages in the monorepo
- ✅ Future-proof (new packages automatically covered)
- ✅ Simple (no per-package configuration needed)

### Package-Level `.gitignore`

Minimal, only for package-specific patterns:

```gitignore
# WASM-specific
wasm-bundle/pkg/
wasm-bundle/target/

# Generated files
002-bootstrap-loader/internal/socketsecurity_bootstrap_loader.js
```

## Pre-Commit Safety

Git will refuse to commit build artifacts:

```bash
$ git add build/out/Release/node
The following paths are ignored by one of your .gitignore files:
build/out/Release/node

$ git status
On branch main
nothing to commit, working tree clean
```

If you accidentally stage artifacts:
```bash
$ git add -f build/out/Release/node  # Force add (bypasses .gitignore)
$ git status
On branch main
Changes to be committed:
  new file:   build/out/Release/node (44 MB)

# Fix: unstage the file
$ git reset HEAD build/out/Release/node
```

## FAQ

### Q: Why not use external build directories?

**A:** This is a fresh repo with good `.gitignore`. External builds add complexity (symlinks, path mapping, configuration) without benefit. If we need external builds later (for caching or isolation), we can add them.

### Q: Why not use Docker?

**A:** Docker is useful for cross-platform builds and reproducible environments, but adds 30-60 seconds of overhead per build. For local dev, building directly is faster. We can add Docker later for CI/CD or cross-compilation.

### Q: What if I want to keep build artifacts?

**A:** Don't run `pnpm clean`. The artifacts stay in `build/` and `dist/` until you clean them. They're gitignored, so they won't be committed accidentally.

### Q: Where do blessed releases go?

**A:** socket-btm is a **builder**, not a **distributor**. Blessed binaries are copied to:
- `socket-cli/.node-source/out/Release/node` (for CLI distribution)
- Or published to a separate releases repository

Build artifacts in socket-btm are ephemeral and never committed.

### Q: How do I inspect build artifacts?

**A:** Just look in `build/`:
```bash
ls build/node-source/       # Node.js source
ls build/out/Release/       # Compiled binary
ls build/out/Stripped/      # Stripped binary
ls build/out/Compressed/    # Compressed binary
cat build/build.log         # Build log
```

All artifacts are in standard locations.

### Q: Can I commit pre-built compression tools?

**A:** Yes! Pre-built tools in `additions/003-compression-tools/` are tracked:
- `socketsecurity_macho_decompress` (macOS)
- `socketsecurity_elf_decompress` (Linux)
- `socketsecurity_pe_decompress.exe` (Windows)

These are small (~100 KB) and rarely change, so they're committed for convenience.

## References

- [Node.js Build Documentation](https://github.com/nodejs/node/blob/main/BUILDING.md)
- [Git .gitignore Documentation](https://git-scm.com/docs/gitignore)
- [XDG Base Directory Specification](https://specifications.freedesktop.org/basedir-spec/basedir-spec-latest.html)
