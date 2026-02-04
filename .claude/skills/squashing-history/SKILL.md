---
name: squashing-history
description: Squashes all git commits on main branch to a single "Initial commit" while preserving code integrity. Creates backup branch, verifies no code changes, and force pushes to clean history. Use when cleaning messy commit history, preparing repository for public release, or simplifying git history for contributors.
allowed-tools: Bash
---

# squashing-history

## Role

Git History Manager specializing in squashing all commits to a single "Initial commit" while preserving code integrity.

## Action

Squash all commits on the main branch down to a single "Initial commit", create a backup branch, verify no code changes occurred, and force push to clean history.

## Limitations

**Constraints:**
- Requires clean working directory
- Must verify code integrity before force push
- Backup branch must be created before any destructive operations
- Only operates on main branch

**Do NOT:**
- Skip backup branch creation
- Force push without verification
- Proceed if code differences are detected
- Skip user confirmation for force push

**Do ONLY:**
- Create backup before any changes
- Verify working directory is clean
- Confirm no code changes after squash
- Ask for user confirmation before force push

## Process

### Phase 1: Pre-flight Validation

```bash
# Check working directory is clean
git status

# Verify on main branch
git branch --show-current
```

**Requirements:**
- Clean working directory (no uncommitted changes)
- On main branch

**If fails:** Commit or stash changes first, or switch to main branch.

---

### Phase 2: Create Backup Branch

**Retry loop for timestamp collisions:**

```bash
# Retry backup branch creation up to 3 times for timestamp collisions
ITERATION=1
MAX_ITERATIONS=3

while [ $ITERATION -le $MAX_ITERATIONS ]; do
  echo "Backup branch creation attempt $ITERATION/$MAX_ITERATIONS"

  # Create backup branch with timestamp and store name
  BACKUP_BRANCH="backup-$(date +%Y%m%d-%H%M%S)"

  # Check if branch already exists (timestamp collision)
  if git rev-parse --verify "$BACKUP_BRANCH" >/dev/null 2>&1; then
    echo "⚠ Branch $BACKUP_BRANCH already exists (timestamp collision)"

    if [ $ITERATION -eq $MAX_ITERATIONS ]; then
      echo "✗ Failed to create unique backup branch after $MAX_ITERATIONS attempts"
      exit 1
    fi

    sleep 1  # Wait to get different timestamp
    ITERATION=$((ITERATION + 1))
    continue
  fi

  # Create the branch
  if git branch "$BACKUP_BRANCH"; then
    echo "✓ Backup branch created: $BACKUP_BRANCH"
    break
  fi

  echo "⚠ Branch creation failed (Iteration $ITERATION/$MAX_ITERATIONS)"

  if [ $ITERATION -eq $MAX_ITERATIONS ]; then
    echo "✗ Failed to create backup branch after $MAX_ITERATIONS attempts"
    exit 1
  fi

  sleep 1
  ITERATION=$((ITERATION + 1))
done

# Show all backup branches
git branch | grep backup-
```

**Validation:**
- Backup branch created successfully
- Current branch is still main
- Branch name is stored in `$BACKUP_BRANCH` variable

**Report:** Backup branch name: `$BACKUP_BRANCH`

---

### Phase 3: Get Current State

```bash
# Get current HEAD for verification
ORIGINAL_HEAD=$(git rev-parse HEAD)
echo "Original HEAD: $ORIGINAL_HEAD"

# Count total commits
ORIGINAL_COUNT=$(git rev-list --count HEAD)
echo "Total commits: $ORIGINAL_COUNT"

# Show recent commits
echo "Recent commits:"
git log --oneline -10
```

**Report:**
- Current HEAD hash
- Total commit count
- Recent commits (for reference)

---

### Phase 4: Squash to Initial Commit

```bash
# Get first commit hash
FIRST_COMMIT=$(git rev-list --max-parents=0 HEAD)
echo "First commit: $FIRST_COMMIT"

# Soft reset to first commit (keeps all changes staged)
git reset --soft "$FIRST_COMMIT"

# Check staged changes
git status
```

**Checkpoint:** All changes should be staged and ready to commit

---

### Phase 5: Create Single Commit

```bash
git commit -m "Initial commit"
```

**Validation:**
- Commit succeeds
- Only one commit in history

```bash
NEW_COUNT=$(git rev-list --count HEAD)
echo "New commit count: $NEW_COUNT"

if [ "$NEW_COUNT" -eq 1 ]; then
  echo "✓ Squash successful: $ORIGINAL_COUNT commits → 1 commit"
else
  echo "✗ Squash failed: expected 1 commit, got $NEW_COUNT"
  exit 1
fi
```

Expected output: `New commit count: 1`

---

### Phase 6: Verify Code Integrity

```bash
# Compare current code with backup branch
# Ignore submodules and generated documentation
git diff --ignore-submodules "$BACKUP_BRANCH"
```

**Critical Check:** Output must be empty (no source code differences)

**Note:** This check ignores:
- Submodule internal states (dirty states, uncommitted changes)
- Submodule pointer changes are still detected

If you need stricter checking (only specific paths):
```bash
# Alternative: Only check source code and critical config
git diff "$BACKUP_BRANCH" -- src/ bin/ test/ package.json pnpm-lock.yaml tsconfig.json
```

**If differences found:**
1. Review differences:
   ```bash
   git diff --ignore-submodules "$BACKUP_BRANCH" --stat
   git diff --ignore-submodules "$BACKUP_BRANCH"
   ```
2. If differences are NOT acceptable (actual code changes):
   ```bash
   echo "✗ Code differences detected! Aborting squash."
   git reset --hard "$BACKUP_BRANCH"
   echo "✓ Restored to backup branch: $BACKUP_BRANCH"
   exit 1
   ```
3. If differences are acceptable (metadata, timestamps in docs):
   - Document the differences
   - Proceed to Phase 7

---

### Phase 7: Review and Confirm

**Manually verify:**
1. Check commit count is 1: `git rev-list --count HEAD`
2. Check working directory is clean: `git status`
3. Confirm backup branch exists: `git branch | grep "$BACKUP_BRANCH"`
4. Review that code matches backup (Phase 6 verification passed)

**Ask user:** "Ready to force push to origin/main? This will rewrite history permanently."

**If user confirms:** Proceed to Phase 8
**If user declines:** Stop and provide rollback instructions:
```bash
# Rollback to backup
git reset --hard "$BACKUP_BRANCH"
echo "Rollback complete. You are back to original state."
```

---

### Phase 8: Force Push

**Retry loop for transient failures:**

```bash
# Retry force push up to 3 times for transient failures
ITERATION=1
MAX_ITERATIONS=3

while [ $ITERATION -le $MAX_ITERATIONS ]; do
  echo "Force push attempt $ITERATION/$MAX_ITERATIONS"

  if git push --force origin main; then
    echo "✓ Force push succeeded"
    break
  fi

  echo "⚠ Force push failed (Iteration $ITERATION/$MAX_ITERATIONS)"

  if [ $ITERATION -eq $MAX_ITERATIONS ]; then
    echo "✗ Force push failed after $MAX_ITERATIONS attempts"
    echo "Check remote permissions, URL, or branch protection rules"
    exit 1
  fi

  sleep 2  # Brief delay before retry
  ITERATION=$((ITERATION + 1))
done
```

**Validation:**
- Push succeeds without errors
- Remote main updated

```bash
# Verify remote was updated
git fetch origin
git log origin/main --oneline -1
```

---

### Phase 9: Complete

**Completion Signal:**

Output the completion promise to signal autonomous loop termination:

```xml
<promise>SQUASH_COMPLETE</promise>
```

**Summary:**
- Original commits: $ORIGINAL_COUNT
- Current commits: 1
- Backup branch: $BACKUP_BRANCH
- Code verified: ✓ No changes
- Force pushed: ✓ Success
- Total phases completed: 9/9

**Optional Cleanup:**

After verifying everything works, you can delete the backup branch:
```bash
# Local backup
git branch -D "$BACKUP_BRANCH"

# If pushed to remote
git push origin --delete "$BACKUP_BRANCH"
```

**Recommendation:** Keep backup branch for at least a few days to ensure no issues.

## Edge Cases

**Uncommitted changes:**
```bash
git status
```
If dirty:
- Commit changes: `git add -A && git commit -m "Your message"`
- OR stash: `git stash push -m "Before squash"`
- Then retry from Phase 1

**Not on main branch:**
```bash
git checkout main
# Then retry from Phase 1
```

**Code differences detected:**

If differences found in Phase 6 that are NOT acceptable:
```bash
# Reset to backup using stored variable
git reset --hard "$BACKUP_BRANCH"
echo "✓ Restored to backup: $BACKUP_BRANCH"

# If you lost the variable, find the branch:
git branch | grep backup-
# Then: git reset --hard <backup-branch-name>
```

**Force push fails:**

Common causes:
1. **No remote access:** Check remote URL: `git remote -v`
2. **Branch protection:** Check GitHub/GitLab branch protection rules
3. **No remote tracking:** Add with `git push --set-upstream origin main --force`

Recovery:
```bash
# You're still on local main with squashed commit
# Backup is safe on local branch
git reset --hard "$BACKUP_BRANCH"
```

**Already squashed:**
```bash
CURRENT_COUNT=$(git rev-list --count HEAD)
if [ "$CURRENT_COUNT" -eq 1 ]; then
  echo "Already squashed to 1 commit. Exiting."
  exit 0
fi
```

**Backup branch already exists:**
```bash
# Check before creating
if git rev-parse --verify "backup-$(date +%Y%m%d-%H%M%S)" >/dev/null 2>&1; then
  echo "⚠ Backup branch with this timestamp already exists"
  # Wait 1 second to get different timestamp
  sleep 1
  BACKUP_BRANCH="backup-$(date +%Y%m%d-%H%M%S)"
fi
```

## Success Criteria

- ✅ `<promise>SQUASH_COMPLETE</promise>` output
- ✅ Backup branch created and tracked in variable
- ✅ Commit count = 1
- ✅ Code matches backup (no source code differences)
- ✅ Force push succeeded
- ✅ Clean working directory
- ✅ User confirmed force push

## Variables Used

- `$BACKUP_BRANCH` - Name of backup branch (set in Phase 2, used in Phases 6-9)
- `$ORIGINAL_HEAD` - Original HEAD commit hash (Phase 3)
- `$ORIGINAL_COUNT` - Original commit count (Phase 3)
- `$FIRST_COMMIT` - First commit hash (Phase 4)

## Commands

- `git status` - Check working directory
- `git branch` - List branches
- `git reset --soft` - Squash commits (preserves changes)
- `git reset --hard` - Restore from backup (destructive)
- `git diff --ignore-submodules` - Verify no code changes
- `git push --force` - Update remote (destructive, requires confirmation)

## Context

This skill is useful for:
- Cleaning up messy commit history
- Starting fresh with single initial commit
- Preparing repository for public release
- Simplifying git history for new contributors
- Removing sensitive information from history (combined with removing files first)

**Warning:** Force push rewrites history permanently. Always create backup first.

**Trade-offs:**
- ✗ Loses commit history and timestamps
- ✗ Loses individual author attribution
- ✗ Loses granular change tracking
- ✓ Clean, simple history
- ✓ Easier for new contributors to understand
- ✓ Smaller .git directory (if combined with gc)
