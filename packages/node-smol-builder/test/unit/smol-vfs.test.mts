/**
 * @file Unit tests for node:smol-vfs (system Node baseline).
 *   On system Node, `node:smol-vfs` is NOT a builtin. The integration
 *   suite (smol-vfs-api.test.mts + vfs.test.mts) asserts the inverse on
 *   the built smol binary.
 */

import { describe, expect, it, test } from 'vitest'

import { builtinModules, isBuiltin } from 'node:module'

describe('node:smol-vfs (system Node)', () => {
  it('isBuiltin() reports false on system Node', () => {
    expect(isBuiltin('node:smol-vfs')).toBe(false)
    expect(isBuiltin('smol-vfs')).toBe(false)
  })

  it('builtinModules does not include smol-vfs on system Node', () => {
    expect(builtinModules).not.toContain('smol-vfs')
    expect(builtinModules).not.toContain('node:smol-vfs')
  })
})
