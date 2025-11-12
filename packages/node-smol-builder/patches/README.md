# Node.js Patches

Custom Node.js patches for Socket smol binaries.

## Patches Applied

Socket-specific patches:
- `001-socketsecurity_brotli_builtin` - Brotli-compressed builtins
- `002-socketsecurity_brotli_friend` - Brotli friend declarations
- `003-socketsecurity_brotli2c_build` - Build brotli2c compression tool
- `004-socketsecurity_disable_modules` - Disable unused modules
- `005-socketsecurity_fix_gcc_lto` - GCC LTO compatibility
- `006-socketsecurity_polyfills` - ICU polyfill (localeCompare)
- `007-socketsecurity_fix_gyp_py3_hashlib` - Python 3 compatibility
- `008-socketsecurity_fix_abseil_windows_duplicate_symbols` - Windows build fix
- `009-socketsecurity_fix_inspector_protocol_windows` - Windows inspector fix
- `010-socketsecurity_fix_v8_safepoint_macos` - macOS V8 safepoint fix
- `011-socketsecurity_windows_hardening` - Windows security hardening
- `012-socketsecurity_arm64_branch_protection` - ARM64 branch protection
- `013-socketsecurity_fix_v8_typeindex_macos` - macOS V8 typeindex fix

## Building

```bash
pnpm build  # Automatically applies all patches
```

Patches are applied in numerical order during the build process.
