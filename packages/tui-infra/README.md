# tui-infra

Source-only C++ TUI primitives — render loop + Yoga binding + mouse
parser — embedded into `node-smol-builder` as the `node:smol-tui`
builtin module. Mirrors the [`temporal-infra`](../temporal-infra/) pattern:
no binary release, no Docker, no workflow. Consumers compile the `.cc`
/ `.hpp` files inline via additions/source-patched.

## Status

**v0 scaffold.** Native code not yet ported; this is the skeleton +
lockstep plan only. The first three PRs port one tier each.

## Three-tier plan

| Tier   | Surface                                              | Hot path?                       | Upstream                                                              | Status |
| ------ | ---------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------- | ------ |
| Tier 1 | ANSI emit (cursor moves, SGR, cell flushes)          | Yes — every frame               | OpenTUI `packages/core/src/zig/ansi.zig` (268 LOC, the per-cell path) | TODO   |
| Tier 2 | Cell buffer + diff + render loop                     | Yes — every frame               | OpenTUI `packages/core/src/zig/renderer.zig`                          | TODO   |
| Tier 3 | Yoga direct binding + mouse parser                   | Per-event (mouse), per-frame (Yoga) | yoga + socket-stuie `packages/react/src/mouse-parser.ts`            | TODO   |

The user-facing `packages/core/src/ansi.ts` (18 LOC) is a thin
re-export of cursor/screen state primitives — NOT the per-cell hot
path. The Zig file is where the render loop's flush calls land
(`ANSI.moveToOutput / fgColorOutput / bgColorOutput /
applyAttributesOutputWriter`).

Each tier ships independently. Tier 1 alone wins ~30% per-frame on
typical OpenTUI workloads (per socket-stuie's `bench/render.mts`).

## Architecture

Three layers, same shape as `temporal-infra`:

| Layer                    | Source                                  | Notes                                                                                                                             |
| ------------------------ | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **(1) Layout (Yoga)**    | yoga submodule (C++ upstream)           | Yoga is already C++ — Tier 3 wires it directly into node-smol via `node:smol-tui.computeLayout()`, replacing socket-stuie's WASM bridge. |
| **(2) Terminal I/O**     | Node's `process.stdout` + libuv          | We don't re-implement raw I/O. ANSI emit produces a Buffer; we write it via the existing Node stream API.                            |
| **(3) Render algorithms**| this package                            | Tier 1+2: cell buffer, dirty diff, ANSI batch emit. Tier 3: mouse-event SGR parser.                                                  |

## Why source-only

Same rationale as `temporal-infra`:

- No binary release artifact to ship — node-smol patches `#include` the
  headers and compiles the `.cc` files alongside V8/Node sources.
- Single source of truth: socket-stuie's TS render loop and this C++
  port both target the same OpenTUI semantics; lockstep tracked via
  the central `.config/lockstep.json` `rows` array (matches the
  socket-btm fleet pattern — same file temporal-infra and other
  upstream-tracking packages use).
- Bumping OpenTUI means bumping the submodule SHA + re-running the
  parity tests — same workflow as bumping `boa-dev/temporal` in
  temporal-infra.

## Lockstep

Rows planned for socket-btm's `.config/lockstep.json`:

| ID                  | Kind         | Upstream                                                                                              | Local                                                |
| ------------------- | ------------ | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `tui-infra-ansi`    | `file-fork`  | socket-stuie `packages/core/upstream/opentui/packages/core/src/zig/ansi.zig`                          | `src/socketsecurity/tui/ansi.cc`                     |
| `tui-infra-render`  | `file-fork`  | socket-stuie `packages/core/upstream/opentui/packages/core/src/zig/renderer.zig`                      | `src/socketsecurity/tui/render.cc` (Tier 2)          |
| `tui-infra-mouse`   | `file-fork`  | socket-stuie `packages/react/src/mouse-parser.ts` (already optimized)                                 | `src/socketsecurity/tui/mouse_parser.cc` (Tier 3)    |
| `opentui-parity`    | `version-pin`| `anomalyco/opentui` v0.1.99 (SHA `cc94b58`, matches socket-stuie's existing `opentui` pin)            | upstream submodule reference                         |
| `yoga`              | `version-pin`| `facebook/yoga` (matches socket-stuie's pin)                                                          | `upstream/yoga/` (Tier 3)                            |

socket-stuie's TS layer keeps being the test-bed for new TUI features;
when a feature stabilizes there, the file-fork row picks it up and the
C++ port follows.

## Wiring into node-smol

Once Tier 1 ports land, `node-smol-builder`'s
`prepare-external-sources.mts` will add two `MONOREPO_PACKAGE_SOURCES`
entries (mirrors temporal-infra's wiring):

```ts
{
  from: path.join(TUI_INFRA_DIR, 'src', 'socketsecurity', 'tui'),
  to:   path.join(ADDITIONS_SOURCE_PATCHED_DIR, 'src', 'socketsecurity', 'tui'),
},
{
  from: path.join(TUI_INFRA_DIR, 'include', 'tui'),
  to:   path.join(ADDITIONS_SOURCE_PATCHED_DIR, 'include', 'tui'),
},
```

The `node:smol-tui` builtin is then registered via a new node-smol
patch parallel to the existing `node:smol-power` / `node:smol-util`
patches.
