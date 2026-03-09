# build-infra Documentation

Documentation for build infrastructure utilities.

## Overview

build-infra provides shared C/C++ libraries and JavaScript build utilities used across all binary tool packages. It includes checkpoint management, tool installation, and cross-platform build helpers.

## Documentation Index

### Architecture

- [caching-strategy.md](caching-strategy.md) - Checkpoint and caching strategy
- [wasm-sync-transforms.md](wasm-sync-transforms.md) - WASM synchronous wrapper generation

### Quick Reference

| Component | Files | Purpose |
|-----------|-------|---------|
| Checkpoint | `checkpoint-manager.mjs` | Build artifact caching |
| Tool Install | `tool-installer.mjs` | Build tool management |
| Constants | `constants.mjs` | Build stages, checkpoints |
| Cache Key | `cache-key.mjs` | Dependency-based cache keys |

### C Header Files (16 files)

| File | Purpose |
|------|---------|
| `debug_common.h` | Debug logging with namespace filtering |
| `dlx_cache_common.h` | DLX binary cache (~/.socket/_dlx/) |
| `file_io_common.c/.h` | Cross-platform file I/O |
| `file_utils.c/.h` | File utilities (mkdir, permissions) |
| `gzip_compress.c/.h` | Platform-abstracted gzip |
| `path_utils.c/.h` | Cross-platform path manipulation |
| `posix_compat.h` | POSIX compatibility for Windows |
| `process_exec.c/.h` | Safe process execution |
| `tar_create.c/.h` | TAR archive creation |
| `tmpdir_common.h` | Temp directory selection |

### Build Stages

```javascript
export const BUILD_STAGES = {
  RELEASE: 'Release',
  STRIPPED: 'Stripped',
  COMPRESSED: 'Compressed',
  FINAL: 'Final'
}
```

### Checkpoint Chains

```javascript
export const CHECKPOINT_CHAINS = {
  dev: ['source-copied', 'source-patched', 'binary-released', ...],
  prod: ['source-copied', 'source-patched', 'binary-released', ...]
}
```

### Key JavaScript Modules

| Module | Exports | Purpose |
|--------|---------|---------|
| `checkpoint-manager.mjs` | 12 | Artifact management, validation |
| `tool-installer.mjs` | 10 | Package managers, elevated install |
| `constants.mjs` | 38 | BYTES, BUILD_STAGES, CHECKPOINTS |
| `cache-key.mjs` | 4 | Cache key generation |
| `platform-mappings.mjs` | 8 | Platform/arch/libc detection |

### DLX Cache Structure

```
~/.socket/_dlx/
├── <cache_key_1>/
│   ├── node
│   └── .dlx-metadata.json
├── <cache_key_2>/
│   └── ...
```

## Related Packages

- [node-smol-builder](../../node-smol-builder/docs/) - Primary consumer
- [bin-infra](../../bin-infra/docs/) - Binary-specific utilities
- [binject](../../binject/docs/) - Uses file/path utilities
