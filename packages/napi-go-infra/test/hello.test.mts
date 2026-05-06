/**
 * Integration test: builds napi-go's hello reference binding and
 * asserts each exported function round-trips correctly.
 */

import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { getCurrentPlatformArch } from 'build-infra/lib/platform-mappings'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const require = createRequire(import.meta.url)

async function loadHello() {
  const platformArch = await getCurrentPlatformArch()
  const addonPath = path.resolve(
    __dirname,
    '..',
    'lib',
    platformArch,
    'hello.node',
  )
  return require(addonPath)
}

describe('napi-go hello binding', () => {
  it('uppercases a string', async () => {
    const addon = await loadHello()
    expect(addon.uppercase('hello from go')).toBe('HELLO FROM GO')
  })

  it('adds two integers', async () => {
    const addon = await loadHello()
    expect(addon.add(2, 40)).toBe(42)
  })

  it('round-trips an object with nested properties', async () => {
    const addon = await loadHello()
    const out = addon.echoObject({ name: 'world', n: 21 })
    expect(out).toStrictEqual({ greeting: 'hello, world', doubled: 42 })
  })

  it('round-trips a wrapped Go object through multiple calls', async () => {
    const addon = await loadHello()
    const b = addon.newBuilder('ping')
    expect(addon.buildNext(b)).toBe('ping #1')
    expect(addon.buildNext(b)).toBe('ping #2')
    expect(addon.buildNext(b)).toBe('ping #3')
  })

  it('surfaces Go errors as JS exceptions', async () => {
    const addon = await loadHello()
    expect(() => addon.add()).toThrow(/expected 2 arguments/)
  })

  it('handles large strings', async () => {
    const addon = await loadHello()
    const big = 'x'.repeat(100_000)
    const out = addon.uppercase(big)
    expect(out.length).toBe(big.length)
    expect(out[0]).toBe('X')
  })
})
