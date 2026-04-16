# build-infra

Shared helpers used by every builder package in this monorepo. Covers platform detection (macOS / Linux glibc / Linux musl / Windows), checkpoint-based incremental builds, tool installation (cmake, ninja, emscripten, python), download + checksum verification for upstream tarballs, WASM post-processing, and the `cleanBuilder` helper every `scripts/clean.mts` uses.

Every other package in `packages/` depends on this one. If you are writing build glue, look here first — the helper probably already exists.
