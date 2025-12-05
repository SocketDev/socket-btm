# Source Patched Checkpoint

Apply Socket Security patches and additions to Node.js source.

## Flow

```
Pristine source → Apply patches → Copy additions → Modified source
                  (8 patches)     (polyfills, vfs)
```

## Patches Applied

Located in `patches/source-patched/`:

| # | Purpose |
|---|---------|
| 001 | Disable HTTP/2, WASI (1-3MB savings) |
| 002 | Fix GCC LTO compilation |
| 003 | Load polyfills for small-icu |
| 004 | Fix Python 3 hashlib in gyp |
| 005 | Fix V8 safepoint on macOS |
| 006 | ARM64 branch protection |
| 007 | Fix V8 typeindex on macOS |
| 008 | Add VFS support (C++ layer) |

## Additions Copied

```
additions/source-patched/js/polyfills/ → lib/internal/socketsecurity_polyfills/
additions/source-patched/js/vfs/       → lib/internal/socketsecurity_vfs/
additions/source-patched/cpp/vfs/      → src/
```

## Performance

| Operation | Time |
|-----------|------|
| Validate patches | ~100ms |
| Apply patches | ~500ms |
| Copy additions | ~50ms |
| Checkpoint save | ~5-8s |
| Cache hit | ~0ms |

## Cache Key

```javascript
{ nodeVersion, patches[], additions[], source-cloned-hash }
```

## Dependencies

Requires: `source-cloned` checkpoint.

## Next

`binary-released` - Configure and compile Node.js.
