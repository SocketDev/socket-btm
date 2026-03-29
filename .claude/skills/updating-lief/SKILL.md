---
name: updating-lief
description: Updates LIEF submodule to match Node.js deps version, performs API compatibility audit across 20+ source files. Use after Node.js updates or when LIEF version drifts from Node.js deps.
user-invocable: true
allowed-tools: Task, Bash, Read, Edit, Grep, Glob
---

# updating-lief

Update the LIEF library submodule to match the version in Node.js deps, then audit all LIEF API usage for compatibility.

- **Submodule**: `packages/lief-builder/upstream/lief` (lief-project/LIEF)
- **Version source of truth**: `packages/node-smol-builder/upstream/node/deps/LIEF/include/LIEF/version.h`
- **Cache bumps**: `lief`, `binflate`, `binject`, `binpress`, `node-smol`

LIEF version is driven by Node.js deps. Update Node.js first (`updating-node`), then run this skill. Do not update LIEF independently.

## Process

### Phase 1: Validate

Clean working directory, verify LIEF submodule exists.

### Phase 2: Determine Version

Extract target from Node.js deps:

```bash
grep '#define LIEF_VERSION "' packages/node-smol-builder/upstream/node/deps/LIEF/include/LIEF/version.h
```

Parse base version (strip trailing `-`). Compare with current submodule tag. Exit if already matching.

If user specifies a version override, warn that it may mismatch Node.js deps.

### Phase 3: Spawn Agent

Spawn a Task agent with the full workflow from `reference.md`. The agent:

1. Updates submodule to target version
2. Updates `.gitmodules` version comment
3. Audits all C++ files using LIEF API for compatibility with new version
4. Fixes any API incompatibilities found
5. Bumps cache versions: lief, binflate, binject, binpress, node-smol
6. Validates build and tests (skip in CI)
7. Creates commits (version update + API fixes if needed)

See `reference.md` for the complete agent prompt template.

### Phase 4: Verify

Check agent output for completion, verify commits created, report results.
