# node-smol-patch-format-guard

**Repo-local** PreToolUse hook (socket-btm only — `source-patched/` exists
nowhere else in the fleet, so this lives under `.claude/hooks/repo/`, not
`fleet/`, and is not cascaded).

Blocks an Edit/Write to
`packages/node-smol-builder/patches/source-patched/*.patch` that would write a
malformed patch — failing the rule at **edit time** instead of waiting for CI.
Defense-in-depth atop `test/patches/validate-patches.test.mts` (run via
`pnpm test:node-smol` on every PR).

## What it enforces

1. **Header** — the patch must carry both `# @node-versions:` and
   `# @description:` lines (the fleet patch-header format consumed by
   `apply-patches.mts`).
2. **No cross-patch reference** — the content must not name another patch by
   number (`patch 004` / `Patch 018`). Patches apply in any order (the suite
   enforces zero file-overlap), so a sibling-patch mention implies a false
   ordering dependency. Describe the wiring/file instead. Plural prose
   ("patches 004 + 021") is allowed.

## Behavior

- Reads the PreToolUse JSON payload from stdin.
- Exit `0` — pass (not a source-patched patch, or well-formed).
- Exit `2` — block (missing header line, or a cross-patch reference), with a
  stderr message listing each problem.
- Fails **open** (exit 0 + stderr log) on any hook bug — never bricks the
  session.

## Test

```bash
node --test test/*.test.mts
```
