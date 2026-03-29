---
name: updating-binsuite
description: Orchestrates LIEF and stubs updates in correct dependency order (LIEF first, then stubs). Use after Node.js updates, before releases, or when binary tools need refresh.
user-invocable: true
allowed-tools: Skill, Bash, Read
---

# updating-binsuite

Orchestrate updating the binary manipulation suite by triggering updating-lief and updating-stubs in order.

## Dependency Chain

```
updating-binsuite
  ├─ updating-lief (reads LIEF version from Node.js deps)
  └─ updating-stubs (triggers curl update internally)
```

## Process

1. **Validate**: Clean working directory
2. **Update LIEF**: `Skill({ skill: "updating-lief" })` - runs first, gets version from node/deps/LIEF. If it fails, abort.
3. **Update Stubs**: `Skill({ skill: "updating-stubs" })` - runs second, triggers curl internally
4. **Report**: Summary of both updates, cache versions bumped, commits created

CI mode passes through to sub-skills (they detect `CI=true` and skip builds).
