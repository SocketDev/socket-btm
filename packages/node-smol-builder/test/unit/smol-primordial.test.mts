/**
 * @fileoverview Unit tests for node:smol-primordial (system Node baseline).
 *
 * On system Node, `node:smol-primordial` is NOT a builtin. The
 * integration suite asserts the inverse on the built smol binary.
 */

import { builtinModules, isBuiltin } from 'node:module'

describe('node:smol-primordial (system Node)', () => {
  it('isBuiltin() reports false on system Node', () => {
    expect(isBuiltin('node:smol-primordial')).toBe(false)
    expect(isBuiltin('smol-primordial')).toBe(false)
  })

  it('builtinModules does not include smol-primordial on system Node', () => {
    expect(builtinModules).not.toContain('smol-primordial')
    expect(builtinModules).not.toContain('node:smol-primordial')
  })
})
