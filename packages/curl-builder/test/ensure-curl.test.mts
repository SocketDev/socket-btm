/**
 * @fileoverview Tests for curl-builder library exports.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { curlExistsAt, getCheckpointChain } from '../lib/ensure-curl.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.join(__dirname, '..')

describe('curl-builder', () => {
  describe('curlExistsAt', () => {
    it('should return false for non-existent directory', () => {
      const result = curlExistsAt('/non/existent/path')
      expect(result).toBe(false)
    })

    it('should return false for empty directory', () => {
      const result = curlExistsAt(packageRoot)
      expect(result).toBe(false)
    })
  })

  describe('getCheckpointChain', () => {
    it('should return an array of checkpoint names', () => {
      const chain = getCheckpointChain()
      expect(Array.isArray(chain)).toBe(true)
      expect(chain.length).toBeGreaterThan(0)
    })

    it('should contain finalized checkpoint', () => {
      const chain = getCheckpointChain()
      expect(chain.some(c => c.includes('finalized'))).toBe(true)
    })
  })
})
