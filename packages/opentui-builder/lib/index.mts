import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { spawnSync } from '@socketsecurity/lib/spawn'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const esmRequire = createRequire(import.meta.url)

const PLATFORM_MAP = {
  __proto__: null,
  darwin: { __proto__: null, arm64: 'aarch64-macos', x64: 'x86_64-macos' },
  linux: {
    __proto__: null,
    arm64: 'aarch64-linux-gnu',
    arm64_musl: 'aarch64-linux-musl',
    x64: 'x86_64-linux-gnu',
    x64_musl: 'x86_64-linux-musl',
  },
  win32: {
    __proto__: null,
    arm64: 'aarch64-windows-gnu',
    x64: 'x86_64-windows-gnu',
  },
}

const EXT_MAP = { __proto__: null, darwin: 'dylib', linux: 'so', win32: 'dll' }
const PREFIX_MAP = { __proto__: null, darwin: 'lib', linux: 'lib', win32: '' }

const PLATFORM_ARCH_MAP = {
  __proto__: null,
  darwin: 'darwin',
  linux: 'linux',
  win32: 'win32',
}

function detectMusl() {
  if (process.platform !== 'linux') {
    return false
  }
  try {
    // Node reports musl libc via process.report
    const report = process.report?.getReport()
    if (typeof report === 'object' && report !== undefined) {
      const header = report.header
      if (header && typeof header.glibcVersionRuntime === 'string') {
        return false
      }
    }
  } catch {}
  // Fallback: check if ldd is musl-based
  try {
    const result = spawnSync('ldd', ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout = String(result.stdout ?? '')
    const stderr = String(result.stderr ?? '')
    if (/musl/i.test(stdout) || /musl/i.test(stderr)) {
      return true
    }
  } catch {
    // Ignore errors — ldd may not be present on non-glibc/non-musl systems.
  }
  return false
}

function loadNativeModule() {
  const { platform, arch } = process
  const platformMap = PLATFORM_MAP[platform]
  if (!platformMap) {
    throw new Error(`Unsupported platform: ${platform}`)
  }

  const isMusl = detectMusl()
  const archKey = isMusl ? `${arch}_musl` : arch
  const zigTarget = platformMap[archKey] ?? platformMap[arch]
  if (!zigTarget) {
    throw new Error(`Unsupported architecture: ${platform}-${arch}`)
  }

  const osPart = PLATFORM_ARCH_MAP[platform]
  const platformArch = `${osPart}-${arch}${isMusl ? '-musl' : ''}`

  const candidates = [
    path.join(
      __dirname,
      '..',
      'build',
      'dev',
      platformArch,
      'out',
      platformArch,
      'opentui.node',
    ),
    path.join(
      __dirname,
      '..',
      'build',
      'prod',
      platformArch,
      'out',
      platformArch,
      'opentui.node',
    ),
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return esmRequire(candidate)
    }
  }

  // Raw shared library via dlopen (lib/ directory contains .dylib/.so/.dll
  // built with napi symbols, loadable directly)
  const ext = EXT_MAP[platform]
  const prefix = PREFIX_MAP[platform]
  const libPath = path.join(__dirname, zigTarget, `${prefix}opentui.${ext}`)
  if (existsSync(libPath)) {
    const mod = { __proto__: null, exports: { __proto__: null } }
    process.dlopen(mod, libPath)
    return mod.exports
  }

  throw new Error(
    `OpenTUI native module not found. Searched:\n${[...candidates, libPath].join('\n')}\nRun "pnpm --filter opentui-builder build" to compile.`,
  )
}

export const native = loadNativeModule()

export const WidthMethod = {
  __proto__: null,
  WCWIDTH: 0,
  UNICODE: 1,
  NO_ZWJ: 2,
}

export const WrapMode = { __proto__: null, NONE: 0, CHAR: 1, WORD: 2 }

export const TextAttributes = {
  __proto__: null,
  NONE: 0,
  BOLD: 1,
  DIM: 2,
  ITALIC: 4,
  UNDERLINE: 8,
  BLINK: 16,
  INVERSE: 32,
  HIDDEN: 64,
  STRIKETHROUGH: 128,
}

export const ATTRIBUTE_BASE_BITS = 8
export const ATTRIBUTE_BASE_MASK = 0xff

export class RGBA {
  constructor(r, g, b, a = 1) {
    this.buffer = new Float32Array([r, g, b, a])
  }

  get r() {
    return this.buffer[0]
  }
  set r(v) {
    this.buffer[0] = v
  }

  get g() {
    return this.buffer[1]
  }
  set g(v) {
    this.buffer[1] = v
  }

  get b() {
    return this.buffer[2]
  }
  set b(v) {
    this.buffer[2] = v
  }

  get a() {
    return this.buffer[3]
  }
  set a(v) {
    this.buffer[3] = v
  }

  static fromValues(r, g, b, a = 1) {
    return new RGBA(r, g, b, a)
  }

  static fromInts(r, g, b, a = 255) {
    return new RGBA(r / 255, g / 255, b / 255, a / 255)
  }

  static fromHex(hex) {
    hex = hex.replace(/^#/, '')
    if (hex.length === 3) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]
    } else if (hex.length === 4) {
      hex =
        hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3]
    }
    if (!/^[0-9A-Fa-f]{6}$/.test(hex) && !/^[0-9A-Fa-f]{8}$/.test(hex)) {
      return new RGBA(1, 0, 1, 1)
    }
    const r = parseInt(hex.substring(0, 2), 16) / 255
    const g = parseInt(hex.substring(2, 4), 16) / 255
    const b = parseInt(hex.substring(4, 6), 16) / 255
    const a = hex.length === 8 ? parseInt(hex.substring(6, 8), 16) / 255 : 1
    return new RGBA(r, g, b, a)
  }

  static fromArray(array) {
    const rgba = new RGBA(0, 0, 0, 1)
    rgba.buffer =
      array instanceof Float32Array ? array : new Float32Array(array)
    return rgba
  }

  toInts() {
    return [
      Math.round(this.r * 255),
      Math.round(this.g * 255),
      Math.round(this.b * 255),
      Math.round(this.a * 255),
    ]
  }

  toHex() {
    const components =
      this.a === 1 ? [this.r, this.g, this.b] : [this.r, this.g, this.b, this.a]
    return (
      '#' +
      components
        .map(x => {
          const h = Math.floor(Math.max(0, Math.min(1, x) * 255)).toString(16)
          return h.length === 1 ? '0' + h : h
        })
        .join('')
    )
  }

  equals(other) {
    if (!other) {
      return false
    }
    return (
      this.r === other.r &&
      this.g === other.g &&
      this.b === other.b &&
      this.a === other.a
    )
  }

  toString() {
    return `rgba(${this.r.toFixed(2)}, ${this.g.toFixed(2)}, ${this.b.toFixed(2)}, ${this.a.toFixed(2)})`
  }
}

export const DebugOverlayCorner = {
  __proto__: null,
  TOP_LEFT: 0,
  TOP_RIGHT: 1,
  BOTTOM_LEFT: 2,
  BOTTOM_RIGHT: 3,
}

export const TargetChannel = {
  __proto__: null,
  FG: 1,
  BG: 2,
  BOTH: 3,
}

// ── Performance helpers ──

const textEncoder = new TextEncoder()

export function encodeText(text) {
  return textEncoder.encode(text)
}

export class BufferView {
  constructor(bufferPtr) {
    this._ptr = bufferPtr
    this._chars = undefined
    this._fg = undefined
    this._bg = undefined
    this._attrs = undefined
    this._width = native.getBufferWidth(bufferPtr)
    this._height = native.getBufferHeight(bufferPtr)
  }

  get width() {
    return this._width
  }
  get height() {
    return this._height
  }

  get chars() {
    if (!this._chars) {
      this._chars = new Uint32Array(native.bufferGetCharArrayBuffer(this._ptr))
    }
    return this._chars
  }

  get fg() {
    if (!this._fg) {
      this._fg = new Float32Array(native.bufferGetFgArrayBuffer(this._ptr))
    }
    return this._fg
  }

  get bg() {
    if (!this._bg) {
      this._bg = new Float32Array(native.bufferGetBgArrayBuffer(this._ptr))
    }
    return this._bg
  }

  get attributes() {
    if (!this._attrs) {
      this._attrs = new Uint32Array(
        native.bufferGetAttributesArrayBuffer(this._ptr),
      )
    }
    return this._attrs
  }

  setCell(x, y, char, fgR, fgG, fgB, fgA, bgR, bgG, bgB, bgA, attrs) {
    const idx = y * this._width + x
    this.chars[idx] = char
    const ci = idx * 4
    this.fg[ci] = fgR
    this.fg[ci + 1] = fgG
    this.fg[ci + 2] = fgB
    this.fg[ci + 3] = fgA
    this.bg[ci] = bgR
    this.bg[ci + 1] = bgG
    this.bg[ci + 2] = bgB
    this.bg[ci + 3] = bgA
    this.attributes[idx] = attrs
  }

  invalidate() {
    this._chars = undefined
    this._fg = undefined
    this._bg = undefined
    this._attrs = undefined
  }
}

export class CursorState {
  constructor() {
    this._buf = new Uint32Array(2)
    this._i32buf = new Int32Array(3)
  }

  readEditBuffer(editBufferPtr) {
    native.editBufferGetCursorInto(editBufferPtr, this._buf)
    return this
  }

  readEditorView(editorViewPtr) {
    native.editorViewGetCursorInto(editorViewPtr, this._buf)
    return this
  }

  readRenderer(rendererPtr) {
    native.getCursorStateInto(rendererPtr, this._i32buf)
    return this
  }

  get row() {
    return this._buf[0]
  }
  get col() {
    return this._buf[1]
  }
  get x() {
    return this._i32buf[0]
  }
  get y() {
    return this._i32buf[1]
  }
  get visible() {
    return this._i32buf[2] !== 0
  }
}

// ── High-level API (uses fast paths internally) ──

const BLACK = new Float32Array([0, 0, 0, 1])
const WHITE = new Float32Array([1, 1, 1, 1])
const TRANSPARENT = new Float32Array([0, 0, 0, 0])

const _hasFA = typeof native.bufferDrawTextFA === 'function'
const _hasFast = typeof native.editBufferInsertTextFast === 'function'
const _hasSized = typeof native.editBufferGetTextSized === 'function'
const _hasBinary = typeof native.writeOutBinary === 'function'
const _hasCursorInto = typeof native.editBufferGetCursorInto === 'function'

function colorBuf(color) {
  if (color instanceof RGBA) {
    return color.buffer
  }
  if (color instanceof Float32Array) {
    return color
  }
  return BLACK
}

export class Buffer {
  constructor(width, height, opts) {
    const widthMethod = opts?.widthMethod ?? WidthMethod.WCWIDTH
    const id = opts?.id ?? ''
    const respectAlpha = opts?.respectAlpha ?? false
    this._ptr = native.createOptimizedBuffer(
      width,
      height,
      respectAlpha,
      widthMethod,
      id,
    )
    this._view = undefined
  }

  get ptr() {
    return this._ptr
  }
  get width() {
    return native.getBufferWidth(this._ptr)
  }
  get height() {
    return native.getBufferHeight(this._ptr)
  }

  get view() {
    if (!this._view) {
      this._view = new BufferView(this._ptr)
    }
    return this._view
  }

  clear(bg) {
    if (_hasFA && bg) {
      const b = colorBuf(bg)
      native.bufferClear(this._ptr, b[0], b[1], b[2], b[3])
    } else {
      native.bufferClear(this._ptr, 0, 0, 0, 1)
    }
    if (this._view) {
      this._view.invalidate()
    }
  }

  resize(width, height) {
    native.bufferResize(this._ptr, width, height)
    if (this._view) {
      this._view.invalidate()
    }
  }

  drawText(text, x, y, fg, bg, attrs = 0) {
    const fgBuf = colorBuf(fg ?? WHITE)
    const bgBuf = colorBuf(bg ?? BLACK)
    if (_hasFA) {
      native.bufferDrawTextFA(this._ptr, text, x, y, fgBuf, bgBuf, attrs)
    } else {
      native.bufferDrawText(
        this._ptr,
        text,
        x,
        y,
        fgBuf[0],
        fgBuf[1],
        fgBuf[2],
        fgBuf[3],
        bgBuf[0],
        bgBuf[1],
        bgBuf[2],
        bgBuf[3],
        attrs,
      )
    }
  }

  drawChar(char, x, y, fg, bg, attrs = 0) {
    const fgBuf = colorBuf(fg ?? WHITE)
    const bgBuf = colorBuf(bg ?? BLACK)
    if (_hasFA) {
      native.bufferDrawCharFA(this._ptr, char, x, y, fgBuf, bgBuf, attrs)
    } else {
      native.bufferDrawChar(
        this._ptr,
        char,
        x,
        y,
        fgBuf[0],
        fgBuf[1],
        fgBuf[2],
        fgBuf[3],
        bgBuf[0],
        bgBuf[1],
        bgBuf[2],
        bgBuf[3],
        attrs,
      )
    }
  }

  setCell(x, y, char, fg, bg, attrs = 0) {
    const fgBuf = colorBuf(fg ?? WHITE)
    const bgBuf = colorBuf(bg ?? BLACK)
    if (_hasFA) {
      native.bufferSetCellFA(this._ptr, x, y, char, fgBuf, bgBuf)
    } else {
      native.bufferSetCell(
        this._ptr,
        x,
        y,
        char,
        fgBuf[0],
        fgBuf[1],
        fgBuf[2],
        fgBuf[3],
        bgBuf[0],
        bgBuf[1],
        bgBuf[2],
        bgBuf[3],
        attrs,
      )
    }
  }

  fillRect(x, y, width, height, bg) {
    const bgBuf = colorBuf(bg ?? BLACK)
    if (_hasFA) {
      native.bufferFillRectFA(this._ptr, x, y, width, height, bgBuf)
    } else {
      native.bufferFillRect(
        this._ptr,
        x,
        y,
        width,
        height,
        bgBuf[0],
        bgBuf[1],
        bgBuf[2],
        bgBuf[3],
      )
    }
  }

  pushScissorRect(x, y, width, height) {
    native.bufferPushScissorRect(this._ptr, x, y, width, height)
  }

  popScissorRect() {
    native.bufferPopScissorRect(this._ptr)
  }
  clearScissorRects() {
    native.bufferClearScissorRects(this._ptr)
  }

  pushOpacity(opacity) {
    native.bufferPushOpacity(this._ptr, opacity)
  }
  popOpacity() {
    native.bufferPopOpacity(this._ptr)
  }
  get opacity() {
    return native.bufferGetCurrentOpacity(this._ptr)
  }

  drawEditorView(editorView, x, y) {
    const ptr = editorView._ptr ?? editorView
    native.bufferDrawEditorView(this._ptr, ptr, x, y)
  }

  drawTextBufferView(textBufferView, x, y) {
    const ptr = textBufferView._ptr ?? textBufferView
    native.bufferDrawTextBufferView(this._ptr, ptr, x, y)
  }

  destroy() {
    native.destroyOptimizedBuffer(this._ptr)
    this._view = undefined
  }
}

export class TextBuffer {
  constructor(widthMethod = WidthMethod.WCWIDTH) {
    this._ptr = native.createTextBuffer(widthMethod)
  }

  get ptr() {
    return this._ptr
  }
  get length() {
    return native.textBufferGetLength(this._ptr)
  }
  get byteSize() {
    return native.textBufferGetByteSize(this._ptr)
  }
  get lineCount() {
    return native.textBufferGetLineCount(this._ptr)
  }

  get text() {
    return _hasSized
      ? native.textBufferGetPlainTextSized(this._ptr)
      : native.textBufferGetPlainText(this._ptr)
  }

  append(text) {
    if (_hasFast) {
      native.textBufferAppendFast(this._ptr, text)
    } else {
      native.textBufferAppend(this._ptr, text)
    }
  }

  clear() {
    native.textBufferClear(this._ptr)
  }
  reset() {
    native.textBufferReset(this._ptr)
  }

  setDefaultFg(color) {
    const c = colorBuf(color)
    native.textBufferSetDefaultFg(this._ptr, c[0], c[1], c[2], c[3])
  }

  setDefaultBg(color) {
    const c = colorBuf(color)
    native.textBufferSetDefaultBg(this._ptr, c[0], c[1], c[2], c[3])
  }

  setDefaultAttributes(attrs) {
    native.textBufferSetDefaultAttributes(this._ptr, attrs)
  }

  resetDefaults() {
    native.textBufferResetDefaults(this._ptr)
  }

  get tabWidth() {
    return native.textBufferGetTabWidth(this._ptr)
  }
  set tabWidth(w) {
    native.textBufferSetTabWidth(this._ptr, w)
  }

  addHighlight(lineIdx, start, end, styleId, priority = 0, hlRef = 0) {
    native.textBufferAddHighlight(
      this._ptr,
      lineIdx,
      start,
      end,
      styleId,
      priority,
      hlRef,
    )
  }

  removeHighlightsByRef(hlRef) {
    native.textBufferRemoveHighlightsByRef(this._ptr, hlRef)
  }
  clearAllHighlights() {
    native.textBufferClearAllHighlights(this._ptr)
  }

  setSyntaxStyle(style) {
    const ptr = style._ptr ?? style
    native.textBufferSetSyntaxStyle(this._ptr, ptr)
  }

  destroy() {
    native.destroyTextBuffer(this._ptr)
  }
}

export class EditBuffer {
  constructor(widthMethod = WidthMethod.WCWIDTH) {
    this._ptr = native.createEditBuffer(widthMethod)
    this._cursor = _hasCursorInto ? new CursorState() : undefined
  }

  get ptr() {
    return this._ptr
  }

  get text() {
    return _hasSized
      ? native.editBufferGetTextSized(this._ptr)
      : native.editBufferGetText(this._ptr)
  }

  set text(value) {
    native.editBufferSetText(this._ptr, value)
  }

  insertText(text) {
    if (_hasFast) {
      native.editBufferInsertTextFast(this._ptr, text)
    } else {
      native.editBufferInsertText(this._ptr, text)
    }
  }

  get cursor() {
    if (this._cursor) {
      return this._cursor.readEditBuffer(this._ptr)
    }
    return native.editBufferGetCursor(this._ptr)
  }

  setCursor(row, col) {
    native.editBufferSetCursor(this._ptr, row, col)
  }
  setCursorByOffset(offset) {
    native.editBufferSetCursorByOffset(this._ptr, offset)
  }
  gotoLine(line) {
    native.editBufferGotoLine(this._ptr, line)
  }

  moveCursorLeft() {
    native.editBufferMoveCursorLeft(this._ptr)
  }
  moveCursorRight() {
    native.editBufferMoveCursorRight(this._ptr)
  }
  moveCursorUp() {
    native.editBufferMoveCursorUp(this._ptr)
  }
  moveCursorDown() {
    native.editBufferMoveCursorDown(this._ptr)
  }

  deleteChar() {
    native.editBufferDeleteChar(this._ptr)
  }
  deleteCharBackward() {
    native.editBufferDeleteCharBackward(this._ptr)
  }
  deleteRange(startRow, startCol, endRow, endCol) {
    native.editBufferDeleteRange(this._ptr, startRow, startCol, endRow, endCol)
  }
  deleteLine() {
    native.editBufferDeleteLine(this._ptr)
  }
  newLine() {
    native.editBufferNewLine(this._ptr)
  }

  undo() {
    native.editBufferUndo(this._ptr)
  }
  redo() {
    native.editBufferRedo(this._ptr)
  }
  get canUndo() {
    return native.editBufferCanUndo(this._ptr)
  }
  get canRedo() {
    return native.editBufferCanRedo(this._ptr)
  }
  clearHistory() {
    native.editBufferClearHistory(this._ptr)
  }

  getTextRange(startOffset, endOffset) {
    return native.editBufferGetTextRange(this._ptr, startOffset, endOffset)
  }

  getTextRangeByCoords(startRow, startCol, endRow, endCol) {
    return native.editBufferGetTextRangeByCoords(
      this._ptr,
      startRow,
      startCol,
      endRow,
      endCol,
    )
  }

  clear() {
    native.editBufferClear(this._ptr)
  }
  destroy() {
    native.destroyEditBuffer(this._ptr)
  }
}

export class EditorView {
  constructor(editBuffer, width, height) {
    const ptr = editBuffer._ptr ?? editBuffer
    this._ptr = native.createEditorView(ptr, width, height)
    this._cursor = _hasCursorInto ? new CursorState() : undefined
  }

  get ptr() {
    return this._ptr
  }

  get cursor() {
    if (this._cursor) {
      return this._cursor.readEditorView(this._ptr)
    }
    return native.editorViewGetCursor(this._ptr)
  }

  get visualCursor() {
    return native.editorViewGetVisualCursor(this._ptr)
  }
  get viewport() {
    return native.editorViewGetViewport(this._ptr)
  }
  get virtualLineCount() {
    return native.editorViewGetVirtualLineCount(this._ptr)
  }
  get totalVirtualLineCount() {
    return native.editorViewGetTotalVirtualLineCount(this._ptr)
  }
  get text() {
    return native.editorViewGetText(this._ptr)
  }

  setViewportSize(width, height) {
    native.editorViewSetViewportSize(this._ptr, width, height)
  }
  setViewport(x, y, width, height, moveCursor = false) {
    native.editorViewSetViewport(this._ptr, x, y, width, height, moveCursor)
  }
  clearViewport() {
    native.editorViewClearViewport(this._ptr)
  }
  setScrollMargin(margin) {
    native.editorViewSetScrollMargin(this._ptr, margin)
  }
  setWrapMode(mode) {
    native.editorViewSetWrapMode(this._ptr, mode)
  }

  moveUpVisual() {
    native.editorViewMoveUpVisual(this._ptr)
  }
  moveDownVisual() {
    native.editorViewMoveDownVisual(this._ptr)
  }

  setSelection(start, end, bgColor, fgColor) {
    const bg = colorBuf(bgColor ?? TRANSPARENT)
    const fg = colorBuf(fgColor ?? WHITE)
    native.editorViewSetSelection(
      this._ptr,
      start,
      end,
      bg[0],
      bg[1],
      bg[2],
      bg[3],
      fg[0],
      fg[1],
      fg[2],
      fg[3],
    )
  }

  resetSelection() {
    native.editorViewResetSelection(this._ptr)
  }
  deleteSelectedText() {
    native.editorViewDeleteSelectedText(this._ptr)
  }

  destroy() {
    native.destroyEditorView(this._ptr)
  }
}

export class SyntaxStyle {
  constructor() {
    this._ptr = native.createSyntaxStyle()
  }

  get ptr() {
    return this._ptr
  }
  get styleCount() {
    return native.syntaxStyleGetStyleCount(this._ptr)
  }

  register(name, fg, bg, attrs = 0) {
    const fgBuf = colorBuf(fg ?? TRANSPARENT)
    const bgBuf = colorBuf(bg ?? TRANSPARENT)
    return native.syntaxStyleRegister(
      this._ptr,
      name,
      fgBuf[0],
      fgBuf[1],
      fgBuf[2],
      fgBuf[3],
      bgBuf[0],
      bgBuf[1],
      bgBuf[2],
      bgBuf[3],
      attrs,
    )
  }

  resolve(name) {
    return native.syntaxStyleResolveByName(this._ptr, name)
  }
  destroy() {
    native.destroySyntaxStyle(this._ptr)
  }
}

export class Renderer {
  constructor(width, height, opts) {
    const testing = opts?.testing ?? false
    const remote = opts?.remote ?? false
    this._ptr = native.createRenderer(width, height, testing, remote)
    this._cursor = _hasCursorInto ? new CursorState() : undefined
  }

  get ptr() {
    return this._ptr
  }

  get nextBuffer() {
    return native.getNextBuffer(this._ptr)
  }
  get currentBuffer() {
    return native.getCurrentBuffer(this._ptr)
  }

  render(force = false) {
    native.render(this._ptr, force)
  }

  resize(width, height) {
    native.resizeRenderer(this._ptr, width, height)
  }

  setBackgroundColor(color) {
    const c = colorBuf(color)
    native.setBackgroundColor(this._ptr, c[0], c[1], c[2], c[3])
  }

  get cursorState() {
    if (this._cursor) {
      return this._cursor.readRenderer(this._ptr)
    }
    return native.getCursorState(this._ptr)
  }

  setCursorPosition(x, y, visible = true) {
    native.setCursorPosition(this._ptr, x, y, visible)
  }

  setTerminalTitle(title) {
    native.setTerminalTitle(this._ptr, title)
  }
  clearTerminal() {
    native.clearTerminal(this._ptr)
  }

  enableMouse(enableMovement = true) {
    native.enableMouse(this._ptr, enableMovement)
  }
  disableMouse() {
    native.disableMouse(this._ptr)
  }

  setupTerminal(useAlternateScreen = true) {
    native.setupTerminal(this._ptr, useAlternateScreen)
  }
  suspend() {
    native.suspendRenderer(this._ptr)
  }
  resume() {
    native.resumeRenderer(this._ptr)
  }

  writeOut(data) {
    if (_hasBinary && data instanceof Uint8Array) {
      native.writeOutBinary(this._ptr, data)
    } else {
      native.writeOut(this._ptr, data)
    }
  }

  addToHitGrid(x, y, width, height, id) {
    native.addToHitGrid(this._ptr, x, y, width, height, id)
  }

  checkHit(x, y) {
    return native.checkHit(this._ptr, x, y)
  }
  clearHitGrid() {
    native.clearCurrentHitGrid(this._ptr)
  }

  destroy() {
    native.destroyRenderer(this._ptr)
  }
}
