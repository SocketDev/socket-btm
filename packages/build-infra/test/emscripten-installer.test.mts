/**
 * @fileoverview Tests for emscripten-installer utilities.
 */

import {
  checkEmscriptenAvailable,
  checkEmsdkInstalled,
  getDefaultEmsdkPath,
  getEmscriptenInstructions,
  getEmsdkPath,
} from '../lib/emscripten-installer.mjs'

describe('emscripten-installer', () => {
  describe(getDefaultEmsdkPath, () => {
    it('should return default emsdk path', () => {
      const path = getDefaultEmsdkPath()
      expectTypeOf(path).toBeString()
      expect(path.length).toBeGreaterThan(0)
    })
  })

  describe(getEmsdkPath, () => {
    it('should return emsdk path', () => {
      const path = getEmsdkPath()
      expectTypeOf(path).toBeString()
      expect(path.length).toBeGreaterThan(0)
    })
  })

  describe(checkEmscriptenAvailable, () => {
    it('should return boolean availability status', () => {
      const result = checkEmscriptenAvailable()
      expectTypeOf(result).toBeBoolean()
    })
  })

  describe(checkEmsdkInstalled, () => {
    it('should return boolean', () => {
      const installed = checkEmsdkInstalled()
      expectTypeOf(installed).toBeBoolean()
    })
  })

  describe(getEmscriptenInstructions, () => {
    it('should return array of instruction strings', () => {
      const instructions = getEmscriptenInstructions()
      expect(Array.isArray(instructions)).toBeTruthy()
      expect(instructions.length).toBeGreaterThan(0)
      expectTypeOf(instructions[0]).toBeString()
    })

    it('should handle custom install path', () => {
      const instructions = getEmscriptenInstructions({
        installPath: '/custom/path',
      })
      expect(Array.isArray(instructions)).toBeTruthy()
      expect(instructions.some(i => i.includes('/custom/path'))).toBeTruthy()
    })
  })
})
