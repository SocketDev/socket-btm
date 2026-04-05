import type OpenTUIBindings from './native.js'

export type { NativePointer } from './native.js'

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

export type NativePointer = import('./native.js').NativePointer

export declare class BufferView {
  constructor(bufferPtr: NativePointer)
  readonly width: number
  readonly height: number
  readonly chars: Uint32Array
  readonly fg: Float32Array
  readonly bg: Float32Array
  readonly attributes: Uint32Array
  setCell(x: number, y: number, char: number, fgR: number, fgG: number, fgB: number, fgA: number, bgR: number, bgG: number, bgB: number, bgA: number, attrs: number): void
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
