---
name: squashing-history
description: Squashes all git commits on main branch to a single "Initial commit" while preserving code integrity. Creates backup branch, verifies no code changes, and force pushes to clean history. Use when cleaning messy commit history, preparing repository for public release, or simplifying git history for contributors.
user-invocable: true
disable-model-invocation: false
allowed-tools: Task
---

# squashing-history

## Role

Git History Manager that spawns an autonomous agent specializing in squashing all commits to a single "Initial commit" while preserving code integrity.

## Action

When invoked, spawn a general-purpose agent using the Task tool to handle the complete git history squashing workflow autonomously.

## Instructions

```javascript
Task({
  subagent_type: "general-purpose",
  description: "Squash git history to single commit",
  prompt: `Squash all commits on main branch to single "Initial commit", create backup, verify code integrity, force push.

## Constraints
- Clean working directory required
- Backup branch created before any destructive ops
- Code integrity verified before force push
- User confirmation required

## Process

### 1. Pre-flight Validation
\`\`\`bash
git status  # Must be clean
git branch --show-current  # Must be main
\`\`\`

### 2. Create Backup Branch
\`\`\`bash
BACKUP_BRANCH="backup-$(date +%Y%m%d-%H%M%S)"
for i in 1 2 3; do
  if git rev-parse --verify "$BACKUP_BRANCH" >/dev/null 2>&1; then
    sleep 1
    BACKUP_BRANCH="backup-$(date +%Y%m%d-%H%M%S)"
    continue
  fi
  git branch "$BACKUP_BRANCH" && break
  if [ $i -eq 3 ]; then exit 1; fi
done
\`\`\`

### 3. Get Current State
\`\`\`bash
ORIGINAL_HEAD=$(git rev-parse HEAD)
ORIGINAL_COUNT=$(git rev-list --count HEAD)
git log --oneline -10
\`\`\`

### 4. Squash to Initial Commit
\`\`\`bash
FIRST_COMMIT=$(git rev-list --max-parents=0 HEAD)
git reset --soft "$FIRST_COMMIT"
git status  # All changes staged
\`\`\`

### 5. Create Single Commit
\`\`\`bash
git commit -m "Initial commit"
NEW_COUNT=$(git rev-list --count HEAD)
if [ "$NEW_COUNT" -ne 1 ]; then
  echo "Squash failed"
  exit 1
fi
\`\`\`

### 6. Verify Code Integrity
\`\`\`bash
git diff --ignore-submodules "$BACKUP_BRANCH"
# Output must be empty
\`\`\`

### 7. Confirm with User
Ask: "Ready to force push to origin/main? This rewrites history permanently."

If declined:
\`\`\`bash
git reset --hard "$BACKUP_BRANCH"
\`\`\`

### 8. Force Push
\`\`\`bash
for i in 1 2 3; do
  if git push --force origin main; then
    break
  fi
  if [ $i -eq 3 ]; then
    echo "Force push failed"
    exit 1
  fi
  sleep 2
done
\`\`\`

### 9. Summary
- Original commits: $ORIGINAL_COUNT → 1
- Backup: $BACKUP_BRANCH
- Code verified: ✓ No changes
- Force pushed: ✓ Success

## Edge Cases
**Uncommitted changes:** \`git add -A && git commit\` or \`git stash\`
**Not on main:** \`git checkout main\`
**Code differences:** \`git reset --hard "$BACKUP_BRANCH"\`
**Already squashed:** Exit if commit count = 1`
})
```

## Success Criteria

- ✅ Backup branch created
- ✅ Commit count = 1
- ✅ Code matches backup
- ✅ Force push succeeded
- ✅ User confirmed
