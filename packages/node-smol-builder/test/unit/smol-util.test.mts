/**
 * @file Unit tests for node:smol-util (system Node baseline).
 *   On system Node, `node:smol-util` is NOT a builtin. The integration
 *   suite asserts the inverse on the built smol binary.
 */

import { describe, expect, it } from 'vitest'

import { builtinModules, isBuiltin } from 'node:module'

describe('node:smol-util (system Node)', () => {
  it('isBuiltin() reports false on system Node', () => {
    expect(isBuiltin('node:smol-util')).toBe(false)
    expect(isBuiltin('smol-util')).toBe(false)
  })

  it('builtinModules does not include smol-util on system Node', () => {
    expect(builtinModules).not.toContain('smol-util')
    expect(builtinModules).not.toContain('node:smol-util')
  })
})
