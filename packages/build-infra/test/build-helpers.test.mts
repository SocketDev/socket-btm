/**
 * @file Tests for build-helpers utilities (pure functions).
 */

import { describe, expect, it } from 'vitest'

import {
  estimateBuildTime,
  formatDuration,
  selectCrossCompileSmokeTestStrategy,
} from '../lib/build-helpers.mts'

describe('build-helpers', () => {
  describe(formatDuration, () => {
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

  describe(estimateBuildTime, () => {
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
      expect(Number.isInteger(result)).toBeTruthy()
      expect(result).toBeGreaterThan(0)
    })
  })

  describe(selectCrossCompileSmokeTestStrategy, () => {
    it('picks docker-musl when Docker is available for a linux musl target', () => {
      const strategy = selectCrossCompileSmokeTestStrategy({
        hasDocker: true,
        hostArch: 'x64',
        hostPlatform: 'linux',
        isMusl: true,
        targetArch: 'x64',
      })
      expect(strategy).toBe('docker-musl')
    })

    it('falls back to docker-static when Docker is unavailable for a linux musl target', () => {
      const strategy = selectCrossCompileSmokeTestStrategy({
        hasDocker: false,
        hostArch: 'x64',
        hostPlatform: 'linux',
        isMusl: true,
        targetArch: 'x64',
      })
      expect(strategy).toBe('docker-static')
    })

    it('picks qemu-arm64 when QEMU is available for a linux x64->arm64 cross-compile', () => {
      const strategy = selectCrossCompileSmokeTestStrategy({
        hasQemu: true,
        hostArch: 'x64',
        hostPlatform: 'linux',
        targetArch: 'arm64',
      })
      expect(strategy).toBe('qemu-arm64')
    })

    it('falls back to qemu-static when QEMU is unavailable for a linux x64->arm64 cross-compile', () => {
      const strategy = selectCrossCompileSmokeTestStrategy({
        hasQemu: false,
        hostArch: 'x64',
        hostPlatform: 'linux',
        targetArch: 'arm64',
      })
      expect(strategy).toBe('qemu-static')
    })

    it('picks rosetta-darwin-x64 when Rosetta is available for a darwin arm64->x64 cross-compile', () => {
      const strategy = selectCrossCompileSmokeTestStrategy({
        hasRosetta: true,
        hostArch: 'arm64',
        hostPlatform: 'darwin',
        targetArch: 'x64',
      })
      expect(strategy).toBe('rosetta-darwin-x64')
    })

    it('falls back to rosetta-static when Rosetta is unavailable for a darwin arm64->x64 cross-compile', () => {
      const strategy = selectCrossCompileSmokeTestStrategy({
        hasRosetta: false,
        hostArch: 'arm64',
        hostPlatform: 'darwin',
        targetArch: 'x64',
      })
      expect(strategy).toBe('rosetta-static')
    })

    it('does not offer Rosetta for a darwin x64->arm64 cross-compile (wrong direction)', () => {
      const strategy = selectCrossCompileSmokeTestStrategy({
        hasRosetta: true,
        hostArch: 'x64',
        hostPlatform: 'darwin',
        targetArch: 'arm64',
      })
      expect(strategy).toBe('static')
    })

    it('does not offer Rosetta on a non-darwin host', () => {
      const strategy = selectCrossCompileSmokeTestStrategy({
        hasRosetta: true,
        hostArch: 'arm64',
        hostPlatform: 'linux',
        targetArch: 'x64',
      })
      expect(strategy).toBe('static')
    })

    it('falls back to static for a scenario with no matching emulation path', () => {
      const strategy = selectCrossCompileSmokeTestStrategy({
        hostArch: 'x64',
        hostPlatform: 'win32',
        targetArch: 'arm64',
      })
      expect(strategy).toBe('static')
    })

    it('prefers the docker-musl path over the darwin/qemu paths when isMusl is set', () => {
      // A linux host building a musl binary short-circuits before the
      // arm64/darwin checks even if hasQemu/hasRosetta happen to be true —
      // musl is decided by libc, not target arch.
      const strategy = selectCrossCompileSmokeTestStrategy({
        hasDocker: true,
        hasQemu: true,
        hasRosetta: true,
        hostArch: 'x64',
        hostPlatform: 'linux',
        isMusl: true,
        targetArch: 'arm64',
      })
      expect(strategy).toBe('docker-musl')
    })
  })
})
