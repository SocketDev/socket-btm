# Source Cloned Checkpoint

Extract pristine Node.js source from git upstream.

## Flow

```
upstream/node/ → build/shared/source/ → build/shared/checkpoints/source-cloned.tar
                    ↓
         ┌──────────┴──────────┐
         ↓                     ↓
  build/dev/source/    build/prod/source/
```

## Purpose

Creates a pristine Node.js source copy, shared between dev and prod builds for consistency and space efficiency (~200MB savings).

## Cache Key

```javascript
{ nodeVersion, nodeSHA, upstreamPath }
```

## Performance

| Operation | Time |
|-----------|------|
| Initial clone | ~2-3s |
| Checkpoint save | ~5-8s |
| Restore | ~3-5s |
| Cache hit | ~0ms |

## Output

```
build/shared/
├── source/              # Pristine copy
└── checkpoints/
    └── source-cloned.tar
```

## Dependencies

None (first checkpoint).

## Next

`source-patched` - Applies patches and copies additions.
