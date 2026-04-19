---
name: updating
description: Coordinates all dependency updates (npm packages and upstream submodules) in correct dependency order. Use when preparing for release, running periodic maintenance, or syncing all upstreams.
user-invocable: true
allowed-tools: Task, Skill, Bash, Read, Grep, Glob, Edit
---

# updating

Update all dependencies in socket-btm: npm packages via `pnpm run update`, then upstream submodules to latest stable versions using existing updating-* skills.

## Dependency Order

Updates run in this order (some have dependencies):

1. `pnpm run update` - npm packages
2. `updating-curl` - curl + mbedtls
3. `updating-cjson` - cJSON
4. `updating-libdeflate` - libdeflate
5. `updating-lzfse` - LZFSE
6. `updating-yoga` - Yoga layout
7. `updating-ink` - ink TUI (after yoga)
8. `updating-onnxruntime` - ONNX Runtime
9. `updating-node` - Node.js (before LIEF)
10. `updating-lief` - LIEF (reads version from Node.js deps, run after node)
11. `updating-fast-webstreams` - fast-webstreams vendor
12. `updating-checksums` - sync checksums (always last)

LIEF version is determined by `node/deps/LIEF/include/LIEF/version.h`. Update Node.js before LIEF.

## Process

### Phase 1: Validate

Check clean working directory, detect CI mode (`CI=true` or `GITHUB_ACTIONS`), verify submodules initialized.

### Phase 2: Gather Versions

Read current versions from `.gitmodules` comments or submodule tags.

### Phase 3: Fetch Latest

For each submodule, fetch tags and identify latest stable (exclude -rc/-alpha/-beta).

### Phase 4: Update npm

```bash
pnpm run update
```

Commit if lockfile changed.

### Phase 5: Update Upstreams

Invoke each updating-* skill in the order above. Wait for each to complete before proceeding. If a skill reports "already up to date", move on.

### Phase 6: Validate xport Manifest

socket-btm's xport manifest tracks 17 upstream submodule pins via
`version-pin` rows (curl, mbedtls, cjson, libdeflate, yoga, ink,
opentui, onnxruntime, lief, node, postgres, wpt-streams, zstd,
iocraft, liburing, usockets, uwebsockets). Every sub-skill that
bumped a submodule in Phase 5 should have moved its row's pinned
SHA forward; validate the manifest before running the full test
suite so any missed bump or drifted row surfaces here.

```bash
pnpm run xport
XPORT_EXIT=$?

case $XPORT_EXIT in
  0) echo "✓ xport clean — all 17 version-pins match submodule HEADs" ;;
  1) echo "✗ xport schema/structural error — stopping"; exit 1 ;;
  2) echo "⚠ xport drift — advisory (upstream advanced since pin); proceeding" ;;
esac
```

Exit-code semantics:
- **0** — clean; proceed.
- **1** — schema/structural error (missing file, unreachable baseline).
  Stop and investigate; do not auto-retry.
- **2** — drift. Expected after routine submodule bumps; the harness
  reports how far upstream has moved since the pin. Not a blocker.

### Phase 7: Final Validation (skip in CI)

```bash
pnpm run fix --all
pnpm run check --all
pnpm test
```

### Phase 8: Report

Generate summary table of all updates (old version, new version, status), include the xport summary line (`total=17 ok=N drift=M error=0`), and list commits created.
