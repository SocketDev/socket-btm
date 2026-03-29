import { afterEach, describe, expect, it } from 'vitest'

import {
  Buffer,
  EditBuffer,
  EditorView,
  RGBA,
  Renderer,
  SyntaxStyle,
  TextAttributes,
  TextBuffer,
  WidthMethod,
  WrapMode,
  native,
} from '../lib/index.mjs'

const white = new RGBA(1, 1, 1, 1)
const black = new RGBA(0, 0, 0, 1)
const red = RGBA.fromHex('#ff0000')

describe('Buffer (high-level)', () => {
  let buf

  afterEach(() => { buf?.destroy() })

  it('creates with dimensions', () => {
    buf = new Buffer(40, 10)
    expect(buf.width).toBe(40)
    expect(buf.height).toBe(10)
  })

  it('creates with options', () => {
    buf = new Buffer(20, 5, { id: 'test', widthMethod: WidthMethod.UNICODE })
    expect(buf.width).toBe(20)
  })

  it('clears with RGBA color', () => {
    buf = new Buffer(10, 5)
    buf.clear(black)
    buf.clear(red)
    buf.clear()
  })

  it('draws text with RGBA colors', () => {
    buf = new Buffer(40, 10)
    buf.clear(black)
    buf.drawText('Hello World', 0, 0, white, black)
    buf.drawText('Bold', 0, 1, red, black, TextAttributes.BOLD)
    buf.drawText('Default colors', 5, 5)
  })

  it('draws characters with RGBA colors', () => {
    buf = new Buffer(20, 5)
    buf.clear()
    buf.drawChar(65, 0, 0, white, black)
    buf.drawChar(66, 1, 0, red)
  })

  it('sets cells with RGBA colors', () => {
    buf = new Buffer(20, 5)
    buf.clear()
    buf.setCell(5, 2, 88, white, black, TextAttributes.UNDERLINE)
  })

  it('fills rect with RGBA color', () => {
    buf = new Buffer(20, 10)
    buf.clear()
    buf.fillRect(2, 1, 5, 3, red)
    buf.fillRect(0, 0, 20, 10)
  })

  it('manages scissor rects', () => {
    buf = new Buffer(40, 10)
    buf.pushScissorRect(5, 2, 10, 5)
    buf.drawText('Clipped', 0, 0, white)
    buf.popScissorRect()
    buf.clearScissorRects()
  })

  it('manages opacity', () => {
    buf = new Buffer(20, 5)
    expect(buf.opacity).toBeCloseTo(1)
    buf.pushOpacity(0.5)
    expect(buf.opacity).toBeCloseTo(0.5)
    buf.popOpacity()
    expect(buf.opacity).toBeCloseTo(1)
  })

  it('provides BufferView for direct memory access', () => {
    buf = new Buffer(10, 5)
    expect(buf.view).toBeDefined()
    expect(buf.view.width).toBe(10)
  })

  it('resizes and invalidates view', () => {
    buf = new Buffer(10, 5)
    buf.resize(20, 10)
    expect(buf.width).toBe(20)
    expect(buf.height).toBe(10)
  })
})

describe('TextBuffer (high-level)', () => {
  let tb

  afterEach(() => { tb?.destroy() })

  it('creates and appends text', () => {
    tb = new TextBuffer()
    tb.append('Hello')
    expect(tb.length).toBeGreaterThan(0)
    expect(tb.lineCount).toBe(1)
  })

  it('tracks multiple lines', () => {
    tb = new TextBuffer()
    tb.append('Line 1\nLine 2\nLine 3')
    expect(tb.lineCount).toBe(3)
  })

  it('clears and resets', () => {
    tb = new TextBuffer()
    tb.append('Content')
    tb.clear()
    expect(tb.length).toBe(0)
    tb.append('More')
    tb.reset()
    expect(tb.length).toBe(0)
  })

  it('manages default styling with RGBA', () => {
    tb = new TextBuffer()
    tb.setDefaultFg(red)
    tb.setDefaultBg(black)
    tb.setDefaultAttributes(TextAttributes.BOLD)
    tb.resetDefaults()
  })

  it('manages tab width', () => {
    tb = new TextBuffer()
    tb.tabWidth = 2
    expect(tb.tabWidth).toBe(2)
  })

  it('manages syntax highlighting', () => {
    tb = new TextBuffer()
    tb.append('Hello World')
    const style = new SyntaxStyle()
    const id = style.register('keyword', RGBA.fromHex('#0088ff'), undefined, TextAttributes.BOLD)
    tb.setSyntaxStyle(style)
    tb.addHighlight(0, 0, 5, id)
    tb.clearAllHighlights()
    style.destroy()
  })
})

describe('EditBuffer (high-level)', () => {
  let eb

  afterEach(() => { eb?.destroy() })

  it('creates and sets text', () => {
    eb = new EditBuffer()
    eb.text = 'Hello World'
    expect(eb.text).toContain('Hello World')
  })

  it('inserts text at cursor', () => {
    eb = new EditBuffer()
    eb.text = 'AC'
    eb.moveCursorRight()
    eb.insertText('B')
    expect(eb.text).toContain('AB')
  })

  it('reads cursor without allocation', () => {
    eb = new EditBuffer()
    eb.text = 'Test'
    eb.setCursor(0, 2)
    const cursor = eb.cursor
    expect(cursor.row).toBe(0)
    expect(cursor.col).toBe(2)
  })

  it('navigates cursor in all directions', () => {
    eb = new EditBuffer()
    eb.text = 'AB\nCD'
    eb.moveCursorRight()
    expect(eb.cursor.col).toBe(1)
    eb.moveCursorDown()
    expect(eb.cursor.row).toBe(1)
    eb.moveCursorLeft()
    eb.moveCursorUp()
    expect(eb.cursor.row).toBe(0)
  })

  it('supports undo/redo', () => {
    eb = new EditBuffer()
    eb.text = 'Original'
    expect(eb.canUndo).toBe(false)
    eb.insertText('X')
    expect(eb.canUndo).toBe(true)
    eb.undo()
    expect(eb.canRedo).toBe(true)
    eb.redo()
  })

  it('deletes text', () => {
    eb = new EditBuffer()
    eb.text = 'ABC'
    eb.deleteChar()
    eb.setCursor(0, 2)
    eb.deleteCharBackward()
  })

  it('manages lines', () => {
    eb = new EditBuffer()
    eb.text = 'Hello'
    eb.setCursor(0, 5)
    eb.newLine()
    expect(eb.text).toContain('\n')
  })

  it('gets text ranges', () => {
    eb = new EditBuffer()
    eb.text = 'ABCDEFGH'
    expect(eb.getTextRange(2, 5)).toBe('CDE')
    expect(eb.getTextRangeByCoords(0, 0, 0, 3)).toBe('ABC')
  })
})

describe('EditorView (high-level)', () => {
  let eb
  let view

  afterEach(() => {
    view?.destroy()
    eb?.destroy()
  })

  it('creates from EditBuffer instance', () => {
    eb = new EditBuffer()
    eb.text = 'Content\nMultiple lines'
    view = new EditorView(eb, 40, 10)
    expect(view.viewport).toBeDefined()
  })

  it('manages viewport', () => {
    eb = new EditBuffer()
    eb.text = 'Test'
    view = new EditorView(eb, 40, 10)
    view.setViewportSize(80, 20)
    expect(view.viewport.width).toBe(80)
  })

  it('wrapping increases line count', () => {
    eb = new EditBuffer()
    eb.text = 'A very long line that should wrap when viewport is narrow'
    view = new EditorView(eb, 10, 10)
    view.setWrapMode(WrapMode.CHAR)
    expect(view.virtualLineCount).toBeGreaterThan(1)
  })

  it('reads cursor without allocation', () => {
    eb = new EditBuffer()
    eb.text = 'Hello'
    view = new EditorView(eb, 40, 10)
    const cursor = view.cursor
    expect(typeof cursor.row).toBe('number')
    expect(typeof cursor.col).toBe('number')
  })

  it('manages selection with RGBA colors', () => {
    eb = new EditBuffer()
    eb.text = 'Select this text'
    view = new EditorView(eb, 40, 10)
    view.setSelection(0, 6, RGBA.fromHex('#3366ff'), white)
    view.resetSelection()
  })

  it('draws into Buffer', () => {
    eb = new EditBuffer()
    eb.text = 'Editor content'
    view = new EditorView(eb, 40, 10)
    const buf = new Buffer(40, 10)
    buf.clear(black)
    buf.drawEditorView(view, 0, 0)
    buf.destroy()
  })
})

describe('SyntaxStyle (high-level)', () => {
  let style

  afterEach(() => { style?.destroy() })

  it('registers with RGBA colors', () => {
    style = new SyntaxStyle()
    const id = style.register('keyword', RGBA.fromHex('#ff0000'), undefined, TextAttributes.BOLD)
    expect(typeof id).toBe('number')
    expect(style.styleCount).toBe(1)
  })

  it('resolves by name', () => {
    style = new SyntaxStyle()
    const id = style.register('comment', RGBA.fromHex('#888888'))
    expect(style.resolve('comment')).toBe(id)
  })
})

describe('Renderer (high-level)', () => {
  let renderer

  afterEach(() => { renderer?.destroy() })

  it('creates in test mode', () => {
    renderer = new Renderer(80, 24, { testing: true })
    expect(renderer.ptr).toBeDefined()
  })

  it('renders without error', () => {
    renderer = new Renderer(80, 24, { testing: true })
    renderer.render()
    renderer.render(true)
  })

  it('resizes', () => {
    renderer = new Renderer(80, 24, { testing: true })
    renderer.resize(120, 40)
  })

  it('manages cursor', () => {
    renderer = new Renderer(80, 24, { testing: true })
    renderer.setCursorPosition(10, 5)
    const state = renderer.cursorState
    expect(state).toBeDefined()
  })

  it('sets background with RGBA', () => {
    renderer = new Renderer(80, 24, { testing: true })
    renderer.setBackgroundColor(RGBA.fromHex('#1a1a2e'))
  })

  it('manages mouse', () => {
    renderer = new Renderer(80, 24, { testing: true })
    renderer.enableMouse()
    renderer.disableMouse()
  })

  it('manages hit grid', () => {
    renderer = new Renderer(80, 24, { testing: true })
    renderer.addToHitGrid(0, 0, 10, 5, 1)
    renderer.clearHitGrid()
  })

  it('writes string output', () => {
    renderer = new Renderer(80, 24, { testing: true })
    renderer.writeOut('hello')
  })

  it('writes binary output', { skip: typeof native.writeOutBinary !== 'function' }, () => {
    renderer = new Renderer(80, 24, { testing: true })
    renderer.writeOut(new Uint8Array([72, 101, 108, 108, 111]))
  })

  it('suspends and resumes', () => {
    renderer = new Renderer(80, 24, { testing: true })
    renderer.suspend()
    renderer.resume()
  })

  it('provides buffers', () => {
    renderer = new Renderer(80, 24, { testing: true })
    expect(renderer.nextBuffer).toBeDefined()
    expect(renderer.currentBuffer).toBeDefined()
  })
})

describe('end-to-end: render pipeline', () => {
  it('full render cycle with high-level API', () => {
    const renderer = new Renderer(80, 24, { testing: true })
    const bufPtr = renderer.nextBuffer
    const buf = new Buffer(80, 24)

    const style = new SyntaxStyle()
    style.register('keyword', RGBA.fromHex('#ff6600'), undefined, TextAttributes.BOLD)

    const eb = new EditBuffer()
    eb.text = 'function hello() {\n  return "world"\n}'
    const view = new EditorView(eb, 80, 20)

    buf.clear(RGBA.fromHex('#1a1a2e'))
    buf.drawText('Editor Demo', 2, 0, white, undefined, TextAttributes.BOLD)
    buf.drawEditorView(view, 0, 2)
    buf.fillRect(0, 22, 80, 2, RGBA.fromHex('#2a2a4e'))
    buf.drawText('Ln 1, Col 1', 2, 23, RGBA.fromHex('#888888'))

    renderer.render()

    view.destroy()
    eb.destroy()
    style.destroy()
    buf.destroy()
    renderer.destroy()
  })
})
