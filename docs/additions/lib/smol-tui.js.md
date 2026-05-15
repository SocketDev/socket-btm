# smol-tui.js -- Public API for terminal UI primitives (node:smol-tui)

## What This File Does

Entry point for `require('node:smol-tui')`. Five surfaces: ANSI emit
constants, hot-path ANSI writers, mouse parser, double-buffered
diff renderer, and Yoga 3.2.1 flexbox layout.

## How It Fits Together

```
require('node:smol-tui') -> this file (smol-tui.js)
  -> internalBinding('smol_tui') (C++ native binding)
    -> additions/source-patched/src/socketsecurity/tui/tui_binding.cc
       Wraps the C++ port of OpenTUI Zig sources at
       include/tui/ + src/tui/, plus Yoga 3.2.1 from
       packages/yoga-layout-builder/upstream/yoga/.
```

## Public API (5 groups)

### 1. ANSI emit -- constants + cold-path string builders
Upstream ref: `@opentui/core packages/core/src/zig/ansi.zig`.
VT/xterm spec: <https://invisible-island.net/xterm/ctlseqs/ctlseqs.html>.

```ts
import { setFgRgb, setBgRgb, sizes } from 'node:smol-tui'
setFgRgb(255, 128, 0) // -> string SGR sequence
```

### 2. ANSI hot-path -- Uint8Array writers
Zero-allocation. Caller pre-allocates a `Buffer` of size
`sizes.maxCursorPositionLen` / `sizes.maxRgbSgrLen` / `sizes.maxAttrRunLen`,
and the binding writes directly into it.

```ts
import { writeCursorPosition, writeFgRgb, writeBgRgb, writeAttributes }
  from 'node:smol-tui'
const buf = Buffer.allocUnsafe(sizes.maxCursorPositionLen)
const n = writeCursorPosition(buf, 0, row, col)
```

### 3. Mouse parser -- SGR + X10 protocols
Upstream ref: `@opentui/core packages/core/src/parse/mouse-parser.ts`.
Decodes `ESC[<b;x;yM|m` (SGR) and `ESC[M<byte><x><y>` (X10); tracks
drag state so press → motion → release becomes DOWN → DRAG →
DRAG_END + DROP events.

```ts
import { createParser, parseMouseOne, looksLikeMouseSequence,
         resetParser, destroyParser, mouseEventType, scrollDirection }
  from 'node:smol-tui'
```

### 4. Renderer + cell buffer -- double-buffered diff
Upstream ref: `@opentui/core packages/core/src/zig/renderer.zig`. Each
frame: clear → draw cells → flush. Flush walks both buffers, emits
ANSI only for changed cells, and writes it into a caller-supplied
Buffer.

```ts
import { createRenderer, rendererResize, rendererClear, rendererSet,
         rendererDrawText, rendererFillRect, rendererInvalidate,
         rendererFlush, rendererSize, destroyRenderer }
  from 'node:smol-tui'
```

### 5. Yoga layout (flexbox)
Upstream: <https://github.com/facebook/yoga/tree/v3.2.1>. Submodule
at `packages/yoga-layout-builder/upstream/yoga/`. Exposes Yoga C-API
(YGNode\* / YGNodeStyle\* / YGNodeLayout\*) plus enum mirrors.

```ts
import { yogaCreateNode, yogaSetFlexDirection, yogaSetFlexGrow,
         yogaSetFlexBasis, yogaSetAlignItems, yogaSetAlignSelf,
         yogaInsertChild, yogaRemoveChild, yogaCalculateLayout,
         yogaGetComputedLayout, yogaMarkDirty, yogaFreeNode,
         flexDirection, justify, edge, wrap, positionType, direction,
         align } from 'node:smol-tui'
```

## Design Choices

- **C++ port of Zig sources**, not a binding to a built Zig artifact:
  the upstream OpenTUI Zig is reference-grade but we don't want a
  Zig build dependency on the node-smol toolchain.
- **Yoga as a submodule (not a fetched binary)**: build determinism
  for the libnode link.
- **Hot-path API takes a caller-allocated buffer**: zero per-call
  alloc, which matters for renderer flush at 60 FPS.

## Where the Real Work Happens

- `src/socketsecurity/tui/tui_binding.cc` -- V8 trampolines wiring
  the C++ port's classes into JS handles.
- `include/tui/*` + `src/tui/*` -- the actual C++ port of OpenTUI
  (ansi emit, mouse parser, cell buffer, renderer).
- `additions/source-patched/deps/yoga/` -- Yoga 3.2.1 sources copied
  in by `prepare-external-sources.mts` from the submodule.
