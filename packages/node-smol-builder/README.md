# node-smol-builder

Builds custom Node.js binary (~23-27MB) with Socket Security patches, SEA, and VFS support.

Targets SEA (Single Executable Application) production use. Built `--without-amaro` (no TypeScript stripping) to reduce binary size by ~3MB since SEA applications are pre-compiled.

Run `pnpm --filter node-smol-builder clean && pnpm --filter node-smol-builder build` to build. See CLAUDE.md for development guidelines (clean-before-rebuild is required to avoid stale checkpoints).

## Auditing the binary's glibc surface

`pnpm --filter node-smol-builder run glibc:audit` runs `objdump -T` on the latest built binary and prints a per-version symbol count plus any `> floor` violations. The `--fallback-report` flag annotates each violation with whether our compat layer (`additions/source-patched/src/socketsecurity/compat/glibc_compat.{h,cc}`) already wraps it. See [docs/plans/glibc-floor-lowering.md](./docs/plans/glibc-floor-lowering.md) for the full staged plan to lower the floor to 2.17 (RHEL 7 / Amazon Linux 1 / 2).
