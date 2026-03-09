# node-smol-builder Documentation

Documentation for the Node.js SMOL binary builder.

## Getting Started

```bash
# Install dependencies
pnpm install

# Build node-smol (uses checkpoints for incremental builds)
pnpm run build

# Production build
pnpm run build --prod
```

## Typical User Workflow

```
1. BUILD NODE-SMOL
   pnpm run build
        │
        ▼
2. CREATE YOUR APP
   Write your Node.js app (app.js)
        │
        ▼
3. CREATE SEA BLOB
   node --experimental-sea-config sea-config.json
        │
        ▼
4. INJECT INTO BINARY
   binject inject -e node-smol -o myapp --sea app.blob
        │
        ▼
5. DISTRIBUTE
   Ship myapp (~22MB self-extracting binary)
```

## Overview

node-smol-builder creates a compressed, self-extracting Node.js binary (~22MB) with integrated SEA (Single Executable Application) and VFS (Virtual Filesystem) support.

## Documentation Index

### Architecture

- [build-system.md](build-system.md) - Build pipeline, stages, and checkpoint system
- [source-packages.md](source-packages.md) - Source package architecture and sync flow
- [patch-system.md](patch-system.md) - Node.js patch system (14 patches)
- [fast-webstreams-sync.md](fast-webstreams-sync.md) - Fast WebStreams ESM-to-CJS sync
- [architecture-decisions.md](architecture-decisions.md) - Architecture decision records (13 ADRs)

### How-To Guides

- [howto/build-from-source.md](howto/build-from-source.md) - Build node-smol from source
- [howto/rebuild-after-edits.md](howto/rebuild-after-edits.md) - Rebuild after code changes

### Quick Reference

| Stage | Name | Output Size |
|-------|------|-------------|
| 0 | source-copied | ~200 MB source |
| 1 | source-patched | ~200 MB patched |
| 2 | binary-released | ~93 MB binary |
| 3 | binary-stripped | ~61 MB binary |
| 4 | binary-compressed | ~22 MB binary |
| 5 | finalized | ~22 MB binary |

### System Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| RAM | 8 GB | 16 GB |
| Disk | 10 GB | 20 GB |
| Node.js | See `.node-version` | See `.node-version` |
| Python | 3.11+ | 3.12+ |

### Key Commands

```bash
# Full build (uses checkpoints)
pnpm run build

# Force clean rebuild
pnpm run build --clean

# Production build
pnpm run build --prod

# Skip to specific phase
pnpm run build --from-checkpoint=binary-stripped

# Run tests
pnpm run test
```

### Source Package Dependencies

```
build-infra (16 files) ─┬─► stubs-builder ─► binpress ─┐
                        ├─► binflate                    │
bin-infra (29 files) ───┼─► binject ────────────────────┼─► node-smol
                        │                               │
binject (22 files) ─────┴───────────────────────────────┘
```

## Related Packages

- [binject](../../binject/docs/) - SEA/VFS injection
- [bin-infra](../../bin-infra/docs/) - Binary format handling
- [build-infra](../../build-infra/docs/) - Build utilities
- [binpress](../../binpress/docs/) - Binary compression
- [binflate](../../binflate/docs/) - Binary extraction
- [stubs-builder](../../stubs-builder/docs/) - Self-extracting stubs
