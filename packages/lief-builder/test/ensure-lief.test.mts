/**
 * @fileoverview Tests for lief-builder library exports.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  getLiefLibPath,
  liefExists,
  liefExistsAt,
} from '../lib/ensure-lief.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.join(__dirname, '..')

describe('lief-builder', () => {
  describe(liefExistsAt, () => {
    it('should return false for non-existent directory', () => {
      const result = liefExistsAt('/non/existent/path')
      expect(result).toBeFalsy()
    })

    it('should return false for empty directory', () => {
      const result = liefExistsAt(packageRoot)
      expect(result).toBeFalsy()
    })
  })

  describe(liefExists, () => {
    it('should return boolean', () => {
      const result = liefExists()
      expectTypeOf(result).toBeBoolean()
    })

    it('should accept build mode parameter', () => {
      const devResult = liefExists('dev')
      const prodResult = liefExists('prod')
      expectTypeOf(devResult).toBeBoolean()
      expectTypeOf(prodResult).toBeBoolean()
    })
  })

  describe(getLiefLibPath, () => {
    it('should return undefined or string', () => {
      const result = getLiefLibPath()
      expect(result === undefined || typeof result === 'string').toBeTruthy()
    })

    it('should accept build mode parameter', () => {
      const devResult = getLiefLibPath('dev')
      const prodResult = getLiefLibPath('prod')
      expect(
        devResult === undefined || typeof devResult === 'string',
      ).toBeTruthy()
      expect(
        prodResult === undefined || typeof prodResult === 'string',
      ).toBeTruthy()
    })
  })
})
