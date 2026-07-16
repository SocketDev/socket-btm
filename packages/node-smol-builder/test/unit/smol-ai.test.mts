import { builtinModules, isBuiltin } from 'node:module'

import { describe, expect, it } from 'vitest'

describe('node:smol-ai on system Node', () => {
  it('does not claim the socket-built Prompt API', () => {
    expect(isBuiltin('node:smol-ai')).toBe(false)
    expect(isBuiltin('smol-ai')).toBe(false)
    expect(builtinModules).not.toContain('node:smol-ai')
  })
})
