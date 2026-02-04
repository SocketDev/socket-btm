---
name: syncing-node
description: Synchronizes socket-btm with upstream Node.js by updating the submodule to latest tag, updating `.node-version`, regenerating patches, validating build and tests. Use when updating to new Node.js releases, applying security patches, or upgrading Node version across the codebase.
user-invocable: true
disable-model-invocation: false
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, TodoWrite
---

# syncing-node

## Role

Node.js Synchronization Specialist maintaining up-to-date Node.js baseline for socket-btm binary tooling.

## Action

Synchronize socket-btm with upstream Node.js by updating the submodule to latest (or specified) tag, updating `.node-version` file, regenerating patches for the new version, validating build and tests, and committing with version update metrics.

## Limitations

**Constraints:**
- Build must complete without errors
- Test pass rate: 100%
- All patches must apply cleanly
- `.node-version` must match submodule tag

**Do NOT:**
- Skip test validation before committing
- Update to non-tagged commits (use tags only)
- Commit with failing builds or tests
- Skip patch regeneration

**Do ONLY:**
- Sync with official Node.js tags
- Follow conventional commit format
- Use Ralph methodology (atomic commits per phase)

## Process

### Phase 1: Validate Environment

```bash
git status
```

**Requirements:**
- Clean working directory
- On feature branch (or main with backup)

**If fails:** Stop and report uncommitted changes

---

### Phase 2: Fetch Latest Node.js Tag

```bash
cd packages/node-smol-builder/upstream/node
git fetch origin --tags

# Get latest tag
LATEST_TAG=$(git tag -l 'v*.*.*' --sort=-version:refname | grep -v 'rc' | head -1)
echo "Latest Node.js tag: $LATEST_TAG"

# Or use specified tag
# LATEST_TAG="v25.6.0"

cd ../../..
```

**Report:** Latest available tag and current tag

---

### Phase 3: Update Submodule

```bash
cd packages/node-smol-builder/upstream/node
git checkout "$LATEST_TAG"
cd ../../..

# Get tag details
cd packages/node-smol-builder/upstream/node
NEW_SHA=$(git rev-parse HEAD)
NEW_VERSION="${LATEST_TAG#v}"  # Remove 'v' prefix
cd ../../..
```

**Validate:**
```bash
# Verify checkout succeeded
cd packages/node-smol-builder/upstream/node && git describe --tags
```

**Report:**
- New version
- Commit hash

---

### Phase 4: Update .node-version File

Read current version:
```bash
OLD_VERSION=$(cat .node-version)
echo "Current version: $OLD_VERSION"
echo "New version: $NEW_VERSION"
```

Update file:
```bash
echo "$NEW_VERSION" > .node-version
```

**Validate:**
```bash
cat .node-version
```

**Checkpoint:** `.node-version` contains new version (e.g., "25.6.0")

**Atomic Commit:**
```bash
git add .node-version packages/node-smol-builder/upstream/node

git commit -m "$(cat <<EOF
chore(node): update Node.js from v$OLD_VERSION to v$NEW_VERSION

Update upstream Node.js submodule to $LATEST_TAG
Commit: $NEW_SHA

Updated:
- .node-version: $OLD_VERSION → $NEW_VERSION
- packages/node-smol-builder/upstream/node → $LATEST_TAG

Next: Regenerate patches for new Node.js version

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Phase 5: Regenerate Patches (with retry loop)

Patches may need manual adjustments for new Node.js version. Try automatic regeneration first:

```bash
cd packages/node-smol-builder

# Clean build to force patch regeneration
pnpm run clean

# Iteration loop for patch application
ITERATION=1
MAX_ITERATIONS=3

while [ $ITERATION -le $MAX_ITERATIONS ]; do
  echo "Patch application attempt $ITERATION/$MAX_ITERATIONS"

  # Try to apply patches
  if pnpm run build:patches 2>&1 | tee /tmp/patch-output.log; then
    echo "✓ Patches applied successfully"
    break
  fi

  echo "⚠ Patch application failed (Iteration $ITERATION/$MAX_ITERATIONS)"

  if [ $ITERATION -eq $MAX_ITERATIONS ]; then
    echo "✗ Patches failed to apply after $MAX_ITERATIONS attempts"
    echo ""
    echo "Manual intervention required:"
    echo "1. Review patch failures in /tmp/patch-output.log"
    echo "2. Update patches in packages/node-smol-builder/patches/source-patched/"
    echo "3. Retry build"
    echo ""
    echo "Common issues:"
    echo "- Node.js API changes requiring patch updates"
    echo "- File relocations in upstream Node.js"
    echo "- Context line changes in patch hunks"
    exit 1
  fi

  sleep 2
  ITERATION=$((ITERATION + 1))
done

cd ../..
```

**Checkpoint:** Patches applied successfully

**If patches fail:** Manual patch updates required (exit with instructions)

---

### Phase 6: Validate Build and Tests (with retry loop)

```bash
cd packages/node-smol-builder

# Validation loop
ITERATION=1
MAX_ITERATIONS=3

while [ $ITERATION -le $MAX_ITERATIONS ]; do
  echo "Validation attempt $ITERATION/$MAX_ITERATIONS"

  # Try lint
  echo "→ Running lint..."
  if ! pnpm run lint:fix --all; then
    echo "⚠ Lint failed (Iteration $ITERATION/$MAX_ITERATIONS)"
  else
    echo "✓ Lint passed"

    # Try build
    echo "→ Running build..."
    if ! pnpm run build; then
      echo "⚠ Build failed (Iteration $ITERATION/$MAX_ITERATIONS)"
    else
      echo "✓ Build passed"

      # Try tests
      echo "→ Running tests..."
      if ! pnpm test; then
        echo "⚠ Tests failed (Iteration $ITERATION/$MAX_ITERATIONS)"
      else
        echo "✓ All validation passed"
        break
      fi
    fi
  fi

  if [ $ITERATION -eq $MAX_ITERATIONS ]; then
    echo "✗ Validation failed after $MAX_ITERATIONS attempts"
    echo "Review errors and fix manually"
    exit 1
  fi

  # Auto-fix and retry
  echo "→ Applying auto-fixes..."
  pnpm run lint:fix --all || true

  sleep 2
  ITERATION=$((ITERATION + 1))
done

cd ../..
```

**Checkpoint:** Lint, build, and tests all pass

---

### Phase 7: Final Commit

```bash
git add packages/node-smol-builder

git commit -m "$(cat <<EOF
chore(node-smol-builder): rebuild with Node.js v$NEW_VERSION

Regenerate patches and rebuild after Node.js update.

Changes:
- Patches applied to Node.js v$NEW_VERSION
- Build validated
- Tests: PASS

Previous version: v$OLD_VERSION
New version: v$NEW_VERSION
Commit: $NEW_SHA

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Phase 8: Complete

**Completion Signal:**

```xml
<promise>NODE_SYNC_COMPLETE</promise>
```

**Summary:**
- Updated from: v$OLD_VERSION
- Updated to: v$NEW_VERSION
- Commit: $NEW_SHA
- Patches: Applied successfully
- Build: ✓ Success
- Tests: ✓ PASS
- Total commits: 2 (version update + rebuild)

---

## Success Criteria

- ✅ `<promise>NODE_SYNC_COMPLETE</promise>` emitted
- ✅ `.node-version` updated to new version
- ✅ Submodule pointer updated to new tag
- ✅ All patches apply cleanly
- ✅ Build completes without errors
- ✅ All tests pass
- ✅ 2 atomic commits created (version update + rebuild)
- ✅ Clean working directory after sync

## Edge Cases

**Upstream not initialized:**
```bash
cd packages/node-smol-builder
if [ ! -d "upstream/node/.git" ]; then
  echo "Initializing upstream Node.js submodule..."
  git submodule update --init --recursive upstream/node
fi
```

**Patches fail to apply:**
- Review `/tmp/patch-output.log` for specific failures
- Update patches manually in `packages/node-smol-builder/patches/source-patched/`
- Patches use standard unified diff format (NOT git diff format)
- See CLAUDE.md "Node.js Source Patch Format" for details

**Build fails after update:**
- Check for Node.js API changes affecting Socket additions
- Review `packages/node-smol-builder/additions/source-patched/`
- Check if new Node version requires build flag changes

**Tests fail:**
- Review test output for Node.js behavior changes
- Update tests if Node.js semantics changed
- Check if new Node version exposed bugs in Socket code

**Rollback if needed:**
```bash
# Reset to previous version
git reset --hard HEAD~2  # Undo both commits

# Or reset submodule only
cd packages/node-smol-builder/upstream/node
git checkout <previous-tag>
cd ../../..

# Update .node-version
echo "<previous-version>" > .node-version
```

## Variables Used

- `$LATEST_TAG` - Latest Node.js tag from upstream (e.g., "v25.6.0")
- `$OLD_VERSION` - Previous version from `.node-version` (e.g., "25.5.0")
- `$NEW_VERSION` - New version without 'v' prefix (e.g., "25.6.0")
- `$NEW_SHA` - Commit hash of new tag
- `$ITERATION` - Current iteration in retry loops (1-3)
- `$MAX_ITERATIONS` - Maximum retry attempts (3)

## Context

**Related Files:**
- `.node-version` - Canonical Node.js version for the monorepo
- `packages/node-smol-builder/upstream/node` - Git submodule tracking upstream Node.js
- `packages/build-infra/lib/constants.mjs` - Reads `.node-version` as `NODE_VERSION`
- `packages/node-smol-builder/patches/source-patched/` - Socket patches for Node.js

**Related Commands:**
- `/sync` - Invoke this skill
- `/sync-status` - Check current version vs latest available

**Standards:**
- Follows Socket Security commit format (CLAUDE.md)
- Uses semantic commit messages (conventional commits)
- Includes Socket attribution in all commits
- Uses Ralph methodology (atomic commits per phase)
