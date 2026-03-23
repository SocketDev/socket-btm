import process from 'node:process'

/**
 * @fileoverview Tests for tool-installer utilities.
 */

import {
  checkElevatedPrivileges,
  detectPackageManagers,
  getInstallInstructions,
  getPackageManagerInstructions,
  getPreferredPackageManager,
} from '../lib/tool-installer.mjs'

describe('tool-installer', () => {
  describe(detectPackageManagers, () => {
    it('should return array of available package managers', () => {
      const managers = detectPackageManagers()
      expect(Array.isArray(managers)).toBeTruthy()
    })

    it('should return empty array on unsupported platform', () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'unknown' })
      const managers = detectPackageManagers()
      expect(managers).toStrictEqual([])
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    })
  })

  describe(getPreferredPackageManager, () => {
    it('should return string or null', () => {
      const preferred = getPreferredPackageManager()
      expect(typeof preferred === 'string' || preferred === null).toBeTruthy()
    })

    it('should return undefined for unsupported platform', () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'unknown' })
      const preferred = getPreferredPackageManager()
      expect(preferred).toBeUndefined()
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    })
  })

  describe(getPackageManagerInstructions, () => {
    it('should return array of instruction strings', () => {
      const instructions = getPackageManagerInstructions()
      expect(Array.isArray(instructions)).toBeTruthy()
      expect(instructions.length).toBeGreaterThan(0)
      expectTypeOf(instructions[0]).toBeString()
    })
  })

  describe(checkElevatedPrivileges, () => {
    it('should return boolean', async () => {
      const hasPrivileges = await checkElevatedPrivileges()
      expectTypeOf(hasPrivileges).toBeBoolean()
    })
  })

  describe(getInstallInstructions, () => {
    it('should return instruction strings for known tool', () => {
      const instructions = getInstallInstructions('cmake')
      expect(Array.isArray(instructions)).toBeTruthy()
      expect(instructions.length).toBeGreaterThan(0)
    })

    it('should return error for unknown tool', () => {
      const instructions = getInstallInstructions('nonexistent-tool-xyz')
      expect(Array.isArray(instructions)).toBeTruthy()
      expect(instructions[0]).toContain('Unknown tool')
    })
  })
})
