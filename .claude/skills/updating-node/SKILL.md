---
name: updating-node
description: Updates Node.js submodule to latest stable tag, syncs .node-version, regenerates patches via autonomous agent, bumps node-smol cache. Use for new Node.js releases, security patches, or API updates.
user-invocable: true
allowed-tools: Task, Bash, Read, Edit, Skill
---

# updating-node

Spawn an autonomous agent that updates Node.js submodule to latest stable, syncs `.node-version`, regenerates patches, and validates everything.

- **Submodule**: `packages/node-smol-builder/upstream/node` (nodejs/node)
- **Tag format**: `vX.Y.Z` (stable only, exclude rc/alpha/beta)
- **Cache bumps**: `node-smol`
- **Creates**: Two commits (version update + patch regeneration)

## Process

### Phase 1: Validate

Clean working directory, verify submodule exists, read current `.node-version`.

### Phase 2: Spawn Agent

Spawn a Task agent with the full workflow from `reference.md`. The agent:

1. Fetches tags, identifies latest stable
2. Updates submodule to new tag
3. Updates `.node-version` to match
4. Bumps `node-smol` cache version
5. Commits version update
6. Invokes `regenerating-patches` skill to regenerate all patches
7. Validates build and tests (skip in CI)
8. Creates patch regeneration commit

See `reference.md` for the complete agent prompt template.

### Phase 3: Post-Update Skills (skip in CI)

In interactive mode, trigger:
1. `updating-binsuite` - rebuilds stubs and binsuite tools
2. `updating-fast-webstreams` - syncs vendor
3. `updating-lief` - syncs LIEF to match Node.js deps version
4. `updating-zstd` - syncs zstd to match Node.js deps version

### Phase 4: Report

Version change, commits created, patch status, post-update results.
