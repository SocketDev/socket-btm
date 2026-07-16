import { describe, expect, it } from 'vitest'

import {
  parseExportShape,
  printExportShapeScript,
  runOnSmolBinary,
  smolBuiltinIsAvailable,
} from '../helpers/smol-builtin.mts'

const skipTests = !smolBuiltinIsAvailable('smol-ai')

describe.skipIf(skipTests)('node:smol-ai integration', () => {
  it('requires the node: prefix and exposes only LanguageModel', async () => {
    const { code, stdout } = await runOnSmolBinary(`
      const { isBuiltin } = require('node:module')
      console.log('prefixed=' + isBuiltin('node:smol-ai'))
      console.log('bare=' + isBuiltin('smol-ai'))
    `)
    expect(code).toBe(0)
    expect(stdout).toContain('prefixed=true')
    expect(stdout).toContain('bare=false')

    const shapeResult = await runOnSmolBinary(printExportShapeScript('smol-ai'))
    expect(shapeResult.code).toBe(0)
    expect([...parseExportShape(shapeResult.stdout)]).toEqual([
      ['LanguageModel', 'object'],
    ])
  })

  it('reports model state without starting a download', async () => {
    const { code, stdout } = await runOnSmolBinary(`
      const { LanguageModel } = require('node:smol-ai')
      Promise.all([LanguageModel.availability(), LanguageModel.params()])
        .then(([availability, params]) => {
          console.log(JSON.stringify({ availability, params }))
        })
    `)
    expect(code).toBe(0)
    const result = JSON.parse(stdout.trim()) as {
      availability: string
      params: { defaultTemperature: number; defaultTopK: number }
    }
    expect(['available', 'downloadable']).toContain(result.availability)
    expect(result.params).toMatchObject({
      defaultTemperature: 0,
      defaultTopK: 1,
    })
  })
})
