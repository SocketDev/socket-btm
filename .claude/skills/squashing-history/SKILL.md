---
name: squashing-history
description: Squashes all commits on main to a single "Initial commit" with backup branch, integrity verification, and user confirmation before force push. Use when cleaning history or preparing for fresh start.
user-invocable: true
allowed-tools: AskUserQuestion, Bash(git:*), Bash(diff:*), Bash(rm:*), Bash(ls:*)---

# squashing-history

Squash all commits on main branch to a single "Initial commit" while preserving code integrity.

## Process

### Phase 1: Pre-flight

Verify working directory is clean and on main branch. Do not proceed otherwise.

```bash
git status
git branch --show-current
```

### Phase 2: Create Backup

```bash
BACKUP_BRANCH="backup-$(date +%Y%m%d-%H%M%S)"
git branch "$BACKUP_BRANCH"
```

Verify backup branch exists and points to current HEAD.

### Phase 3: Capture Baseline

Record original HEAD SHA and commit count for reporting.

### Phase 4: Squash

```bash
FIRST_COMMIT=$(git rev-list --max-parents=0 HEAD)
git reset --soft "$FIRST_COMMIT"
git commit -m "Initial commit"
```

Verify commit count is exactly 1.

### Phase 5: Verify Integrity

```bash
git diff --ignore-submodules "$BACKUP_BRANCH"
```

Output must be completely empty. If any differences appear, rollback immediately with `git reset --hard $BACKUP_BRANCH`.

### Phase 6: Confirm with User

Show summary (original count, backup branch name, integrity status) and ask for explicit confirmation via AskUserQuestion before force push.

### Phase 7: Force Push

```bash
git push --force origin main
```

Verify local and remote SHAs match after push.

### Phase 8: Report

Report completion with backup branch name and rollback instructions.

See `reference.md` for retry loops and edge case handling.
