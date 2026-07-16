# libpq-builder

Builds libpq (the PostgreSQL client library) with OpenSSL support so node-smol's `node:smol-sql` module can talk to Postgres directly without shelling out or loading a system shared library. Prefers a prebuilt artifact from GitHub releases; falls back to a from-source build when none matches the current platform.

## Build

```bash
pnpm --filter libpq-builder run build                    # dev build (default)
BUILD_MODE=prod pnpm --filter libpq-builder run build    # production build
```

This package's build script does not read `--prod` / `--dev` CLI flags — set `BUILD_MODE` in the environment instead.

First-time from-source build init:

```bash
git submodule update --init --recursive packages/libpq-builder/upstream/postgres
```

OpenSSL resolution (from-source path): libpq's configure needs a directory containing **built** `libcrypto.a`/`libssl.a` and the matching headers. The builder searches in this order:

1. node-smol-builder's bundled OpenSSL (once node-smol has been built once).
2. Homebrew `openssl@3` at `/opt/homebrew/opt/openssl@3` (macOS) or `/usr/local/opt/openssl@3`.
3. System `/usr/include/openssl` + `/usr/lib/{x86_64,aarch64}-linux-gnu` (Linux).

If none of those have built libs, PostgreSQL's configure falls back to an auto-probe. On macOS install `brew install openssl@3`; on Linux `sudo apt install libssl-dev`.

Output: `build/<mode>/<platform-arch>/out/Final/libpq/dist/` (`libpq.a`, `libpgcommon.a`, `libpgport.a`, plus `libpq-fe.h` and `pg_config.h` headers).
