# Binary size: Identical Code Folding (ICF) assessment

Tracks whether node-smol can adopt the link-time Identical Code Folding
optimization that denoland/deno#34478 used to shave ~4.4% off Deno's binary,
and records what actually applies to node-smol's toolchain.

## What ICF is

ICF (Identical Code Folding) is a linker pass that merges functions whose
emitted machine code is byte-identical, keeping one copy and pointing every
caller at it. The `safe` variant only folds functions whose address is not
semantically significant, so function-pointer identity (`&a == &b`) is
preserved. The `all` variant folds more but can break code that compares
function pointers.

Deno's win came from Rust: monomorphizing generics produces many identical
instantiations (`drop` glue, `Debug` impls, generic bodies that erase to the
same code). C++ produces far less of this, so the ceiling for node-smol is
lower before any measurement.

## node-smol's linker reality

ICF is a linker flag, so the relevant question is which linker each platform
actually uses, not which language the source is.

| Platform | Linker in node-smol | ICF | Status |
|----------|---------------------|-----|--------|
| Linux x64 / arm64 | gold (`-fuse-ld=gold`) | `--icf=safe` | Enabled — switched from bfd to gold |
| macOS arm64 / x64 | Apple `ld64` / `ld-prime` | Folds in release by default | No explicit flag needed; no extra win |
| Windows x64 | MSVC `link.exe` | `/OPT:ICF` | Implied by `/OPT:REF` in release; made explicit |

Key findings from the build scripts (`scripts/binary-released/shared/build-released.mts`)
and `upstream/node/common.gypi`:

- **Linux now links with gold.** Upstream `common.gypi` only switched to
  `-fuse-ld=gold` when `node_section_ordering_info` was set, which node-smol
  never sets — so the stock build used bfd `ld`, which has no `--icf`. Patch
  `001-common-gypi-lto.patch` adds a sibling Linux-release block (active in the
  default `node_section_ordering_info==""` case) that selects gold and passes
  `-Wl,--icf=safe` + `-ffunction-sections`. gold is GCC's native companion
  linker (node-smol builds with GCC, not Clang), so this needs no LLVM. The
  builder images install it: `gcc-toolset-13-binutils-gold` on glibc
  (AlmaLinux 8), `binutils-gold` on musl (Alpine).
- **macOS already folds.** `ld64` / `ld-prime` perform ICF as part of a release
  link with `-dead_strip`, so there is no separate flag to add and little
  marginal gain. node-smol also runs ThinLTO (`LLVM_LTO=YES_THIN`) on macOS,
  which already deduplicates some identical code before the linker runs.
- **Windows release already implies ICF.** `link.exe` enables `/OPT:REF,ICF`
  whenever `/OPT:REF` is on in a release build. We make `/OPT:ICF` explicit so
  the behavior is durable and visible rather than relying on the default — the
  same "make it durable" move Deno made for its MSVC path.
- **LTO is already on.** Prod Linux/macOS builds pass `--enable-lto`
  (`-flto=thin` for Clang, `-flto=4 -ffat-lto-objects` for GCC). LTO folds some
  identical code on its own, so ICF stacked on top yields less than Deno's
  no-LTO baseline measured.

## What we applied

All via patch `001-common-gypi-lto.patch` (against `upstream/node/common.gypi`)
plus the builder Dockerfiles:

- **Linux release** (`OS=="linux"`, default `node_section_ordering_info==""`):
  `-fuse-ld=gold` + `-ffunction-sections` in cflags; `-fuse-ld=gold` +
  `-Wl,--icf=safe` in ldflags. Applies to x64 and arm64, glibc and musl
  (`--fully-static` is orthogonal to linker choice; gold links static
  libstdc++ fine). gold installed in both builder images
  (`Dockerfile.glibc-released` → `gcc-toolset-13-binutils-gold`;
  `Dockerfile.musl-released` → `binutils-gold`).
- **Windows release** `VCLinkerTool`: `OptimizeReferences` (`/OPT:REF`) +
  `EnableCOMDATFolding` (`/OPT:ICF`). Release implies these already; explicit
  keeps them durable. Debug keeps incremental linking untouched (the two are
  mutually exclusive).
- **macOS**: nothing — `ld64`/`ld-prime` already fold in release.

Cache bumped (`node-smol` in `.github/cache-versions.json`) so CI rebuilds with
the new linker rather than serving a pre-gold cached binary.

### Why `--icf=safe`, not `--icf=all`

`safe` only folds functions whose address is not observable, preserving
function-pointer identity (`&a != &b` stays true for distinct symbols). V8 and
Node compare code/function pointers in several places, so `--icf=all` risks
miscompilation. The size delta between `safe` and `all` is small; correctness
wins.

### Post-link steps are linker-agnostic

`strip --strip-debug`, the ARM64-only `objcopy --remove-section`, and `sstrip`
all operate on standard ELF sections that gold emits identically to bfd, so the
existing `build-stripped.mts` pipeline needs no change.

## How to measure

```bash
# stripped binary size
ls -l build/Release/<platform-arch>/out/Final/node

# .text section size (Linux)
size -A build/Release/<platform-arch>/out/Final/node | grep '\.text'

# __text section size (macOS)
size -m build/Release/<platform-arch>/out/Final/node | grep __text
```

Compare a baseline build against an ICF build of the same SHA; report the delta
in bytes and percent.

## Reference

- Upstream technique: denoland/deno#34478 (safe ICF, `lld --icf=safe` /
  `/OPT:ICF`, ~4.4% on aarch64-darwin Rust binary).
