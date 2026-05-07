/**
 * @fileoverview Unit tests for node:smol-ffi (system Node baseline).
 *
 * Mirrors the smol-power unit suite: on system Node, `node:smol-ffi`
 * is NOT a builtin. The integration suite asserts the inverse on the
 * built smol binary.
 */

import { builtinModules, isBuiltin } from 'node:module'

describe('node:smol-ffi (system Node)', () => {
  it('isBuiltin() reports false on system Node', () => {
    expect(isBuiltin('node:smol-ffi')).toBe(false)
    expect(isBuiltin('smol-ffi')).toBe(false)
  })

  it('builtinModules does not include smol-ffi on system Node', () => {
    expect(builtinModules).not.toContain('smol-ffi')
    expect(builtinModules).not.toContain('node:smol-ffi')
  })
})
