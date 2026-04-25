# opentui-builder

Native Node-API bindings for [OpenTUI](https://github.com/anomalyco/opentui), built in Zig and cross-compiled to produce `.node` addons for all eight platform targets (macOS x64/arm64, Linux x64/arm64 glibc and musl, Windows x64/arm64) from a single host machine.

OpenTUI is Socket CLI's low-level terminal renderer — the layer that decides what pixels go where in the TUI. This package is what the CLI loads at runtime via Node-API.

## Build

```bash
pnpm --filter opentui-builder run build        # dev build for the host platform
pnpm --filter opentui-builder run build --prod # production build
```

First-time init:

```bash
git submodule update --init --recursive packages/opentui-builder/upstream/opentui
```

The Zig version is pinned in `external-tools.json` and auto-downloaded on first use (cached under `.cache/external-tools/zig/`). Do not install Zig system-wide — the build will use whatever the pin says.

**Host-OS note**: macOS 26+ requires Zig ≥ 0.16 because 0.15.x's linker is incompatible with the macOS 26 SDK. Linux/Windows hosts are unaffected. The `ensureZig` preflight runs a link smoke test and fails fast with a clear message if the host can't link.

Output: `build/<mode>/<platform-arch>/out/Final/opentui.<platform-arch>.node`.
