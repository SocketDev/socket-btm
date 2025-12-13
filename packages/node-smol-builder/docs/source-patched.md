# Source Patched Checkpoint

Apply Socket Security patches and additions to Node.js source.

## Flow

```
Pristine source → Apply patches → Copy additions → Modified source
                  (6 patches)     (polyfills, vfs)
```

## Patches Applied

Located in `patches/source-patched/`:

| # | Purpose |
|---|---------|
| 001 | Fix GCC LTO linker configuration and enable ARM64 branch protection |
| 002 | Load polyfills for small-icu builds |
| 003 | Fix Python 3 hashlib in gyp |
| 004 | Add VFS support (C++ binding registration and build files) |
| 005-fix_v8_typeindex_macos | Fix V8 TypeIndex constructor for macOS |
| 005-vfs_bootstrap | Initialize VFS during Node.js pre-execution |

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
