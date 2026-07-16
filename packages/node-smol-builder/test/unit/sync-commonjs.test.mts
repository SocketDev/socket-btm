import { describe, expect, it } from 'vitest'

import {
  convertToCommonJS,
  toInternalPath,
} from '../../scripts/vendor-fast-webstreams/sync-commonjs.mts'

describe(convertToCommonJS, () => {
  it('converts named imports and local exports', () => {
    const converted = convertToCommonJS(
      "import { alpha as beta } from './dep.js'\nexport const value = beta\n",
      'example.js',
    )

    expect(converted).toContain(
      "const { alpha: beta } = require('internal/deps/fast-webstreams/dep')",
    )
    expect(converted).toContain('const value = beta')
    expect(converted).toContain('exports.value = value;')
  })

  it('preserves aliases when converting re-exports', () => {
    const converted = convertToCommonJS(
      "export { alpha as beta } from './dep.js'\n",
      'example.js',
    )

    expect(converted).toContain(
      "const _reexport_0 = require('internal/deps/fast-webstreams/dep')",
    )
    expect(converted).toContain('exports.beta = _reexport_0.alpha;')
  })
})

describe(toInternalPath, () => {
  it('maps relative vendor paths and preserves external paths', () => {
    expect(toInternalPath('./reader.js')).toBe(
      'internal/deps/fast-webstreams/reader',
    )
    expect(toInternalPath('../shared.js')).toBe('internal/deps/shared')
    expect(toInternalPath('node:stream')).toBe('node:stream')
  })
})
