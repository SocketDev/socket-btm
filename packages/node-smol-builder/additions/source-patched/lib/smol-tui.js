'use strict'

// node:smol-tui — terminal UI primitives. Five surfaces:
//
//   1. ANSI emit constants + cold-path string builders
//      Upstream ref: socket-stuie/@opentui/core packages/core/src/zig/ansi.zig
//      VT/xterm spec: https://invisible-island.net/xterm/ctlseqs/ctlseqs.html
//
//   2. ANSI hot-path Uint8Array writers (cursor / fg / bg / attrs)
//      Caller pre-allocates a Buffer of size `sizes.maxCursorPositionLen` /
//      `sizes.maxRgbSgrLen` / `sizes.maxAttrRunLen`; the binding writes
//      straight into it. Zero per-call allocation.
//
//   3. Mouse parser handles
//      Upstream ref: @opentui/core packages/core/src/parse/mouse-parser.ts
//      Decodes SGR (ESC[<b;x;yM|m) and X10 (ESC[M<byte><x><y>) protocols;
//      tracks drag state so press → motion → release becomes DOWN → DRAG →
//      DRAG_END + DROP events.
//
//   4. Renderer + cell buffer handles (double-buffered diff renderer)
//      Upstream ref: @opentui/core packages/core/src/zig/renderer.zig
//      Each frame: clear → draw cells → flush. Flush walks both buffers,
//      emits ANSI only for changed cells, and writes it into a caller-
//      supplied Buffer.
//
//   5. Yoga layout (flexbox)
//      Upstream: https://github.com/facebook/yoga/tree/v3.2.1
//      submodule: packages/yoga-layout-builder/upstream/yoga/
//      The binding exposes the Yoga C-API (YGNode* / YGNodeStyle* /
//      YGNodeLayout*) plus enum mirrors (flexDirection, justify, align,
//      edge, wrap, positionType, direction).
//
// Backed by the native binding (smol_tui) at
// src/socketsecurity/tui/tui_binding.cc, which wraps the C++ port of
// OpenTUI's Zig sources (in include/tui/ + src/tui/) plus Yoga 3.2.1.

const { ObjectFreeze } = primordials

const {
  align,
  constants,
  createParser,
  createRenderer,
  cursorPosition,
  destroyParser,
  destroyRenderer,
  direction,
  edge,
  flexDirection,
  justify,
  looksLikeMouseSequence,
  mouseEventType,
  parseMouseOne,
  positionType,
  rendererClear,
  rendererDrawBox,
  rendererDrawText,
  rendererDrawTextWrapped,
  rendererFillRect,
  rendererFlush,
  rendererInvalidate,
  rendererResize,
  rendererSet,
  rendererSize,
  resetParser,
  scrollDirection,
  setBgRgb,
  setFgRgb,
  sizes,
  wrap,
  writeAttributes,
  writeBgRgb,
  writeCursorPosition,
  writeFgRgb,
  yogaCalculateLayout,
  yogaCreateNode,
  yogaFreeNode,
  yogaGetComputedLayout,
  yogaInsertChild,
  yogaMarkDirty,
  yogaRemoveChild,
  yogaSetAlignItems,
  yogaSetAlignSelf,
  yogaSetFlexBasis,
  yogaSetFlexDirection,
  yogaSetFlexGrow,
  yogaSetFlexShrink,
  yogaSetFlexWrap,
  yogaSetHeight,
  yogaSetJustifyContent,
  yogaSetMargin,
  yogaSetPadding,
  yogaSetPosition,
  yogaSetPositionType,
  yogaSetWidth,
} = internalBinding('smol_tui')

module.exports = ObjectFreeze({
  __proto__: null,
  align: ObjectFreeze({ __proto__: null, ...align }),
  constants: ObjectFreeze({ __proto__: null, ...constants }),
  createParser,
  createRenderer,
  cursorPosition,
  destroyParser,
  destroyRenderer,
  direction: ObjectFreeze({ __proto__: null, ...direction }),
  edge: ObjectFreeze({ __proto__: null, ...edge }),
  flexDirection: ObjectFreeze({ __proto__: null, ...flexDirection }),
  justify: ObjectFreeze({ __proto__: null, ...justify }),
  looksLikeMouseSequence,
  mouseEventType: ObjectFreeze({ __proto__: null, ...mouseEventType }),
  parseMouseOne,
  positionType: ObjectFreeze({ __proto__: null, ...positionType }),
  rendererClear,
  rendererDrawBox,
  rendererDrawText,
  rendererDrawTextWrapped,
  rendererFillRect,
  rendererFlush,
  rendererInvalidate,
  rendererResize,
  rendererSet,
  rendererSize,
  resetParser,
  scrollDirection: ObjectFreeze({ __proto__: null, ...scrollDirection }),
  setBgRgb,
  setFgRgb,
  sizes: ObjectFreeze({ __proto__: null, ...sizes }),
  wrap: ObjectFreeze({ __proto__: null, ...wrap }),
  writeAttributes,
  writeBgRgb,
  writeCursorPosition,
  writeFgRgb,
  yogaCalculateLayout,
  yogaCreateNode,
  yogaFreeNode,
  yogaGetComputedLayout,
  yogaInsertChild,
  yogaMarkDirty,
  yogaRemoveChild,
  yogaSetAlignItems,
  yogaSetAlignSelf,
  yogaSetFlexBasis,
  yogaSetFlexDirection,
  yogaSetFlexGrow,
  yogaSetFlexShrink,
  yogaSetFlexWrap,
  yogaSetHeight,
  yogaSetJustifyContent,
  yogaSetMargin,
  yogaSetPadding,
  yogaSetPosition,
  yogaSetPositionType,
  yogaSetWidth,
})
