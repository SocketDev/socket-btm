# node-smol-builder

Builds custom Node.js binary (~23-27MB) with Socket Security patches, SEA, and VFS support.

Targets SEA (Single Executable Application) production use. Built `--without-amaro` (no TypeScript stripping) to reduce binary size by ~3MB since SEA applications are pre-compiled.

## Build

```bash
pnpm --filter node-smol-builder run clean && \
  pnpm --filter node-smol-builder run build        # dev build (30–60min clean)
pnpm --filter node-smol-builder run clean && \
  pnpm --filter node-smol-builder run build --prod # production build with LTO
```

Always `clean` before `build` — stale checkpoints are the #1 source of "my patch isn't landing" confusion. See the root `CLAUDE.md` for the full development guidelines.

First-time init (clones ~1GB of upstream Node.js):

```bash
git submodule update --init --recursive packages/node-smol-builder/upstream
```

Builds from source — no prebuilt path for this one. Depends on `lief-builder` (optional, enabled with `--with-lief`), `curl-builder` (for stub integration), and the `binject` / `binpress` / `binflate` / `bin-infra` / `build-infra` source packages, which are auto-mirrored into `additions/source-patched/src/socketsecurity/` during the prepare-external-sources step.

Prereqs: `cmake`, `ninja`, `python3` (≥ 3.11), a working C++17 toolchain (Xcode CLT on macOS, `build-essential` on Linux, MSVC on Windows), plus whatever each submodule build needs.

Output: `build/<mode>/<platform-arch>/out/Final/node` (stripped + signed on macOS). For the compressed self-extracting variant, feed this binary into `binpress`.

## Auditing the binary's glibc surface

`pnpm --filter node-smol-builder run glibc:audit` runs `objdump -T` on the latest built binary and prints a per-version symbol count plus any `> floor` violations. The `--fallback-report` flag annotates each violation with whether our compat layer (`additions/source-patched/src/socketsecurity/compat/glibc_compat.{h,cc}`) already wraps it. See [docs/plans/glibc-floor-lowering.md](./docs/plans/glibc-floor-lowering.md) for the full staged plan to lower the floor to 2.17 (RHEL 7 / Amazon Linux 1 / 2).
