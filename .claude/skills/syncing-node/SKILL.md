---
name: syncing-node
description: Synchronizes socket-btm with upstream Node.js by updating the submodule to latest tag, updating `.node-version`, regenerating patches, validating build and tests. Use when updating to new Node.js releases, applying security patches, or upgrading Node version across the codebase.
user-invocable: true
disable-model-invocation: false
allowed-tools: Task
---

# syncing-node

## Role

Node.js Synchronization Specialist that spawns an autonomous agent to maintain up-to-date Node.js baseline for socket-btm binary tooling.

## Action

When invoked, spawn a general-purpose agent using the Task tool to handle the complete Node.js synchronization workflow autonomously.

## Instructions

```javascript
Task({
  subagent_type: "general-purpose",
  description: "Sync Node.js to latest version",
  prompt: `Synchronize socket-btm with upstream Node.js: update submodule to latest tag, update \`.node-version\`, regenerate patches, validate build/tests, commit changes.

## Constraints
- Build must complete without errors
- Test pass rate: 100%
- All patches must apply cleanly
- \`.node-version\` must match submodule tag

## Process

### 1. Validate Environment
\`\`\`bash
git status  # Must be clean
\`\`\`

### 2. Fetch Latest Node.js Tag
\`\`\`bash
cd packages/node-smol-builder/upstream/node
git fetch origin --tags
LATEST_TAG=$(git tag -l 'v*.*.*' --sort=-version:refname | grep -v 'rc' | head -1)
cd ../../..
\`\`\`

### 3. Update Submodule
\`\`\`bash
cd packages/node-smol-builder/upstream/node
git checkout "$LATEST_TAG"
NEW_SHA=$(git rev-parse HEAD)
NEW_VERSION="${LATEST_TAG#v}"
cd ../../..
\`\`\`

### 4. Update .node-version
\`\`\`bash
OLD_VERSION=$(cat .node-version)
echo "$NEW_VERSION" > .node-version
git add .node-version packages/node-smol-builder/upstream/node
git commit -m "chore(node): update Node.js from v$OLD_VERSION to v$NEW_VERSION

Update upstream Node.js submodule to $LATEST_TAG

Updated:
- .node-version: $OLD_VERSION → $NEW_VERSION
- packages/node-smol-builder/upstream/node → $LATEST_TAG"
\`\`\`

### 5. Regenerate Patches
\`\`\`bash
cd packages/node-smol-builder
pnpm run clean

# Retry up to 3 times
for i in 1 2 3; do
  if pnpm run build:patches 2>&1 | tee /tmp/patch-output.log; then
    break
  fi
  if [ $i -eq 3 ]; then
    echo "Patches failed - check /tmp/patch-output.log"
    exit 1
  fi
  sleep 2
done
cd ../..
\`\`\`

### 6. Validate Build and Tests
\`\`\`bash
cd packages/node-smol-builder

# Retry up to 3 times
for i in 1 2 3; do
  pnpm run lint:fix --all || true
  if pnpm run build && pnpm test; then
    break
  fi
  if [ $i -eq 3 ]; then
    echo "Validation failed"
    exit 1
  fi
  sleep 2
done
cd ../..
\`\`\`

### 7. Final Commit
\`\`\`bash
git add packages/node-smol-builder
git commit -m "chore(node-smol-builder): rebuild with Node.js v$NEW_VERSION

Regenerate patches and rebuild after Node.js update.

- Patches applied to Node.js v$NEW_VERSION
- Build validated
- Tests: PASS"
\`\`\`

### 8. Report Summary
- Updated from: v$OLD_VERSION → v$NEW_VERSION
- Commit: $NEW_SHA
- Status: ✓ Build ✓ Tests
- Total commits: 2

## Edge Cases
**Upstream not initialized:** \`git submodule update --init --recursive upstream/node\`
**Patches fail:** Update patches in \`packages/node-smol-builder/patches/source-patched/\` - see CLAUDE.md for format
**Rollback:** \`git reset --hard HEAD~2\``
})
```

## Success Criteria

- ✅ `.node-version` updated
- ✅ Submodule updated to new tag
- ✅ Patches apply cleanly
- ✅ Build and tests pass
- ✅ 2 commits created
