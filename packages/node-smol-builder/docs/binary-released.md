# Binary Released Checkpoint

Configure and compile Node.js with Socket Security optimizations.

## Flow

```
Patched source → ./configure → make -j{N} → Compiled binary
                 (flags)       (parallel)    (27-49MB)
```

## Build Modes

| Mode | Size | JIT | Build Time | Use Case |
|------|------|-----|------------|----------|
| **Dev** | 49MB | ✓ | 10-20 min | Local development |
| **Prod** | 27MB | ❌ | 30-45 min | Distribution |

## Key Configure Flags

```bash
--ninja                    # Use Ninja build system
--with-intl=small-icu      # English-only ICU (-5MB)
--without-npm              # No npm
--without-corepack         # No corepack
--without-amaro            # No TypeScript/amaro
--without-node-options     # Disable NODE_OPTIONS
--without-inspector        # No inspector/debugger (prod only)
--enable-lto               # Link-time optimization (prod only, Linux only)
```

## Performance

| CPUs | RAM | Dev Build | Prod Build |
|------|-----|-----------|------------|
| 4 | 16GB | 10-15 min | 30-40 min |
| 8 | 32GB | 6-8 min | 20-25 min |

## Size Breakdown (Prod)

```
V8 engine:     ~12MB
ICU:           ~3MB   (small-icu)
OpenSSL:       ~4MB
Node.js core:  ~6MB
Other libs:    ~3MB
Debug symbols: ~3MB   (removed in strip phase)
```

## Cache Key

```javascript
{ nodeVersion, buildMode, platform, arch, configureFlags, source-patched-hash }
```

## Dependencies

Requires: `source-patched` checkpoint.

## Next

`binary-stripped` - Remove debug symbols (~2-3MB reduction).
