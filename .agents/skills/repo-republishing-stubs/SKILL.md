---
name: repo-republishing-stubs
description: Opt-in flow to rebuild + republish all 8 platform smol_stub artifacts via the stubs.yml GitHub Actions workflow (e.g. after the SEA footer integrity changed sha256→sha512, so the 7 downloaded prebuilts must be rebuilt to match). The model drives the automatable steps (prereq checks, dispatch, watch, verify) and PAUSES at the one human gate — the operator types the release-workflow-dispatch bypass phrase to opt in — then clicks the emitted GitHub Actions + Release browser links to watch / authenticate if gh prompts. Use when a stub-affecting source change (footer format, compression, platform metadata) needs every platform's prebuilt republished.
user-invocable: true
allowed-tools: Skill, Read, Grep, Glob, Bash(gh auth status:*), Bash(gh workflow run:*), Bash(gh run list:*), Bash(gh run view:*), Bash(gh run watch:*), Bash(gh release view:*), Bash(gh release list:*), Bash(git status:*), Bash(git log:*), Bash(git rev-list:*), Bash(rg:*), Bash(grep:*), Bash(node:*), Bash(ls:*), Bash(cat:*), Bash(head:*), Bash(tail:*)
model: claude-sonnet-4-6
---

# republishing-stubs

Rebuild + republish all 8 platform `smol_stub` artifacts through the `stubs.yml`
workflow on real runners (Depot cross-builds the platforms this host can't), then
the workflow's immutable-release job ships them as a GitHub Release. A republish
is needed when a source change alters the stub's on-disk shape — most recently
the SEA footer integrity hash (sha256 32-byte → sha512 64-byte): until all 8 are
rebuilt, a binpress on a platform whose prebuilt is still sha256 embeds a stub
that can't verify its own sha512 footer.

This is a **release dispatch** — it ships immutable GitHub Release assets the
fleet (socket-cli, socket-addon) consumes via SHA-pinned trusted-publisher pins.
So the flow is **opt-in**: the model does everything automatable and STOPS at the
single human gate (the dispatch-authorization phrase). It never ships without it.

## The human gates (what only you can do)

1. **Opt-in to the dispatch.** The `release-workflow-guard` blocks a real
   (`dry-run=false`) dispatch of a release workflow unless you've typed the
   canonical phrase verbatim in a recent turn:
   `Allow workflow-dispatch bypass: stubs.yml`. The skill checks for it and
   stops if absent — that typed phrase IS your opt-in.
2. **A browser auth click, only if `gh` prompts.** `gh` normally has the
   `workflow` scope already (keyring); if a dispatch returns an auth error, the
   skill surfaces the device/login URL for you to open + approve, then retries.
3. **Watch / inspect (optional).** The skill emits the run + release URLs; click
   them to watch live or confirm the published assets.

The release itself is a **GitHub Release** (`gh release create → upload → edit
--draft=false`, immutable 3-step) — there is **no npm publish and no OTP** in this
path, and the `release` environment currently has no required-reviewer gate, so
once the build matrix is green the release publishes automatically.

## Phases

### Phase 0 — Prereqs (automatable; stop on any failure)

1. **Clean + pushed.** `git status` clean; HEAD pushed to origin (the workflow
   builds from the pushed ref, so unpushed footer changes won't be in the
   artifacts). If the stub source changed and isn't on origin, STOP — push first.
2. **Source is the intended shape.** Confirm the footer constant is sha512:
   `rg 'INTEGRITY_HASH_LEN 64' packages/bin-infra/src/socketsecurity/bin-infra/compression_constants.h`
   (or whatever invariant this republish is for). If the source still shows the
   old value, STOP — the republish would ship the old artifacts.
3. **gh ready.** `gh auth status` reports `(keyring)` and a `workflow` scope.
4. **Publish prereqs fresh.** `node scripts/check-publish-prereq.mts stubs`
   (the same check the workflow's `verify-prereqs` job runs) — catches stale
   upstream publishes before burning a matrix run.
5. **Local pre-flight (recommended).** Validate the workflow in local containers
   BEFORE spending a remote run — invoke the **`greening-ci-local`** skill on
   `stubs.yml` (Docker via Agent-CI; it runs the build legs locally, pauses on a
   failure so you can fix + retry in place). Linux/musl legs run locally; macOS +
   Depot legs report as the env boundary (they need real runners) — that's
   expected, not a defect. A locally-green pass catches code/config breaks before
   the real dispatch.
6. **Or a remote dry-run.** Alternatively (or additionally, for the legs that
   only run remotely): `gh workflow run stubs.yml -f dry-run=true` (allowed
   without the opt-in phrase — the guard recognizes the `dry-run=true` input) and
   watch it green with `greening-ci --mode=release` before the real run.

### Phase 1 — Opt-in gate (HUMAN)

Check the recent transcript for `Allow workflow-dispatch bypass: stubs.yml`. If
ABSENT: STOP and tell the operator the exact phrase to type, plus a one-line
summary of what will ship (8 platform stubs, GitHub Release). Do NOT dispatch.
If PRESENT: proceed.

### Phase 2 — Dispatch the real run (automatable, post-opt-in)

`gh workflow run stubs.yml -f dry-run=false` (add `-f force=true` only if a cache
bust is needed). Then resolve the run id and **emit the browser URL**:

```
gh run list --workflow=stubs.yml --limit 1 --json databaseId,url \
  --jq '.[0] | "\(.url)"'
```

Print: `▶ Watch the run: <url>` so the operator can open it. If the dispatch
returns an auth error, surface the gh login/device URL, ask the operator to open
+ approve it, then retry the dispatch once.

### Phase 3 — Watch to green (automatable)

Hand off to the **`greening-ci`** skill in `release` mode (build-server matrices:
fast 30s polls, cool down on first success), or poll `gh run watch <id>`. The
matrix is 8 platform legs; macOS legs run on real GH macOS runners, Linux/musl on
Depot. A leg failure surfaces its log — fix locally, push, and the operator
re-dispatches (a new run; the workflow has no in-place retry of a published
release).

### Phase 4 — Verify + done

1. The `release` + `update-release-assets` jobs ran (they only run on
   `!dry-run`).
2. The GitHub Release published with 8 `.tar.gz` assets + `checksums.txt`:
   `gh release list --limit 3` → pick the new tag → `gh release view <tag>`.
   Confirm 8 platform archives.
3. **Emit the release URL**: `🏁 Release: <release html_url>` for the operator to
   click and confirm the published assets.
4. Report: tag, 8 asset names, and that downstream consumers will pick the new
   SHA-pinned stubs on their next trusted-publisher sync.

## Guardrails

- **Never dispatch `dry-run=false` without the Phase-1 phrase.** That is the
  opt-in; the model does not infer it from "go ahead" / "do it".
- **Never edit the release workflow to skip a gate.** Fix the source + re-dispatch.
- A republish ships immutable assets the fleet pins — treat a failed/partial
  release as a STOP-and-report, not a retry-blind.
