'use strict'

// node:smol-tui — terminal UI primitives (ANSI emit + cell buffer +
// renderer + mouse parser + Yoga layout).
//
// Backed by the native binding (smol_tui) implemented in
// src/socketsecurity/tui/, which wraps the C++ port of socket-stuie's
// OpenTUI Zig source (ansi.zig, renderer.zig, mouse-parser.ts) plus
// Yoga 3.x for flexbox layout.
//
// This is the starter surface: ANSI constants + sync escape-sequence
// builders. The hot-path FastApi writers, render-loop diff, mouse
// parser stream, and Yoga binding land in follow-ups.

const { ObjectFreeze } = primordials

const {
  constants,
  cursorPosition,
  setFgRgb,
  setBgRgb,
  sizes,
  writeAttributes,
  writeBgRgb,
  writeCursorPosition,
  writeFgRgb,
} = internalBinding('smol_tui')

module.exports = ObjectFreeze({
  __proto__: null,
  constants: ObjectFreeze({ __proto__: null, ...constants }),
  cursorPosition,
  setFgRgb,
  setBgRgb,
  sizes: ObjectFreeze({ __proto__: null, ...sizes }),
  writeAttributes,
  writeBgRgb,
  writeCursorPosition,
  writeFgRgb,
})
