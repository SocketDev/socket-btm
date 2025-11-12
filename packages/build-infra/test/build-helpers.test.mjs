/**
 * @fileoverview Tests for build-helpers utilities (pure functions).
 */

import { describe, expect, it } from 'vitest'

import { estimateBuildTime, formatDuration } from '../lib/build-helpers.mjs'

describe('build-helpers', () => {
  describe('formatDuration', () => {
    it('should format seconds', () => {
      expect(formatDuration(0)).toBe('0s')
      expect(formatDuration(30 * 1000)).toBe('30s')
      expect(formatDuration(59 * 1000)).toBe('59s')
    })

    it('should format minutes and seconds', () => {
      expect(formatDuration(60 * 1000)).toBe('1m 0s')
      expect(formatDuration(90 * 1000)).toBe('1m 30s')
      expect(formatDuration(119 * 1000)).toBe('1m 59s')
      expect(formatDuration(3599 * 1000)).toBe('59m 59s')
    })

    it('should format hours and minutes', () => {
      expect(formatDuration(3600 * 1000)).toBe('1h 0m')
      expect(formatDuration(3660 * 1000)).toBe('1h 1m')
      expect(formatDuration(7200 * 1000)).toBe('2h 0m')
      expect(formatDuration(86_399 * 1000)).toBe('23h 59m')
    })

    it('should handle fractional seconds', () => {
      expect(formatDuration(1500)).toBe('1s')
      expect(formatDuration(59_900)).toBe('59s')
      expect(formatDuration(60_100)).toBe('1m 0s')
    })

    it('should handle very large values', () => {
      expect(formatDuration(100_000 * 1000)).toBe('27h 46m')
    })
  })

  describe('estimateBuildTime', () => {
    it('should estimate single-core build time', () => {
      // With 1 core: no parallelization benefit
      const result = estimateBuildTime(60, 1)
      expect(result).toBe(60)
    })

    it("should apply Amdahl's law with 80% parallelization (default)", () => {
      // With 60 minutes and 80% parallelizable work on 4 cores:
      // Result = 60 * (0.2 + 0.8/4) = 60 * 0.4 = 24 minutes
      const result = estimateBuildTime(60, 4)
      expect(result).toBe(24)
    })

    it('should reduce time with more cores', () => {
      const base = estimateBuildTime(60, 1)
      const twoCore = estimateBuildTime(60, 2)
      const fourCore = estimateBuildTime(60, 4)

      expect(twoCore).toBeLessThan(base)
      expect(fourCore).toBeLessThan(twoCore)
    })

    it("should show diminishing returns (Amdahl's law)", () => {
      const base = estimateBuildTime(100, 2)
      const double = estimateBuildTime(100, 4)
      const quad = estimateBuildTime(100, 8)

      // Improvement from 2→4 cores should be greater than 4→8
      const improvement1 = base - double
      const improvement2 = double - quad
      expect(improvement2).toBeLessThan(improvement1)
    })

    it('should handle edge cases', () => {
      expect(estimateBuildTime(0, 4)).toBe(0)
      expect(estimateBuildTime(100, 1)).toBe(100)
    })

    it('should always return integer minutes (ceiling)', () => {
      // Should round up to nearest minute
      const result = estimateBuildTime(60, 3)
      expect(Number.isInteger(result)).toBe(true)
      expect(result).toBeGreaterThan(0)
    })
  })
})
