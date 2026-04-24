/**
 * ultraviolet-builder — Node.js bindings for Charmbracelet Ultraviolet.
 *
 * Loads the platform-specific .node artifact built by scripts/build.mts.
 */

import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getCurrentPlatformArch } from 'build-infra/lib/platform-mappings'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const require = createRequire(import.meta.url)

/**
 * @typedef KeyEvent
 * @property {'KeyPress' | 'KeyRelease'} type
 * @property {number} code
 * @property {number} mod
 * @property {string} text
 * @property {boolean} isRepeat
 */

/**
 * @typedef MouseEvent
 * @property {'MouseClick' | 'MouseRelease' | 'MouseWheel' | 'MouseMotion'} type
 * @property {number} x
 * @property {number} y
 * @property {number} button
 * @property {number} mod
 */

/**
 * @typedef WindowSizeEvent
 * @property {'WindowSize'} type
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef SimpleEvent
 * @property {'PasteStart' | 'PasteEnd' | 'Focus' | 'Blur'} type
 */

/**
 * @typedef PasteEvent
 * @property {'Paste'} type
 * @property {string} text
 */

/**
 * @typedef UnknownEvent
 * @property {'Unknown' | 'Unhandled'} type
 * @property {string} [raw]
 * @property {string} [go]
 */

/**
 * @typedef {KeyEvent | MouseEvent | WindowSizeEvent | SimpleEvent | PasteEvent | UnknownEvent} DecodedEvent
 */

/**
 * @typedef Native
 * @property {() => object} newDecoder
 * @property {(decoder: object, bytes: Buffer | Uint8Array) => DecodedEvent[]} decode
 */

/**
 * Load the native binding for the current platform-arch.
 *
 * @returns {Promise<Native>}
 */
export async function load() {
  const platformArch = await getCurrentPlatformArch()
  const addonPath = path.resolve(
    __dirname,
    '..',
    'lib',
    platformArch,
    'ultraviolet.node',
  )
  return require(addonPath)
}
