import type OpenTUIBindings from './native.js'

export type { NativePointer } from './native.js'
export type NativePointer = import('./native.js').NativePointer
export type ColorInput = RGBA | Float32Array

export declare const native: OpenTUIBindings

export declare class RGBA {
  buffer: Float32Array
  r: number
  g: number
  b: number
  a: number
  constructor(r: number, g: number, b: number, a?: number)
  static fromValues(r: number, g: number, b: number, a?: number): RGBA
  static fromInts(r: number, g: number, b: number, a?: number): RGBA
  static fromHex(hex: string): RGBA
  static fromArray(array: Float32Array | number[]): RGBA
  toInts(): [number, number, number, number]
  toHex(): string
  equals(other: RGBA | undefined): boolean
  toString(): string
}

export declare const WidthMethod: {
  readonly WCWIDTH: 0
  readonly UNICODE: 1
  readonly NO_ZWJ: 2
}

export declare const WrapMode: {
  readonly NONE: 0
  readonly CHAR: 1
  readonly WORD: 2
}

export declare const TextAttributes: {
  readonly NONE: 0
  readonly BOLD: 1
  readonly DIM: 2
  readonly ITALIC: 4
  readonly UNDERLINE: 8
  readonly BLINK: 16
  readonly INVERSE: 32
  readonly HIDDEN: 64
  readonly STRIKETHROUGH: 128
}

export declare const ATTRIBUTE_BASE_BITS: 8
export declare const ATTRIBUTE_BASE_MASK: 0xff

export declare const DebugOverlayCorner: {
  readonly TOP_LEFT: 0
  readonly TOP_RIGHT: 1
  readonly BOTTOM_LEFT: 2
  readonly BOTTOM_RIGHT: 3
}

export declare const TargetChannel: {
  readonly FG: 1
  readonly BG: 2
  readonly BOTH: 3
}

export declare function encodeText(text: string): Uint8Array

export declare class BufferView {
  constructor(bufferPtr: NativePointer)
  readonly width: number
  readonly height: number
  readonly chars: Uint32Array
  readonly fg: Float32Array
  readonly bg: Float32Array
  readonly attributes: Uint32Array
  setCell(
    x: number,
    y: number,
    char: number,
    fgR: number,
    fgG: number,
    fgB: number,
    fgA: number,
    bgR: number,
    bgG: number,
    bgB: number,
    bgA: number,
    attrs: number,
  ): void
  invalidate(): void
}

export declare class CursorState {
  constructor()
  readEditBuffer(editBufferPtr: NativePointer): this
  readEditorView(editorViewPtr: NativePointer): this
  readRenderer(rendererPtr: NativePointer): this
  readonly row: number
  readonly col: number
  readonly x: number
  readonly y: number
  readonly visible: boolean
}

export declare class Buffer {
  constructor(
    width: number,
    height: number,
    opts?: { widthMethod?: number; id?: string; respectAlpha?: boolean },
  )
  readonly ptr: NativePointer
  readonly width: number
  readonly height: number
  readonly view: BufferView
  readonly opacity: number
  clear(bg?: ColorInput): void
  resize(width: number, height: number): void
  drawText(
    text: string,
    x: number,
    y: number,
    fg?: ColorInput,
    bg?: ColorInput,
    attrs?: number,
  ): void
  drawChar(
    char: number,
    x: number,
    y: number,
    fg?: ColorInput,
    bg?: ColorInput,
    attrs?: number,
  ): void
  setCell(
    x: number,
    y: number,
    char: number,
    fg?: ColorInput,
    bg?: ColorInput,
    attrs?: number,
  ): void
  fillRect(
    x: number,
    y: number,
    width: number,
    height: number,
    bg?: ColorInput,
  ): void
  pushScissorRect(x: number, y: number, width: number, height: number): void
  popScissorRect(): void
  clearScissorRects(): void
  pushOpacity(opacity: number): void
  popOpacity(): void
  drawEditorView(
    editorView: EditorView | NativePointer,
    x: number,
    y: number,
  ): void
  drawTextBufferView(textBufferView: NativePointer, x: number, y: number): void
  destroy(): void
}

export declare class TextBuffer {
  constructor(widthMethod?: number)
  readonly ptr: NativePointer
  readonly length: number
  readonly byteSize: number
  readonly lineCount: number
  readonly text: string
  tabWidth: number
  append(text: string): void
  clear(): void
  reset(): void
  setDefaultFg(color: ColorInput): void
  setDefaultBg(color: ColorInput): void
  setDefaultAttributes(attrs: number): void
  resetDefaults(): void
  addHighlight(
    lineIdx: number,
    start: number,
    end: number,
    styleId: number,
    priority?: number,
    hlRef?: number,
  ): void
  removeHighlightsByRef(hlRef: number): void
  clearAllHighlights(): void
  setSyntaxStyle(style: SyntaxStyle | NativePointer): void
  destroy(): void
}

export declare class EditBuffer {
  constructor(widthMethod?: number)
  readonly ptr: NativePointer
  text: string
  readonly cursor: CursorState | { row: number; col: number }
  readonly canUndo: boolean
  readonly canRedo: boolean
  insertText(text: string): void
  setCursor(row: number, col: number): void
  setCursorByOffset(offset: number): void
  gotoLine(line: number): void
  moveCursorLeft(): void
  moveCursorRight(): void
  moveCursorUp(): void
  moveCursorDown(): void
  deleteChar(): void
  deleteCharBackward(): void
  deleteRange(
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
  ): void
  deleteLine(): void
  newLine(): void
  undo(): void
  redo(): void
  clearHistory(): void
  getTextRange(startOffset: number, endOffset: number): string
  getTextRangeByCoords(
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
  ): string
  clear(): void
  destroy(): void
}

export declare class EditorView {
  constructor(
    editBuffer: EditBuffer | NativePointer,
    width: number,
    height: number,
  )
  readonly ptr: NativePointer
  readonly cursor: CursorState | { row: number; col: number }
  readonly visualCursor: {
    visualRow: number
    visualCol: number
    logicalRow: number
    logicalCol: number
    offset: number
  }
  readonly viewport: { x: number; y: number; width: number; height: number }
  readonly virtualLineCount: number
  readonly totalVirtualLineCount: number
  readonly text: string
  setViewportSize(width: number, height: number): void
  setViewport(
    x: number,
    y: number,
    width: number,
    height: number,
    moveCursor?: boolean,
  ): void
  clearViewport(): void
  setScrollMargin(margin: number): void
  setWrapMode(mode: number): void
  moveUpVisual(): void
  moveDownVisual(): void
  setSelection(
    start: number,
    end: number,
    bgColor?: ColorInput,
    fgColor?: ColorInput,
  ): void
  resetSelection(): void
  deleteSelectedText(): void
  destroy(): void
}

export declare class SyntaxStyle {
  constructor()
  readonly ptr: NativePointer
  readonly styleCount: number
  register(
    name: string,
    fg?: ColorInput,
    bg?: ColorInput,
    attrs?: number,
  ): number
  resolve(name: string): number
  destroy(): void
}

export declare class Renderer {
  constructor(
    width: number,
    height: number,
    opts?: { testing?: boolean; remote?: boolean },
  )
  readonly ptr: NativePointer
  readonly nextBuffer: NativePointer
  readonly currentBuffer: NativePointer
  readonly cursorState: CursorState | { x: number; y: number; visible: boolean }
  render(force?: boolean): void
  resize(width: number, height: number): void
  setBackgroundColor(color: ColorInput): void
  setCursorPosition(x: number, y: number, visible?: boolean): void
  setTerminalTitle(title: string): void
  clearTerminal(): void
  enableMouse(enableMovement?: boolean): void
  disableMouse(): void
  setupTerminal(useAlternateScreen?: boolean): void
  suspend(): void
  resume(): void
  writeOut(data: string | Uint8Array): void
  addToHitGrid(
    x: number,
    y: number,
    width: number,
    height: number,
    id: number,
  ): void
  checkHit(x: number, y: number): number
  clearHitGrid(): void
  destroy(): void
}
