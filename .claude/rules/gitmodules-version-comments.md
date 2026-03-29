# .gitmodules Version Comment Format

**MANDATORY**: All submodule version comments in `.gitmodules` MUST follow this exact format.

## Format Rules

1. **Position**: Version comment appears on the line IMMEDIATELY BEFORE the `[submodule "path"]` line
2. **Format**: `# package-X.Y.Z` where:
   - `package` is the package name (lowercase)
   - `X.Y.Z` is the semantic version using DOTS (never underscores)
   - NO `v` prefix (use `1.0.0`, NOT `v1.0.0`)
3. **Consistency**: ALL submodules use the same format - no exceptions

## Example

```gitmodules
# curl-8.18.0
[submodule "packages/curl-builder/upstream/curl"]
	path = packages/curl-builder/upstream/curl
	url = https://github.com/curl/curl.git
# mbedtls-3.6.5
[submodule "packages/curl-builder/upstream/mbedtls"]
	path = packages/curl-builder/upstream/mbedtls
	url = https://github.com/Mbed-TLS/mbedtls.git
# lief-0.17.0
[submodule "packages/lief-builder/upstream/lief"]
	path = packages/lief-builder/upstream/lief
	url = https://github.com/lief-project/LIEF.git
```

## Why This Matters

- **Build scripts** use `getSubmoduleVersion()` which expects `# package-X.Y.Z\n[submodule ...]`
- **CI workflows** use `grep -B 1` to extract versions from the line before the submodule
- **Consistency** prevents bugs and makes version extraction reliable

## Forbidden Patterns

❌ `# v0.17.0` - NO v prefix
❌ `# curl-8_18_0` - NO underscores (use dots)
❌ Comment after URL line - MUST be before `[submodule ...]`
❌ Different formats for different submodules - ALL must match

## Validation

When adding or updating submodules:
1. Add version comment BEFORE `[submodule ...]` line
2. Use format: `# package-VERSION` with dots
3. Run `grep -B 1 'submodule-path' .gitmodules` to verify it can be extracted
4. Check that build scripts can parse it with `getSubmoduleVersion()`
