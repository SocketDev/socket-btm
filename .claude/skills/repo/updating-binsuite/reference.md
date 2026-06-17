# updating-binsuite Reference Documentation

This document provides edge cases and troubleshooting for the updating-binsuite skill.

## Dependency Chain

```
updating-binsuite
  ├─→ updating-lief
  │     └─ bumps: lief, binflate, binject, binpress
  └─→ updating-stubs
        └─→ updating-curl
              └─ bumps: curl
        └─ bumps: stubs, binpress
```

## LIEF Version Source

The LIEF version is NOT independently determined. It comes from:
- `packages/node-smol-builder/upstream/node/deps/LIEF/`
- Check Node.js's bundled LIEF version after updating Node.js
- updating-lief should use this version as target

## Cache Version Summary

After a full binsuite update, these cache versions should be bumped:

| Package | Bumped By |
|---------|-----------|
| lief | updating-lief |
| binflate | updating-lief |
| binject | updating-lief |
| binpress | updating-lief, updating-stubs |
| stubs | updating-stubs |
| curl | updating-curl |

Note: `binpress` may be bumped twice (once by each skill) - this is fine.

## Edge Cases

### LIEF Already Current

If LIEF is already at the target version:
- updating-lief will report "Already at target version"
- Proceed with stubs update anyway
- Stubs may still need curl updates

### Stubs Already Current

If stubs and curl are already current:
- updating-stubs will report "Already up to date"
- No changes needed
- Binsuite update successful

### Partial Failure

If LIEF succeeds but stubs fails:
- LIEF changes are committed
- Stubs changes not committed
- User needs to fix stubs issue and re-run updating-stubs
- Or rollback LIEF changes

## Rollback

Rollback depends on how many commits were created:

```bash
# Check commits from binsuite update
git log --oneline -10

# Rollback specific number of commits
git reset --hard HEAD~N  # where N is number of binsuite commits
```

## Triggering from updating-node

When updating-node triggers updating-binsuite:
1. Node.js submodule updated first
2. LIEF version determined from node/deps/LIEF
3. updating-binsuite runs with known LIEF target
