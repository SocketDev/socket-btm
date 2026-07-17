---
name: updating-node
description: Update Node, patches, .node-version, and the node-smol cache.
user-invocable: true
allowed-tools: Task, Bash(pnpm:*), Bash(npm:*), Bash(git:*), Bash(node:*), Bash(rg:*), Bash(grep:*), Bash(find:*), Bash(ls:*), Bash(cat:*), Bash(head:*), Bash(tail:*), Bash(wc:*), Bash(diff:*), Read, Edit, Skill
---

# updating-node

Spawn an autonomous agent that updates Node.js submodule to latest stable, syncs `.node-version`, regenerates patches, and validates everything.

- **Submodule**: `packages/node-smol-builder/upstream/node` (nodejs/node)
- **Tag format**: `vX.Y.Z` (stable only, exclude rc/alpha/beta)
- **Cache bumps**: `node-smol` — see "When to bump node-smol cache" below
- **Creates**: Two commits (version update + patch regeneration)

## When to bump node-smol cache

The `node-smol` entry in `.github/cache-versions.json` keys Docker layer
caches and the GHA build cache. Bump it whenever a build input changes,
not only when Node itself bumps. Triggers:

- Node.js submodule SHA changes (new tag).
- `packages/node-smol-builder/docker/Dockerfile.*` changes (apt/apk
  packages, rustup install, base image bumps).
- `additions/source-patched/**/*` changes (new source-patched files).
- `patches/source-patched/**/*` changes (patch series adds/removes/edits).
- `scripts/binary-released/**/*.mts` changes that alter `configureFlags`,
  build env vars, or output paths (e.g. adding `--v8-enable-temporal-support`).
- `external-tools.json` changes that flow into the Dockerfile via
  `.build-context/registry-tools.json` (pnpm pin, rust pin, sfw pin).

If unsure: bumping is cheap (~30 min cold build), not bumping when you
should produces silent stale-cache hits that are very expensive to debug.

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

In interactive mode, dispatch in this dependency order — curl and
LIEF have no prereqs, so they parallelize; everything else is
sequential:

1. **curl + lief (parallel)** — both link only against the toolchain
   (Rust + Emscripten/native), no socket-btm artifacts upstream.
   Dispatch both, wait for both releases to land.
2. **stubs** — consumes curl + lief; produces platform stubs that
   binsuite + node-smol SEA-inject.
3. **binsuite** — consumes stubs (+ curl, lief).
4. **temporal-infra** — invokes `/updating-temporal-infra` to refresh
   the parity reference + audit the C++ port for drift. Short-
   circuits if `boa-dev/temporal` hasn't cut a new tag since the
   last run (no commit, cascade proceeds). When it DOES move, the
   C++ port catches up before node-smol consumes the changes via
   `additions/source-patched/`.
5. **node-smol** — consumes stubs + binsuite + curl + lief + the
   refreshed temporal C++ port; the final layer.

Adjacent vendor syncs (independent of the chain): `updating-fast-webstreams`,
`updating-zstd` — can run any time.

**Why the order matters:** node-smol embeds the stub-injected `curl`
binary plus the LIEF library AND consumes the temporal C++ port via
`additions/source-patched/`; dispatching node-smol before its
prerequisites cascade leaves it building against stale dependencies
and surfaces "fixed" issues in the wrong layer.

**Coupling is one-way:** `/updating-node` exercises
`/updating-temporal-infra` so every Node bump has a current parity
reference. A standalone `/updating-temporal-infra` run (boa-dev/temporal
cuts a tag while Node is current) does NOT drag in a Node rebuild.

### Phase 4: Report

Version change, commits created, patch status, post-update results.

### Phase 5: Validate via CI dispatch (`gh workflow run`)

Once the prerequisite skills above land their commits, validate the
full chain by dispatching `node-smol.yml`.

**🚨 Dispatch policy**

The `release-workflow-guard` hook risk-tiers each dispatch:

- **Verifiable dry-run** (`-f dry-run=true` + workflow declares the
  input) — always allowed.
- **GitHub-release-only workflow** (no `npm/pnpm/yarn publish` in
  the YAML; only `gh release create` / release action) — allowed
  live. node-smol, stubs, curl, LIEF, binsuite, etc. all qualify.
  Recovery for a bad release: `gh release delete <tag>
--cleanup-tag --yes`.
- **npm-publishing workflow** — always blocked. The user runs
  these themselves.
- **Force-prod override** (`-f publish=true` etc.) — always blocked
  even on a GH-only workflow, since the override may flip in an
  npm-publish branch.

**Pre-dispatch checklist (live releases only)**

🚨 Before dispatching a non-dry-run release build:

1. **Bump the cache version** in `.github/cache-versions.json`
   for the artifact you're releasing. Skipping this re-publishes
   from a stale cache — the new release is byte-identical to the
   old one.
2. **Check live release count.** Cap is **2 per artifact**: keep
   the current release plus one prior as a safety net. If a 3rd
   would land, delete the oldest first:
   ```bash
   gh release list --json tagName,createdAt --limit 50 \
     | jq -r '.[] | select(.tagName | startswith("stubs-")) | .tagName' \
     | tail -n +3 \
     | xargs -I {} gh release delete {} --cleanup-tag --yes
   ```
3. **Dispatch only after Phase 3 completes.** Skipping Phase 3
   means node-smol builds against stale stubs/curl/LIEF and the
   failures surface in the wrong layer.

**Dry-run policy** still applies for _validation_ dispatches —
when you just want to see whether the source tree compiles. Pass
`-f dry-run=true` and the hook lets it through.

**🚨 Monitor policy: stop on first failure**

When polling a node-smol run via `gh run view --json jobs`, the goal
is **not** "wait for all 8 platform jobs to finish" — it's "find the
first failure, stop, and fix." Each platform burns ~30–60 minutes of
runner time; letting 7 jobs finish after one already failed wastes
the runner pool and your wall clock.

```bash
RUN_ID=<dispatched-run>
while true; do
  json=$(gh run view "$RUN_ID" --repo SocketDev/socket-btm --json status,conclusion,jobs)
  status=$(echo "$json" | jq -r '.status')
  failed=$(echo "$json" | jq -r '.jobs[] | select(.conclusion == "failure") | .name' | head -1)
  if [ -n "$failed" ]; then
    echo "FAIL: $failed — cancelling run + diagnosing"
    gh run cancel "$RUN_ID" --repo SocketDev/socket-btm
    break
  fi
  [ "$status" = "completed" ] && break
  sleep 90
done
```

When a failure surfaces:

1. **Cancel the run immediately** — `gh run cancel <id>`. Don't let
   sibling jobs finish; their outcome is moot.
2. **Pull the actual compile error** — `gh api repos/.../actions/jobs/$JOB/logs | grep -E "error:|FAILED:"`.
3. **Fix forward in main** — patch the source / regenerate the
   affected patch, commit, push.
4. **Redispatch** the same workflow only after the fix lands.

**Why fail-fast matters here:** node-smol failures are usually
mechanical (an API rename, a header move, a patch hunk drift). The
first failing platform tells you the issue; the other 7 will hit the
same mechanical issue on the next stage anyway. Wait for them only if
you need cross-platform divergence data, which is rare.
