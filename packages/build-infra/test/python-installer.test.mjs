/**
 * @fileoverview Tests for python-installer utilities.
 */

import { describe, expect, it } from 'vitest'

import {
  checkPipAvailable,
  getPipCommand,
  getPythonPackageInstructions,
} from '../lib/python-installer.mjs'

describe('python-installer', () => {
  describe('checkPipAvailable', () => {
    it('should return boolean', () => {
      const available = checkPipAvailable()
      expect(typeof available).toBe('boolean')
    })
  })

  describe('getPipCommand', () => {
    it('should return pip command', () => {
      const command = getPipCommand()
      // Can be string or null if pip is not installed
      if (command !== null) {
        expect(typeof command).toBe('string')
        expect(command.length).toBeGreaterThan(0)
      } else {
        expect(command).toBe(null)
      }
    })
  })

  describe('getPythonPackageInstructions', () => {
    it('should return array of instruction strings', () => {
      // Note: getPythonPackageInstructions requires packages to be defined
      // in external-tools.json with type: "python". Since the core external-tools.json
      // doesn't include Python packages, we test with empty list.
      const instructions = getPythonPackageInstructions([])
      expect(Array.isArray(instructions)).toBe(true)
      expect(instructions.length).toBeGreaterThan(0)
      expect(typeof instructions[0]).toBe('string')
    })

    it('should handle empty package list', () => {
      const instructions = getPythonPackageInstructions([])
      expect(Array.isArray(instructions)).toBe(true)
    })
  })
})
