/**
 * @fileoverview Unit tests for node:smol-primordials (system Node baseline).
 *
 * On system Node, `node:smol-primordials` is NOT a builtin. The
 * integration suite asserts the inverse on the built smol binary.
 */

import { builtinModules, isBuiltin } from 'node:module'

describe('node:smol-primordials (system Node)', () => {
  it('isBuiltin() reports false on system Node', () => {
    expect(isBuiltin('node:smol-primordials')).toBe(false)
    expect(isBuiltin('smol-primordials')).toBe(false)
  })

  it('builtinModules does not include smol-primordials on system Node', () => {
    expect(builtinModules).not.toContain('smol-primordials')
    expect(builtinModules).not.toContain('node:smol-primordials')
  })
})
