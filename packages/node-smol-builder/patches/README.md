# Node.js Patches

Custom Node.js patches for Socket smol binaries.

## Patches Applied

Socket-specific patches:
- `001-socketsecurity_disable_modules` - Disable unused modules
- `002-socketsecurity_fix_gcc_lto` - GCC LTO compatibility
- `003-socketsecurity_polyfills` - ICU polyfill (localeCompare)
- `004-socketsecurity_fix_gyp_py3_hashlib` - Python 3 compatibility
- `005-socketsecurity_fix_v8_safepoint_macos` - macOS V8 safepoint fix
- `006-socketsecurity_arm64_branch_protection` - ARM64 branch protection
- `007-socketsecurity_fix_v8_typeindex_macos` - macOS V8 typeindex fix

## Building

```bash
pnpm build  # Automatically applies all patches
```

Patches are applied in numerical order during the build process.
