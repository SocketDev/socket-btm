---
name: regenerating-patches
description: Regenerate Node patches after version or patch-chain drift.
user-invocable: true
allowed-tools: Agent, Read, Edit, Write, Glob, Grep, Bash(git:*), Bash(patch:*), Bash(diff:*), Bash(cp:*), Bash(rm:*), Bash(mkdir:*), Bash(ls:*), Bash(cat:*), Bash(head:*), Bash(tail:*), Bash(wc:*), Bash(awk:*), Bash(grep:*), Bash(sed:*), Bash(find:*), AskUserQuestion
---

# regenerating-patches

Regenerate Node.js patches against the current pristine upstream tag so every patch applies cleanly in numeric order. This is the canonical recovery flow when an upstream version bump shifts line numbers under our patches.

## Scope

- **node** — `packages/node-smol-builder/patches/source-patched/*.patch` against `packages/node-smol-builder/upstream/node`

## Phase 1 — validate environment

```bash
cd "$CLAUDE_PROJECT_DIR" 2>/dev/null || cd "$(git rev-parse --show-toplevel)"
git status --short
```

For each in-scope target:

1. Confirm submodule is initialized: `[ -d "$UPSTREAM_DIR/.git" ]` (file-or-dir).
2. Resolve the pristine version from the submodule's HEAD tag — do not hardcode:
   ```bash
   cd "$UPSTREAM_DIR"
   VERSION=$(git describe --tags --exact-match 2>/dev/null || git rev-parse --short HEAD)
   ```
   For node, this should match the value in repo-root `.node-version` (with a leading `v`).
3. Reset to pristine: `git checkout -- . && git clean -fd` (inside the submodule).
4. List the patch files and capture which ones currently fail. The fast pre-flight:
   ```bash
   for p in $PATCH_DIR/*.patch; do
     tail -n +4 "$p" > /tmp/test.patch
     git apply --check /tmp/test.patch >/dev/null 2>&1 || echo "FAIL $(basename $p)"
   done
   ```
   The 4-line skip is the `# @…-versions:` / `# @description:` / blank-`#` / blank-`#` header that lives above the unified diff (see Patch Format below). All passing patches keep their existing content; only the FAIL list gets regenerated.

If any pre-flight step errors, surface the diagnostic to the user and stop.

## Phase 2 — spawn the regen Agent

Dispatch one **Agent** call with `subagent_type: general-purpose`. The full task — read each failing patch, re-anchor against pristine upstream, write the regenerated patch back to its original path — is delegated to the agent. The skill's role is to construct the prompt and validate the output; it does not edit patches itself.

The Agent call MUST include in its prompt:

- `UPSTREAM_DIR` (absolute) and `PATCH_DIR` (absolute)
- The resolved `VERSION` string (e.g. `v26.1.0`)
- The complete list of failing patches from Phase 1 (basename + the failing target line from `git apply --check`)
- The list of passing patches in numeric order — those must be applied before the regen target so each regen sees the cumulative state of all earlier patches (some patches anchor inside regions added by earlier patches, e.g. `023-smol-power-binding.patch` modifies a block that `018-smol-builtin-bindings.patch` introduces)
- A pointer to `reference.md` for edge cases (timestamp collisions, target-file-not-found, header normalization, common failure modes)

The agent's per-patch loop:

1. **Reset** the submodule to pristine: `git checkout -- . && git clean -fd`
2. **Replay** every passing patch in numeric order whose number is below the current target. Use the patch tool with the `tail -n +4` strip:
   ```bash
   tail -n +4 "$EARLIER_PATCH" | patch -p1 --silent
   ```
3. **Read** the current (broken) target patch to extract: original header (`# @node-versions: …` and `# @description: …` lines), all `+`/`−` content lines, and the file path(s) it modifies.
4. **Apply intent manually**: copy the modified file from the cumulative-patched tree to `/tmp/patch-rebuild/b/<file>`, copy a parallel pristine-cumulative version to `/tmp/patch-rebuild/a/<file>`, and use the **Edit** tool to add/remove the same lines the original patch did. The Edit tool's exact-match semantics force the agent to preserve indentation and surrounding context byte-for-byte.
5. **Generate** the new patch:
   ```bash
   diff -ruN /tmp/patch-rebuild/a/ /tmp/patch-rebuild/b/ \
     | sed -E 's@^(--- |\+\+\+ )/tmp/patch-rebuild/[ab]/@\1a/@; t; s@^(--- |\+\+\+ )/tmp/patch-rebuild/[ab]/@\1b/@'
   ```
   That second `sed` is wrong — use this canonical form instead:
   ```bash
   diff -ruN /tmp/patch-rebuild/a/ /tmp/patch-rebuild/b/ \
     | sed -E 's@/tmp/patch-rebuild/a/@a/@; s@/tmp/patch-rebuild/b/@b/@' \
     | grep -v '^[-+]\{3\}.*\t'   # strip timestamps
   ```
6. **Prepend** the original header verbatim (4 lines: `# @node-versions: …`, `# @description: …`, optional `# detail` lines each followed by a `#` separator — see Patch Format below).
7. **Validate**: `tail -n +4 NEW_PATCH | git apply --check` (against the cumulative-patched tree). Must exit 0.
8. **Write** the regenerated patch back to `$PATCH_DIR/<original-name>.patch`, overwriting.
9. **Reset** the submodule again before the next iteration.

After all failing patches are regenerated, run a final pristine→all-patches replay to confirm every patch in the directory still applies in numeric order. End with the submodule at pristine HEAD (not committed).

## Phase 3 — report

The skill (not the agent) should print:

- `version`: the pristine tag/SHA
- `regenerated`: list of patch basenames the agent rewrote
- `unchanged`: count of patches that already applied
- `unrecoverable`: any patches the agent couldn't fix automatically + the diagnostic

The skill does not commit. The user reviews the diff and commits manually.

## Patch format

Patches use a 4-line metadata header above the unified diff:

```
# @node-versions: v26.1.0
# @description: One-line summary
#
# Optional multi-line detail. Each non-blank line begins with #.
#
--- a/<target-file>
+++ b/<target-file>
@@ -<line>,<n> +<line>,<n> @@
 context
-old
+new
 context
```

For iocraft patches: replace `# @node-versions:` with `# @iocraft-versions:`. Never put timestamps on the `---`/`+++` lines (`diff -ruN` adds them; the post-process `sed` strips them).

The validator `git apply --check` rejects timestamps and demands matching context — those are the two most common regen failures. See `reference.md` § Common Failure Modes for the full list.

## Constraints

- **Don't modify upstream/node tree state at the end.** The submodule must be at pristine HEAD when the skill returns; uncommitted modifications would mask drift on the next run.
- **Don't commit or push.** The user reviews the regenerated patches before committing.
- **Don't create `.backup-*` files.** Earlier versions of this skill did; they pollute the patch directory and confuse `find $PATCH_DIR -name '*.patch'`. If a working tree already has them, leave them — but generate new patches only.
- **Use `diff -ruN`** for the regen, never `git diff` or `git format-patch`. Both inject git-specific markers (`index <hash>`, `new file mode`) that the build pipeline's `patch -p1` doesn't expect.
- **Strip timestamps** before validating: `grep -v $'^[-+]\{3\}.*\t'` (or equivalent).
- **Run the agent once.** Spawning per-patch agents loses cumulative state and is much slower than one agent processing the list serially.
- **Explanatory comments belong in the header, not inline in hunks.** Add `# …` lines between `# @description:` and the first `--- a/`; never add `# …` or `// …` lines inside hunk bodies just to explain the change. Inline comments inflate the diff against upstream, force hunk-count bumps when edited, and survive into the patched source as noise. See `docs/references/btm-source-patches.md` § Comments: header, not inline.

See `reference.md` for: edge cases, rollback procedures, retry logic, header normalization details, common failure modes, and cross-platform considerations (BSD vs GNU `diff`/`sed`).
