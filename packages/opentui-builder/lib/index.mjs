import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

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
  win32: { __proto__: null, arm64: 'aarch64-windows-gnu', x64: 'x86_64-windows-gnu' },
}

const EXT_MAP = { __proto__: null, darwin: 'dylib', linux: 'so', win32: 'dll' }
const PREFIX_MAP = { __proto__: null, darwin: 'lib', linux: 'lib', win32: '' }

const PLATFORM_ARCH_MAP = {
  __proto__: null,
  darwin: 'darwin',
  linux: 'linux',
  win32: 'win',
}

function detectMusl() {
  if (process.platform !== 'linux') return false
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
    const { execFileSync } = require('node:child_process')
    const lddOutput = execFileSync('ldd', ['--version'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    if (/musl/i.test(lddOutput)) return true
  } catch (e) {
    if (e && typeof e.stderr === 'string' && /musl/i.test(e.stderr)) return true
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
  const platformArch = `${osPart}-${arch}`

  const candidates = [
    path.join(__dirname, '..', 'build', 'dev', platformArch, 'out', platformArch, 'opentui.node'),
    path.join(__dirname, '..', 'build', 'prod', platformArch, 'out', platformArch, 'opentui.node'),
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

export const WidthMethod = { __proto__: null, WCWIDTH: 0, UNICODE: 1, NO_ZWJ: 2 }

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

  get r() { return this.buffer[0] }
  set r(v) { this.buffer[0] = v }

  get g() { return this.buffer[1] }
  set g(v) { this.buffer[1] = v }

  get b() { return this.buffer[2] }
  set b(v) { this.buffer[2] = v }

  get a() { return this.buffer[3] }
  set a(v) { this.buffer[3] = v }

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
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3]
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
    rgba.buffer = array instanceof Float32Array ? array : new Float32Array(array)
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
    const components = this.a === 1
      ? [this.r, this.g, this.b]
      : [this.r, this.g, this.b, this.a]
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
    if (!other) return false
    return this.r === other.r && this.g === other.g && this.b === other.b && this.a === other.a
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
