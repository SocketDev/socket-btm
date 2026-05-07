# curl-builder

Provides libcurl + mbedTLS for our self-extracting stub binaries so they can download payloads over HTTPS without relying on a system curl. By default, the builder downloads a prebuilt artifact from GitHub releases (fast); with `--force` it compiles from the upstream `curl` submodule with mbedTLS statically linked.

Consumed by stubs-builder. If you are adding TLS features or bumping curl, see `.claude/skills/updating-curl/SKILL.md`.

## Build

```bash
pnpm --filter curl-builder run build                     # dev build, prefer prebuilt release artifact
pnpm --filter curl-builder run build -- --force          # force compile from source (curl + mbedtls submodules)
```

First-time from-source init:

```bash
git submodule update --init --recursive packages/curl-builder/upstream/curl packages/curl-builder/upstream/mbedtls
```

Output: `build/<mode>/<platform-arch>/out/Final/curl/` (libs + headers for static linking).
