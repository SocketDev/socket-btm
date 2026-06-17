/**
 * @file Unit tests for node:smol-http (system Node baseline).
 *   On system Node, `node:smol-http` is NOT a builtin. The integration
 *   suite asserts the inverse on the built smol binary.
 */

import { describe, expect, it } from 'vitest'

import { builtinModules, isBuiltin } from 'node:module'

describe('node:smol-http (system Node)', () => {
  it('isBuiltin() reports false on system Node', () => {
    expect(isBuiltin('node:smol-http')).toBe(false)
    expect(isBuiltin('smol-http')).toBe(false)
  })

  it('builtinModules does not include smol-http on system Node', () => {
    expect(builtinModules).not.toContain('smol-http')
    expect(builtinModules).not.toContain('node:smol-http')
  })
})
