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

## Comments: header, not inline

Rationale and extended explanation belong in the **patch header** — the
block between `# @description:` and the first `---` / `+++` line — never
inline inside a hunk. Comments inside hunk bodies:

- Inflate the diff against upstream and obscure the actual code change.
- Force a hunk-count bump every time the comment is edited.
- Survive into the patched source tree as `#` / `//` lines that don't
  belong upstream.

The header is free-form `# …` lines; add as many as the change warrants.
Inside the diff, prefer self-documenting code and let the patch header
carry the why.

```diff
# @node-versions: v26.2.0
# @description: Wire smol sources + libqrencode autoconf macros
#
# libqrencode v4.1.1 (vendored under deps/qrcode/upstream/libqrencode):
# autoconf/cmake normally define STATIC_IN_RELEASE + MAJOR/MINOR/MICRO_VERSION
# from configure.ac. Inside Node's gyp build neither toolchain runs, so the
# 'defines' block below pins them. Keep the integers in sync with the
# smol-qrcode binding's libqrencode version comment if the upstream pin
# changes.
#
--- a/node.gyp
+++ b/node.gyp
@@ -1055,14 +1079,335 @@
           'defines': [
             'LIBUS_USE_LIBUV',
+            'STATIC_IN_RELEASE=static',
+            'MAJOR_VERSION=4',
+            'MINOR_VERSION=1',
+            'MICRO_VERSION=1',
           ],
```

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
