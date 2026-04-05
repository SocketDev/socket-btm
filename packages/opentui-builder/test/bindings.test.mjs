import { describe, expect, it } from 'vitest'

import { RGBA, TextAttributes, WidthMethod, WrapMode, native } from '../lib/index.mjs'

describe('opentui native module', () => {
  it('loads successfully', () => {
    expect(native).toBeDefined()
    expect(typeof native.createRenderer).toBe('function')
    expect(typeof native.createOptimizedBuffer).toBe('function')
    expect(typeof native.createTextBuffer).toBe('function')
    expect(typeof native.createEditBuffer).toBe('function')
  })

  it('exports system functions', () => {
    expect(typeof native.getArenaAllocatedBytes).toBe('function')
    const bytes = native.getArenaAllocatedBytes()
    expect(typeof bytes).toBe('number')
    expect(bytes).toBeGreaterThanOrEqual(0)
  })
})

describe('RGBA', () => {
  it('creates from floats', () => {
    const color = new RGBA(1, 0, 0.5, 0.8)
    expect(color.r).toBe(1)
    expect(color.g).toBe(0)
    expect(color.b).toBe(0.5)
    expect(color.a).toBeCloseTo(0.8)
  })

  it('defaults alpha to 1', () => {
    const color = new RGBA(0.5, 0.5, 0.5)
    expect(color.a).toBe(1)
  })

  it('creates from hex', () => {
    const color = RGBA.fromHex('#ff0000')
    expect(color.r).toBeCloseTo(1)
    expect(color.g).toBeCloseTo(0)
    expect(color.b).toBeCloseTo(0)
    expect(color.a).toBe(1)
  })

  it('creates from ints', () => {
    const color = RGBA.fromInts(255, 128, 0)
    expect(color.r).toBeCloseTo(1)
    expect(color.g).toBeCloseTo(128 / 255)
    expect(color.b).toBeCloseTo(0)
  })
})

describe('constants', () => {
  it('exports WidthMethod', () => {
    expect(WidthMethod.WCWIDTH).toBe(0)
    expect(WidthMethod.UNICODE).toBe(1)
  })

  it('exports WrapMode', () => {
    expect(WrapMode.NONE).toBe(0)
    expect(WrapMode.CHAR).toBe(1)
    expect(WrapMode.WORD).toBe(2)
  })

  it('exports TextAttributes', () => {
    expect(TextAttributes.NONE).toBe(0)
    expect(TextAttributes.BOLD).toBe(1)
    expect(TextAttributes.STRIKETHROUGH).toBe(128)
  })
})

describe('renderer', () => {
  it('creates and destroys in test mode', () => {
    const renderer = native.createRenderer(80, 24, true, false)
    expect(renderer).toBeDefined()
    native.destroyRenderer(renderer)
  })

  it('gets buffers from renderer', () => {
    const renderer = native.createRenderer(80, 24, true, false)
    const buffer = native.getNextBuffer(renderer)
    expect(buffer).toBeDefined()
    expect(native.getBufferWidth(buffer)).toBe(80)
    expect(native.getBufferHeight(buffer)).toBe(24)
    native.destroyRenderer(renderer)
  })
})

describe('optimized buffer', () => {
  it('creates and destroys standalone buffer', () => {
    const buffer = native.createOptimizedBuffer(40, 10, false, WidthMethod.WCWIDTH, 'test')
    expect(buffer).toBeDefined()
    expect(native.getBufferWidth(buffer)).toBe(40)
    expect(native.getBufferHeight(buffer)).toBe(10)
    expect(native.bufferGetId(buffer)).toBe('test')
    native.destroyOptimizedBuffer(buffer)
  })

  it('clears and fills buffer', () => {
    const buffer = native.createOptimizedBuffer(10, 5, false, WidthMethod.WCWIDTH, 'fill-test')
    native.bufferClear(buffer, 0, 0, 0, 1)
    native.bufferFillRect(buffer, 0, 0, 5, 3, 1, 0, 0, 1)
    native.destroyOptimizedBuffer(buffer)
  })

  it('draws text into buffer', () => {
    const buffer = native.createOptimizedBuffer(40, 10, false, WidthMethod.WCWIDTH, 'text-test')
    native.bufferClear(buffer, 0, 0, 0, 1)
    native.bufferDrawText(buffer, 'Hello', 0, 0, 1, 1, 1, 1, 0, 0, 0, 1, TextAttributes.NONE)
    native.destroyOptimizedBuffer(buffer)
  })

  it('manages scissor rects', () => {
    const buffer = native.createOptimizedBuffer(40, 10, false, WidthMethod.WCWIDTH, 'scissor-test')
    native.bufferPushScissorRect(buffer, 5, 5, 10, 5)
    native.bufferPopScissorRect(buffer)
    native.bufferClearScissorRects(buffer)
    native.destroyOptimizedBuffer(buffer)
  })

  it('manages opacity stack', () => {
    const buffer = native.createOptimizedBuffer(40, 10, false, WidthMethod.WCWIDTH, 'opacity-test')
    expect(native.bufferGetCurrentOpacity(buffer)).toBeCloseTo(1)
    native.bufferPushOpacity(buffer, 0.5)
    expect(native.bufferGetCurrentOpacity(buffer)).toBeCloseTo(0.5)
    native.bufferPopOpacity(buffer)
    expect(native.bufferGetCurrentOpacity(buffer)).toBeCloseTo(1)
    native.destroyOptimizedBuffer(buffer)
  })
})

describe('text buffer', () => {
  it('creates and appends text', () => {
    const tb = native.createTextBuffer(WidthMethod.WCWIDTH)
    expect(tb).toBeDefined()

    native.textBufferAppend(tb, 'Hello, World!')
    expect(native.textBufferGetLength(tb)).toBeGreaterThan(0)
    expect(native.textBufferGetLineCount(tb)).toBe(1)

    native.textBufferAppend(tb, '\nSecond line')
    expect(native.textBufferGetLineCount(tb)).toBe(2)

    native.destroyTextBuffer(tb)
  })

  it('clears and resets', () => {
    const tb = native.createTextBuffer(WidthMethod.WCWIDTH)
    native.textBufferAppend(tb, 'test data')
    expect(native.textBufferGetLength(tb)).toBeGreaterThan(0)

    native.textBufferClear(tb)
    expect(native.textBufferGetLength(tb)).toBe(0)

    native.destroyTextBuffer(tb)
  })

  it('manages tab width', () => {
    const tb = native.createTextBuffer(WidthMethod.WCWIDTH)
    expect(native.textBufferGetTabWidth(tb)).toBeGreaterThan(0)
    native.textBufferSetTabWidth(tb, 2)
    expect(native.textBufferGetTabWidth(tb)).toBe(2)
    native.destroyTextBuffer(tb)
  })
})

describe('edit buffer', () => {
  it('creates and sets text', () => {
    const eb = native.createEditBuffer(WidthMethod.WCWIDTH)
    expect(eb).toBeDefined()

    native.editBufferSetText(eb, 'Hello')
    const text = native.editBufferGetText(eb)
    expect(text).toContain('Hello')

    native.destroyEditBuffer(eb)
  })

  it('supports undo/redo cycle', () => {
    const eb = native.createEditBuffer(WidthMethod.WCWIDTH)
    native.editBufferSetText(eb, 'Original')
    native.editBufferInsertText(eb, 'X')
    expect(native.editBufferCanUndo(eb)).toBe(true)

    native.editBufferUndo(eb)
    expect(native.editBufferCanRedo(eb)).toBe(true)

    native.editBufferRedo(eb)

    native.destroyEditBuffer(eb)
  })

  it('tracks cursor position', () => {
    const eb = native.createEditBuffer(WidthMethod.WCWIDTH)
    native.editBufferSetText(eb, 'Line 1\nLine 2')

    const cursor = native.editBufferGetCursor(eb)
    expect(cursor).toBeDefined()
    expect(typeof cursor.row).toBe('number')
    expect(typeof cursor.col).toBe('number')

    native.destroyEditBuffer(eb)
  })
})

describe('editor view', () => {
  it('creates view from edit buffer', () => {
    const eb = native.createEditBuffer(WidthMethod.WCWIDTH)
    native.editBufferSetText(eb, 'Test content')

    const view = native.createEditorView(eb, 40, 10)
    expect(view).toBeDefined()

    const viewport = native.editorViewGetViewport(view)
    expect(viewport).toBeDefined()
    expect(typeof viewport.width).toBe('number')

    native.destroyEditorView(view)
    native.destroyEditBuffer(eb)
  })
})

describe('syntax style', () => {
  it('creates and registers styles', () => {
    const style = native.createSyntaxStyle()
    expect(style).toBeDefined()

    const id = native.syntaxStyleRegister(
      style,
      'keyword',
      0, 0.5, 1, 1,
      0, 0, 0, 0,
      TextAttributes.BOLD,
    )
    expect(typeof id).toBe('number')
    expect(native.syntaxStyleGetStyleCount(style)).toBeGreaterThan(0)

    const resolved = native.syntaxStyleResolveByName(style, 'keyword')
    expect(resolved).toBe(id)

    native.destroySyntaxStyle(style)
  })
})

describe('links', () => {
  it('allocates and retrieves links', () => {
    const linkId = native.linkAlloc('https://example.com')
    expect(typeof linkId).toBe('number')

    const url = native.linkGetUrl(linkId)
    expect(url).toBe('https://example.com')

    const attrs = native.attributesWithLink(TextAttributes.UNDERLINE, linkId)
    expect(native.attributesGetLinkId(attrs)).toBe(linkId)

    native.clearGlobalLinkPool()
  })
})
