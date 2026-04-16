# opentui-builder

Native Node-API bindings for [OpenTUI](https://github.com/anomalyco/opentui), built in Zig and cross-compiled to produce `.node` addons for all eight platform targets (macOS x64/arm64, Linux x64/arm64 glibc and musl, Windows x64/arm64) from a single host machine.

OpenTUI is Socket CLI's low-level terminal renderer — the layer that decides what pixels go where in the TUI. This package is what the CLI loads at runtime via Node-API.
