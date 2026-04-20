# Monorepo Structure

## Package Organization

Socket-btm follows a consistent directory structure across all 18 packages.

### Directory Conventions

**`lib/`** - JavaScript/TypeScript utilities

- Ready-to-run `.mjs` or `.js` files
- No compilation required
- Examples: build helpers, configuration, utilities

**`src/`** - Compilable source code

- Rust files (`.rs`) for native bindings
- C++ files (`.cpp`, `.h`) for native modules
- Scoped packages (e.g., `src/socketsecurity/build-infra/`)
- Requires build step before use

**`docker/`** - Docker build files

- All `Dockerfile*` files belong here
- Platform-specific variants (e.g., `Dockerfile.glibc`, `Dockerfile.musl`)
- Referenced by GitHub Actions workflows

**`test/`** - Test files and fixtures

- Rust tests (`.rs` files)
- Test fixtures and data
- Coverage configurations

**`patches/`** - Upstream modifications

- Patch files for submodule changes
- Applied during build process
- Pattern: `001-description.patch`, `002-description.patch`

**`upstream/`** - Git submodules

- Vendored dependencies tracked as submodules
- Must point to public commits (never local commits)
- Local changes captured as patches in `patches/`

### Package Types

**Builder packages** (`*-builder/`)

- Build native code or prepare assets
- Examples: `node-smol-builder`, `curl-builder`, `iocraft-builder`
- Typically have `lib/` for build scripts, `src/` for native code

**Infrastructure packages** (`*-infra/`)

- Shared build tooling and utilities
- Examples: `build-infra`, `bin-infra`
- Primarily `lib/` with reusable build helpers

**C/C++ packages** (`binflate`, `binject`, `binpress`)

- C/C++ implementations for binary manipulation (LIEF interop is C++)
- Have `src/` with C/C++ code
- Include platform-specific Dockerfiles

**Model packages** (`models`, `*-models-builder`)

- AI/ML model preparation
- Download, convert, or prepare model files

## Common Patterns

### Build Outputs

Most packages output to:

- `build/` - Build artifacts
- `dist/` - Distribution files (if package exports)
- `upstream/` - Submodule checkouts

### GitHub Actions Integration

Workflows reference package files as:

```yaml
file: packages/<package-name>/docker/Dockerfile.<variant>
```

### Package Naming

- Directory name matches `package.json` `"name"` field
- Builder packages use `-builder` suffix
- Infrastructure packages use `-infra` suffix
