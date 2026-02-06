---
name: syncing-upstream
description: Synchronizes socket-btm with upstream Node.js by updating the submodule to latest tag, updating `.node-version`, regenerating patches, validating build and tests. Use when updating to new Node.js releases, applying security patches, or maintaining upstream synchronization.
user-invocable: true
disable-model-invocation: false
allowed-tools: Task
---

# syncing-upstream

<task>
Your task is to spawn an autonomous agent that synchronizes socket-btm with upstream Node.js by updating the submodule to the latest stable tag, updating `.node-version`, regenerating patches, validating build and tests pass, and committing changes with detailed metrics.
</task>

<context>
**What is Node.js Synchronization?**
socket-btm builds custom Node.js binaries with Socket Security patches. This skill keeps the baseline Node.js version up-to-date by:
- Updating upstream Node.js submodule to latest stable tag
- Synchronizing `.node-version` to match submodule
- Regenerating Socket Security patches for new Node.js version
- Validating patches apply cleanly to new version
- Ensuring build and tests pass with updated Node.js

**socket-btm Architecture:**
This is Socket Security's binary tooling manager (BTM) that:
- Builds custom Node.js binaries with Socket Security patches
- Tracks upstream Node.js via submodule: `packages/node-smol-builder/upstream/node`
- Maintains `.node-version` for tooling and CI consistency
- Applies 13 patches to Node.js source during build
- Produces production-ready patched Node.js binaries

**When to Sync:**
- New Node.js stable release (security patches, features)
- Security advisories requiring Node.js upgrade
- Feature development requiring newer Node.js APIs
- Regular maintenance (monthly or quarterly cadence)

**Critical Files:**
- `.node-version` - Node.js version for tooling (nvm, volta, etc.)
- `packages/node-smol-builder/upstream/node` - Git submodule tracking nodejs/node
- `packages/node-smol-builder/patches/source-patched/*.patch` - Socket Security patches

**Success Metrics:**
- Build: Must complete without errors
- Tests: 100% pass rate
- Patches: All 13 must apply cleanly
- Version consistency: `.node-version` matches submodule tag
</context>

<constraints>
**CRITICAL Requirements:**
- Working directory MUST be clean before starting (no uncommitted changes)
- Submodule MUST update to stable tag only (no release candidates)
- All patches MUST apply cleanly to new Node.js version
- Build MUST succeed without errors
- Tests MUST pass (100% success rate)
- Two commits MUST be created (version update + patch regeneration)

**Do NOT:**
- Update to release candidate or nightly tags (unstable)
- Skip patch regeneration after Node.js update (will break build)
- Skip build validation (untested changes risky for production)
- Skip test validation (functional regressions undetected)
- Commit without validating patches apply cleanly

**Do ONLY:**
- Update to latest stable tag (format: v*.*.*, no -rc suffix)
- Regenerate patches after submodule update
- Validate build and tests before final commit
- Create two atomic commits (version + patches)
- Use conventional commit format with detailed changelog
- Report version change and commit metrics
</constraints>

<instructions>

## Process

This skill spawns an autonomous agent to handle the complete Node.js synchronization workflow, including version update, patch regeneration, validation, and commits.

### Phase 1: Validate Environment

<prerequisites>
Before spawning the agent, verify the environment is ready:
</prerequisites>

<action>
Check working directory and submodule state:
</action>

```bash
# Check working directory is clean
git status

# Verify upstream submodule exists
ls -la packages/node-smol-builder/upstream/node

# Check current Node.js version
cat .node-version
```

<validation>
**Expected State:**
- ✓ Working directory clean (no uncommitted changes)
- ✓ Submodule directory exists: `packages/node-smol-builder/upstream/node/`
- ✓ `.node-version` file exists with valid version

**If working directory NOT clean:**
- Commit or stash changes before proceeding
- Node.js sync should start from clean state

**If submodule missing:**
- Initialize: `git submodule update --init --recursive`
- Report error and ask user to fix

Do NOT proceed if environment checks fail.
</validation>

---

### Phase 2: Spawn Autonomous Agent

<action>
Spawn a general-purpose agent with detailed instructions for Node.js synchronization:
</action>

**Use Task tool with the following prompt:**

```javascript
Task({
  subagent_type: "general-purpose",
  description: "Sync Node.js to latest version",
  prompt: `Synchronize socket-btm with upstream Node.js: update submodule to latest stable tag, update \`.node-version\`, regenerate patches, validate build/tests, commit with detailed metrics.

<task>
Your task is to synchronize socket-btm with upstream Node.js by updating the submodule to the latest stable Node.js release, updating \`.node-version\` to match, regenerating all Socket Security patches for the new version, validating build and tests pass, and creating two commits with detailed changelogs.
</task>

<context>
**Project Context:**
You are working on socket-btm (Socket Security's binary tooling manager) which builds custom Node.js binaries with security patches. The Node.js version is tracked in two places:
- \`.node-version\` - For tooling (nvm, volta, CI)
- \`packages/node-smol-builder/upstream/node\` - Git submodule pointing to nodejs/node

**Why Synchronize:**
- Keep Node.js baseline up-to-date with security patches
- Access new Node.js APIs and features
- Maintain compatibility with latest ecosystem tools
- Ensure Socket Security patches apply to current Node.js

**Workflow Overview:**
1. Fetch latest stable Node.js tag (no release candidates)
2. Update submodule to new tag
3. Update \`.node-version\` to match
4. Commit version change
5. Regenerate patches for new Node.js version
6. Validate build and tests pass
7. Commit patch regeneration
8. Report metrics and version change

**Critical Success Factors:**
- Only stable tags (vX.Y.Z, no -rc or -nightly)
- All 13 patches must apply cleanly
- Build must succeed without errors
- Tests must pass (100%)
- Two atomic commits with detailed messages
</context>

<constraints>
**CRITICAL Requirements:**
- MUST use stable tag only (vX.Y.Z, no -rc suffix)
- MUST update both .node-version AND submodule
- MUST regenerate patches after Node.js update
- MUST validate build succeeds before committing
- MUST validate tests pass (100%)
- MUST create exactly 2 commits (version + patches)

**Failure Modes to Prevent:**
- Updating to unstable release candidate
- Forgetting to update .node-version
- Skipping patch regeneration (breaks build)
- Committing without validation (untested changes)
- Single commit combining version and patches (lose atomicity)
</constraints>

<instructions>

## Critical Workflow (8 Steps)

Execute these steps sequentially. Each step must succeed before proceeding.

### Step 1: Validate Environment

<action>
Verify starting state is clean:
</action>

\`\`\`bash
git status
\`\`\`

<validation>
**Expected Output:**
\`\`\`
On branch main
nothing to commit, working tree clean
\`\`\`

**If working directory NOT clean:**
- Stop immediately
- Report uncommitted changes to user
- Ask user to commit or stash changes first

Do NOT proceed if git status shows uncommitted changes.
</validation>

---

### Step 2: Fetch Latest Node.js Tag

<action>
Fetch all tags from upstream Node.js and identify latest stable release:
</action>

\`\`\`bash
cd packages/node-smol-builder/upstream/node
git fetch origin --tags

# Get latest stable tag (exclude release candidates)
LATEST_TAG=\$(git tag -l 'v*.*.*' --sort=-version:refname | grep -v 'rc' | head -1)
echo "Latest stable Node.js tag: \$LATEST_TAG"

# Capture current tag for comparison
CURRENT_TAG=\$(git describe --tags 2>/dev/null || echo "unknown")
echo "Current tag: \$CURRENT_TAG"

cd ../../..
\`\`\`

<validation>
Think through these validation questions:
1. Does LATEST_TAG match format vX.Y.Z (three version numbers)?
2. Is LATEST_TAG different from CURRENT_TAG?
3. Does LATEST_TAG NOT contain "-rc" (release candidate)?

**Expected Output:**
\`\`\`
Latest stable Node.js tag: v22.3.0
Current tag: v22.2.0
\`\`\`

**If LATEST_TAG is empty or invalid:**
- Check git fetch succeeded
- Verify nodejs/node repository has tags
- Report error and exit

**If LATEST_TAG == CURRENT_TAG:**
- Already on latest version
- Report to user: "Node.js already at latest stable (\$LATEST_TAG)"
- Exit successfully (no update needed)

Do NOT proceed if tag validation fails.
</validation>

---

### Step 3: Update Submodule

<action>
Checkout new Node.js tag in submodule and capture version info:
</action>

\`\`\`bash
cd packages/node-smol-builder/upstream/node
git checkout "\$LATEST_TAG"
NEW_SHA=\$(git rev-parse HEAD)
NEW_VERSION="\${LATEST_TAG#v}"  # Strip 'v' prefix
cd ../../..

echo "Updated to Node.js \$LATEST_TAG (\$NEW_SHA)"
echo "New version: \$NEW_VERSION"
\`\`\`

<validation>
Verify submodule updated:
\`\`\`bash
cd packages/node-smol-builder/upstream/node
git describe --tags  # Should output LATEST_TAG
cd ../../..
\`\`\`

**Expected Output:**
\`\`\`
Updated to Node.js v22.3.0 (abc123def456...)
New version: 22.3.0
v22.3.0
\`\`\`

Verify NEW_VERSION has correct format (X.Y.Z without 'v' prefix).
</validation>

---

### Step 4: Update .node-version

<action>
Update .node-version to match submodule and create first commit:
</action>

\`\`\`bash
# Capture old version for commit message
OLD_VERSION=\$(cat .node-version)
echo "Old version: \$OLD_VERSION"

# Write new version
echo "\$NEW_VERSION" > .node-version

# Verify update
cat .node-version

# Stage changes
git add .node-version packages/node-smol-builder/upstream/node

# Create first commit (version update)
git commit -m "chore(node): update Node.js from v\$OLD_VERSION to v\$NEW_VERSION

Update upstream Node.js submodule to \$LATEST_TAG

Updated:
- .node-version: \$OLD_VERSION → \$NEW_VERSION
- packages/node-smol-builder/upstream/node → \$LATEST_TAG"
\`\`\`

<validation>
Verify commit created:
\`\`\`bash
git log -1 --oneline
git show --stat HEAD
\`\`\`

**Expected Output:**
\`\`\`
chore(node): update Node.js from v22.2.0 to v22.3.0
\`\`\`

Verify:
- Commit message follows conventional commit format
- .node-version changed
- Submodule updated

**Report to user:**
✓ Commit 1/2: Node.js version updated to v\$NEW_VERSION
</validation>

---

### Step 5: Regenerate Patches

<action>
Clean build artifacts and regenerate patches for new Node.js version:
</action>

\`\`\`bash
cd packages/node-smol-builder
pnpm run clean

# Retry up to 3 times (patches can be flaky)
for i in 1 2 3; do
  echo "Attempt \$i/3: Regenerating patches..."
  if pnpm run build:patches 2>&1 | tee /tmp/patch-output.log; then
    echo "✓ Patches regenerated successfully"
    break
  fi
  if [ \$i -eq 3 ]; then
    echo "✗ ERROR: Patches failed after 3 attempts"
    echo "Check log: /tmp/patch-output.log"
    cat /tmp/patch-output.log
    exit 1
  fi
  echo "Retry in 2 seconds..."
  sleep 2
done

cd ../..
\`\`\`

<validation>
Think through these validation questions:
1. Did build:patches exit 0 (success)?
2. Are there any "FAILED" or "reject" messages in output?
3. Do all 13 patches apply cleanly?

**If patches fail:**
- Review /tmp/patch-output.log for specific errors
- Common issues:
  - Node.js API changed (patch context no longer matches)
  - File moved or renamed in new Node.js version
  - Patch format incompatible with new upstream
- May require manual patch updates
- Consult regenerating-node-patches skill for patch regeneration

**Expected Output:**
\`\`\`
✓ Patches regenerated successfully
\`\`\`

Do NOT proceed to Step 6 if patch regeneration fails.
</validation>

---

### Step 6: Validate Build and Tests

<action>
Run full validation: linting, build, and tests:
</action>

\`\`\`bash
cd packages/node-smol-builder

# Retry up to 3 times
for i in 1 2 3; do
  echo "Attempt \$i/3: Validating build and tests..."

  # Fix any auto-fixable linting issues
  pnpm run lint:fix --all || true

  # Build and test
  if pnpm run build && pnpm test; then
    echo "✓ Build and tests passed"
    break
  fi

  if [ \$i -eq 3 ]; then
    echo "✗ ERROR: Validation failed after 3 attempts"
    echo "Build or tests failed with Node.js v\$NEW_VERSION"
    exit 1
  fi

  echo "Retry in 2 seconds..."
  sleep 2
done

cd ../..
\`\`\`

<validation>
Think through these validation questions:
1. Did build succeed without errors?
2. Did all tests pass (100%)?
3. Are there any new warnings or deprecations?

**Expected Output:**
\`\`\`
✓ Build and tests passed
\`\`\`

**If validation fails:**
- Review build errors (TypeScript, compilation issues)
- Review test failures (API changes, behavior differences)
- Common issues:
  - Node.js API deprecated or removed
  - Test expectations changed with new behavior
  - Build configuration incompatible
- May require code updates to work with new Node.js

Do NOT proceed to Step 7 if validation fails.
</validation>

---

### Step 7: Final Commit

<action>
Create second commit with patch regeneration and validation results:
</action>

\`\`\`bash
git add packages/node-smol-builder
git commit -m "chore(node-smol-builder): rebuild with Node.js v\$NEW_VERSION

Regenerate patches and rebuild after Node.js update.

Changes:
- All 13 patches applied cleanly to Node.js v\$NEW_VERSION
- Build validated: SUCCESS
- Tests validated: PASS (100%)

This completes the Node.js synchronization from v\$OLD_VERSION to v\$NEW_VERSION."
\`\`\`

<validation>
Verify commit created:
\`\`\`bash
git log -2 --oneline
git show --stat HEAD
\`\`\`

**Expected Output:**
\`\`\`
abc123d chore(node-smol-builder): rebuild with Node.js v22.3.0
abc123c chore(node): update Node.js from v22.2.0 to v22.3.0
\`\`\`

Verify:
- Two commits created
- Both follow conventional commit format
- Detailed changelogs included

**Report to user:**
✓ Commit 2/2: Patches regenerated and validated for v\$NEW_VERSION
</validation>

---

### Step 8: Report Summary

<action>
Generate final summary report with metrics:
</action>

\`\`\`bash
# Get commit SHAs
COMMIT_1=\$(git rev-parse HEAD~1)
COMMIT_2=\$(git rev-parse HEAD)

# Generate summary
cat << EOF

Node.js Synchronization Complete
=================================
Updated from: v\$OLD_VERSION → v\$NEW_VERSION
Upstream tag: \$LATEST_TAG
Commit SHA: \$NEW_SHA

Commits Created:
- \${COMMIT_1:0:7}: chore(node): update Node.js version
- \${COMMIT_2:0:7}: chore(node-smol-builder): rebuild with patches

Validation:
✓ All 13 patches applied cleanly
✓ Build: SUCCESS
✓ Tests: PASS (100%)
✓ Total commits: 2

Next Steps:
- Review changes: git log -2 --stat
- Test manually if desired
- Push to remote: git push origin main
- Monitor CI/CD for integration tests

Node.js is now synchronized to v\$NEW_VERSION.
EOF
\`\`\`

<validation>
Final verification checklist:
- ✓ Two commits created
- ✓ .node-version updated
- ✓ Submodule updated
- ✓ Patches regenerated
- ✓ Build passed
- ✓ Tests passed
- ✓ Summary report generated

All steps completed successfully.
</validation>

</instructions>

<completion_signal>
\`\`\`xml
<promise>NODE_SYNC_COMPLETE</promise>
\`\`\`
</completion_signal>

<success_criteria>
- ✅ Updated from OLD_VERSION to NEW_VERSION
- ✅ .node-version matches submodule tag
- ✅ All 13 patches applied cleanly
- ✅ Build succeeded without errors
- ✅ Tests passed (100%)
- ✅ Two commits created with detailed messages
- ✅ Ready for push to remote
</success_criteria>

## Edge Cases

**Upstream submodule not initialized:**
\`\`\`bash
git submodule update --init --recursive packages/node-smol-builder/upstream/node
\`\`\`

**Patches fail to apply:**
- Node.js API may have changed significantly
- Review patch output for specific failures
- May need to manually update patches
- Use regenerating-node-patches skill to rebuild patches from scratch
- Consult CLAUDE.md for patch format

**Build fails with new Node.js:**
- Node.js may have deprecated or removed APIs
- Review build errors for specific issues
- Update code to work with new Node.js APIs
- Consult Node.js release notes for breaking changes

**Tests fail with new Node.js:**
- Behavior may have changed in new version
- Review test failures for specific issues
- Update tests or code to match new behavior
- Verify changes are expected per Node.js release notes

**Rollback if needed:**
\`\`\`bash
git reset --hard HEAD~2  # Remove both commits
\`\`\`
`
})
```

<validation>
**After agent completion, verify:**
- Agent output shows \`<promise>NODE_SYNC_COMPLETE</promise>\`
- Two commits created (version + patches)
- .node-version matches submodule tag
- Build and tests passed

**Report to user:**
- Node.js updated: vOLD → vNEW
- Commits: 2
- Build: SUCCESS
- Tests: PASS
- Ready for push
</validation>

---

### Phase 3: Complete

<completion_signal>
```xml
<promise>SKILL_COMPLETE</promise>
```
</completion_signal>

<summary>
Report final results to the user:

**Node.js Synchronization Skill Complete**
=========================================
✓ Autonomous agent spawned
✓ Agent completed Node.js synchronization workflow
✓ Node.js updated to latest stable version
✓ .node-version synchronized with submodule
✓ All patches regenerated and validated
✓ Build and tests passed
✓ Two commits created

**Version Change:**
OLD_VERSION → NEW_VERSION

**Commits:**
1. chore(node): update Node.js version
2. chore(node-smol-builder): rebuild with patches

**Next Steps:**
1. Review changes: \`git log -2 --stat\`
2. Test manually if desired
3. Push to remote: \`git push origin main\`
4. Monitor CI/CD for integration tests

Node.js is now synchronized to the latest stable release.
</summary>

</instructions>

## Success Criteria

- ✅ \`<promise>SKILL_COMPLETE</promise>\` output
- ✅ Autonomous agent spawned with detailed instructions
- ✅ Agent completed Node.js synchronization workflow
- ✅ .node-version updated to latest stable
- ✅ Submodule updated to latest stable tag
- ✅ All patches regenerated and applied cleanly
- ✅ Build and tests passed (100%)
- ✅ Two commits created with detailed messages
- ✅ Ready for push to remote

## Commands

This skill spawns an autonomous agent. No direct commands needed.

## Context

This skill is useful for:
- Updating to new Node.js stable releases
- Applying security patches from upstream
- Accessing new Node.js APIs and features
- Maintaining compatibility with ecosystem tools
- Regular maintenance (monthly or quarterly)

**Safety:** Working directory must be clean. Validation ensures patches apply and tests pass before committing. Rollback available with \`git reset --hard HEAD~2\`.

**Trade-offs:**
- ✓ Automated workflow (minimal manual steps)
- ✓ Validation ensures patches work with new version
- ✓ Atomic commits (version + patches separate)
- ✓ Retry logic for flaky operations
- ✗ Requires clean working directory
- ✗ May fail if patches incompatible with new Node.js
- ✗ Manual intervention needed if validation fails
