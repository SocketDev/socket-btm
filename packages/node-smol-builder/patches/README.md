# Node.js Patches

Custom patches applied during the build process to optimize Node.js for Socket smol binaries.

## Organization

- `release/` - Patches applied during initial Node.js compilation phase
  - Module disabling, GCC fixes, ICU polyfills, platform-specific fixes

All patches are applied automatically during `pnpm build` in numerical order.
