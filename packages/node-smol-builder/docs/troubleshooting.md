# Troubleshooting Guide

Common issues and solutions when building node-smol.

## Quick Diagnosis

```
Build failed?
    │
    ├─► "Patch failed to apply"
    │       └─► See: Patch Application Failures
    │
    ├─► "ninja: error: loading build.ninja"
    │       └─► Run: pnpm run clean && pnpm run build
    │
    ├─► "linking with cc failed"
    │       └─► Check: disk space (df -h), dependencies
    │
    ├─► "heap out of memory"
    │       └─► Set: export JOBS=2 (reduce parallelism)
    │
    ├─► "codesign failed" (macOS)
    │       └─► Run: codesign --sign - --force <binary>
    │
    ├─► Binary runs but crashes
    │       └─► See: Integration Test Failures
    │
    └─► Build succeeds but old code runs
            └─► Run: pnpm run clean && pnpm run build
```

## Debug Mode

Enable verbose logging:

```bash
# Full debug output
DEBUG="*" pnpm run build

# Capture build log
pnpm run build 2>&1 | tee build.log
```

## Build Failures

### Patch Application Failures

```
Error: Patch failed to apply: 003-smol-bootstrap.patch
Hunk #1 FAILED at line 42
```

**Cause:** Upstream Node.js source has changed, making patch context invalid.

**Solution:**
1. Use the regenerating-node-patches skill:
   ```
   /skill regenerating-node-patches
   ```

2. Or manually regenerate:
   ```bash
   # Get pristine file from upstream
   cp upstream/node/lib/internal/main/run_main_module.js /tmp/original.js

   # Apply your changes to a copy
   cp /tmp/original.js /tmp/modified.js
   # ... edit /tmp/modified.js ...

   # Generate new patch
   diff -u /tmp/original.js /tmp/modified.js > patches/source-patched/003-smol-bootstrap.patch

   # Validate
   cd upstream/node && patch --dry-run < ../../patches/source-patched/003-smol-bootstrap.patch
   ```

### Ninja Configuration Errors

```
Error: ninja: error: loading 'build.ninja': No such file or directory
```

**Cause:** Configure step failed or wasn't run.

**Solution:**
```bash
# Clean and rebuild from scratch
pnpm run clean
pnpm run build
```

### Compilation Failures

```
error: linking with `cc` failed: exit status: 1
```

**Cause:** Linker error, often due to missing libraries or disk space.

**Solution:**
1. Check disk space:
   ```bash
   df -h .
   ```

2. Check for missing dependencies:
   ```bash
   # macOS
   xcode-select --install

   # Linux
   sudo apt-get install build-essential python3
   ```

3. Check compiler version:
   ```bash
   clang --version  # macOS
   gcc --version    # Linux
   ```

### Memory Issues

```
FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory
```

**Cause:** Build requires significant RAM (~8GB recommended).

**Solution:**
1. Reduce parallel jobs:
   ```bash
   export JOBS=2  # Default uses all cores
   pnpm run build
   ```

2. Close memory-intensive applications

3. Add swap space (Linux):
   ```bash
   sudo fallocate -l 4G /swapfile
   sudo chmod 600 /swapfile
   sudo mkswap /swapfile
   sudo swapon /swapfile
   ```

## Checkpoint Issues

### Stale Checkpoint

```
Warning: Source files changed but checkpoint exists
```

**Cause:** Source files were modified but build is using old checkpoint.

**Solution:**
```bash
# Always clean before rebuild after source changes
pnpm run clean
pnpm run build
```

### Checkpoint Corruption

```
Error: Failed to parse checkpoint: SyntaxError
```

**Cause:** Checkpoint JSON file is corrupted.

**Solution:**
```bash
# Remove checkpoints
rm -rf build/dev/checkpoints/*
rm -rf build/shared/checkpoints/*
pnpm run build
```

### Wrong Checkpoint Used

```
Warning: Using checkpoint from different build mode
```

**Cause:** Switching between dev/prod modes without cleaning.

**Solution:**
```bash
pnpm run clean
pnpm run build --prod  # or --dev
```

## Code Signing (macOS)

### Signing Failed

```
Error: codesign failed: The signature is invalid
```

**Cause:** Binary structure is incompatible with signing.

**Solution:**
1. Try ad-hoc signing:
   ```bash
   codesign --sign - --force build/dev/out/Final/node
   ```

2. Check entitlements:
   ```bash
   codesign -d --entitlements :- build/dev/out/Final/node
   ```

### Gatekeeper Rejection

```
"node" cannot be opened because the developer cannot be verified

```

**Solution:**
```bash
# Remove quarantine attribute
xattr -d com.apple.quarantine build/dev/out/Final/node
```

## Platform-Specific Issues

### Linux glibc Version

```
Error: version `GLIBC_2.34' not found
```

**Cause:** Binary built on newer system than target.

**Solution:**
1. Build in Docker with older glibc:
   ```bash
   ./docker/build.sh
   ```

2. Or use musl target:
   ```bash
   pnpm run build --libc musl
   ```

### Linux Missing Libraries

```
error while loading shared libraries: libstdc++.so.6
```

**Solution:**
```bash
# Ubuntu/Debian
sudo apt-get install libstdc++6

# RHEL/CentOS
sudo yum install libstdc++
```

### Windows Long Paths

```
Error: ENAMETOOLONG: name too long
```

**Cause:** Windows path length limit (260 chars).

**Solution:**
1. Enable long paths (Windows 10 1607+):
   ```powershell
   # Run as Administrator
   New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
   ```

2. Build closer to root:
   ```bash
   # Move project to C:\btm
   ```

## Compression Issues

### LZFSE Compression Failed

```
Error: Compression failed: input too large
```

**Cause:** Binary exceeds compression limits.

**Solution:**
- Check binary size isn't unusually large
- Verify source binary is valid

### Decompression Failed

```
Error: DECOMPRESS_FAILED: data may be corrupted
```

**Cause:** Compressed data is corrupted or incomplete.

**Solution:**
1. Rebuild the compressed binary:
   ```bash
   pnpm run clean
   pnpm run build --prod
   ```

2. Verify file integrity:
   ```bash
   ls -la build/prod/out/Final/node
   file build/prod/out/Final/node
   ```

## Integration Test Failures

### Binary Not Found

```
Error: ENOENT: no such file or directory, 'build/dev/out/Final/node'
```

**Cause:** Build didn't complete or output path changed.

**Solution:**
```bash
# Verify build output exists
ls -la build/dev/out/Final/

# Rebuild if needed
pnpm run build
```

### Permission Denied

```
Error: EACCES: permission denied
```

**Solution:**
```bash
chmod +x build/dev/out/Final/node
```

### Test Timeout

```
Error: Timeout of 30000ms exceeded
```

**Cause:** Test binary is slow or hanging.

**Solution:**
1. Increase timeout in test config
2. Check for infinite loops in test code
3. Verify binary runs manually:
   ```bash
   ./build/dev/out/Final/node -e "console.log('hello')"
   ```

## Environment Issues

### Wrong Node.js Version

```
Error: Unsupported Node.js version
```

**Solution:**
```bash
# Check version
node --version

# Use nvm to switch
nvm use 20
```

### Missing pnpm

```
Error: pnpm: command not found
```

**Solution:**
```bash
npm install -g pnpm
```

### PATH Issues

```
Error: ninja: command not found
```

**Solution:**
```bash
# Add build tools to PATH
export PATH="$PATH:$(pwd)/build/tools/bin"
```

## Getting Help

### Debug Output

Enable verbose logging:
```bash
DEBUG="*" pnpm run build
```

### Build Log

Check full build output:
```bash
pnpm run build 2>&1 | tee build.log
```

### Reporting Issues

Include in bug reports:
1. Operating system and version
2. Node.js version (`node --version`)
3. Full error message
4. Build log (last 100 lines)
5. Steps to reproduce

## Related Documentation

- [Build System](build-system.md) - Pipeline architecture
- [Configure Build](howto/configure-build.md) - Build configuration
- [Patch System](patch-system.md) - Patching guide
