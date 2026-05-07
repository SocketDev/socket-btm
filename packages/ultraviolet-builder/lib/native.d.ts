/**
 * Shape of the native binding exported by ultraviolet.node. Consumers
 * should import from the package root (lib/index.mts) rather than
 * loading this file directly; it exists as a type-only anchor.
 */

export interface KeyEvent {
  type: 'KeyPress' | 'KeyRelease'
  code: number
  mod: number
  text: string
  isRepeat: boolean
}

export interface MouseEvent {
  type: 'MouseClick' | 'MouseRelease' | 'MouseWheel' | 'MouseMotion'
  x: number
  y: number
  button: number
  mod: number
}

export interface WindowSizeEvent {
  type: 'WindowSize'
  width: number
  height: number
}

export interface SimpleEvent {
  type: 'PasteStart' | 'PasteEnd' | 'Focus' | 'Blur'
}

export interface PasteEvent {
  type: 'Paste'
  text: string
}

export interface UnknownEvent {
  type: 'Unknown' | 'Unhandled'
  raw?: string
  go?: string
}

export type DecodedEvent =
  | KeyEvent
  | MouseEvent
  | WindowSizeEvent
  | SimpleEvent
  | PasteEvent
  | UnknownEvent

export interface Native {
  newDecoder(): object
  decode(decoder: object, bytes: Buffer | Uint8Array): DecodedEvent[]
}
