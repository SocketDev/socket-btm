/**
 * Simple state-only tests to isolate tokio runtime issues
 */

import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const require = createRequire(import.meta.url)

const bindingPath = path.join(
  __dirname,
  '../build/dev/out/darwin-arm64/iocraft.node',
)
const bindingExists = existsSync(bindingPath)

const nativeBinding = bindingExists ? require(bindingPath) : undefined
const JsStateHandle = nativeBinding?.JsStateHandle

describe.skipIf(!bindingExists)('JsStateHandle (isolated)', () => {
  it('creates and reads state', () => {
    const handle = new JsStateHandle(42)
    expect(handle.get()).toBe(42)
  })

  it('sets state', () => {
    const handle = new JsStateHandle(0)
    handle.set(10)
    expect(handle.get()).toBe(10)
  })
})
