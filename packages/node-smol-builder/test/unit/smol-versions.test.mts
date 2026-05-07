/**
 * @fileoverview Unit tests for node:smol-versions (system Node baseline).
 *
 * On system Node, `node:smol-versions` is NOT a builtin. The integration
 * suite asserts the inverse on the built smol binary.
 */

import { builtinModules, isBuiltin } from 'node:module'

describe('node:smol-versions (system Node)', () => {
  it('isBuiltin() reports false on system Node', () => {
    expect(isBuiltin('node:smol-versions')).toBe(false)
    expect(isBuiltin('smol-versions')).toBe(false)
  })

  it('builtinModules does not include smol-versions on system Node', () => {
    expect(builtinModules).not.toContain('smol-versions')
    expect(builtinModules).not.toContain('node:smol-versions')
  })
})
