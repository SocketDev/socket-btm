Squash all commits on main branch to single "Initial commit" using the squashing-history skill.

## What it does

1. Creates timestamped backup branch
2. Soft resets to first commit
3. Creates single "Initial commit" with all code
4. Verifies code integrity (zero differences)
5. Gets user confirmation
6. Force pushes to origin

## Safety

- Backup branch created before any destructive operations
- Code verified byte-for-byte identical before force push
- Explicit user confirmation required
- Rollback possible via backup branch

## Usage

```bash
/squash-history
```

## Rollback (if needed)

```bash
git reset --hard backup-YYYYMMDD-HHMMSS
git push --force origin main
```
