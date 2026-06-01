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

| Platform | Linker in node-smol today | ICF available | Status |
|----------|---------------------------|---------------|--------|
| Linux x64 / arm64 | bfd `ld` (compiler default) | No — bfd has no ICF | Blocked without a linker switch |
| macOS arm64 / x64 | Apple `ld64` / `ld-prime` | Folds in release by default | No explicit flag needed; no extra win |
| Windows x64 | MSVC `link.exe` | `/OPT:ICF` | Implied by `/OPT:REF` in release; made explicit |

Key findings from the build scripts (`scripts/binary-released/shared/build-released.mts`)
and `upstream/node/common.gypi`:

- **Linux does not use gold or lld.** `common.gypi` only switches to
  `-fuse-ld=gold` when `node_section_ordering_info` is set, and node-smol
  never sets it. No `LDFLAGS`/`--with-*` linker selection appears anywhere in
  `scripts/` or `patches/`. The default link is bfd `ld`, which has no `--icf`.
  Getting ICF on Linux therefore requires *first* forcing `-fuse-ld=gold` (or
  lld) — a toolchain change, not a flag-add. That switch was deliberately
  deferred (see "Deferred" below).
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

`upstream/node/common.gypi`, Release `VCLinkerTool` (via patch
`001-common-gypi-lto.patch`): explicit `OptimizeReferences` (`/OPT:REF`) +
`EnableCOMDATFolding` (`/OPT:ICF`) on Windows release links. Debug keeps
incremental linking untouched (the two are mutually exclusive).

This is the only place ICF takes effect on the current toolchain without a
linker switch. macOS needs nothing; Linux needs the deferred switch.

## Deferred: Linux ICF via a linker switch

To get ICF on Linux we would force gold or lld globally and add `--icf=safe`:

```
# common.gypi, Linux release ldflags
-fuse-ld=gold        # or lld
-Wl,--icf=safe
```

Risks that gate this:

- Switching the system linker affects every Linux build (musl `--fully-static`,
  `objcopy --remove-section` post-link steps, section stripping). Needs a full
  green build + SEA smoke test per arch.
- gold is in maintenance; lld is the forward path but is another toolchain
  dependency to pin and validate in CI.
- The win is unproven on a C++ + ThinLTO binary. Measure stripped size with and
  without before committing to the toolchain change.

Decision: not worth the toolchain risk until a measurement justifies it. When
revisiting, build both ways and compare stripped `node` size plus the `.text`
section, the way Deno's PR reported it.

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
