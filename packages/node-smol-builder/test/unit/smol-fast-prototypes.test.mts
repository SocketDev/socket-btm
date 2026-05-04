/**
 * @fileoverview Unit tests for node:smol-fast-prototypes (system Node baseline).
 *
 * On system Node, `node:smol-fast-prototypes` is NOT a builtin. The
 * integration suite asserts the inverse on the built smol binary.
 */

import { builtinModules, isBuiltin } from 'node:module'

describe('node:smol-fast-prototypes (system Node)', () => {
  it('isBuiltin() reports false on system Node', () => {
    expect(isBuiltin('node:smol-fast-prototypes')).toBe(false)
    expect(isBuiltin('smol-fast-prototypes')).toBe(false)
  })

  it('builtinModules does not include smol-fast-prototypes on system Node', () => {
    expect(builtinModules).not.toContain('smol-fast-prototypes')
    expect(builtinModules).not.toContain('node:smol-fast-prototypes')
  })
})
