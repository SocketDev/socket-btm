/**
 * @fileoverview Tests for curl-builder library exports.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { curlExistsAt, getCheckpointChain } from '../lib/ensure-curl.mts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.join(__dirname, '..')

describe('curl-builder', () => {
  describe(curlExistsAt, () => {
    it('should return false for non-existent directory', () => {
      const result = curlExistsAt('/non/existent/path')
      expect(result).toBeFalsy()
    })

    it('should return false for empty directory', () => {
      const result = curlExistsAt(packageRoot)
      expect(result).toBeFalsy()
    })
  })

  describe(getCheckpointChain, () => {
    it('should return an array of checkpoint names', () => {
      const chain = getCheckpointChain()
      expect(Array.isArray(chain)).toBeTruthy()
      expect(chain.length).toBeGreaterThan(0)
    })

    it('should contain finalized checkpoint', () => {
      const chain = getCheckpointChain()
      expect(chain.some(c => c.includes('finalized'))).toBeTruthy()
    })
  })
})
