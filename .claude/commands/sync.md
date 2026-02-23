# sync - Update Node.js to latest version

Invoke the syncing-node skill to synchronize with upstream Node.js:

**Process:**
1. Validate environment (clean working directory)
2. Fetch latest Node.js tag from upstream
3. Update `.node-version` and submodule pointer
4. Regenerate patches for new Node version
5. Validate build and tests
6. Create atomic commits with version metrics

**What It Does:**
- Updates `packages/node-smol-builder/upstream/node` submodule
- Updates `.node-version` in monorepo root
- Regenerates Node.js patches (with retry loop)
- Validates build and tests (with retry loop)
- Creates 2 atomic commits (version update + rebuild)

**Ralph Loops:**
- Phase 5: Patch regeneration (MAX_ITERATIONS=3)
- Phase 6: Build/test validation (MAX_ITERATIONS=3)

Use the Skill tool to invoke: `syncing-node`

**Alternative:** Use `/sync-status` to check current version vs latest available.

## Success Criteria

- ✅ Skill `syncing-node` invoked successfully
- ✅ Working directory clean at start
- ✅ Latest Node.js tag fetched from upstream
- ✅ `.node-version` updated to new version
- ✅ Submodule pointer updated to new tag
- ✅ All patches regenerated and applied cleanly
- ✅ Build completes without errors
- ✅ All tests pass (100% pass rate)
- ✅ 2 atomic commits created (version update + rebuild)
- ✅ `<promise>NODE_SYNC_COMPLETE</promise>` emitted

## Completion Signal

Upon successful completion, the `syncing-node` skill emits:

```xml
<promise>NODE_SYNC_COMPLETE</promise>
```

This signal indicates:
- Updated from v{OLD_VERSION} to v{NEW_VERSION}
- Submodule pointer updated
- Patches applied successfully
- Build validated
- Tests passed
- 2 atomic commits created

## Edge Cases

For comprehensive edge case handling, refer to the `syncing-node` skill documentation.

**Common issues:**

- **Upstream not initialized**: Skill initializes submodule automatically
- **Patches fail to apply**: Phase 5 Ralph loop (MAX_ITERATIONS=3) with auto-retry
- **Build fails**: Phase 6 Ralph loop with lint auto-fix and retry
- **Tests fail**: Phase 6 halts with test output for manual intervention
- **Already up to date**: Skill detects and exits early

**Rollback if needed:**
```bash
# Reset to previous version
git reset --hard HEAD~2  # Undo both commits

# Or manually reset components
echo "<previous-version>" > .node-version
cd packages/node-smol-builder/upstream/node
git checkout <previous-tag>
cd ../../..
```

## Context

**Related Files:**
- `.node-version` - Canonical Node.js version for monorepo
- `packages/node-smol-builder/upstream/node` - Git submodule tracking upstream
- `packages/node-smol-builder/patches/source-patched/` - Socket patches (13 total)

**Related Skills:**
- `syncing-node` - The skill invoked by this command

**Related Commands:**
- `/sync-status` - Check current version vs latest available
- `/node-patcher` - Regenerate patches manually
