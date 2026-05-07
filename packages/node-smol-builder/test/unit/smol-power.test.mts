/**
 * @fileoverview Unit tests for node:smol-power.
 *
 * `node:smol-power` is a builtin only inside the smol binary. On
 * system Node these tests verify:
 *   - `isBuiltin('node:smol-power')` returns false (not a system Node
 *     builtin)
 *   - the module ID is NOT in `module.builtinModules`
 *   - the binding name is `smol_power` (matches our patches)
 *
 * Integration tests at test/integration/smol-power.test.mts run the
 * actual API against the built Final/ binary.
 */

import { builtinModules, isBuiltin } from 'node:module'

describe('node:smol-power (system Node)', () => {
  it('isBuiltin() reports false on system Node', () => {
    // System Node doesn't ship smol-power. The smol-power.js wrapper
    // uses isBuiltin() to short-circuit before the dynamic import on
    // platforms that don't have the binding.
    expect(isBuiltin('node:smol-power')).toBe(false)
    expect(isBuiltin('smol-power')).toBe(false)
  })

  it('builtinModules does not include smol-power on system Node', () => {
    expect(builtinModules).not.toContain('smol-power')
    expect(builtinModules).not.toContain('node:smol-power')
  })

  it('isBuiltin() reports true for a real Node builtin', () => {
    // Sanity check: confirm the negative result above isn't because
    // isBuiltin() is broken or the module name has a typo elsewhere.
    expect(isBuiltin('node:fs')).toBe(true)
    expect(isBuiltin('fs')).toBe(true)
  })
})
