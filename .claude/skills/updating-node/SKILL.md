---
name: updating-node
description: Updates Node.js submodule to latest stable tag, syncs .node-version, regenerates patches via autonomous agent, bumps node-smol cache. Use for new Node.js releases, security patches, or API updates.
user-invocable: true
allowed-tools: Task, Bash(pnpm:*), Bash(npm:*), Bash(git:*), Bash(node:*), Bash(rg:*), Bash(grep:*), Bash(find:*), Bash(ls:*), Bash(cat:*), Bash(head:*), Bash(tail:*), Bash(wc:*), Bash(diff:*), Read, Edit, Skill---

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

In interactive mode, trigger in this order — each layer depends on
the binaries the layer above produces:

1. `updating-stubs` — rebuilds platform stubs (foundation; `binsuite`,
   `lief`, `node-smol` all SEA-inject these)
2. `updating-curl` — links against the new stubs; produces `curl`
   binary used by downstream LIEF/binsuite/node-smol bootstraps
3. `updating-binsuite` — rebuilds binsuite tools (depend on stubs +
   curl)
4. `updating-fast-webstreams` — syncs vendor (independent)
5. `updating-lief` — syncs LIEF to match Node.js deps version (depends
   on stubs)
6. `updating-zstd` — syncs zstd to match Node.js deps version
7. `updating-node` validate — only after the above land, dispatch a
   `node-smol` dry-run build (see Phase 5)

**Why the order matters:** node-smol embeds the stub-injected `curl`
binary plus the LIEF library; dispatching node-smol before its
prerequisites cascade leaves it building against stale dependencies
and surfaces "fixed" issues in the wrong layer.

### Phase 4: Report

Version change, commits created, patch status, post-update results.

### Phase 5: Validate via CI dispatch (`gh workflow run`)

Once the prerequisite skills above land their commits, validate the
full chain by dispatching `node-smol.yml` as a verifiable dry-run.

**🚨 Dispatch policy**

- **Always pass `-f dry-run=true`.** Never dispatch a non-dry-run
  build from this skill — production builds are user-driven.
- **Dispatch only after Phase 3 completes.** Skipping Phase 3 means
  node-smol builds against stale stubs/curl/LIEF and the failures
  surface in the wrong layer.

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
