# updating-stubs Reference Documentation

This document provides edge cases and troubleshooting for the updating-stubs skill.

## Dependency Chain

```
stubs-builder
    └─→ curl-builder (HTTP support)
           └─→ mbedtls (TLS support)
```

## Cache Version Dependencies

When updating stubs, these cache versions must be bumped:

```json
{
  "versions": {
    "stubs": "v70",    // ← Bump this
    "binpress": "v137" // ← Bump this (uses stub binaries)
  }
}
```

## Build Artifacts

stubs-builder produces:
- `build/stub-darwin-arm64` - macOS ARM64 stub
- `build/stub-darwin-x64` - macOS x64 stub
- `build/stub-linux-x64` - Linux glibc stub
- `build/stub-linux-x64-musl` - Linux musl stub
- `build/stub-win32-x64.exe` - Windows stub

These are embedded into binpress for creating self-extracting compressed binaries.

## Edge Cases

### curl Not Updated

If curl is already at latest version, the updating-curl skill will exit with "Already up to date". This is fine - proceed with rebuilding stubs anyway to ensure they're current.

### No Changes After Rebuild

If stubs rebuild produces identical binaries:
- `git status` will show no changes
- Report "Stubs already up to date"
- No commit needed
- Still bump cache versions if curl was updated

### Cross-Platform Builds

stubs-builder may download prebuilt curl from releases rather than building locally:
- Ensures consistent cross-platform builds
- `ensureCurl()` function handles this in build.mts

## Troubleshooting

### Build Fails

**Symptom:**
```
Error: curl binary not found
```

**Cause:** curl download failed or path incorrect.

**Solution:**
1. Check network connectivity
2. Verify curl releases exist
3. Check `ensureCurl()` function in build.mts

### Tests Fail

**Symptom:**
```
stub decompression failed
```

**Cause:** Stub binary incompatible with test input.

**Solution:**
1. Review test failure details
2. Check if stub format changed
3. May need to update test fixtures

## Rollback

```bash
# Rollback single commit
git reset --hard HEAD~1

# If curl was also updated, rollback both
git reset --hard HEAD~2
```
