# BTM source patches

Detailed format and rules for patches under `packages/*/patches/`.

## Locations

- **Node.js**: `packages/node-smol-builder/patches/source-patched/*.patch`
- **OpenTUI**: `packages/opentui-builder/patches/*.patch`
- **LIEF**: `packages/lief-builder/patches/lief/*.patch`

## Required format

Standard unified diff (`--- a/`, `+++ b/`), NEVER `git format-patch` output. Required headers on the first non-blank lines:

```diff
# @<project>-versions: vX.Y.Z     (or @opentui-versions / @lief-versions)
# @description: One-line summary
#
--- a/file
+++ b/file
```

The project tag must match the patch tree: `@node-versions` for Node.js patches, `@opentui-versions` for OpenTUI, `@lief-versions` for LIEF.

## Patch rules

**1 patch, 1 file. 1 file, 1 patch.** Bidirectional. Every source file in the patch series is owned by exactly one patch, and every patch modifies exactly one source file. No exceptions, no allowlist entries, no "intentional splits."

- Within a patch: only ONE source file is modified — no multi-file diffs.
- Across the series: each source file is touched by EXACTLY ONE patch. Fold multi-edit changes into the canonical patch for that file.
- Numbered series is contiguous. When a patch is folded into another and deleted, renumber the remainder to close the gap. No allowlist for historic gaps.
- For multi-file features that can't be split independently, use an ordered numeric-prefix series (`001-*.patch`, `002-*.patch`, ...) applied in filename order. Each patch still owns exactly ONE file; dependencies flow in ascending order only.
- Minimal touch, clean diffs, no style changes outside scope.

## Enforcement

`scripts/check-patch-format.mts` enforces: `one-file-per-patch`, `multiple-patches-per-file`, `numbered-series-gap`, header presence and form, unified-diff form, and hunk-count integrity (`@@ -A,B +C,D @@` matches actual body line counts).

## Generation workflow

- Regenerate / refold: use the `/regenerating-patches` skill.
- Manual: `diff -u a/file b/file`, add headers, validate with `patch --dry-run`.

## Related rules

- `.claude/rules/gitmodules-version-comments.md` — `.gitmodules` version-comment format.
