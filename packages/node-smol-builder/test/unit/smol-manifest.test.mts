/**
 * @fileoverview Unit tests for node:smol-manifest (system Node baseline).
 *
 * On system Node, `node:smol-manifest` is NOT a builtin. The integration
 * suite asserts the inverse on the built smol binary.
 */

import { builtinModules, isBuiltin } from 'node:module'

describe('node:smol-manifest (system Node)', () => {
  it('isBuiltin() reports false on system Node', () => {
    expect(isBuiltin('node:smol-manifest')).toBe(false)
    expect(isBuiltin('smol-manifest')).toBe(false)
  })

  it('builtinModules does not include smol-manifest on system Node', () => {
    expect(builtinModules).not.toContain('smol-manifest')
    expect(builtinModules).not.toContain('node:smol-manifest')
  })
})
