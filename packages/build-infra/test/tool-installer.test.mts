/**
 * @fileoverview Tests for tool-installer utilities.
 */

import { describe, expect, it } from 'vitest'

import {
  checkElevatedPrivileges,
  detectPackageManagers,
  getInstallInstructions,
  getPackageManagerInstructions,
  getPreferredPackageManager,
} from '../lib/tool-installer.mjs'

describe('tool-installer', () => {
  describe('detectPackageManagers', () => {
    it('should return array of available package managers', () => {
      const managers = detectPackageManagers()
      expect(Array.isArray(managers)).toBe(true)
    })

    it('should return empty array on unsupported platform', () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'unknown' })
      const managers = detectPackageManagers()
      expect(managers).toEqual([])
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    })
  })

  describe('getPreferredPackageManager', () => {
    it('should return string or null', () => {
      const preferred = getPreferredPackageManager()
      expect(typeof preferred === 'string' || preferred === null).toBe(true)
    })

    it('should return undefined for unsupported platform', () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'unknown' })
      const preferred = getPreferredPackageManager()
      expect(preferred).toBeUndefined()
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    })
  })

  describe('getPackageManagerInstructions', () => {
    it('should return array of instruction strings', () => {
      const instructions = getPackageManagerInstructions()
      expect(Array.isArray(instructions)).toBe(true)
      expect(instructions.length).toBeGreaterThan(0)
      expect(typeof instructions[0]).toBe('string')
    })
  })

  describe('checkElevatedPrivileges', () => {
    it('should return boolean', async () => {
      const hasPrivileges = await checkElevatedPrivileges()
      expect(typeof hasPrivileges).toBe('boolean')
    })
  })

  describe('getInstallInstructions', () => {
    it('should return instruction strings for known tool', () => {
      const instructions = getInstallInstructions('cmake')
      expect(Array.isArray(instructions)).toBe(true)
      expect(instructions.length).toBeGreaterThan(0)
    })

    it('should return error for unknown tool', () => {
      const instructions = getInstallInstructions('nonexistent-tool-xyz')
      expect(Array.isArray(instructions)).toBe(true)
      expect(instructions[0]).toContain('Unknown tool')
    })
  })
})
