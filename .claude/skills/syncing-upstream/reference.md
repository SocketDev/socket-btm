# syncing-upstream Reference Documentation

This document provides detailed edge cases, troubleshooting procedures, and advanced topics for the syncing-upstream skill in socket-btm.

## Table of Contents

1. [Edge Cases](#edge-cases)
2. [Rollback Procedures](#rollback-procedures)
3. [Retry Logic](#retry-logic)
4. [Version Detection](#version-detection)
5. [Patch Compatibility](#patch-compatibility)
6. [Build and Test Failures](#build-and-test-failures)
7. [Cross-Platform Considerations](#cross-platform-considerations)
8. [Advanced Topics](#advanced-topics)

---

## Edge Cases

### Already on Latest Version

**Scenario:** Upstream sync runs but Node.js already at latest stable tag.

**Detection:**
```bash
cd packages/node-smol-builder/upstream/node
CURRENT_TAG=$(git describe --tags 2>/dev/null)
LATEST_TAG=$(git tag -l 'v*.*.*' --sort=-version:refname | grep -v 'rc' | head -1)

if [ "$CURRENT_TAG" = "$LATEST_TAG" ]; then
  echo "Already on latest: $LATEST_TAG"
  exit 0
fi
```

**Outcome:** Exit successfully with message "Node.js already at latest stable (v25.5.0)" - no commits created.

**Likelihood:** High if running sync frequently or after recent update.

---

### Release Candidate Tagged as Latest

**Scenario:** Latest tag is release candidate (v25.6.0-rc.1), not stable.

**Prevention:**
```bash
# Exclude release candidates with grep -v 'rc'
LATEST_TAG=$(git tag -l 'v*.*.*' --sort=-version:refname | grep -v 'rc' | head -1)
```

**Validation:**
```bash
if echo "$LATEST_TAG" | grep -q 'rc'; then
  echo "ERROR: Latest tag is release candidate: $LATEST_TAG"
  echo "Skipping unstable release"
  exit 1
fi
```

**Why Critical:** Release candidates are unstable and may break production builds.

---

### Submodule Detached HEAD

**Scenario:** Submodule is in detached HEAD state (not on a tag).

**Detection:**
```bash
cd packages/node-smol-builder/upstream/node
if ! git symbolic-ref -q HEAD >/dev/null; then
  echo "WARNING: Submodule in detached HEAD state"
  git describe --tags  # Show current position
fi
```

**Solution:** This is expected behavior after checking out a tag. The submodule will be in detached HEAD at the tag commit.

**Not a Problem:** Submodules track specific commits, not branches. Detached HEAD is normal.

---

### .node-version Out of Sync

**Scenario:** .node-version and submodule tag don't match before sync.

**Detection:**
```bash
NODE_VERSION=$(cat .node-version)
cd packages/node-smol-builder/upstream/node
SUBMODULE_TAG=$(git describe --tags 2>/dev/null || echo "unknown")
SUBMODULE_VERSION="${SUBMODULE_TAG#v}"

if [ "$NODE_VERSION" != "$SUBMODULE_VERSION" ]; then
  echo "WARNING: Version mismatch detected"
  echo "  .node-version: $NODE_VERSION"
  echo "  Submodule: $SUBMODULE_VERSION"
  echo "This will be fixed by the sync"
fi
```

**Outcome:** Sync will correct the mismatch and create commit with before/after versions.

---

### Partial Commit State

**Scenario:** First commit (version update) succeeded but second commit (patches) failed.

**State:**
- ✓ Commit 1: .node-version and submodule updated
- ✗ Commit 2: Patch regeneration failed

**Recovery:**

**Option 1: Fix and Retry**
```bash
# Review error
cat /tmp/patch-output.log

# Fix patches manually if needed
# Use regenerating-node-patches skill

# Retry from Step 5
cd packages/node-smol-builder
pnpm run clean
pnpm run build:patches

# If successful, complete Step 7 (commit)
git add packages/node-smol-builder
git commit -m "chore(node-smol-builder): rebuild with Node.js vX.Y.Z"
```

**Option 2: Rollback First Commit**
```bash
# Remove version update commit
git reset --hard HEAD~1

# Submodule and .node-version reverted
```

See [Rollback Procedures](#rollback-procedures) for details.

---

### Network Failure During Fetch

**Scenario:** `git fetch origin --tags` fails due to network issues.

**Detection:**
```bash
cd packages/node-smol-builder/upstream/node
if ! git fetch origin --tags 2>&1 | tee /tmp/fetch-output.log; then
  echo "ERROR: Failed to fetch tags from nodejs/node"
  cat /tmp/fetch-output.log
  exit 1
fi
```

**Retry Logic:**
```bash
MAX_RETRIES=3
for i in $(seq 1 $MAX_RETRIES); do
  echo "Attempt $i/$MAX_RETRIES: Fetching tags..."
  if git fetch origin --tags; then
    echo "✓ Tags fetched successfully"
    break
  fi
  if [ $i -eq $MAX_RETRIES ]; then
    echo "✗ ERROR: Failed to fetch after $MAX_RETRIES attempts"
    exit 1
  fi
  echo "Retry in 5 seconds..."
  sleep 5
done
```

**Common Causes:**
- Network connectivity issues
- GitHub API rate limiting
- DNS resolution failures
- Proxy/firewall blocking

---

### Uncommitted Changes Block Sync

**Scenario:** Working directory has uncommitted changes before sync.

**Detection (Phase 1):**
```bash
git status --porcelain
```

**Prevention:**
```bash
if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: Working directory not clean"
  echo "Uncommitted changes:"
  git status --short
  echo ""
  echo "Please commit or stash changes before syncing:"
  echo "  git add -A && git commit -m 'WIP: before sync'"
  echo "  OR"
  echo "  git stash push -m 'Before Node.js sync'"
  exit 1
fi
```

**User Action Required:** Commit or stash changes before running sync.

---

## Rollback Procedures

### Rollback After Partial Success (1 Commit)

**Scenario:** Version commit succeeded but patch regeneration failed.

**Current State:**
```bash
git log -1 --oneline
# abc123d chore(node): update Node.js from v25.4.0 to v25.5.0
```

**Rollback:**
```bash
# Remove the version update commit
git reset --hard HEAD~1

# Verify rollback
cat .node-version  # Should show v25.4.0 (old version)
cd packages/node-smol-builder/upstream/node
git describe --tags  # Should show v25.4.0 (old tag)
```

**Outcome:** Back to pre-sync state, ready to retry or investigate failures.

---

### Rollback After Full Success (2 Commits)

**Scenario:** Both commits created but issues discovered post-sync.

**Current State:**
```bash
git log -2 --oneline
# def456e chore(node-smol-builder): rebuild with Node.js v25.5.0
# abc123d chore(node): update Node.js from v25.4.0 to v25.5.0
```

**Rollback:**
```bash
# Remove both commits
git reset --hard HEAD~2

# Verify rollback
cat .node-version  # Should show v25.4.0
cd packages/node-smol-builder/upstream/node
git describe --tags  # Should show v25.4.0
cd ../..
pnpm run build  # Should build with old version
```

**When to Use:**
- Build works but runtime issues discovered
- Tests pass but integration tests fail in CI
- Need to investigate before deploying changes

---

### Rollback After Push to Remote

**Scenario:** Sync complete, pushed to remote, but need to rollback.

**⚠️ WARNING:** This rewrites history on remote. Coordinate with team.

**Steps:**
```bash
# Local rollback
git reset --hard HEAD~2

# Force push to remote (DESTRUCTIVE)
git push --force origin main
```

**Notification Required:**
```
Team: Node.js sync v25.5.0 rolled back to v25.4.0 due to [REASON].
Please sync your local branches:
  git fetch origin
  git reset --hard origin/main
```

**Alternative (Safer):** Create revert commits instead:
```bash
# Revert both commits in reverse order
git revert HEAD      # Revert patches commit
git revert HEAD~1    # Revert version commit

# Push reverts (safe, no force required)
git push origin main
```

---

### Emergency Rollback During Sync

**Scenario:** Need to abort sync while agent is running (Step 5-7).

**Immediate Actions:**

1. **Let agent complete current step** - Don't interrupt mid-operation
2. **After agent exits, assess state:**
   ```bash
   git status
   git log -2 --oneline
   ```
3. **Rollback based on commits created:**
   - 0 commits: No rollback needed (sync didn't start)
   - 1 commit: Rollback version update (HEAD~1)
   - 2 commits: Rollback both (HEAD~2)

---

## Retry Logic

### Patch Regeneration Retry

**Why Needed:** `pnpm run build:patches` can fail transiently due to:
- File system sync delays
- Race conditions in build scripts
- Network issues fetching dependencies

**Implementation:**
```bash
MAX_RETRIES=3
RETRY_DELAY=2

for i in $(seq 1 $MAX_RETRIES); do
  echo "Attempt $i/$MAX_RETRIES: Regenerating patches..."

  if pnpm run build:patches 2>&1 | tee /tmp/patch-output-$i.log; then
    echo "✓ Patches regenerated successfully"
    break
  fi

  if [ $i -eq $MAX_RETRIES ]; then
    echo "✗ ERROR: Patches failed after $MAX_RETRIES attempts"
    echo ""
    echo "Logs from all attempts:"
    for j in $(seq 1 $i); do
      echo "=== Attempt $j ==="
      cat /tmp/patch-output-$j.log
    done
    exit 1
  fi

  echo "⚠ Attempt $i failed, retrying in ${RETRY_DELAY}s..."
  sleep $RETRY_DELAY
done
```

**Log Preservation:** All attempts logged separately for debugging.

---

### Build and Test Retry

**Why Needed:** Build/tests can fail transiently due to:
- Linting auto-fix timing issues
- Test flakiness
- Resource contention

**Implementation:**
```bash
MAX_RETRIES=3
RETRY_DELAY=2

for i in $(seq 1 $MAX_RETRIES); do
  echo "Attempt $i/$MAX_RETRIES: Validating build and tests..."

  # Auto-fix linting (best effort)
  pnpm run lint:fix --all || true

  # Run build and tests
  if pnpm run build && pnpm test 2>&1 | tee /tmp/validation-$i.log; then
    echo "✓ Build and tests passed"
    break
  fi

  if [ $i -eq $MAX_RETRIES ]; then
    echo "✗ ERROR: Validation failed after $MAX_RETRIES attempts"
    echo ""
    echo "This likely indicates real compatibility issues with Node.js $NEW_VERSION"
    echo ""
    echo "Review logs:"
    for j in $(seq 1 $i); do
      echo "  /tmp/validation-$j.log"
    done
    exit 1
  fi

  echo "⚠ Attempt $i failed, retrying in ${RETRY_DELAY}s..."
  sleep $RETRY_DELAY
done
```

**When Retries Fail:** Likely real compatibility issue requiring code changes.

---

### Git Operation Retry

**Why Needed:** Git operations can fail transiently due to:
- File system locks
- Network issues (for submodule fetch)
- Race conditions with IDE/tools

**Not Usually Needed:** Git operations are generally reliable. Only add retry for specific failures.

---

## Version Detection

### Parsing Node.js Version Tags

**Tag Format:** `v25.5.0` (semantic versioning with 'v' prefix)

**Extraction:**
```bash
# Get tag
LATEST_TAG=$(git tag -l 'v*.*.*' --sort=-version:refname | grep -v 'rc' | head -1)
# Example: v25.5.0

# Strip 'v' prefix for .node-version
NEW_VERSION="${LATEST_TAG#v}"
# Example: 25.5.0
```

**Validation:**
```bash
# Check format: vMAJOR.MINOR.PATCH
if ! echo "$LATEST_TAG" | grep -qE '^v[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "ERROR: Invalid tag format: $LATEST_TAG"
  exit 1
fi

# Check not a release candidate
if echo "$LATEST_TAG" | grep -q 'rc'; then
  echo "ERROR: Tag is release candidate: $LATEST_TAG"
  exit 1
fi
```

---

### Semantic Version Comparison

**Problem:** Need to compare v25.5.0 vs v25.4.0 semantically (not lexicographically).

**Solution:** Use `git tag --sort=-version:refname` for version-aware sorting:

```bash
# Gets tags sorted by version (newest first)
git tag -l 'v*.*.*' --sort=-version:refname | head -5
# v25.5.0
# v25.4.0
# v25.3.0
# v25.2.0
# v25.1.0
```

**Why This Works:** Git's version sorting understands semantic versioning.

---

### Major Version Upgrades

**Scenario:** Upgrading across major versions (v24.x.x → v25.x.x or v25.x.x → v26.x.x).

**Higher Risk:**
- Breaking API changes likely
- Patches may need significant updates
- More thorough testing required

**Additional Validation:**
```bash
OLD_MAJOR=$(echo "$OLD_VERSION" | cut -d. -f1)
NEW_MAJOR=$(echo "$NEW_VERSION" | cut -d. -f1)

if [ "$NEW_MAJOR" -gt "$OLD_MAJOR" ]; then
  echo "⚠️  WARNING: Major version upgrade detected"
  echo "   $OLD_VERSION → $NEW_VERSION"
  echo ""
  echo "   Major version upgrades may include:"
  echo "   - Breaking API changes"
  echo "   - Patch compatibility issues"
  echo "   - Behavior changes requiring code updates"
  echo ""
  echo "   Review Node.js release notes before proceeding:"
  echo "   https://github.com/nodejs/node/blob/main/doc/changelogs/CHANGELOG_V${NEW_MAJOR}.md"
  echo ""
  read -p "Continue with major version upgrade? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborting sync"
    exit 1
  fi
fi
```

---

## Patch Compatibility

### Detecting Patch Application Failures

**Scenario:** Patches don't apply cleanly to new Node.js version.

**Detection (Step 5):**
```bash
cd packages/node-smol-builder
if ! pnpm run build:patches 2>&1 | tee /tmp/patch-output.log; then
  echo "ERROR: Patch regeneration failed"

  # Parse output for specific failures
  grep -i "failed\|reject\|error" /tmp/patch-output.log

  exit 1
fi
```

**Common Causes:**

1. **Context Lines Changed**
   - Node.js file modified near patch location
   - Solution: Regenerate patch with new context lines

2. **File Moved or Renamed**
   - Patch references old file path
   - Solution: Update patch to reference new path

3. **Code Removed**
   - Patched code no longer exists in Node.js
   - Solution: Remove patch if no longer needed, or find new location

4. **API Changed**
   - Node.js API signature changed
   - Solution: Update patch to use new API

---

### Manual Patch Updates

**When Needed:** Automated patch regeneration fails, manual updates required.

**Process:**

1. **Identify broken patch:**
   ```bash
   cat /tmp/patch-output.log | grep -B 5 "FAILED"
   ```

2. **Test patch manually:**
   ```bash
   cd packages/node-smol-builder/upstream/node
   git reset --hard v25.5.0

   patch --dry-run < ../../patches/source-patched/001-common_gypi_fixes.patch
   ```

3. **Update patch using regenerating-node-patches skill:**
   - Read original patch intent (comments)
   - Apply modifications to new Node.js version
   - Regenerate patch from pristine source

4. **Validate new patch:**
   ```bash
   cd packages/node-smol-builder/upstream/node
   git reset --hard v25.5.0

   patch --dry-run < ../../patches/source-patched/001-common_gypi_fixes.patch
   ```

5. **Resume sync from Step 6 (validation):**
   ```bash
   cd packages/node-smol-builder
   pnpm run build && pnpm test
   ```

---

### Patch Independence Verification

**Why Important:** Each patch should apply to pristine upstream (not depend on previous patches).

**Verification Script:**
```bash
#!/bin/bash
set -e

cd packages/node-smol-builder/upstream/node
FAILED=0

for patch in ../../patches/source-patched/*.patch; do
  patch_name=$(basename "$patch")
  echo "Testing: $patch_name (pristine source)"

  # Reset to pristine for each patch
  git reset --hard v25.5.0
  git clean -fd

  if ! patch --dry-run -p1 < "$patch"; then
    echo "❌ FAILED: $patch_name does not apply to pristine source"
    FAILED=$((FAILED + 1))
  else
    echo "✅ PASSED: $patch_name"
  fi
done

if [ $FAILED -gt 0 ]; then
  echo ""
  echo "❌ $FAILED patches failed independence check"
  echo "Patches must apply to pristine upstream (no dependencies)"
  exit 1
else
  echo ""
  echo "✅ All patches are independent"
fi
```

**Run After:** Any manual patch updates to ensure independence maintained.

---

## Build and Test Failures

### Build Failures After Node.js Update

**Common Causes:**

1. **Deprecated APIs Used**
   ```
   error TS2305: Module '"fs"' has no exported member 'SyncWriteStream'.
   ```
   **Solution:** Update code to use replacement API or remove deprecated usage.

2. **Type Definition Changes**
   ```
   error TS2339: Property 'readMode' does not exist on type 'ReadStream'.
   ```
   **Solution:** Update TypeScript types or code to match new Node.js types.

3. **Build Tool Incompatibility**
   ```
   Error: node-gyp rebuild failed
   ```
   **Solution:** Update node-gyp or build configuration for new Node.js version.

---

### Test Failures After Node.js Update

**Common Causes:**

1. **Behavior Changes**
   ```
   Expected error message to contain "ENOENT", got "ENOTFOUND"
   ```
   **Solution:** Update test expectations to match new behavior.

2. **Performance Changes**
   ```
   Timeout: Test took 5001ms, limit is 5000ms
   ```
   **Solution:** Adjust timeouts or optimize test.

3. **New Warnings**
   ```
   (node:12345) Warning: Accessing non-existent property 'version'
   ```
   **Solution:** Fix warnings or suppress if expected in new version.

---

### Debugging Build/Test Failures

**Step-by-Step Process:**

1. **Isolate failure:**
   ```bash
   cd packages/node-smol-builder

   # Try build alone
   pnpm run build

   # Try tests alone
   pnpm test
   ```

2. **Review detailed logs:**
   ```bash
   cat /tmp/validation-1.log | grep -A 10 "error\|fail"
   ```

3. **Test with old Node.js version:**
   ```bash
   # Temporarily switch back
   cd upstream/node
   git checkout v25.4.0
   cd ../..

   # Does it work with old version?
   pnpm run build && pnpm test

   # If yes: confirms Node.js version is the issue
   ```

4. **Check Node.js changelog:**
   ```
   https://github.com/nodejs/node/blob/main/doc/changelogs/CHANGELOG_V25.md
   ```
   Search for breaking changes, deprecations, behavior changes.

5. **Fix and retry sync**

---

## Cross-Platform Considerations

### macOS vs Linux

**Submodule Operations:**
- ✅ Both support same git commands
- ✅ Both use same tag format

**Build System:**
- ⚠️ node-gyp may behave differently
- ⚠️ Native module compilation differs

**Patches:**
- ✅ Same patch format works on both
- ⚠️ Some patches are macOS-specific (see 011-fix_v8_typeindex_macos.patch)

---

### Windows Support

**Git Commands:**
- ✅ Git for Windows supports same commands
- ⚠️ Path separators: Use `/` in git commands, works on all platforms

**Bash Scripts:**
- ✅ Git Bash or WSL required
- ⚠️ PowerShell uses different syntax (not recommended)

**Build System:**
- ⚠️ May require Visual Studio Build Tools
- ⚠️ Some patches may need Windows-specific adjustments

---

## Advanced Topics

### Automated Scheduled Syncs

**Use Case:** Run upstream sync weekly to stay current.

**GitHub Actions Example:**
```yaml
name: Weekly Node.js Sync

on:
  schedule:
    # Every Monday at 9 AM UTC
    - cron: '0 9 * * 1'
  workflow_dispatch:  # Manual trigger

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
        with:
          submodules: recursive

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version-file: '.node-version'

      - name: Run upstream sync
        run: |
          # Invoke syncing-upstream skill via CLI
          # (requires Claude Code or custom automation)

      - name: Create Pull Request
        if: success()
        uses: peter-evans/create-pull-request@v5
        with:
          title: 'chore: sync upstream Node.js'
          body: |
            Automated upstream Node.js sync.

            Review changes and merge if tests pass.
          branch: automated/node-js-sync
```

**Benefits:**
- Stay up-to-date automatically
- Review changes via PR before merging
- CI validates changes before merge

---

### Skipping Patch Regeneration

**Scenario:** Node.js version didn't change patch-relevant files, skip regeneration.

**⚠️ WARNING:** This is RISKY and NOT RECOMMENDED. Always regenerate patches.

**Why Risky:**
- Can't know for sure if patches apply without testing
- May introduce subtle bugs
- Breaks reproducibility

**If Absolutely Necessary:**
```bash
# After Step 4 (version commit)
# Skip Step 5 (regenerate patches)
# Jump to Step 6 (validate)

cd packages/node-smol-builder
pnpm run build && pnpm test

# If validation passes, create commit
git add packages/node-smol-builder
git commit -m "chore(node-smol-builder): validate with Node.js v$NEW_VERSION (patches unchanged)"
```

**Only Use When:**
- Patch version bump only (v25.5.0 → v25.5.1)
- No files modified in patch locations
- Time-sensitive update required

---

### Selective Patch Testing

**Scenario:** Test individual patches after update to identify problematic ones.

**Script:**
```bash
#!/bin/bash
cd packages/node-smol-builder/upstream/node
git reset --hard v25.5.0

PASSING=()
FAILING=()

for patch in ../../patches/source-patched/*.patch; do
  patch_name=$(basename "$patch")

  # Reset before each patch
  git reset --hard v25.5.0
  git clean -fd

  echo "Testing: $patch_name"
  if patch -p1 < "$patch"; then
    PASSING+=("$patch_name")
  else
    FAILING+=("$patch_name")
  fi
done

echo ""
echo "✅ Passing patches (${#PASSING[@]}):"
printf '  %s\n' "${PASSING[@]}"

echo ""
echo "❌ Failing patches (${#FAILING[@]}):"
printf '  %s\n' "${FAILING[@]}"
```

**Use Case:** Identify which specific patches need regeneration.

---

## Monitoring and Alerting

### Success Metrics to Track

**Per Sync:**
- Version change (old → new)
- Patches applied: 13/13
- Build status: PASS/FAIL
- Test status: PASS/FAIL
- Commit SHAs
- Duration

**Over Time:**
- Sync frequency
- Success rate
- Time to sync (trend)
- Manual interventions needed

---

### Alerting on Failures

**When to Alert:**
1. Patch regeneration fails (requires manual intervention)
2. Build fails after update (compatibility issue)
3. Tests fail after update (behavior change)
4. Sync takes unusually long (>30 minutes)

**Alert Content:**
- Node.js version attempted
- Failure step (Step 5, 6, or 7)
- Error logs
- Rollback instructions

---

## Troubleshooting Checklist

When upstream sync fails, check:

- [ ] Working directory clean before sync?
- [ ] Submodule initialized and accessible?
- [ ] Latest tag is stable (not -rc)?
- [ ] Network connectivity (git fetch succeeded)?
- [ ] Patches applied to pristine source?
- [ ] Build passes with new version?
- [ ] Tests pass with new version?
- [ ] .node-version matches submodule tag?
- [ ] Two commits created?
- [ ] Commits follow conventional format?

Run through checklist systematically to identify root cause.

---

# Agent Prompt Template

This section contains the autonomous agent prompt template used by the syncing-upstream skill. The skill executor loads this template and passes it to the Task tool to spawn the synchronization agent.

**Usage:** In SKILL.md Phase 2, load this template and pass to `Task({ subagent_type: "general-purpose", prompt: <template> })`

**Template:**

```
Synchronize socket-btm with upstream Node.js: update submodule to latest stable tag, update `.node-version`, regenerate patches, validate build/tests, commit with detailed metrics.

<task>
Your task is to synchronize socket-btm with upstream Node.js by updating the submodule to the latest stable Node.js release, updating `.node-version` to match, regenerating all Socket Security patches for the new version, validating build and tests pass, and creating two commits with detailed changelogs.
</task>

<context>
**Project Context:**
You are working on socket-btm (Socket Security's binary tooling manager) which builds custom Node.js binaries with security patches. The Node.js version is tracked in two places:
- `.node-version` - For tooling (nvm, volta, CI)
- `packages/node-smol-builder/upstream/node` - Git submodule pointing to nodejs/node

**Why Synchronize:**
- Keep Node.js baseline up-to-date with security patches
- Access new Node.js APIs and features
- Maintain compatibility with latest ecosystem tools
- Ensure Socket Security patches apply to current Node.js

**Workflow Overview:**
1. Fetch latest stable Node.js tag (no release candidates)
2. Update submodule to new tag
3. Update `.node-version` to match
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

```bash
git status
```

<validation>
**Expected Output:**
```
On branch main
nothing to commit, working tree clean
```

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

```bash
cd packages/node-smol-builder/upstream/node
git fetch origin --tags

# Get latest stable tag (exclude release candidates)
LATEST_TAG=$(git tag -l 'v*.*.*' --sort=-version:refname | grep -v 'rc' | head -1)
echo "Latest stable Node.js tag: $LATEST_TAG"

# Capture current tag for comparison
CURRENT_TAG=$(git describe --tags 2>/dev/null || echo "unknown")
echo "Current tag: $CURRENT_TAG"

cd ../../..
```

<validation>
**Chain-of-Thought Validation:**

Use `<thinking>` tags to show your reasoning process:

<thinking>
1. Does LATEST_TAG match format vX.Y.Z (three version numbers)?
   - Check: LATEST_TAG=$LATEST_TAG
   - Pattern: ^v[0-9]+\.[0-9]+\.[0-9]+$
   - Result: [PASS/FAIL]

2. Is LATEST_TAG different from CURRENT_TAG?
   - Current: $CURRENT_TAG
   - Latest: $LATEST_TAG
   - Different: [yes/no]
   - Result: [PASS/FAIL - proceed/exit]

3. Does LATEST_TAG NOT contain "-rc" (release candidate)?
   - Check: echo $LATEST_TAG | grep -q 'rc'
   - Result: [PASS/FAIL]

Overall validation: [PASS/FAIL]
Decision: [PROCEED to Step 3 / EXIT with message]
</thinking>

**Expected Output:**
```
Latest stable Node.js tag: v22.3.0
Current tag: v22.2.0
```

**If LATEST_TAG is empty or invalid:**
- Check git fetch succeeded
- Verify nodejs/node repository has tags
- Report error and exit

**If LATEST_TAG == CURRENT_TAG:**
- Already on latest version
- Report to user: "Node.js already at latest stable ($LATEST_TAG)"
- Exit successfully (no update needed)

Do NOT proceed if tag validation fails.
</validation>

---

### Step 3: Update Submodule

<action>
Checkout new Node.js tag in submodule and capture version info:
</action>

```bash
cd packages/node-smol-builder/upstream/node
git checkout "$LATEST_TAG"
NEW_SHA=$(git rev-parse HEAD)
NEW_VERSION="${LATEST_TAG#v}"  # Strip 'v' prefix
cd ../../..

echo "Updated to Node.js $LATEST_TAG ($NEW_SHA)"
echo "New version: $NEW_VERSION"
```

<validation>
Verify submodule updated:
```bash
cd packages/node-smol-builder/upstream/node
git describe --tags  # Should output LATEST_TAG
cd ../../..
```

**Expected Output:**
```
Updated to Node.js v22.3.0 (abc123def456...)
New version: 22.3.0
v22.3.0
```

Verify NEW_VERSION has correct format (X.Y.Z without 'v' prefix).
</validation>

---

### Step 4: Update .node-version

<action>
Update .node-version to match submodule and create first commit:
</action>

```bash
# Capture old version for commit message
OLD_VERSION=$(cat .node-version)
echo "Old version: $OLD_VERSION"

# Write new version
echo "$NEW_VERSION" > .node-version

# Verify update
cat .node-version

# Stage changes
git add .node-version packages/node-smol-builder/upstream/node

# Create first commit (version update)
git commit -m "chore(node): update Node.js from v$OLD_VERSION to v$NEW_VERSION

Update upstream Node.js submodule to $LATEST_TAG

Updated:
- .node-version: $OLD_VERSION → $NEW_VERSION
- packages/node-smol-builder/upstream/node → $LATEST_TAG"
```

<validation>
Verify commit created:
```bash
git log -1 --oneline
git show --stat HEAD
```

**Expected Output:**
```
chore(node): update Node.js from v22.2.0 to v22.3.0
```

Verify:
- Commit message follows conventional commit format
- .node-version changed
- Submodule updated

**Report to user:**
✓ Commit 1/2: Node.js version updated to v$NEW_VERSION
</validation>

---

### Step 5: Regenerate Patches

<action>
Clean build artifacts and regenerate patches for new Node.js version:
</action>

```bash
cd packages/node-smol-builder
pnpm run clean

# Retry up to 3 times (patches can be flaky)
for i in 1 2 3; do
  echo "Attempt $i/3: Regenerating patches..."
  if pnpm run build:patches 2>&1 | tee /tmp/patch-output.log; then
    echo "✓ Patches regenerated successfully"
    break
  fi
  if [ $i -eq 3 ]; then
    echo "✗ ERROR: Patches failed after 3 attempts"
    echo "Check log: /tmp/patch-output.log"
    cat /tmp/patch-output.log
    exit 1
  fi
  echo "Retry in 2 seconds..."
  sleep 2
done

cd ../..
```

<validation>
**Chain-of-Thought Validation:**

Use `<thinking>` tags to show your reasoning:

<thinking>
1. Did build:patches exit 0 (success)?
   - Exit code: $?
   - Result: [PASS/FAIL]

2. Are there any "FAILED" or "reject" messages in output?
   - Check: grep -i "failed\|reject" /tmp/patch-output.log
   - Errors found: [yes/no]
   - Result: [PASS/FAIL]

3. Do all 13 patches apply cleanly?
   - Expected patches: 13
   - Successfully applied: [count]
   - Result: [PASS/FAIL]

Overall: [SUCCESS/FAILURE]
Decision: [PROCEED to Step 6 / ABORT with error]
</thinking>

**If patches fail:**
- Review /tmp/patch-output.log for specific errors
- Common issues:
  - Node.js API changed (patch context no longer matches)
  - File moved or renamed in new Node.js version
  - Patch format incompatible with new upstream
- May require manual patch updates
- Consult regenerating-node-patches skill for patch regeneration

**Expected Output:**
```
✓ Patches regenerated successfully
```

Do NOT proceed to Step 6 if patch regeneration fails.
</validation>

---

### Step 6: Validate Build and Tests

<action>
Run full validation: linting, build, and tests:
</action>

```bash
cd packages/node-smol-builder

# Retry up to 3 times
for i in 1 2 3; do
  echo "Attempt $i/3: Validating build and tests..."

  # Fix any auto-fixable linting issues
  pnpm run lint:fix --all || true

  # Build and test
  if pnpm run build && pnpm test; then
    echo "✓ Build and tests passed"
    break
  fi

  if [ $i -eq 3 ]; then
    echo "✗ ERROR: Validation failed after 3 attempts"
    echo "Build or tests failed with Node.js v$NEW_VERSION"
    exit 1
  fi

  echo "Retry in 2 seconds..."
  sleep 2
done

cd ../..
```

<validation>
**Chain-of-Thought Validation:**

Use `<thinking>` tags to show your reasoning:

<thinking>
1. Did build succeed without errors?
   - Build exit code: $?
   - Compilation errors: [yes/no]
   - Result: [PASS/FAIL]

2. Did all tests pass (100%)?
   - Tests run: [count]
   - Tests passed: [count]
   - Tests failed: [count]
   - Pass rate: [percentage]
   - Result: [PASS/FAIL]

3. Are there any new warnings or deprecations?
   - New warnings: [list or "none"]
   - Critical: [yes/no]
   - Result: [PASS/FAIL/WARNING]

Overall validation: [SUCCESS/FAILURE]
Decision: [PROCEED to Step 7 / ABORT and investigate]
</thinking>

**Expected Output:**
```
✓ Build and tests passed
```

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

```bash
git add packages/node-smol-builder
git commit -m "chore(node-smol-builder): rebuild with Node.js v$NEW_VERSION

Regenerate patches and rebuild after Node.js update.

Changes:
- All 13 patches applied cleanly to Node.js v$NEW_VERSION
- Build validated: SUCCESS
- Tests validated: PASS (100%)

This completes the Node.js synchronization from v$OLD_VERSION to v$NEW_VERSION."
```

<validation>
Verify commit created:
```bash
git log -2 --oneline
git show --stat HEAD
```

**Expected Output:**
```
abc123d chore(node-smol-builder): rebuild with Node.js v22.3.0
abc123c chore(node): update Node.js from v22.2.0 to v22.3.0
```

Verify:
- Two commits created
- Both follow conventional commit format
- Detailed changelogs included

**Report to user:**
✓ Commit 2/2: Patches regenerated and validated for v$NEW_VERSION
</validation>

---

### Step 8: Report Summary

<action>
Generate final summary report with metrics:
</action>

```bash
# Get commit SHAs
COMMIT_1=$(git rev-parse HEAD~1)
COMMIT_2=$(git rev-parse HEAD)

# Generate summary
cat << EOF

Node.js Synchronization Complete
=================================
Updated from: v$OLD_VERSION → v$NEW_VERSION
Upstream tag: $LATEST_TAG
Commit SHA: $NEW_SHA

Commits Created:
- ${COMMIT_1:0:7}: chore(node): update Node.js version
- ${COMMIT_2:0:7}: chore(node-smol-builder): rebuild with patches

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

Node.js is now synchronized to v$NEW_VERSION.
EOF
```

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
```xml
<promise>NODE_SYNC_COMPLETE</promise>
```
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
```bash
git submodule update --init --recursive packages/node-smol-builder/upstream/node
```

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
```bash
git reset --hard HEAD~2  # Remove both commits
```
```
