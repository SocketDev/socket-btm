---
name: squashing-history
description: Squashes all git commits on main branch to a single "Initial commit" while preserving code integrity. Creates backup branch, verifies no code changes, and force pushes to clean history. Use when cleaning messy commit history, preparing repository for public release, or simplifying git history for contributors.
allowed-tools: Bash
---

# squashing-history

<task>
Your task is to squash all commits on the main branch down to a single "Initial commit" while preserving code integrity. You must create a backup branch, verify no code changes occurred during the squash, get user confirmation, and force push to clean history.
</task>

<context>
**What is Git History Squashing?**
Git history squashing combines multiple commits into one. This operation uses `git reset --soft` to keep all code changes staged while resetting commit history to the first commit, then creates a single new "Initial commit".

**Why Squash History?**
- Clean up messy commit history (experimental commits, WIP commits, etc.)
- Prepare repository for public release (fresh start)
- Simplify history for new contributors
- Remove sensitive information from history (after removing files)

**Critical Safety Measures:**
1. **Backup**: Always create backup branch before any changes
2. **Verification**: Compare code with backup - must be byte-for-byte identical
3. **User Confirmation**: Force push is destructive - requires explicit user consent
4. **Rollback Ready**: Backup branch allows instant recovery if needed

**Trade-offs:**
- ✗ Loses commit history and timestamps
- ✗ Loses individual author attribution
- ✗ Loses granular change tracking
- ✓ Clean, simple history (one commit)
- ✓ Easier for new contributors to understand
- ✓ Smaller .git directory (if combined with gc)
</context>

<constraints>
**CRITICAL Safety Requirements:**
- Working directory MUST be clean (no uncommitted changes)
- Backup branch MUST be created before ANY destructive operations
- Code verification MUST show zero differences
- User confirmation MUST be obtained before force push
- Only operates on main branch (no other branches)

**Do NOT:**
- Skip backup branch creation (NEVER - this is your recovery path)
- Force push without user confirmation (NEVER - it's permanent)
- Proceed if git diff shows ANY code differences (NEVER - data integrity violated)
- Skip working directory verification (NEVER - uncommitted changes would be lost)

**Do ONLY:**
- Create backup branch with timestamp (e.g., backup-20260206-120000)
- Use git reset --soft (preserves code, resets commits)
- Verify code integrity with git diff (must be empty output)
- Ask user explicit yes/no before force push
- Store backup branch name in variable for rollback instructions
</constraints>

<instructions>

## Process

**SAFETY FIRST**: This is a DESTRUCTIVE operation. Follow each phase exactly as written. Do not skip validation steps.

### Phase 1: Pre-flight Validation

<prerequisites>
CRITICAL: Verify safe starting conditions before ANY changes:
</prerequisites>

```bash
# Check working directory is clean
git status

# Verify on main branch
git branch --show-current
```

<validation>
**Required State:**
- ✓ Working directory clean (git status shows "nothing to commit, working tree clean")
- ✓ On main branch (git branch --show-current outputs "main")

**If working directory NOT clean:**
- User must commit changes: `git add -A && git commit -m "..."`
- OR stash changes: `git stash push -m "Pre-squash backup"`
- OR discard changes (if safe): `git reset --hard HEAD`

**If NOT on main branch:**
- Switch to main: `git checkout main`
- Then re-run Phase 1 validation

**Do NOT proceed to Phase 2 unless both checks pass.**
</validation>

---

### Phase 2: Create Backup Branch

<action>
CRITICAL: Create backup branch BEFORE any destructive operations:
</action>

```bash
# Create backup branch with timestamp
BACKUP_BRANCH="backup-$(date +%Y%m%d-%H%M%S)"
git branch "$BACKUP_BRANCH"
```

See `reference.md` for retry loop handling timestamp collisions (if branch already exists).

<validation>
Verify backup creation succeeded:
```bash
# Verify branch exists
git branch | grep "$BACKUP_BRANCH"

# Verify still on main
git branch --show-current

# Verify backup points to current HEAD
git rev-parse main
git rev-parse "$BACKUP_BRANCH"
```

Both SHAs must match - backup and main point to same commit.

**Report to user:**
`Backup branch created: $BACKUP_BRANCH`
`This branch allows instant rollback if needed: git reset --hard $BACKUP_BRANCH`
</validation>

---

### Phase 3: Get Current State

<action>
Capture baseline metrics for verification and reporting:
</action>

```bash
# Get current HEAD for verification
ORIGINAL_HEAD=$(git rev-parse HEAD)
echo "Original HEAD: $ORIGINAL_HEAD"

# Count total commits
ORIGINAL_COUNT=$(git rev-list --count HEAD)
echo "Total commits: $ORIGINAL_COUNT"

# Show recent commits (for user context)
echo "Recent commits:"
git log --oneline -10
```

<validation>
**Report to user:**
- Current HEAD: $ORIGINAL_HEAD (first 7 chars: ${ORIGINAL_HEAD:0:7})
- Total commits to be squashed: $ORIGINAL_COUNT
- Recent history (10 most recent commits shown above)

These metrics will be compared after squashing to verify the operation.
</validation>

---

### Phase 4: Squash to Initial Commit

<action>
DESTRUCTIVE: Perform the actual squash operation:
</action>

```bash
# Get first commit hash (root of git history)
FIRST_COMMIT=$(git rev-list --max-parents=0 HEAD)
echo "First commit: $FIRST_COMMIT"

# Soft reset to first commit
# This keeps ALL code changes staged, but resets commit history
git reset --soft "$FIRST_COMMIT"

# Check staged changes (should show everything staged)
git status
```

<validation>
**Expected Output:**
```
Changes to be committed:
  (use "git restore --staged <file>..." to unstage)
        modified: [many files]
        new file: [many files]
```

All code changes should be staged. If git status shows "nothing to commit", something went wrong - rollback immediately.
</validation>

---

### Phase 5: Create Single Commit

<action>
Create the single "Initial commit" with all code:
</action>

```bash
git commit -m "Initial commit"
```

<validation>
Verify squash succeeded - must have exactly 1 commit:

```bash
NEW_COUNT=$(git rev-list --count HEAD)
echo "New commit count: $NEW_COUNT"

if [ "$NEW_COUNT" -eq 1 ]; then
  echo "✓ Squash successful: $ORIGINAL_COUNT commits → 1 commit"
else
  echo "✗ Squash failed: expected 1 commit, got $NEW_COUNT"
  echo "Rollback: git reset --hard $BACKUP_BRANCH"
  exit 1
fi
```

**Expected Output:**
`✓ Squash successful: <N> commits → 1 commit`

If validation fails, rollback immediately - do not proceed to Phase 6.
</validation>

---

### Phase 6: Verify Code Integrity

<action>
CRITICAL: Verify no code was lost or changed during squashing:
</action>

```bash
# Compare current code with backup branch
# Ignore submodules (they're handled separately)
git diff --ignore-submodules "$BACKUP_BRANCH"
```

<validation>
**CRITICAL CHECK:** Output MUST be completely empty.

**If output is empty:**
✓ Code integrity verified - zero differences
✓ Safe to proceed to Phase 7

**If ANY differences appear:**
✗ CODE INTEGRITY VIOLATED - DO NOT PROCEED
✗ Rollback immediately: `git reset --hard $BACKUP_BRANCH`
✗ Report differences to user and investigate root cause

See `reference.md` for detailed rollback and recovery procedures.

This is your last safety check before the irreversible force push.
</validation>

---

### Phase 7: Review and Confirm

<action>
Perform final review and get explicit user confirmation:
</action>

**Pre-Push Verification Checklist:**

```bash
# 1. Verify commit count is 1
git rev-list --count HEAD

# 2. Verify working directory is clean
git status

# 3. Verify backup branch exists
git branch | grep "$BACKUP_BRANCH"

# 4. Show the single commit
git log --oneline -1
```

<validation>
**Expected Results:**
- Commit count: 1 ✓
- Working tree: clean ✓
- Backup branch: exists ✓
- Code verification: passed (Phase 6) ✓

**Report summary to user:**
```
Squash Ready for Force Push
============================
Original commits: $ORIGINAL_COUNT
New commits: 1
Backup branch: $BACKUP_BRANCH (allows instant rollback)
Code integrity: ✓ Verified (zero differences)
Working directory: ✓ Clean

This operation will:
- Permanently rewrite history on origin/main
- Replace $ORIGINAL_COUNT commits with 1 commit
- Be reversible only via backup branch restore

Backup restore command (if needed):
  git reset --hard $BACKUP_BRANCH
  git push --force origin main
```

**USER CONFIRMATION REQUIRED:**
Use AskUserQuestion tool with:
- Question: "Ready to force push squashed history to origin/main? This rewrites history permanently and affects all collaborators."
- Options:
  - "Yes, force push" (proceed to Phase 8)
  - "No, rollback" (execute rollback from reference.md)

**If user confirms:** Proceed to Phase 8
**If user declines:** Rollback to backup and stop
</validation>

---

### Phase 8: Force Push

<action>
IRREVERSIBLE: Force push to rewrite remote history:
</action>

```bash
git push --force origin main
```

See `reference.md` for retry loop handling transient network failures (up to 3 attempts).

<validation>
Verify force push succeeded:

```bash
# Fetch to get updated remote refs
git fetch origin

# Verify remote main was updated
git log origin/main --oneline -1

# Verify local and remote match
LOCAL_SHA=$(git rev-parse main)
REMOTE_SHA=$(git rev-parse origin/main)

if [ "$LOCAL_SHA" = "$REMOTE_SHA" ]; then
  echo "✓ Force push successful - remote updated"
else
  echo "✗ Force push may have failed - SHAs don't match"
  echo "  Local:  $LOCAL_SHA"
  echo "  Remote: $REMOTE_SHA"
  exit 1
fi
```

**Expected Output:**
`✓ Force push successful - remote updated`
</validation>

---

### Phase 9: Complete

<completion_signal>
```xml
<promise>SQUASH_COMPLETE</promise>
```
</completion_signal>

<summary>
Report these final results to the user:

**Squash Operation Complete**
============================
✓ Original commits: $ORIGINAL_COUNT
✓ Current commits: 1
✓ Backup branch: $BACKUP_BRANCH
✓ Code verified: Zero differences
✓ Force pushed: Success
✓ Total phases completed: 9/9

**Backup Information:**
Your backup branch ($BACKUP_BRANCH) contains the complete original history.

To restore backup (if needed):
```bash
git reset --hard $BACKUP_BRANCH
git push --force origin main
```

**Optional Cleanup:**
After verifying everything works (wait a few days), you can delete the backup:
```bash
# Local backup
git branch -D "$BACKUP_BRANCH"

# If pushed to remote (optional)
git push origin --delete "$BACKUP_BRANCH"
```

**Recommendation:** Keep backup branch for at least 1-2 weeks to ensure no issues arise.

**Collaborators Note:**
All collaborators need to re-sync their local branches:
```bash
git fetch origin
git reset --hard origin/main
```
</summary>

</instructions>

## Success Criteria

- ✅ `<promise>SQUASH_COMPLETE</promise>` output
- ✅ Backup branch created and tracked in variable
- ✅ Commit count = 1
- ✅ Code matches backup (no source code differences)
- ✅ Force push succeeded
- ✅ Clean working directory
- ✅ User confirmed force push

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

For detailed retry loops, edge cases, rollback procedures, and variable documentation, see `reference.md`.
