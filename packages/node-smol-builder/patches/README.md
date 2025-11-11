# Node.js Patches

Custom Node.js patches for Socket smol binaries.

## Patches Applied

Socket-specific patches:
- `001-socketsecurity_bootstrap_preexec` - Bootstrap loader injection
- `002-socketsecurity_brotli_builtin` - Brotli-compressed builtins
- `003-socketsecurity_brotli_friend` - Brotli friend declarations
- `004-socketsecurity_brotli2c_build` - Build brotli2c tool
- `005-socketsecurity_disable_modules` - Disable unused modules
- `006-socketsecurity_fix_gcc_lto` - GCC LTO compatibility
- `008-socketsecurity_localecompare_polyfill` - ICU polyfill
- `009-socketsecurity_normalize_polyfill` - ICU polyfill
- `010-socketsecurity_fix_gyp_py3_hashlib` - Python 3 compatibility
- `011-socketsecurity_fix_abseil_windows_duplicate_symbols` - Windows build fix
- `012-socketsecurity_fix_inspector_protocol_windows` - Windows inspector fix
- `013-socketsecurity_sea_brotli` - Brotli SEA blob compression

## Building

```bash
pnpm build  # Automatically applies all patches
```

Patches are applied in numerical order during the build process.
