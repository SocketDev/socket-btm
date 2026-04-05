import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  BufferView,
  CursorState,
  RGBA,
  TextAttributes,
  WidthMethod,
  WrapMode,
  encodeText,
  native,
} from '../lib/index.mjs'

// ── Module Loading ──

describe('opentui native module', () => {
  it('loads and exports all expected categories', () => {
    expect(native).toBeDefined()
    // Renderer
    expect(typeof native.createRenderer).toBe('function')
    expect(typeof native.destroyRenderer).toBe('function')
    expect(typeof native.render).toBe('function')
    // Buffer
    expect(typeof native.createOptimizedBuffer).toBe('function')
    expect(typeof native.bufferClear).toBe('function')
    expect(typeof native.bufferDrawText).toBe('function')
    // TextBuffer
    expect(typeof native.createTextBuffer).toBe('function')
    expect(typeof native.textBufferAppend).toBe('function')
    // EditBuffer
    expect(typeof native.createEditBuffer).toBe('function')
    expect(typeof native.editBufferUndo).toBe('function')
    // EditorView
    expect(typeof native.createEditorView).toBe('function')
    // SyntaxStyle
    expect(typeof native.createSyntaxStyle).toBe('function')
    // Links
    expect(typeof native.linkAlloc).toBe('function')
    // HitGrid
    expect(typeof native.addToHitGrid).toBe('function')
    expect(typeof native.checkHit).toBe('function')
    // NativeSpanFeed
    expect(typeof native.createNativeSpanFeed).toBe('function')
  })

  it('reports arena allocated bytes', () => {
    const bytes = native.getArenaAllocatedBytes()
    expect(typeof bytes).toBe('number')
    expect(bytes).toBeGreaterThanOrEqual(0)
  })
})

// ── RGBA Helper ──

describe('RGBA', () => {
  it('creates from float components', () => {
    const color = new RGBA(1, 0, 0.5, 0.8)
    expect(color.r).toBe(1)
    expect(color.g).toBe(0)
    expect(color.b).toBeCloseTo(0.5)
    expect(color.a).toBeCloseTo(0.8)
  })

  it('defaults alpha to 1', () => {
    const color = new RGBA(0.5, 0.5, 0.5)
    expect(color.a).toBe(1)
  })

  it('backed by Float32Array', () => {
    const color = new RGBA(0.1, 0.2, 0.3, 0.4)
    expect(color.buffer).toBeInstanceOf(Float32Array)
    expect(color.buffer.length).toBe(4)
  })

  it('creates from hex #RRGGBB', () => {
    const color = RGBA.fromHex('#ff0000')
    expect(color.r).toBeCloseTo(1)
    expect(color.g).toBeCloseTo(0)
    expect(color.b).toBeCloseTo(0)
    expect(color.a).toBe(1)
  })

  it('creates from hex #RGB shorthand', () => {
    const color = RGBA.fromHex('#f00')
    expect(color.r).toBeCloseTo(1)
    expect(color.g).toBeCloseTo(0)
    expect(color.b).toBeCloseTo(0)
  })

  it('creates from hex #RRGGBBAA', () => {
    const color = RGBA.fromHex('#ff000080')
    expect(color.r).toBeCloseTo(1)
    expect(color.a).toBeCloseTo(128 / 255)
  })

  it('creates from ints (0-255)', () => {
    const color = RGBA.fromInts(255, 128, 0, 255)
    expect(color.r).toBeCloseTo(1)
    expect(color.g).toBeCloseTo(128 / 255)
    expect(color.b).toBeCloseTo(0)
    expect(color.a).toBeCloseTo(1)
  })

  it('creates from Float32Array', () => {
    const arr = new Float32Array([0.1, 0.2, 0.3, 0.4])
    const color = RGBA.fromArray(arr)
    expect(color.r).toBeCloseTo(0.1)
    expect(color.buffer).toBe(arr)
  })

  it('converts to ints', () => {
    const color = new RGBA(1, 0, 0.5, 1)
    const ints = color.toInts()
    expect(ints[0]).toBe(255)
    expect(ints[1]).toBe(0)
    expect(ints[2]).toBe(128)
    expect(ints[3]).toBe(255)
  })

  it('converts to hex', () => {
    const color = RGBA.fromInts(255, 0, 0)
    expect(color.toHex()).toBe('#ff0000')
  })

  it('includes alpha in hex when not 1', () => {
    const color = new RGBA(1, 0, 0, 0.5)
    const hex = color.toHex()
    expect(hex).toMatch(/^#ff0000[0-9a-f]{2}$/)
  })

  it('tests equality', () => {
    const a = new RGBA(1, 0, 0, 1)
    const b = new RGBA(1, 0, 0, 1)
    const c = new RGBA(0, 1, 0, 1)
    expect(a.equals(b)).toBe(true)
    expect(a.equals(c)).toBe(false)
    expect(a.equals(undefined)).toBe(false)
  })

  it('toString produces readable output', () => {
    const color = new RGBA(1, 0, 0, 1)
    expect(color.toString()).toContain('rgba(')
    expect(color.toString()).toContain('1.00')
  })
})

// ── Constants ──

describe('constants', () => {
  it('WidthMethod values', () => {
    expect(WidthMethod.WCWIDTH).toBe(0)
    expect(WidthMethod.UNICODE).toBe(1)
  })

  it('WrapMode values', () => {
    expect(WrapMode.NONE).toBe(0)
    expect(WrapMode.CHAR).toBe(1)
    expect(WrapMode.WORD).toBe(2)
  })

  it('TextAttributes are power-of-2 bitmask', () => {
    expect(TextAttributes.NONE).toBe(0)
    expect(TextAttributes.BOLD).toBe(1)
    expect(TextAttributes.DIM).toBe(2)
    expect(TextAttributes.ITALIC).toBe(4)
    expect(TextAttributes.UNDERLINE).toBe(8)
    expect(TextAttributes.BLINK).toBe(16)
    expect(TextAttributes.INVERSE).toBe(32)
    expect(TextAttributes.HIDDEN).toBe(64)
    expect(TextAttributes.STRIKETHROUGH).toBe(128)
  })

  it('TextAttributes can be combined as bitmask', () => {
    const boldItalic = TextAttributes.BOLD | TextAttributes.ITALIC
    expect(boldItalic).toBe(5)
    expect(boldItalic & TextAttributes.BOLD).toBeTruthy()
    expect(boldItalic & TextAttributes.ITALIC).toBeTruthy()
    expect(boldItalic & TextAttributes.UNDERLINE).toBeFalsy()
  })
})

// ── Renderer ──

describe('renderer', () => {
  let renderer

  afterEach(() => {
    if (renderer) {
      native.destroyRenderer(renderer)
      renderer = undefined
    }
  })

  it('creates in test mode', () => {
    renderer = native.createRenderer(80, 24, true, false)
    expect(renderer).toBeDefined()
  })

  it('provides next and current buffers', () => {
    renderer = native.createRenderer(80, 24, true, false)
    const next = native.getNextBuffer(renderer)
    const current = native.getCurrentBuffer(renderer)
    expect(next).toBeDefined()
    expect(current).toBeDefined()
  })

  it('buffers match renderer dimensions', () => {
    renderer = native.createRenderer(120, 40, true, false)
    const buffer = native.getNextBuffer(renderer)
    expect(native.getBufferWidth(buffer)).toBe(120)
    expect(native.getBufferHeight(buffer)).toBe(40)
  })

  it('resizes renderer and buffers', () => {
    renderer = native.createRenderer(80, 24, true, false)
    native.resizeRenderer(renderer, 100, 30)
    const buffer = native.getNextBuffer(renderer)
    expect(native.getBufferWidth(buffer)).toBe(100)
    expect(native.getBufferHeight(buffer)).toBe(30)
  })

  it('renders without error', () => {
    renderer = native.createRenderer(80, 24, true, false)
    native.render(renderer, false)
    native.render(renderer, true)
  })

  it('manages cursor position', () => {
    renderer = native.createRenderer(80, 24, true, false)
    native.setCursorPosition(renderer, 10, 5, true)
    const state = native.getCursorState(renderer)
    expect(state).toBeDefined()
    expect(typeof state.x).toBe('number')
    expect(typeof state.y).toBe('number')
    expect(typeof state.visible).toBe('boolean')
  })

  it('sets background color', () => {
    renderer = native.createRenderer(80, 24, true, false)
    native.setBackgroundColor(renderer, 0.1, 0.2, 0.3, 1)
  })

  it('manages debug overlay', () => {
    renderer = native.createRenderer(80, 24, true, false)
    native.setDebugOverlay(renderer, true, 0)
    native.setDebugOverlay(renderer, false, 0)
  })

  it('suspends and resumes', () => {
    renderer = native.createRenderer(80, 24, true, false)
    native.suspendRenderer(renderer)
    native.resumeRenderer(renderer)
  })
})

// ── Optimized Buffer ──

describe('optimized buffer', () => {
  let buffer

  afterEach(() => {
    if (buffer) {
      native.destroyOptimizedBuffer(buffer)
      buffer = undefined
    }
  })

  it('creates with dimensions and id', () => {
    buffer = native.createOptimizedBuffer(40, 10, false, WidthMethod.WCWIDTH, 'test')
    expect(native.getBufferWidth(buffer)).toBe(40)
    expect(native.getBufferHeight(buffer)).toBe(10)
    expect(native.bufferGetId(buffer)).toBe('test')
  })

  it('clears to background color', () => {
    buffer = native.createOptimizedBuffer(20, 5, false, WidthMethod.WCWIDTH, 'clear-test')
    native.bufferClear(buffer, 0, 0, 0, 1)
  })

  it('resizes buffer', () => {
    buffer = native.createOptimizedBuffer(20, 5, false, WidthMethod.WCWIDTH, 'resize-test')
    native.bufferResize(buffer, 40, 10)
    expect(native.getBufferWidth(buffer)).toBe(40)
    expect(native.getBufferHeight(buffer)).toBe(10)
  })

  it('draws text at position', () => {
    buffer = native.createOptimizedBuffer(40, 10, false, WidthMethod.WCWIDTH, 'text-test')
    native.bufferClear(buffer, 0, 0, 0, 1)
    // White text on black background
    native.bufferDrawText(buffer, 'Hello World', 0, 0, 1, 1, 1, 1, 0, 0, 0, 1, TextAttributes.NONE)
    // Bold red text
    native.bufferDrawText(buffer, 'Bold Red', 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, TextAttributes.BOLD)
  })

  it('draws individual characters', () => {
    buffer = native.createOptimizedBuffer(20, 5, false, WidthMethod.WCWIDTH, 'char-test')
    native.bufferClear(buffer, 0, 0, 0, 1)
    // Draw 'A' (char code 65)
    native.bufferDrawChar(buffer, 65, 0, 0, 1, 1, 1, 1, 0, 0, 0, 1, TextAttributes.NONE)
    // Draw 'B' with underline
    native.bufferDrawChar(buffer, 66, 1, 0, 1, 1, 1, 1, 0, 0, 0, 1, TextAttributes.UNDERLINE)
  })

  it('sets individual cells', () => {
    buffer = native.createOptimizedBuffer(20, 5, false, WidthMethod.WCWIDTH, 'cell-test')
    native.bufferClear(buffer, 0, 0, 0, 1)
    native.bufferSetCell(buffer, 5, 2, 88, 1, 0, 0, 1, 0, 0, 0, 1, TextAttributes.NONE)
  })

  it('fills rectangular regions', () => {
    buffer = native.createOptimizedBuffer(20, 10, false, WidthMethod.WCWIDTH, 'fill-test')
    native.bufferClear(buffer, 0, 0, 0, 1)
    // Fill a 5x3 region at (2,1) with red background
    native.bufferFillRect(buffer, 2, 1, 5, 3, 1, 0, 0, 1)
    // Fill entire buffer with blue
    native.bufferFillRect(buffer, 0, 0, 20, 10, 0, 0, 1, 1)
  })

  it('manages scissor rect stack', () => {
    buffer = native.createOptimizedBuffer(40, 10, false, WidthMethod.WCWIDTH, 'scissor-test')
    native.bufferPushScissorRect(buffer, 5, 2, 10, 5)
    // Drawing outside the scissor rect should be clipped
    native.bufferDrawText(buffer, 'Clipped', 0, 0, 1, 1, 1, 1, 0, 0, 0, 1, TextAttributes.NONE)
    native.bufferPopScissorRect(buffer)
    // Nested scissor rects
    native.bufferPushScissorRect(buffer, 0, 0, 20, 5)
    native.bufferPushScissorRect(buffer, 5, 1, 10, 3)
    native.bufferPopScissorRect(buffer)
    native.bufferPopScissorRect(buffer)
    native.bufferClearScissorRects(buffer)
  })

  it('manages opacity stack', () => {
    buffer = native.createOptimizedBuffer(20, 5, false, WidthMethod.WCWIDTH, 'opacity-test')
    expect(native.bufferGetCurrentOpacity(buffer)).toBeCloseTo(1)

    native.bufferPushOpacity(buffer, 0.5)
    expect(native.bufferGetCurrentOpacity(buffer)).toBeCloseTo(0.5)

    // Nested opacity multiplies
    native.bufferPushOpacity(buffer, 0.5)
    expect(native.bufferGetCurrentOpacity(buffer)).toBeCloseTo(0.25)

    native.bufferPopOpacity(buffer)
    expect(native.bufferGetCurrentOpacity(buffer)).toBeCloseTo(0.5)

    native.bufferPopOpacity(buffer)
    expect(native.bufferGetCurrentOpacity(buffer)).toBeCloseTo(1)
  })

  it('clears opacity stack', () => {
    buffer = native.createOptimizedBuffer(20, 5, false, WidthMethod.WCWIDTH, 'opacity-clear-test')
    native.bufferPushOpacity(buffer, 0.5)
    native.bufferPushOpacity(buffer, 0.3)
    native.bufferClearOpacity(buffer)
    expect(native.bufferGetCurrentOpacity(buffer)).toBeCloseTo(1)
  })

  it('exposes raw buffer data pointers', () => {
    buffer = native.createOptimizedBuffer(10, 5, false, WidthMethod.WCWIDTH, 'ptr-test')
    const charPtr = native.bufferGetCharPtr(buffer)
    const fgPtr = native.bufferGetFgPtr(buffer)
    const bgPtr = native.bufferGetBgPtr(buffer)
    const attrPtr = native.bufferGetAttributesPtr(buffer)
    expect(charPtr).toBeDefined()
    expect(fgPtr).toBeDefined()
    expect(bgPtr).toBeDefined()
    expect(attrPtr).toBeDefined()
  })

  it('manages alpha blending mode', () => {
    buffer = native.createOptimizedBuffer(10, 5, false, WidthMethod.WCWIDTH, 'alpha-test')
    expect(native.bufferGetRespectAlpha(buffer)).toBe(false)
    native.bufferSetRespectAlpha(buffer, true)
    expect(native.bufferGetRespectAlpha(buffer)).toBe(true)
  })

  it('has bufferDrawBox function', () => {
    expect(typeof native.bufferDrawBox).toBe('function')
  })

  it('composites frame buffer onto target', () => {
    buffer = native.createOptimizedBuffer(40, 20, false, WidthMethod.WCWIDTH, 'composite-target')
    const source = native.createOptimizedBuffer(10, 5, false, WidthMethod.WCWIDTH, 'composite-source')
    native.bufferClear(source, 1, 0, 0, 1)
    native.bufferDrawText(source, 'src', 0, 0, 1, 1, 1, 1, 0, 0, 0, 1, TextAttributes.NONE)

    native.drawFrameBuffer(buffer, 5, 5, source, 0, 0, 10, 5)
    native.destroyOptimizedBuffer(source)
  })

  it('has bufferDrawGrayscaleBuffer function', () => {
    expect(typeof native.bufferDrawGrayscaleBuffer).toBe('function')
  })
})

// ── Text Buffer ──

describe('text buffer', () => {
  let tb

  beforeEach(() => {
    tb = native.createTextBuffer(WidthMethod.WCWIDTH)
  })

  afterEach(() => {
    native.destroyTextBuffer(tb)
  })

  it('starts with one empty line', () => {
    expect(native.textBufferGetLength(tb)).toBe(0)
    expect(native.textBufferGetByteSize(tb)).toBe(0)
    expect(native.textBufferGetLineCount(tb)).toBe(1)
  })

  it('appends text and tracks length', () => {
    native.textBufferAppend(tb, 'Hello')
    expect(native.textBufferGetLength(tb)).toBeGreaterThan(0)
    expect(native.textBufferGetLineCount(tb)).toBe(1)
  })

  it('tracks multi-line content', () => {
    native.textBufferAppend(tb, 'Line 1\nLine 2\nLine 3')
    expect(native.textBufferGetLineCount(tb)).toBe(3)
  })

  it('appends incrementally', () => {
    native.textBufferAppend(tb, 'First')
    native.textBufferAppend(tb, '\nSecond')
    native.textBufferAppend(tb, '\nThird')
    expect(native.textBufferGetLineCount(tb)).toBe(3)
  })

  it('clears buffer', () => {
    native.textBufferAppend(tb, 'Some content\nMultiple lines')
    expect(native.textBufferGetLength(tb)).toBeGreaterThan(0)

    native.textBufferClear(tb)
    expect(native.textBufferGetLength(tb)).toBe(0)
    expect(native.textBufferGetLineCount(tb)).toBe(1)
  })

  it('resets buffer', () => {
    native.textBufferAppend(tb, 'Content')
    native.textBufferReset(tb)
    expect(native.textBufferGetLength(tb)).toBe(0)
  })

  it('manages default foreground color', () => {
    native.textBufferSetDefaultFg(tb, 1, 0, 0, 1)
    native.textBufferResetDefaults(tb)
  })

  it('manages default background color', () => {
    native.textBufferSetDefaultBg(tb, 0, 0, 1, 1)
    native.textBufferResetDefaults(tb)
  })

  it('manages default attributes', () => {
    native.textBufferSetDefaultAttributes(tb, TextAttributes.BOLD | TextAttributes.ITALIC)
    native.textBufferResetDefaults(tb)
  })

  it('manages tab width', () => {
    const defaultTab = native.textBufferGetTabWidth(tb)
    expect(defaultTab).toBeGreaterThan(0)

    native.textBufferSetTabWidth(tb, 2)
    expect(native.textBufferGetTabWidth(tb)).toBe(2)

    native.textBufferSetTabWidth(tb, 8)
    expect(native.textBufferGetTabWidth(tb)).toBe(8)
  })

  it('reports byte size distinct from char length', () => {
    native.textBufferAppend(tb, 'Hello')
    const charLen = native.textBufferGetLength(tb)
    const byteSize = native.textBufferGetByteSize(tb)
    expect(byteSize).toBeGreaterThanOrEqual(charLen)
  })

  it('manages highlights', () => {
    native.textBufferAppend(tb, 'Hello World')
    const style = native.createSyntaxStyle()
    const styleId = native.syntaxStyleRegister(style, 'keyword', 0, 0.5, 1, 1, 0, 0, 0, 0, TextAttributes.BOLD)
    native.textBufferSetSyntaxStyle(tb, style)

    native.textBufferAddHighlight(tb, 0, 0, 5, styleId, 0, 1)
    expect(native.textBufferGetHighlightCount(tb)).toBeGreaterThan(0)

    native.textBufferRemoveHighlightsByRef(tb, 1)
    native.textBufferClearAllHighlights(tb)

    native.destroySyntaxStyle(style)
  })

  it('loads file content', () => {
    native.textBufferLoadFile(tb, '/dev/null')
    expect(native.textBufferGetLength(tb)).toBe(0)
  })

  it('manages memory buffers', () => {
    const memId = native.textBufferRegisterMemBuffer(tb, 'buffered text', false)
    expect(memId).toBeDefined()
    native.textBufferClearMemRegistry(tb)
  })
})

// ── Text Buffer View ──

describe('text buffer view', () => {
  let tb
  let view

  beforeEach(() => {
    tb = native.createTextBuffer(WidthMethod.WCWIDTH)
    native.textBufferAppend(tb, 'Line 1 content here\nLine 2 has more text\nLine 3 short')
    view = native.createTextBufferView(tb)
  })

  afterEach(() => {
    native.destroyTextBufferView(view)
    native.destroyTextBuffer(tb)
  })

  it('creates from text buffer', () => {
    expect(view).toBeDefined()
  })

  it('sets viewport dimensions', () => {
    native.textBufferViewSetViewportSize(view, 40, 10)
  })

  it('sets viewport position', () => {
    native.textBufferViewSetViewport(view, 0, 0, 40, 10)
  })

  it('wraps text by character', () => {
    native.textBufferViewSetWrapWidth(view, 10)
    native.textBufferViewSetWrapMode(view, WrapMode.CHAR)
    const virtualLines = native.textBufferViewGetVirtualLineCount(view)
    expect(virtualLines).toBeGreaterThan(3)
  })

  it('wraps text by word', () => {
    native.textBufferViewSetWrapWidth(view, 10)
    native.textBufferViewSetWrapMode(view, WrapMode.WORD)
    const virtualLines = native.textBufferViewGetVirtualLineCount(view)
    expect(virtualLines).toBeGreaterThan(3)
  })

  it('no wrapping when mode is none', () => {
    native.textBufferViewSetWrapMode(view, WrapMode.NONE)
    const virtualLines = native.textBufferViewGetVirtualLineCount(view)
    expect(virtualLines).toBe(3)
  })

  it('provides line info', () => {
    native.textBufferViewSetWrapWidth(view, 40)
    native.textBufferViewSetWrapMode(view, WrapMode.CHAR)
    const info = native.textBufferViewGetLineInfoDirect(view)
    expect(info).toBeDefined()
  })

  it('manages selection', () => {
    native.textBufferViewSetSelection(view, 0, 5, 0.2, 0.3, 0.8, 0.5, 1, 1, 1, 1)
    const selection = native.textBufferViewGetSelectionInfo(view)
    expect(selection).toBeDefined()

    native.textBufferViewResetSelection(view)
  })

  it('gets selected text', () => {
    native.textBufferViewSetSelection(view, 0, 6, 0.2, 0.3, 0.8, 0.5, 1, 1, 1, 1)
    const text = native.textBufferViewGetSelectedText(view)
    expect(typeof text).toBe('string')
    native.textBufferViewResetSelection(view)
  })

  it('gets plain text', () => {
    const text = native.textBufferViewGetPlainText(view)
    expect(typeof text).toBe('string')
  })

  it('sets truncation mode', () => {
    native.textBufferViewSetTruncate(view, true)
    native.textBufferViewSetTruncate(view, false)
  })

  it('measures for dimensions', () => {
    const result = native.textBufferViewMeasureForDimensions(view, 40, 10)
    expect(result).toBeDefined()
  })

  it('manages tab indicator', () => {
    native.textBufferViewSetTabIndicator(view, 0x2192)
    native.textBufferViewSetTabIndicatorColor(view, 0.5, 0.5, 0.5, 0.3)
  })
})

// ── Edit Buffer ──

describe('edit buffer', () => {
  let eb

  beforeEach(() => {
    eb = native.createEditBuffer(WidthMethod.WCWIDTH)
  })

  afterEach(() => {
    native.destroyEditBuffer(eb)
  })

  it('starts empty', () => {
    const text = native.editBufferGetText(eb)
    expect(text).toBe('')
  })

  it('sets and gets text', () => {
    native.editBufferSetText(eb, 'Hello World')
    expect(native.editBufferGetText(eb)).toContain('Hello World')
  })

  it('cursor starts at origin after setText', () => {
    native.editBufferSetText(eb, 'ABC')
    const cursor = native.editBufferGetCursor(eb)
    expect(cursor.row).toBe(0)
    expect(cursor.col).toBe(0)
  })

  it('inserts text at cursor position', () => {
    native.editBufferSetText(eb, 'AC')
    native.editBufferMoveCursorRight(eb)
    native.editBufferInsertText(eb, 'B')
    expect(native.editBufferGetText(eb)).toContain('AB')
  })

  it('inserts characters at cursor', () => {
    native.editBufferSetText(eb, '')
    native.editBufferInsertText(eb, 'A')
    native.editBufferInsertText(eb, 'B')
    const text = native.editBufferGetText(eb)
    expect(text).toContain('A')
    expect(text).toContain('B')
  })

  it('moves cursor in all directions', () => {
    native.editBufferSetText(eb, 'AB\nCD')

    native.editBufferMoveCursorRight(eb)
    expect(native.editBufferGetCursor(eb).col).toBe(1)

    native.editBufferMoveCursorDown(eb)
    expect(native.editBufferGetCursor(eb).row).toBe(1)

    native.editBufferMoveCursorLeft(eb)
    expect(native.editBufferGetCursor(eb).col).toBe(0)

    native.editBufferMoveCursorUp(eb)
    expect(native.editBufferGetCursor(eb).row).toBe(0)
  })

  it('sets cursor position explicitly', () => {
    native.editBufferSetText(eb, 'Line 1\nLine 2\nLine 3')
    native.editBufferSetCursor(eb, 2, 3)
    const cursor = native.editBufferGetCursor(eb)
    expect(cursor.row).toBe(2)
    expect(cursor.col).toBe(3)
  })

  it('navigates to specific line', () => {
    native.editBufferSetText(eb, 'Line 0\nLine 1\nLine 2')
    native.editBufferGotoLine(eb, 2)
    expect(native.editBufferGetCursor(eb).row).toBe(2)
  })

  it('sets cursor by byte offset', () => {
    native.editBufferSetText(eb, 'ABCDE')
    native.editBufferSetCursorByOffset(eb, 3)
    const cursor = native.editBufferGetCursor(eb)
    expect(cursor.col).toBe(3)
  })

  it('deletes character forward', () => {
    native.editBufferSetText(eb, 'ABC')
    native.editBufferDeleteChar(eb)
    const text = native.editBufferGetText(eb)
    expect(text.length).toBeLessThan(3)
  })

  it('deletes character backward', () => {
    native.editBufferSetText(eb, 'ABC')
    native.editBufferSetCursor(eb, 0, 3)
    native.editBufferDeleteCharBackward(eb)
    const text = native.editBufferGetText(eb)
    expect(text).not.toContain('C')
  })

  it('deletes range', () => {
    native.editBufferSetText(eb, 'Hello World')
    native.editBufferDeleteRange(eb, 0, 5, 0, 11)
    const text = native.editBufferGetText(eb)
    expect(text).toContain('Hello')
    expect(text).not.toContain('World')
  })

  it('inserts and deletes lines', () => {
    native.editBufferSetText(eb, 'Line 1')
    native.editBufferSetCursor(eb, 0, 6)
    native.editBufferNewLine(eb)
    const text = native.editBufferGetText(eb)
    expect(text).toContain('\n')
  })

  it('deletes entire line', () => {
    native.editBufferSetText(eb, 'Line 1\nLine 2\nLine 3')
    native.editBufferSetCursor(eb, 1, 0)
    native.editBufferDeleteLine(eb)
    const text = native.editBufferGetText(eb)
    expect(text).not.toContain('Line 2')
  })

  it('supports undo', () => {
    native.editBufferSetText(eb, 'Original')
    expect(native.editBufferCanUndo(eb)).toBe(false)

    native.editBufferInsertText(eb, 'X')
    expect(native.editBufferCanUndo(eb)).toBe(true)

    native.editBufferUndo(eb)
    expect(native.editBufferGetText(eb)).not.toContain('X')
  })

  it('supports redo', () => {
    native.editBufferSetText(eb, 'Original')
    native.editBufferInsertText(eb, 'X')
    native.editBufferUndo(eb)
    expect(native.editBufferCanRedo(eb)).toBe(true)

    native.editBufferRedo(eb)
    expect(native.editBufferGetText(eb)).toContain('X')
  })

  it('clears undo history', () => {
    native.editBufferSetText(eb, 'Text')
    native.editBufferInsertText(eb, 'Z')
    native.editBufferClearHistory(eb)
    expect(native.editBufferCanUndo(eb)).toBe(false)
  })

  it('converts between offset and position', () => {
    native.editBufferSetText(eb, 'Line 0\nLine 1')
    const pos = native.editBufferOffsetToPosition(eb, 7)
    expect(pos.row).toBe(1)
    expect(pos.col).toBe(0)

    const offset = native.editBufferPositionToOffset(eb, 1, 0)
    expect(offset).toBe(7)
  })

  it('gets line start offset', () => {
    native.editBufferSetText(eb, 'AAA\nBBB\nCCC')
    const offset = native.editBufferGetLineStartOffset(eb, 1)
    expect(offset).toBe(4)
  })

  it('finds word boundaries', () => {
    native.editBufferSetText(eb, 'hello world')
    native.editBufferSetCursor(eb, 0, 0)
    const next = native.editBufferGetNextWordBoundary(eb)
    expect(next).toBeDefined()
  })

  it('gets end of line', () => {
    native.editBufferSetText(eb, 'Hello')
    native.editBufferSetCursor(eb, 0, 0)
    const eol = native.editBufferGetEOL(eb)
    expect(eol).toBeDefined()
  })

  it('gets text range by offsets', () => {
    native.editBufferSetText(eb, 'ABCDEFGH')
    const text = native.editBufferGetTextRange(eb, 2, 5)
    expect(text).toBe('CDE')
  })

  it('gets text range by coordinates', () => {
    native.editBufferSetText(eb, 'Hello\nWorld')
    const text = native.editBufferGetTextRangeByCoords(eb, 0, 0, 0, 5)
    expect(text).toBe('Hello')
  })

  it('has unique id', () => {
    const id = native.editBufferGetId(eb)
    expect(id).toBeDefined()
  })

  it('exposes underlying text buffer', () => {
    const textBuf = native.editBufferGetTextBuffer(eb)
    expect(textBuf).toBeDefined()
  })

  it('clears content', () => {
    native.editBufferSetText(eb, 'Content')
    native.editBufferClear(eb)
    expect(native.editBufferGetText(eb)).toBe('')
  })

  it('gets cursor position with offset', () => {
    native.editBufferSetText(eb, 'ABCDE')
    native.editBufferSetCursor(eb, 0, 3)
    const pos = native.editBufferGetCursorPosition(eb)
    expect(pos.row).toBe(0)
    expect(pos.col).toBe(3)
    expect(typeof pos.offset).toBe('number')
  })
})

// ── Editor View ──

describe('editor view', () => {
  let eb
  let view

  beforeEach(() => {
    eb = native.createEditBuffer(WidthMethod.WCWIDTH)
    native.editBufferSetText(eb, 'Line 1 content\nLine 2 has more text\nLine 3 short\nLine 4\nLine 5')
    view = native.createEditorView(eb, 40, 10)
  })

  afterEach(() => {
    native.destroyEditorView(view)
    native.destroyEditBuffer(eb)
  })

  it('creates with dimensions', () => {
    expect(view).toBeDefined()
    const viewport = native.editorViewGetViewport(view)
    expect(viewport).toBeDefined()
    expect(typeof viewport.width).toBe('number')
    expect(typeof viewport.height).toBe('number')
  })

  it('resizes viewport', () => {
    native.editorViewSetViewportSize(view, 80, 20)
    const viewport = native.editorViewGetViewport(view)
    expect(viewport.width).toBe(80)
    expect(viewport.height).toBe(20)
  })

  it('sets viewport position', () => {
    native.editorViewSetViewport(view, 0, 2, 40, 5, false)
    const viewport = native.editorViewGetViewport(view)
    expect(viewport.y).toBe(2)
  })

  it('clears viewport', () => {
    native.editorViewSetViewport(view, 0, 2, 40, 5, false)
    native.editorViewClearViewport(view)
  })

  it('sets scroll margin', () => {
    native.editorViewSetScrollMargin(view, 3)
  })

  it('reports virtual line count', () => {
    const count = native.editorViewGetVirtualLineCount(view)
    expect(count).toBeGreaterThanOrEqual(5)
  })

  it('reports total virtual line count', () => {
    const count = native.editorViewGetTotalVirtualLineCount(view)
    expect(count).toBeGreaterThanOrEqual(5)
  })

  it('wrapping increases virtual line count', () => {
    native.editorViewSetWrapMode(view, WrapMode.NONE)
    const noWrapCount = native.editorViewGetVirtualLineCount(view)

    native.editorViewSetViewportSize(view, 10, 10)
    native.editorViewSetWrapMode(view, WrapMode.CHAR)
    const wrapCount = native.editorViewGetVirtualLineCount(view)
    expect(wrapCount).toBeGreaterThanOrEqual(noWrapCount)
  })

  it('provides line info', () => {
    const info = native.editorViewGetLineInfoDirect(view)
    expect(info).toBeDefined()
  })

  it('provides logical line info', () => {
    const info = native.editorViewGetLogicalLineInfoDirect(view)
    expect(info).toBeDefined()
  })

  it('tracks visual cursor', () => {
    native.editBufferSetCursor(eb, 1, 5)
    const vc = native.editorViewGetVisualCursor(view)
    expect(vc).toBeDefined()
    expect(typeof vc.visualRow).toBe('number')
    expect(typeof vc.visualCol).toBe('number')
    expect(typeof vc.logicalRow).toBe('number')
    expect(typeof vc.logicalCol).toBe('number')
    expect(typeof vc.offset).toBe('number')
  })

  it('moves cursor visually up and down', () => {
    native.editBufferSetCursor(eb, 2, 0)
    native.editorViewMoveDownVisual(view)
    const after = native.editorViewGetCursor(view)
    expect(after.row).toBeGreaterThanOrEqual(2)

    native.editorViewMoveUpVisual(view)
  })

  it('manages selection by offsets', () => {
    native.editorViewSetSelection(view, 0, 10, 0.2, 0.3, 0.8, 0.5, 1, 1, 1, 1)
    native.editorViewResetSelection(view)
  })

  it('deletes selected text', () => {
    native.editorViewSetSelection(view, 0, 5, 0.2, 0.3, 0.8, 0.5, 1, 1, 1, 1)
    native.editorViewDeleteSelectedText(view)
  })

  it('gets selected text bytes', () => {
    native.editorViewSetSelection(view, 0, 5, 0.2, 0.3, 0.8, 0.5, 1, 1, 1, 1)
    const bytes = native.editorViewGetSelectedTextBytes(view)
    expect(bytes).toBeDefined()
  })

  it('gets full text', () => {
    const text = native.editorViewGetText(view)
    expect(typeof text).toBe('string')
    expect(text.length).toBeGreaterThan(0)
  })

  it('exposes underlying text buffer view', () => {
    const tbv = native.editorViewGetTextBufferView(view)
    expect(tbv).toBeDefined()
  })

  it('sets cursor by offset', () => {
    native.editorViewSetCursorByOffset(view, 10)
    const cursor = native.editorViewGetCursor(view)
    expect(cursor).toBeDefined()
  })

  it('finds word boundaries', () => {
    native.editBufferSetCursor(eb, 0, 0)
    const next = native.editorViewGetNextWordBoundary(view)
    expect(next).toBeDefined()
  })

  it('gets visual start and end of line', () => {
    native.editBufferSetCursor(eb, 0, 3)
    const sol = native.editorViewGetVisualSOL(view)
    const eol = native.editorViewGetVisualEOL(view)
    expect(sol).toBeDefined()
    expect(eol).toBeDefined()
  })

  it('gets logical end of line', () => {
    native.editBufferSetCursor(eb, 0, 0)
    const eol = native.editorViewGetEOL(view)
    expect(eol).toBeDefined()
  })

  it('draws into buffer', () => {
    const buffer = native.createOptimizedBuffer(40, 10, false, WidthMethod.WCWIDTH, 'ev-draw')
    native.bufferClear(buffer, 0, 0, 0, 1)
    native.bufferDrawEditorView(buffer, view, 0, 0)
    native.destroyOptimizedBuffer(buffer)
  })

  it('manages tab indicator', () => {
    native.editorViewSetTabIndicator(view, 0x2192)
    native.editorViewSetTabIndicatorColor(view, 0.5, 0.5, 0.5, 0.3)
  })
})

// ── Syntax Style ──

describe('syntax style', () => {
  let style

  beforeEach(() => {
    style = native.createSyntaxStyle()
  })

  afterEach(() => {
    native.destroySyntaxStyle(style)
  })

  it('starts with zero styles', () => {
    expect(native.syntaxStyleGetStyleCount(style)).toBe(0)
  })

  it('registers styles with incremental IDs', () => {
    const id1 = native.syntaxStyleRegister(style, 'keyword', 0, 0, 1, 1, 0, 0, 0, 0, TextAttributes.BOLD)
    const id2 = native.syntaxStyleRegister(style, 'string', 0, 1, 0, 1, 0, 0, 0, 0, TextAttributes.NONE)
    expect(id2).toBeGreaterThan(id1)
    expect(native.syntaxStyleGetStyleCount(style)).toBe(2)
  })

  it('resolves registered style by name', () => {
    const id = native.syntaxStyleRegister(style, 'comment', 0.5, 0.5, 0.5, 1, 0, 0, 0, 0, TextAttributes.DIM)
    const resolved = native.syntaxStyleResolveByName(style, 'comment')
    expect(resolved).toBe(id)
  })

  it('registers styles with all attribute combinations', () => {
    const attrs = [
      TextAttributes.NONE,
      TextAttributes.BOLD,
      TextAttributes.DIM,
      TextAttributes.ITALIC,
      TextAttributes.UNDERLINE,
      TextAttributes.BOLD | TextAttributes.ITALIC,
      TextAttributes.BOLD | TextAttributes.UNDERLINE | TextAttributes.STRIKETHROUGH,
    ]
    for (let i = 0; i < attrs.length; i++) {
      native.syntaxStyleRegister(style, `style${i}`, 1, 1, 1, 1, 0, 0, 0, 0, attrs[i])
    }
    expect(native.syntaxStyleGetStyleCount(style)).toBe(attrs.length)
  })

  it('handles many styles efficiently', () => {
    for (let i = 0; i < 100; i++) {
      native.syntaxStyleRegister(
        style, `scope.${i}`,
        Math.random(), Math.random(), Math.random(), 1,
        0, 0, 0, 0,
        TextAttributes.NONE,
      )
    }
    expect(native.syntaxStyleGetStyleCount(style)).toBe(100)
  })
})

// ── Links ──

describe('links', () => {
  afterEach(() => {
    native.clearGlobalLinkPool()
  })

  it('allocates unique link IDs', () => {
    const id1 = native.linkAlloc('https://example.com')
    const id2 = native.linkAlloc('https://other.com')
    expect(id1).not.toBe(id2)
  })

  it('retrieves URL by ID', () => {
    const id = native.linkAlloc('https://socket.dev')
    expect(native.linkGetUrl(id)).toBe('https://socket.dev')
  })

  it('packs link ID into attributes', () => {
    const linkId = native.linkAlloc('https://example.com')
    const attrs = native.attributesWithLink(TextAttributes.UNDERLINE, linkId)
    expect(attrs).not.toBe(TextAttributes.UNDERLINE)
    expect(native.attributesGetLinkId(attrs)).toBe(linkId)
  })

  it('preserves base attributes when adding link', () => {
    const linkId = native.linkAlloc('https://example.com')
    const base = TextAttributes.BOLD | TextAttributes.ITALIC
    const withLink = native.attributesWithLink(base, linkId)
    expect(native.attributesGetLinkId(withLink)).toBe(linkId)
  })

  it('clears link pool', () => {
    native.linkAlloc('https://a.com')
    native.linkAlloc('https://b.com')
    native.clearGlobalLinkPool()
  })
})

// ── Hit Grid ──

describe('hit grid', () => {
  let renderer

  beforeEach(() => {
    renderer = native.createRenderer(80, 24, true, false)
  })

  afterEach(() => {
    native.destroyRenderer(renderer)
  })

  it('adds hit regions', () => {
    native.addToHitGrid(renderer, 10, 5, 20, 10, 42)
  })

  it('checks hit returns number', () => {
    const result = native.checkHit(renderer, 0, 0)
    expect(typeof result).toBe('number')
  })

  it('clears hit grid', () => {
    native.addToHitGrid(renderer, 10, 5, 20, 10, 42)
    native.clearCurrentHitGrid(renderer)
  })

  it('supports scissor rects', () => {
    native.hitGridPushScissorRect(renderer, 0, 0, 40, 12)
    native.addToHitGrid(renderer, 10, 5, 20, 10, 99)
    native.hitGridPopScissorRect(renderer)
    native.hitGridClearScissorRects(renderer)
  })

  it('tracks dirty state', () => {
    const dirty = native.getHitGridDirty(renderer)
    expect(typeof dirty).toBe('boolean')
  })
})

// ── Buffer + View Integration ──

describe('buffer drawing integration', () => {
  it('draws text buffer view into optimized buffer', () => {
    const tb = native.createTextBuffer(WidthMethod.WCWIDTH)
    native.textBufferAppend(tb, 'Hello World\nSecond Line')
    const tbv = native.createTextBufferView(tb)
    native.textBufferViewSetViewportSize(tbv, 40, 10)

    const buffer = native.createOptimizedBuffer(40, 10, false, WidthMethod.WCWIDTH, 'tbv-draw')
    native.bufferClear(buffer, 0, 0, 0, 1)
    native.bufferDrawTextBufferView(buffer, tbv, 0, 0)

    native.destroyOptimizedBuffer(buffer)
    native.destroyTextBufferView(tbv)
    native.destroyTextBuffer(tb)
  })

  it('draws editor view into optimized buffer', () => {
    const eb = native.createEditBuffer(WidthMethod.WCWIDTH)
    native.editBufferSetText(eb, 'Editor content\nWith multiple lines')
    const ev = native.createEditorView(eb, 40, 10)

    const buffer = native.createOptimizedBuffer(40, 10, false, WidthMethod.WCWIDTH, 'ev-draw')
    native.bufferClear(buffer, 0, 0, 0, 1)
    native.bufferDrawEditorView(buffer, ev, 0, 0)

    native.destroyOptimizedBuffer(buffer)
    native.destroyEditorView(ev)
    native.destroyEditBuffer(eb)
  })
})

// ── Performance Helpers ──

describe('encodeText', () => {
  it('encodes ASCII string to Uint8Array', () => {
    const encoded = encodeText('Hello')
    expect(encoded).toBeInstanceOf(Uint8Array)
    expect(encoded.length).toBe(5)
    expect(encoded[0]).toBe(72) // 'H'
    expect(encoded[4]).toBe(111) // 'o'
  })

  it('encodes Unicode to multi-byte UTF-8', () => {
    const encoded = encodeText('A\u00e9') // 'Aé'
    expect(encoded.length).toBe(3) // A=1, é=2 bytes
  })

  it('returns empty array for empty string', () => {
    const encoded = encodeText('')
    expect(encoded.length).toBe(0)
  })
})

const hasDirectBufferAPIs = typeof native.bufferGetCharArrayBuffer === 'function'

describe.skipIf(!hasDirectBufferAPIs)('BufferView', () => {
  let buffer

  afterEach(() => {
    if (buffer) {
      native.destroyOptimizedBuffer(buffer)
      buffer = undefined
    }
  })

  it('creates view over native buffer', () => {
    buffer = native.createOptimizedBuffer(10, 5, false, WidthMethod.WCWIDTH, 'bv-test')
    const view = new BufferView(buffer)
    expect(view.width).toBe(10)
    expect(view.height).toBe(5)
  })

  it('provides typed array views over native memory', () => {
    buffer = native.createOptimizedBuffer(10, 5, false, WidthMethod.WCWIDTH, 'bv-arrays')
    const view = new BufferView(buffer)

    expect(view.chars).toBeInstanceOf(Uint32Array)
    expect(view.chars.length).toBe(50) // 10*5

    expect(view.fg).toBeInstanceOf(Float32Array)
    expect(view.fg.length).toBe(200) // 10*5*4 (RGBA)

    expect(view.bg).toBeInstanceOf(Float32Array)
    expect(view.bg.length).toBe(200)

    expect(view.attributes).toBeInstanceOf(Uint32Array)
    expect(view.attributes.length).toBe(50)
  })

  it('lazily initializes and caches typed arrays', () => {
    buffer = native.createOptimizedBuffer(10, 5, false, WidthMethod.WCWIDTH, 'bv-lazy')
    const view = new BufferView(buffer)
    const chars1 = view.chars
    const chars2 = view.chars
    expect(chars1).toBe(chars2)
  })

  it('writes cells directly into native memory', () => {
    buffer = native.createOptimizedBuffer(10, 5, false, WidthMethod.WCWIDTH, 'bv-write')
    native.bufferClear(buffer, 0, 0, 0, 1)
    const view = new BufferView(buffer)

    view.setCell(3, 2, 65, 1, 1, 1, 1, 0, 0, 0, 1, TextAttributes.BOLD)

    const idx = 2 * 10 + 3
    expect(view.chars[idx]).toBe(65)
    expect(view.attributes[idx]).toBe(TextAttributes.BOLD)
    const ci = idx * 4
    expect(view.fg[ci]).toBe(1)
    expect(view.bg[ci + 3]).toBe(1)
  })

  it('invalidates cached views', () => {
    buffer = native.createOptimizedBuffer(10, 5, false, WidthMethod.WCWIDTH, 'bv-inv')
    const view = new BufferView(buffer)
    const chars1 = view.chars
    view.invalidate()
    const chars2 = view.chars
    expect(chars1).not.toBe(chars2)
  })
})

const hasCursorIntoAPIs = typeof native.editBufferGetCursorInto === 'function'

describe.skipIf(!hasCursorIntoAPIs)('CursorState', () => {
  it('creates reusable cursor state object', () => {
    const cursor = new CursorState()
    expect(cursor).toBeDefined()
  })

  it('reads edit buffer cursor without allocation', () => {
    const eb = native.createEditBuffer(WidthMethod.WCWIDTH)
    native.editBufferSetText(eb, 'Hello')
    native.editBufferSetCursor(eb, 0, 3)

    const cursor = new CursorState()
    cursor.readEditBuffer(eb)
    expect(cursor.row).toBe(0)
    expect(cursor.col).toBe(3)

    native.editBufferMoveCursorRight(eb)
    cursor.readEditBuffer(eb)
    expect(cursor.col).toBe(4)

    native.destroyEditBuffer(eb)
  })

  it('reads editor view cursor without allocation', () => {
    const eb = native.createEditBuffer(WidthMethod.WCWIDTH)
    native.editBufferSetText(eb, 'Test')
    const view = native.createEditorView(eb, 40, 10)

    const cursor = new CursorState()
    cursor.readEditorView(view)
    expect(typeof cursor.row).toBe('number')
    expect(typeof cursor.col).toBe('number')

    native.destroyEditorView(view)
    native.destroyEditBuffer(eb)
  })

  it('reads renderer cursor state without allocation', () => {
    const renderer = native.createRenderer(80, 24, true, false)
    native.setCursorPosition(renderer, 10, 5, true)

    const cursor = new CursorState()
    cursor.readRenderer(renderer)
    expect(typeof cursor.x).toBe('number')
    expect(typeof cursor.y).toBe('number')
    expect(typeof cursor.visible).toBe('boolean')

    native.destroyRenderer(renderer)
  })
})
