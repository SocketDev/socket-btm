/**
 * @fileoverview Tests for emscripten-installer utilities.
 */

import { describe, expect, it } from 'vitest'

import {
  checkEmscriptenAvailable,
  checkEmsdkInstalled,
  getDefaultEmsdkPath,
  getEmscriptenInstructions,
  getEmsdkPath,
} from '../lib/emscripten-installer.mjs'

describe('emscripten-installer', () => {
  describe('getDefaultEmsdkPath', () => {
    it('should return default emsdk path', () => {
      const path = getDefaultEmsdkPath()
      expect(typeof path).toBe('string')
      expect(path.length).toBeGreaterThan(0)
    })
  })

  describe('getEmsdkPath', () => {
    it('should return emsdk path', () => {
      const path = getEmsdkPath()
      expect(typeof path).toBe('string')
      expect(path.length).toBeGreaterThan(0)
    })
  })

  describe('checkEmscriptenAvailable', () => {
    it('should return boolean availability status', () => {
      const result = checkEmscriptenAvailable()
      expect(typeof result).toBe('boolean')
    })
  })

  describe('checkEmsdkInstalled', () => {
    it('should return boolean', () => {
      const installed = checkEmsdkInstalled()
      expect(typeof installed).toBe('boolean')
    })
  })

  describe('getEmscriptenInstructions', () => {
    it('should return array of instruction strings', () => {
      const instructions = getEmscriptenInstructions()
      expect(Array.isArray(instructions)).toBe(true)
      expect(instructions.length).toBeGreaterThan(0)
      expect(typeof instructions[0]).toBe('string')
    })

    it('should handle custom install path', () => {
      const instructions = getEmscriptenInstructions({
        installPath: '/custom/path',
      })
      expect(Array.isArray(instructions)).toBe(true)
      expect(instructions.some(i => i.includes('/custom/path'))).toBe(true)
    })
  })
})
