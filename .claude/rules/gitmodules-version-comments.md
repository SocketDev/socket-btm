# .gitmodules Version Comment Format

**MANDATORY**: All submodule version comments in `.gitmodules` MUST follow this format.

## Format Rules

1. **Position**: Version comment appears on the line IMMEDIATELY BEFORE the `[submodule "path"]` line.
2. **Default form**: `# package-X.Y.Z` where:
   - `package` is the package name (lowercase)
   - `X.Y.Z` is the semantic version using DOTS (never underscores)
   - NO `v` prefix (use `1.0.0`, NOT `v1.0.0`)
3. **Consistency**: ALL semver-tracked submodules use the default form. Two narrow extensions are allowed only when documented:
   - **`# package-X.Y.Z sha256:HEX`** — for submodules whose tree integrity is verified at build time. Currently used by `node`. The `sha256:` token is single-spaced after the version.
   - **`# package-EPOCH/PATH`** — for submodules pinned to upstream epoch tags rather than semver releases (no semver releases are published). Currently used by `wpt-epochs/three_hourly/<date>_<hour>H`.

## Examples

```gitmodules
# Default form
# curl-8.19.0
[submodule "packages/curl-builder/upstream/curl"]
	path = packages/curl-builder/upstream/curl
	url = https://github.com/curl/curl.git

# With integrity checksum (intentional extension)
# node-25.9.0 sha256:d55d77187039d4cd85c732f76838f44e3be552054473459dfa9cc0eb611ea664
[submodule "packages/node-smol-builder/upstream/node"]
	path = packages/node-smol-builder/upstream/node
	url = https://github.com/nodejs/node.git

# Epoch-tagged upstream (no semver releases)
# wpt-epochs/three_hourly/2026-02-24_21H
[submodule "packages/node-smol-builder/scripts/vendor-fast-webstreams/wpt/streams"]
	path = packages/node-smol-builder/scripts/vendor-fast-webstreams/wpt/streams
	url = https://github.com/web-platform-tests/wpt.git
```

## Why This Matters

- **Build scripts** use `getSubmoduleVersion()` to extract `# package-VERSION...` from the line before each `[submodule ...]`. Trailing tokens (`sha256:...`, epoch path segments) are tolerated by the parser.
- **CI workflows** use `grep -B 1` to extract the comment line; the parser splits on the first whitespace after the version token.
- **Consistency** keeps the parser simple and the file readable.

## Forbidden Patterns

- `# v0.17.0` — NO `v` prefix on the version.
- `# curl-8_19_0` — NO underscores in semver (use dots).
- Comment after the `url =` line — MUST be before `[submodule ...]`.
- Adding a NEW form beyond the three above without first updating this rule.

## Validation

When adding or updating submodules:
1. Add the version comment BEFORE the `[submodule ...]` line.
2. Pick the form: default semver, semver+sha256, or epoch path. Do not invent a fourth.
3. Run `grep -B 1 'submodule-path' .gitmodules` to verify extractability.
4. Confirm `getSubmoduleVersion()` parses the comment without errors.
