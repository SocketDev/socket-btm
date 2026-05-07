#!/usr/bin/env node
/**
 * node:smol-markdown demo — render AI-style Markdown output to the
 * terminal using node:smol-tui as the renderer.
 *
 * Demonstrates the full Phase B integration: md4c parses input into
 * an event stream, the demo walks events and dispatches each into
 * node:smol-tui's DrawTextWrapped + DrawBox primitives.
 *
 * Run with socket-built node (see smol-tui-hello.mts for the binary
 * path).
 */
import {
  ATTRIBUTE_BASE_MASK,
  TextAttributes,
  createRenderer,
  destroyRenderer,
  rendererClear,
  rendererDrawBox,
  rendererDrawTextWrapped,
  rendererFlush,
  rendererSize,
  stringWidth,
} from 'node:smol-tui'

import {
  blockType,
  eventCategory,
  parseMarkdown,
  spanType,
  textType,
} from 'node:smol-markdown'

const FLUSH_BUF = new Uint8Array(256 * 1024)

const SAMPLE_MD = `# Hello from smol-markdown

This is a **CommonMark + GFM** Markdown parser implemented in C++ via
md4c, exposed as \`node:smol-markdown\` on socket-built Node.

## Features

- Native parsing (no JS regex engine)
- Full GFM dialect: tables, strikethrough, tasklists, autolinks
- Flat event stream — JS reconstructs the tree

## Example code

\`\`\`js
const events = parseMarkdown(text, 'github')
\`\`\`

That's the whole API.
`

const CATEGORY_MASK = 0xf0_00
const VALUE_MASK = 0x0f_ff

interface RenderState {
  y: number
  attrs: number
  fgR: number
  fgG: number
  fgB: number
  inHeading: boolean
  headingLevel: number
  rendererId: number
  width: number
}

export function processEvents(
  events: Array<[number, undefined | string | number]>,
  state: RenderState,
): void {
  let line = ''
  let lineAttrs = 0
  const flushLine = (): void => {
    if (!line) {
      return
    }
    const bytes = new TextEncoder().encode(line)
    rendererDrawTextWrapped(
      state.rendererId,
      /* x */ 2,
      /* y */ state.y,
      /* maxWidth */ Math.max(20, state.width - 4),
      /* maxLines */ 0,
      bytes,
      state.fgR,
      state.fgG,
      state.fgB,
      0,
      0,
      20,
      lineAttrs & ATTRIBUTE_BASE_MASK,
    )
    state.y += 1
    line = ''
    lineAttrs = 0
  }

  for (let i = 0, { length } = events; i < length; i += 1) {
    const [code, payload] = events[i]
    const cat = code & CATEGORY_MASK
    const val = code & VALUE_MASK

    if (cat === eventCategory.BLOCK_ENTER) {
      if (val === blockType.H) {
        flushLine()
        state.inHeading = true
        state.headingLevel = typeof payload === 'number' ? payload : 1
        state.fgR = state.headingLevel === 1 ? 255 : 200
        state.fgG = state.headingLevel === 1 ? 200 : 220
        state.fgB = 100
        lineAttrs = TextAttributes.BOLD
      } else if (val === blockType.CODE) {
        flushLine()
        state.fgR = 150
        state.fgG = 255
        state.fgB = 150
      } else if (val === blockType.LI) {
        flushLine()
        line = '  • '
      }
    } else if (cat === eventCategory.BLOCK_LEAVE) {
      flushLine()
      if (val === blockType.H) {
        state.inHeading = false
        state.fgR = 220
        state.fgG = 220
        state.fgB = 220
        state.y += 1  // blank line after heading
      } else if (val === blockType.CODE) {
        state.fgR = 220
        state.fgG = 220
        state.fgB = 220
        state.y += 1
      } else if (val === blockType.P) {
        state.y += 1
      }
    } else if (cat === eventCategory.SPAN_ENTER) {
      if (val === spanType.STRONG) {
        lineAttrs |= TextAttributes.BOLD
      } else if (val === spanType.EM) {
        lineAttrs |= TextAttributes.ITALIC
      } else if (val === spanType.CODE) {
        // Inline code: tint and keep going inline.
        state.fgR = 150
        state.fgG = 255
        state.fgB = 150
      }
    } else if (cat === eventCategory.SPAN_LEAVE) {
      if (val === spanType.STRONG) {
        lineAttrs &= ~TextAttributes.BOLD
      } else if (val === spanType.EM) {
        lineAttrs &= ~TextAttributes.ITALIC
      } else if (val === spanType.CODE) {
        state.fgR = state.inHeading ? 255 : 220
        state.fgG = state.inHeading ? 200 : 220
        state.fgB = state.inHeading ? 100 : 220
      }
    } else if (cat === eventCategory.TEXT) {
      if (typeof payload !== 'string') {
        continue
      }
      // Handle newlines inside text payloads (e.g. code blocks).
      if (val === textType.CODE && payload.includes('\n')) {
        const lines = payload.split('\n')
        for (let j = 0, { length: ll } = lines; j < ll; j += 1) {
          line += lines[j]
          if (j < ll - 1) {
            flushLine()
          }
        }
      } else {
        line += payload
      }
    }
  }
  flushLine()
}

function main(): void {
  const cols = process.stdout.columns ?? 80
  const rows = process.stdout.rows ?? 40
  const rendererId = createRenderer(cols, rows, false, false)
  stdoutWrite('\x1b[?1049h\x1b[?25l')

  const exit = (): void => {
    stdoutWrite('\x1b[?25h\x1b[?1049l')
    destroyRenderer(rendererId)
    process.exit(0)
  }
  process.on('SIGINT', exit)
  process.on('SIGTERM', exit)

  rendererClear(rendererId)
  const { width, height } = rendererSize(rendererId)

  // Frame.
  rendererDrawBox(
    rendererId,
    0,
    0,
    width,
    height,
    /* style */ 2,  // rounded
    /* sidesBits */ 0xf,
    100,
    200,
    255,
    0,
    0,
    20,
    0,
    true,
  )

  // Parse with GitHub dialect (tables + strikethrough + tasklists +
  // autolinks).
  const events = parseMarkdown(SAMPLE_MD, 'github')

  const state: RenderState = {
    y: 1,
    attrs: 0,
    fgR: 220,
    fgG: 220,
    fgB: 220,
    inHeading: false,
    headingLevel: 0,
    rendererId,
    width,
  }
  processEvents(events, state)

  const bytesWritten = rendererFlush(rendererId, FLUSH_BUF, FLUSH_BUF.length)
  if (bytesWritten > 0 && bytesWritten < FLUSH_BUF.length) {
    stdoutWrite(FLUSH_BUF.subarray(0, bytesWritten))
  }

  // Keep alive until Ctrl-C.
  setInterval(() => {}, 60_000)
}

export function stdoutWrite(data: Uint8Array | string): void {
  process.stdout.write(data) // socket-hook: allow console
}

main()
