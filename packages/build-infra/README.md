# build-infra

Shared helpers used by every builder package in this monorepo. Covers platform detection (macOS / Linux glibc / Linux musl / Windows), checkpoint-based incremental builds, tool installation (cmake, ninja, emscripten, python), download + checksum verification for upstream tarballs, WASM post-processing, and the `cleanBuilder` helper every `scripts/clean.mts` uses.

Every other package in `packages/` depends on this one. If you are writing build glue, look here first — the helper probably already exists.

There is no `pnpm run build` here — this package is a library. Tests live in `test/` and run with `pnpm --filter build-infra run test`.

When you edit files under `lib/`, `make/`, `scripts/`, `wasm-synced/`, `src/socketsecurity/build-infra/`, `release-assets.json`, or `external-tools.json`, also bump the matching entries in `.github/cache-versions.json` — the "Cache Version Cascade" table in the root `CLAUDE.md` spells out which downstream packages each path invalidates.
