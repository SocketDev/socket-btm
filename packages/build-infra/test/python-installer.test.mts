/**
 * @fileoverview Tests for python-installer utilities.
 */

import {
  checkPipAvailable,
  getPipCommand,
  getPythonPackageInstructions,
} from '../lib/python-installer.mts'

describe('python-installer', () => {
  describe(checkPipAvailable, () => {
    it('should return boolean', () => {
      const available = checkPipAvailable()
      expectTypeOf(available).toBeBoolean()
    })
  })

  describe(getPipCommand, () => {
    it('should return pip command', () => {
      const command = getPipCommand()
      // Can be string or null if pip is not installed
      if (command !== null) {
        expectTypeOf(command).toBeString()
        expect(command.length).toBeGreaterThan(0)
      } else {
        expect(command).toBeNull()
      }
    })
  })

  describe(getPythonPackageInstructions, () => {
    it('should return array of instruction strings', () => {
      // Note: getPythonPackageInstructions requires packages to be defined
      // in external-tools.json with type: "python". Since the core external-tools.json
      // doesn't include Python packages, we test with empty list.
      const instructions = getPythonPackageInstructions([])
      expect(Array.isArray(instructions)).toBeTruthy()
      expect(instructions.length).toBeGreaterThan(0)
      expectTypeOf(instructions[0]).toBeString()
    })

    it('should handle empty package list', () => {
      const instructions = getPythonPackageInstructions([])
      expect(Array.isArray(instructions)).toBeTruthy()
    })
  })
})
