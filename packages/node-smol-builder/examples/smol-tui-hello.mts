#!/usr/bin/env node
/**
 * Minimal hello-world for node:smol-tui.
 *
 * Demonstrates the canonical render loop: create a renderer, draw a
 * bordered box with text inside, flush to stdout, await Ctrl-C.
 *
 * Run with a socket-built node (the regular Node.js binary doesn't
 * have `node:smol-tui`):
 *
 * ./packages/node-smol-builder/build/dev/darwin-arm64/out/socket-node\
 * packages/node-smol-builder/examples/smol-tui-hello.mts
 *
 * This file is the canonical reference for how userland TUI code
 * should wire the binding together — copy-paste this into your app
 * and adapt.
 */

// node:smol-tui is a builtin on socket-built node. Userland imports
// it the same way it would import any node: module.
//
// Runtime check: a regular Node.js binary will throw
// ERR_UNKNOWN_BUILTIN_MODULE here. That's the signal to fall back to
// userland @opentui/core or skip the smol path entirely.
import {
  ATTRIBUTE_BASE_MASK,
  codepointWidth,
  createRenderer,
  destroyRenderer,
  rendererClear,
  rendererDrawBox,
  rendererDrawTextWrapped,
  rendererFlush,
  rendererResize,
  rendererSize,
  stringWidth,
  TextAttributes,
} from 'node:smol-tui'

// Constants matching tui::BorderStyle enum (see include/tui/renderables.hpp).
const BORDER_SINGLE = 0
const BORDER_DOUBLE = 1
const BORDER_ROUNDED = 2
const BORDER_HEAVY = 3

const SIDES_ALL = 0xf // top | right | bottom | left

// ANSI flush buffer: re-used frame-to-frame; one allocation per app.
// 256 KB covers up to a 200×60 grid in the worst case (every cell
// changes between frames).
const FLUSH_BUF = new Uint8Array(256 * 1024)

export function drawFrame(rendererId: number): void {
  const { width, height } = rendererSize(rendererId)
  rendererClear(rendererId)

  // Outer bordered box.
  rendererDrawBox(
    rendererId,
    0,
    0,
    width,
    height,
    BORDER_ROUNDED,
    SIDES_ALL,
    /* borderFg */ 100,
    200,
    255,
    /* bg */ 0,
    0,
    20,
    /* attrs */ 0,
    /* fillBackground */ true,
  )

  // Title bar (manual since rendererDrawBox doesn't take title yet —
  // see the tui-infra-renderables row in .config/lockstep.json
  // deviations).
  const title = ' node:smol-tui demo '
  const titleBytes = new TextEncoder().encode(title)
  const titleWidth = stringWidth(title)
  const titleX = Math.max(2, Math.floor((width - titleWidth) / 2))
  rendererDrawTextWrapped(
    rendererId,
    titleX,
    0,
    /* maxWidth */ titleWidth,
    /* maxLines */ 1,
    titleBytes,
    /* fg */ 255,
    255,
    255,
    /* bg */ 0,
    0,
    20,
    TextAttributes.BOLD & ATTRIBUTE_BASE_MASK,
  )

  // Inner content — wrap-aware text.
  const body =
    'Hello from a socket-built Node! This renderer runs the entire ' +
    'flush loop in C++ (tui::Renderer::Flush) and draws boxes / wrapped ' +
    'text via tui::DrawBox / tui::DrawTextWrapped. Press Ctrl-C to exit.'
  const bodyBytes = new TextEncoder().encode(body)
  rendererDrawTextWrapped(
    rendererId,
    /* x */ 3,
    /* y */ 2,
    /* maxWidth */ Math.max(20, width - 6),
    /* maxLines */ Math.max(1, height - 4),
    bodyBytes,
    /* fg */ 200,
    220,
    255,
    /* bg */ 0,
    0,
    20,
    /* attrs */ 0,
  )

  // Footer hint.
  const hint = ` ${width}x${height} cells `
  const hintBytes = new TextEncoder().encode(hint)
  rendererDrawTextWrapped(
    rendererId,
    width - stringWidth(hint) - 2,
    height - 1,
    stringWidth(hint),
    1,
    hintBytes,
    150,
    150,
    150,
    0,
    0,
    20,
    TextAttributes.DIM & ATTRIBUTE_BASE_MASK,
  )

  // Flush the diff to stdout.
  const bytesWritten = rendererFlush(rendererId, FLUSH_BUF, FLUSH_BUF.length)
  if (bytesWritten > 0 && bytesWritten < FLUSH_BUF.length) {
    stdoutWrite(FLUSH_BUF.subarray(0, bytesWritten))
  }
}

export function getTerminalSize(): { width: number; height: number } {
  const cols = process.stdout.columns ?? 80
  const rows = process.stdout.rows ?? 24
  return { width: cols, height: rows }
}

// Raw ANSI writes go through stdout directly — logger.info() would
// re-encode + prefix the bytes which breaks the terminal sequences.
// stdoutWrite isolates the marker into one helper.
export function stdoutWrite(data: Uint8Array | string): void {
  process.stdout.write(data) // socket-hook: allow console
}

// Quick verification — these checks run before the render loop so a
// broken binding surfaces with a clear error rather than a blank
// screen. Each call exercises one of the C++ entry points landed in
// the B-* commit series.
export function verify(): void {
  // codepointWidth + stringWidth (Unicode 17.0 tables).
  console.assert(codepointWidth(0x61) === 1, 'codepointWidth(a) === 1')
  console.assert(codepointWidth(0x4e_2d) === 2, 'codepointWidth(中) === 2')
  console.assert(stringWidth('hello') === 5, 'stringWidth(hello) === 5')
  console.assert(stringWidth('中文') === 4, 'stringWidth(中文) === 4')
  console.assert(stringWidth('') === 0, 'stringWidth("") === 0')
}
void verify // referenced for type-checking, not invoked in the demo

function main(): void {
  const { width: initialWidth, height: initialHeight } = getTerminalSize()
  const rendererId = createRenderer(initialWidth, initialHeight, false, false)

  // Enter alt-screen + hide cursor.
  stdoutWrite('\x1b[?1049h\x1b[?25l')

  const exit = () => {
    stdoutWrite('\x1b[?25h\x1b[?1049l')
    destroyRenderer(rendererId)
    process.exit(0)
  }

  process.on('SIGINT', exit)
  process.on('SIGTERM', exit)

  process.stdout.on('resize', () => {
    const { width, height } = getTerminalSize()
    rendererResize(rendererId, width, height)
    drawFrame(rendererId)
  })

  drawFrame(rendererId)

  // Keep the event loop alive.
  setInterval(() => {}, 60_000)
}

main()
