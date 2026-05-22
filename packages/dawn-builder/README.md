# dawn-builder

Builder package for [Dawn](https://dawn.googlesource.com/dawn), Chromium's
WebGPU implementation. Produces `libwebgpu_dawn.a` + headers that
`node-smol-builder` links against to expose the `node:smol-webgpu`
builtin.

## Status

**Scaffolding (D1).** Build script + submodule + binding adaptation
land in follow-up D2-D9 commits per
[`.claude/plans/dawn-webgpu-integration.md`](../../.claude/plans/dawn-webgpu-integration.md).

## Why a separate builder package

Dawn is ~436 MB cloned with active development tracking the Chromium
release cadence (~6-week branch bumps). Isolating its submodule + build
into its own `*-builder` package:

- Keeps `node-smol-builder/upstream/` lean for the node submodule + the
  small native deps (uSockets, md4c, tree-sitter, libqrencode).
- Lets the Dawn build cache key be the submodule SHA — invalidates only
  when Dawn moves, not when node-smol's own sources change.
- Matches the existing `*-builder` convention used by curl, yoga,
  onnxruntime, lief, etc.

## CMake island build

Dawn ships both a GN-based Chromium-tooling build and a self-contained
CMake build (`CMakeLists.txt` at the Dawn repo root). We use the CMake
form — same shape as `yoga-layout-builder` and `onnxruntime-builder`.

The build produces:

- `libwebgpu_dawn.a` (~40 MB stripped, ~200 MB unstripped on macos-arm64)
- Headers under `build/<mode>/<platform-arch>/out/include/`

`node-smol-builder` links the static lib + includes the headers into the
`node:smol-webgpu` binding's compilation unit.

## Cache key

The Dawn submodule SHA participates in `node-smol-builder`'s SOURCE_PATCHED
cache key via `prepare-external-sources.mts`. Bumping the Dawn submodule
invalidates the cache; node-smol re-links against the updated artifact.

Within a single Dawn SHA, the build is incremental — ccache handles the
per-translation-unit re-compilation when only headers change.

## Sparse checkout

Dawn's tree includes ~250 MB of `third_party/` we don't need (ANGLE, DXC,
webgpu-cts, samples, docs). Submodule sparse-checkout config restricts
to:

- `src/dawn/{native,common,platform,utils}/`
- `src/tint/`
- `include/dawn/`
- `third_party/{spirv-tools,spirv-headers,vulkan-headers,abseil-cpp}/`

Reduces submodule size to ~180 MB.
