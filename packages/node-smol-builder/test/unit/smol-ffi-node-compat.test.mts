/**
 * @fileoverview Unit tests for node:smol-ffi/node (system Node baseline).
 *
 * On system Node, `node:smol-ffi/node` is NOT a builtin — neither the
 * canonical smol-ffi nor its /node subpath ship in stock Node. The
 * integration suite asserts the inverse on the built smol binary.
 *
 * The /node subpath is a thin forwarder to upstream `node:ffi` (Node
 * v26.1.0+ experimental). On older Node versions where `node:ffi`
 * isn't built in, the forwarder exports `{ __notAvailable__: true }`
 * as a sentinel. The integration suite covers both branches; the
 * unit suite just locks the schemeless-blocklist behavior.
 */

import { describe, expect, it } from 'vitest'

import { builtinModules, isBuiltin } from 'node:module'

describe('node:smol-ffi/node (system Node)', () => {
  it('isBuiltin() reports false on system Node', () => {
    expect(isBuiltin('node:smol-ffi/node')).toBe(false)
    expect(isBuiltin('smol-ffi/node')).toBe(false)
  })

  it('builtinModules does not include smol-ffi/node on system Node', () => {
    expect(builtinModules).not.toContain('smol-ffi/node')
    expect(builtinModules).not.toContain('node:smol-ffi/node')
  })
})
