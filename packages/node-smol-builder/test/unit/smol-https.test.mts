/**
 * @file Unit tests for node:smol-https (system Node baseline).
 *   On system Node, `node:smol-https` is NOT a builtin. The integration
 *   suite asserts the inverse on the built smol binary plus the explicit
 *   TLS-required error semantics encoded in the JS shim.
 */

import { describe, expect, it } from 'vitest'

import { builtinModules, isBuiltin } from 'node:module'

describe('node:smol-https (system Node)', () => {
  it('isBuiltin() reports false on system Node', () => {
    expect(isBuiltin('node:smol-https')).toBe(false)
    expect(isBuiltin('smol-https')).toBe(false)
  })

  it('builtinModules does not include smol-https on system Node', () => {
    expect(builtinModules).not.toContain('smol-https')
    expect(builtinModules).not.toContain('node:smol-https')
  })
})
