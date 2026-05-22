# tui-infra

Source-only C++ TUI primitives — ANSI emit + cell-buffer diff render
loop + Yoga binding + mouse parser — embedded into `node-smol-builder`
as the `node:smol-tui` builtin. Mirrors the
[`temporal-infra`](../temporal-infra/) pattern: no binary release, no
Docker, no workflow. Consumers compile the `.cc` / `.hpp` files inline
via additions/source-patched.

## Status

**Tier 1–3 ported.** ANSI emit, cell-buffer diff render loop, mouse
parser, and Yoga direct binding are all live in
[`node:smol-tui`](../node-smol-builder/additions/source-patched/lib/smol-tui.js).
The binding glue lives at
[`additions/source-patched/src/socketsecurity/tui/tui_binding.cc`](../node-smol-builder/additions/source-patched/src/socketsecurity/tui/tui_binding.cc).
Higher-level surfaces (`@opentui/react`, `@opentui/keymap`,
`@opentui/qrcode`, `@opentui/solid`) are planned as
`node:smol-tui/<surface>` siblings — see the design plan at
[`.claude/plans/opentui-smol-tui-completion.md`](../../.claude/plans/opentui-smol-tui-completion.md).

## Three-tier port

| Tier   | Surface                                       | Hot path?                           | Upstream                                                                                                                                                                                                                                                                                              | Status |
| ------ | --------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Tier 1 | ANSI emit (cursor moves, SGR, cell flushes)   | Yes — every frame                   | [`opentui/packages/core/src/zig/ansi.zig`](../opentui-builder/upstream/opentui/packages/core/src/zig/ansi.zig)                                                                                                                                                                                       | DONE   |
| Tier 2 | Cell buffer + diff + render loop              | Yes — every frame                   | [`opentui/packages/core/src/zig/renderer.zig`](../opentui-builder/upstream/opentui/packages/core/src/zig/renderer.zig) + [`buffer-methods.zig`](../opentui-builder/upstream/opentui/packages/core/src/zig/buffer-methods.zig)                                                                        | DONE   |
| Tier 3 | Yoga direct binding + mouse parser            | Per-event (mouse), per-frame (Yoga) | yoga 3.2.1 (C++ upstream) + [`opentui/packages/core/src/lib/parse.mouse.ts`](../opentui-builder/upstream/opentui/packages/core/src/lib/parse.mouse.ts)                                                                                                                                               | DONE   |

The user-facing `packages/core/src/ansi.ts` (18 LOC) is a thin
re-export of cursor/screen state primitives — NOT the per-cell hot
path. The Zig file is where the render loop's flush calls land
(`ANSI.moveToOutput / fgColorOutput / bgColorOutput /
applyAttributesOutputWriter`).

## Architecture

Three layers, same shape as `temporal-infra`:

| Layer                     | Source                          | Notes                                                                                                                                |
| ------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **(1) Layout (Yoga)**     | yoga submodule (C++ upstream)   | Yoga is already C++ — `node:smol-tui.computeLayout()` wires it directly into node-smol, no JS bridge.                                |
| **(2) Terminal I/O**      | Node's `process.stdout` + libuv | Raw I/O stays in Node. ANSI emit produces a `Buffer`; the JS layer writes it via the existing Node stream API.                        |
| **(3) Render algorithms** | this package                    | Cell buffer, dirty diff, ANSI batch emit, SGR / X10 mouse decode, Yoga handle registry.                                              |

## Why source-only

Same rationale as `temporal-infra`:

- No binary release artifact to ship — node-smol patches `#include` the
  headers and compiles the `.cc` files alongside V8/Node sources.
- Single source of truth: socket-stuie's TS render loop and this C++
  port both target the same OpenTUI semantics; lockstep tracked via
  `.config/lockstep.json` rows (`tui-infra-ansi`, `tui-infra-buffer`,
  `tui-infra-renderer`, `tui-infra-mouse`, and the `opentui`
  `version-pin`).
- Bumping OpenTUI means bumping the submodule SHA + re-running the
  parity tests — same workflow as bumping `boa-dev/temporal` in
  temporal-infra.

## JS contract

`node:smol-tui` exposes one binding under `internalBinding('smol_tui')`
re-exported by `lib/smol-tui.js`. The surface groups by tier:

- **ANSI constants + writers** — `constants.{reset,clear,...}`,
  `cursorPosition`, `setFgRgb`, `setBgRgb`, `writeCursorPosition` (Fast
  API), `writeFgRgb` (Fast API), `writeBgRgb` (Fast API),
  `writeAttributes` (Fast API), `sizes.{maxCursorPositionLen,...}`.
- **Renderer / cell buffer** — `createRenderer`, `destroyRenderer`,
  `rendererResize`, `rendererClear`, `rendererSet`, `rendererFillRect`,
  `rendererDrawText`, `rendererInvalidate`, `rendererFlush`,
  `rendererSize`.
- **Mouse parser** — `createParser`, `destroyParser`, `resetParser`,
  `parseMouseOne`, `looksLikeMouseSequence`, `mouseEventType.{...}`,
  `scrollDirection.{...}`.
- **Yoga layout** — `yogaCreateNode`, `yogaFreeNode`, `yogaInsertChild`,
  `yogaRemoveChild`, `yogaCalculateLayout`, `yogaMarkDirty`,
  `yogaGetComputedLayout`, plus 14 `yogaSet*` setters, plus enum
  mirrors `flexDirection.{...}`, `justify.{...}`, `align.{...}`,
  `edge.{...}`, `wrap.{...}`, `positionType.{...}`, `direction.{...}`.

All entries are zero-allocation per call where the binding can manage
it: hot-path writers and `rendererFlush` take caller-allocated
`Uint8Array` outputs; the JS layer reuses one buffer per session.

## Wiring into node-smol

[`prepare-external-sources.mts`](../node-smol-builder/scripts/binary-released/shared/prepare-external-sources.mts)
copies the two trees into `additions/source-patched/`:

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

Three node-smol patches register the binding:

- [`004-node-gyp-smol-sources.patch`](../node-smol-builder/patches/source-patched/004-node-gyp-smol-sources.patch)
  — lists the `.cc` files in `node.gyp` under the
  `node_use_smol_tui == "true"` gate.
- [`017-smol-builtin-bindings.patch`](../node-smol-builder/patches/source-patched/017-smol-builtin-bindings.patch)
  — declares `smol_tui` in `NODE_BUILTIN_BINDINGS`.
- [`018-configure-postgres-iouring.patch`](../node-smol-builder/patches/source-patched/018-configure-postgres-iouring.patch)
  — adds `--without-smol-tui` flag and `node_use_smol_tui` variable.

The `node:` prefix is enforced by patch
[`003-realm-smol-bindings.patch`](../node-smol-builder/patches/source-patched/003-realm-smol-bindings.patch),
which adds `'smol-tui'` to the `schemelessBlockList` in
`lib/internal/bootstrap/realm.js`. Loading `require('smol-tui')`
without the prefix fails with `ERR_UNKNOWN_BUILTIN_MODULE`; the only
valid spec is `require('node:smol-tui')`.
