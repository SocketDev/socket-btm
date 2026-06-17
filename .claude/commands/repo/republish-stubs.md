---
description: Opt-in flow to rebuild + republish all 8 platform smol_stub artifacts via stubs.yml — the model drives prereqs/dispatch/watch/verify and pauses at the one human gate (the release-dispatch opt-in phrase), emitting browser links to watch + confirm the release.
---

Rebuild and republish every platform's `smol_stub` through the `stubs.yml`
GitHub Actions workflow (Depot cross-builds the platforms this host can't; the
immutable-release job ships them as a GitHub Release). Use after a stub-affecting
source change — e.g. the SEA footer integrity hash sha256→sha512 — so the 7
downloaded prebuilts are rebuilt to match the local one.

**Opt-in by design.** The model runs every automatable step (prereq checks,
dry-run validation, the real dispatch, the green-watch, and the published-assets
verification) but STOPS at the single human gate: it will not fire a real
(`dry-run=false`) release dispatch until you type the canonical phrase verbatim —

    Allow workflow-dispatch bypass: stubs.yml

That phrase is your opt-in. The model then dispatches, prints the **GitHub Actions
run URL** for you to click and watch (and, only if `gh` prompts for auth, the
login URL to approve), and on success prints the **Release URL** to confirm the 8
published assets. No npm publish, no OTP in this path — it's a GitHub Release.

Run a dry-run first if you want to validate the matrix without shipping:
`gh workflow run stubs.yml -f dry-run=true` (allowed without the phrase).

Invokes the `republishing-stubs` skill.
