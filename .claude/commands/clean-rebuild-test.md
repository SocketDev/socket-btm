# Clean, Rebuild, and Test

Execute a complete validation cycle for node-smol-builder:

1. Clean build artifacts and checkpoints
2. Rebuild with latest changes
3. Run test suite
4. Report: build size, test results, and any failures

Use this after making changes to binpress, binject, or build-infra that affect node-smol-builder.

Usage: `/clean-rebuild-test`

## Success Criteria

- ✅ Build artifacts cleaned successfully
- ✅ Build completes without errors
- ✅ All tests pass (100% pass rate)
- ✅ Binary size reported
- ✅ Build time reported
- ✅ `<promise>BUILD_TEST_COMPLETE</promise>` emitted

## Completion Signal

Upon successful completion, emit:

```xml
<promise>BUILD_TEST_COMPLETE</promise>
```

## Edge Cases

**Build fails:**
```bash
# Check build output for errors
pnpm --filter node-smol-builder run build

# Common issues:
# - Missing dependencies: pnpm install
# - Corrupted checkpoints: pnpm run clean && pnpm run build
# - C++ compilation errors: Check compiler version and flags
```

**Tests fail:**
```bash
# Run tests with verbose output
pnpm --filter node-smol-builder test

# Check specific test failures
# Fix issues before proceeding
```

**Clean fails:**
```bash
# Manually remove build artifacts
rm -rf packages/node-smol-builder/build

# Then retry
pnpm --filter node-smol-builder run build
```

## Context

**Related Files:**
- Build package: `packages/node-smol-builder/`
- Build script: `packages/node-smol-builder/scripts/binary-released/`
- Build checkpoints: `packages/node-smol-builder/build/dev/checkpoints/`
- Test directory: `packages/node-smol-builder/test/`

**Related Packages:**
- `binpress` - Binary compression (may affect build)
- `binject` - Binary injection (may affect build)
- `build-infra` - Shared build infrastructure

**Related Commands:**
- `/fix-and-commit` - Quick lint and test cycle with commit
- `/commit-task` - Commit with progress tracking
