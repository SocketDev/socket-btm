# Binary Stripped Checkpoint

Remove debug symbols for smaller distribution size.

## Flow

```
Release binary (27-49MB) → strip tool → Stripped binary (25-46MB)
                           (platform)   (-2-3MB)
```

## Platform Tools

| Platform | Command | Reduction |
|----------|---------|-----------|
| **macOS** | `strip -x` | -2.4MB (~9%) |
| **Linux** | `strip --strip-debug` | -2.5MB (~9%) |
| **Windows** | N/A (PDB separate) | N/A |

## What's Removed

```
Debug Symbols:
  ✓ Function names
  ✓ Line numbers
  ✓ Source files
  ✓ Local variables

Kept:
  ✓ Dynamic symbols (dlopen)
  ✓ Export symbols (public API)
```

## Impact

| Aspect | Change |
|--------|--------|
| Runtime performance | None |
| Startup time | None (or +1ms) |
| Stack traces | Basic only |
| Debugging | Limited |

## Dependencies

Requires: `binary-released` checkpoint.

## Next

`binary-compressed` - Platform-specific compression (~75-80% reduction).
