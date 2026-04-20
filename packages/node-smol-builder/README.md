# node-smol-builder

Builds custom Node.js binary (~23-27MB) with Socket Security patches, SEA, and VFS support.

Targets SEA (Single Executable Application) production use. Built `--without-amaro` (no TypeScript stripping) to reduce binary size by ~3MB since SEA applications are pre-compiled.

Run `pnpm --filter node-smol-builder clean && pnpm --filter node-smol-builder build` to build. See CLAUDE.md for development guidelines (clean-before-rebuild is required to avoid stale checkpoints).
