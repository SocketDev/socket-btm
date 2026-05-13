/**
 * @fileoverview Unit tests for node:smol-ffi/bun (system Node baseline).
 *
 * On system Node, `node:smol-ffi/bun` is NOT a builtin. The
 * integration suite asserts the inverse on the built smol binary.
 *
 * The /bun subpath is a pure-JS adapter that reshapes the canonical
 * smol-ffi surface into the bun:ffi shape (FFIType, CString, dlopen
 * with { args, returns } per-symbol definitions, etc.). Most of the
 * surface is testable via shape assertions; JSCallback/CFunction/
 * linkSymbols are deferred to Phase 2 and throw ENOTIMPL.
 */

import { builtinModules, isBuiltin } from 'node:module'

describe('node:smol-ffi/bun (system Node)', () => {
  it('isBuiltin() reports false on system Node', () => {
    expect(isBuiltin('node:smol-ffi/bun')).toBe(false)
    expect(isBuiltin('smol-ffi/bun')).toBe(false)
  })

  it('builtinModules does not include smol-ffi/bun on system Node', () => {
    expect(builtinModules).not.toContain('smol-ffi/bun')
    expect(builtinModules).not.toContain('node:smol-ffi/bun')
  })
})
