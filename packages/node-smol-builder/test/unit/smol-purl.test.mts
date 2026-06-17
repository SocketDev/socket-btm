/**
 * @fileoverview Unit tests for node:smol-purl (system Node baseline).
 *
 * On system Node, `node:smol-purl` is NOT a builtin. The integration
 * suite asserts the inverse on the built smol binary.
 */

import { describe, expect, it } from 'vitest'

import { builtinModules, isBuiltin } from 'node:module'

describe('node:smol-purl (system Node)', () => {
  it('isBuiltin() reports false on system Node', () => {
    expect(isBuiltin('node:smol-purl')).toBe(false)
    expect(isBuiltin('smol-purl')).toBe(false)
  })

  it('builtinModules does not include smol-purl on system Node', () => {
    expect(builtinModules).not.toContain('smol-purl')
    expect(builtinModules).not.toContain('node:smol-purl')
  })
})
