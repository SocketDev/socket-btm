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
