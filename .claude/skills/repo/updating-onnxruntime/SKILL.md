---
name: updating-onnxruntime
description: Updates ONNX Runtime submodule to latest stable version, initializes nested submodules, bumps onnxruntime and models caches. Use for new ML operators, inference performance, or security patches.
user-invocable: true
allowed-tools: Bash(pnpm:*), Bash(npm:*), Bash(git:*), Bash(node:*), Bash(rg:*), Bash(grep:*), Bash(find:*), Bash(ls:*), Bash(cat:*), Bash(head:*), Bash(tail:*), Bash(wc:*), Bash(diff:*), Read, Edit, Glob, Grep---

# updating-onnxruntime

Update the ONNX Runtime submodule to latest stable release.

- **Submodule**: `packages/onnxruntime-builder/upstream/onnxruntime` (microsoft/onnxruntime)
- **Tag format**: `vX.Y.Z` (exclude dev/rc/preview)
- **Cache bumps**: `onnxruntime`, `models`
- **Note**: Has nested submodules (cmake/external/onnx, emsdk) that need recursive init

## Process

1. **Validate**: Clean working directory, detect CI mode
2. **Fetch latest**: `git fetch origin --tags` in submodule, find latest stable `vX.Y.Z` tag
3. **Check**: If already at latest, report and exit
4. **Update submodule**: `git checkout $TAG`, then `git submodule update --init --recursive` to initialize nested submodules
5. **Verify clean**: `git status` should show only submodule pointer change (capital M), not modified/untracked content
6. **Update .gitmodules**: Edit version comment to `# onnxruntime-X.Y.Z` (strip v prefix)
7. **Build/test** (skip in CI): `pnpm run clean && pnpm run build && pnpm test` in `packages/onnxruntime-builder`. Builds can take 30+ minutes (WASM compilation).
8. **Bump caches**: Increment `onnxruntime` and `models` in `.github/cache-versions.json`
9. **Commit and report**
