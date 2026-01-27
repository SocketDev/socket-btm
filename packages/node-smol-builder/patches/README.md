# Node.js Patches

Custom patches applied during the build process to optimize Node.js for Socket smol binaries.

## Organization

- `source-patched/` - Patches applied to Node.js source before compilation
  - VFS integration, GCC fixes, ICU polyfills, platform-specific fixes
  - Applied in numerical order (001-*, 002-*, etc.)

All patches are applied automatically during `pnpm build`.

## Patch Metadata

Each patch file includes metadata headers:

```
# @node-versions: v25.x
# @description: Brief description of what this patch does
# @requires: path/to/additional/files (optional)
# @phase: 1 (optional, for dependency ordering)
```

- `@node-versions`: Node.js version this patch was generated against (e.g., `v25.x`)
  - Must always be a specific version, never wildcards like `v25+`
  - Updated automatically by `scripts/update-node-version.mjs`
- `@description`: Human-readable description
- `@requires`: Additional files needed (e.g., C++ implementations, JS polyfills)
- `@phase`: Execution phase for patches with dependencies

## Updating Patches for New Node.js Versions

When updating to a new Node.js version, patches may need to be updated:

### 1. Update Version Metadata (Automatic)

The `scripts/update-node-version.mjs` script automatically updates patch metadata:

```bash
node scripts/update-node-version.mjs 25.5.0
```

This updates `@node-versions` headers in **all** patches to the new version.

### 2. Regenerate ALL Patches

**Every patch must be regenerated** against the new Node.js source, even if it applies cleanly.

This ensures patches are based on the exact source code of the new version:

1. Check out pristine Node.js source:
   ```bash
   cd packages/node-smol-builder/upstream/node
   git checkout v25.5.0
   ```

2. Manually apply the Socket changes to the new source
   - Review the old patch to understand what changes are needed
   - Apply equivalent changes to the new source files
   - Verify the changes work as expected

3. Generate a new patch:
   ```bash
   git diff > ../patches/source-patched/NNN-patch-name.patch
   ```

4. Add metadata headers to the new patch file:
   ```
   # @node-versions: v25.x
   # @description: Brief description
   # @requires: path/to/files (if needed)
   ```

5. Test the patch applies cleanly:
   ```bash
   cd packages/node-smol-builder
   pnpm run build
   ```

**Never manually edit patch hunks** - always regenerate from a clean git diff to ensure patches are valid and maintainable.

### 3. Test Patch Application

Build with the new Node.js version to verify all patches apply cleanly:

```bash
cd packages/node-smol-builder
pnpm run build
```

### 4. Document Breaking Changes

If Node.js introduced breaking changes that affect Socket patches:

- Document the changes in commit messages
- Update patch descriptions if the implementation changed
- Consider updating patch dependencies (`@requires`, `@phase`)

## Patch Validation

The build system validates patches before applying them:

- **Format Validation**: Checks patch format is valid
- **Compatibility**: Verifies patches apply cleanly to current Node.js source
- **Conflict Detection**: Detects overlapping modifications between patches
- **Dependency Checking**: Verifies `@requires` files exist

Validation failures will stop the build with detailed error messages.
