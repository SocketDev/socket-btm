/**
 * @fileoverview Tests for lief-builder library exports.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  getLiefLibPath,
  liefExists,
  liefExistsAt,
} from '../lib/ensure-lief.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.join(__dirname, '..')

describe('lief-builder', () => {
  describe('liefExistsAt', () => {
    it('should return false for non-existent directory', () => {
      const result = liefExistsAt('/non/existent/path')
      expect(result).toBe(false)
    })

    it('should return false for empty directory', () => {
      const result = liefExistsAt(packageRoot)
      expect(result).toBe(false)
    })
  })

  describe('liefExists', () => {
    it('should return boolean', () => {
      const result = liefExists()
      expect(typeof result).toBe('boolean')
    })

    it('should accept build mode parameter', () => {
      const devResult = liefExists('dev')
      const prodResult = liefExists('prod')
      expect(typeof devResult).toBe('boolean')
      expect(typeof prodResult).toBe('boolean')
    })
  })

  describe('getLiefLibPath', () => {
    it('should return null or string', () => {
      const result = getLiefLibPath()
      expect(result === null || typeof result === 'string').toBe(true)
    })

    it('should accept build mode parameter', () => {
      const devResult = getLiefLibPath('dev')
      const prodResult = getLiefLibPath('prod')
      expect(devResult === null || typeof devResult === 'string').toBe(true)
      expect(prodResult === null || typeof prodResult === 'string').toBe(true)
    })
  })
})
