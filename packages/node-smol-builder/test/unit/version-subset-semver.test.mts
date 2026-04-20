/**
 * Tests for the inline `semver` helper in
 * additions/source-patched/lib/internal/socketsecurity/http/version_subset.js
 *
 * Gold standard: npm `node-semver` v7.x satisfies() behavior.
 *
 * The focus is on correctness of caret/tilde/comparator range handling,
 * especially the three distinct caret branches that semver requires:
 *
 *   ^X.Y.Z with X > 0      →  >= X.Y.Z  <(X+1).0.0
 *   ^0.Y.Z with Y > 0      →  >= 0.Y.Z  <0.(Y+1).0
 *   ^0.0.Z                 →  >= 0.0.Z  <0.0.(Z+1)   (i.e. only exact patch)
 *
 * Prior implementations collapsed the first two 0-major branches together,
 * so `^0.0.3` was accepted matching `0.0.4`, `0.0.5`, etc. The fix below
 * splits them, matching npm's behavior.
 */

import { describe, expect, it } from 'vitest'

import { semver } from '../../additions/source-patched/lib/internal/socketsecurity/http/version_subset.js'

describe('version_subset semver.satisfies()', () => {
  describe('caret range: X.Y.Z with X > 0 (major > 0)', () => {
    it('matches same major, higher minor', () => {
      expect(semver.satisfies('1.3.0', '^1.2.3')).toBe(true)
      expect(semver.satisfies('1.9.9', '^1.2.3')).toBe(true)
    })

    it('matches same major.minor, higher patch', () => {
      expect(semver.satisfies('1.2.4', '^1.2.3')).toBe(true)
    })

    it('matches exact version', () => {
      expect(semver.satisfies('1.2.3', '^1.2.3')).toBe(true)
    })

    it('rejects different major', () => {
      expect(semver.satisfies('2.0.0', '^1.2.3')).toBe(false)
      expect(semver.satisfies('0.9.9', '^1.2.3')).toBe(false)
    })

    it('rejects lower patch on same minor', () => {
      expect(semver.satisfies('1.2.2', '^1.2.3')).toBe(false)
    })

    it('rejects lower minor', () => {
      expect(semver.satisfies('1.1.9', '^1.2.3')).toBe(false)
    })
  })

  describe('caret range: 0.Y.Z with Y > 0 (major=0, minor>0)', () => {
    it('matches same minor, higher patch', () => {
      expect(semver.satisfies('0.2.4', '^0.2.3')).toBe(true)
      expect(semver.satisfies('0.2.9', '^0.2.3')).toBe(true)
    })

    it('matches exact version', () => {
      expect(semver.satisfies('0.2.3', '^0.2.3')).toBe(true)
    })

    it('rejects different minor', () => {
      expect(semver.satisfies('0.3.0', '^0.2.3')).toBe(false)
      expect(semver.satisfies('0.1.9', '^0.2.3')).toBe(false)
    })

    it('rejects different major', () => {
      expect(semver.satisfies('1.2.3', '^0.2.3')).toBe(false)
    })

    it('rejects lower patch on same minor', () => {
      expect(semver.satisfies('0.2.2', '^0.2.3')).toBe(false)
    })
  })

  describe('caret range: 0.0.Z (major=0, minor=0) — exact patch only', () => {
    it('matches exact patch', () => {
      expect(semver.satisfies('0.0.3', '^0.0.3')).toBe(true)
    })

    it('rejects higher patch — ^0.0.x is NOT a permissive caret', () => {
      expect(semver.satisfies('0.0.4', '^0.0.3')).toBe(false)
      expect(semver.satisfies('0.0.10', '^0.0.3')).toBe(false)
      expect(semver.satisfies('0.0.99', '^0.0.3')).toBe(false)
    })

    it('rejects lower patch', () => {
      expect(semver.satisfies('0.0.2', '^0.0.3')).toBe(false)
    })

    it('rejects different minor', () => {
      expect(semver.satisfies('0.1.0', '^0.0.3')).toBe(false)
      expect(semver.satisfies('0.1.3', '^0.0.3')).toBe(false)
    })

    it('rejects different major', () => {
      expect(semver.satisfies('1.0.3', '^0.0.3')).toBe(false)
    })

    it('^0.0.0 matches only 0.0.0', () => {
      expect(semver.satisfies('0.0.0', '^0.0.0')).toBe(true)
      expect(semver.satisfies('0.0.1', '^0.0.0')).toBe(false)
    })
  })

  describe('tilde range', () => {
    it('~1.2.3 matches same minor, higher patch', () => {
      expect(semver.satisfies('1.2.4', '~1.2.3')).toBe(true)
      expect(semver.satisfies('1.2.99', '~1.2.3')).toBe(true)
    })

    it('~1.2.3 matches exact version', () => {
      expect(semver.satisfies('1.2.3', '~1.2.3')).toBe(true)
    })

    it('~1.2.3 rejects different minor', () => {
      expect(semver.satisfies('1.3.0', '~1.2.3')).toBe(false)
      expect(semver.satisfies('1.1.9', '~1.2.3')).toBe(false)
    })

    it('~1.2.3 rejects different major', () => {
      expect(semver.satisfies('2.2.3', '~1.2.3')).toBe(false)
    })
  })

  describe('special ranges', () => {
    it('* matches anything', () => {
      expect(semver.satisfies('1.2.3', '*')).toBe(true)
      expect(semver.satisfies('0.0.0', '*')).toBe(true)
    })

    it('"latest" matches anything', () => {
      expect(semver.satisfies('1.2.3', 'latest')).toBe(true)
    })

    it('invalid version string returns false', () => {
      expect(semver.satisfies('not-a-version', '^1.0.0')).toBe(false)
    })

    it('invalid range string returns false', () => {
      expect(semver.satisfies('1.0.0', '^not-a-version')).toBe(false)
    })
  })

  describe('compound AND-ranges', () => {
    it('>=1.0.0 <2.0.0 admits 1.5.0', () => {
      expect(semver.satisfies('1.5.0', '>=1.0.0 <2.0.0')).toBe(true)
    })

    it('>=1.0.0 <2.0.0 rejects 2.0.0', () => {
      expect(semver.satisfies('2.0.0', '>=1.0.0 <2.0.0')).toBe(false)
    })

    it('>=1.0.0 <2.0.0 rejects 0.9.9', () => {
      expect(semver.satisfies('0.9.9', '>=1.0.0 <2.0.0')).toBe(false)
    })
  })

  describe('operator + space normalization (R7 regression)', () => {
    it('>= 1.0.0 (space after operator) admits 1.5.0', () => {
      // Regression: the AND-split once split ">= 1.0.0" into [">=", "1.0.0"]
      // and returned false for every version. Normalization strips the space.
      expect(semver.satisfies('1.5.0', '>= 1.0.0')).toBe(true)
    })

    it('>= 1.0.0 rejects 0.9.9', () => {
      expect(semver.satisfies('0.9.9', '>= 1.0.0')).toBe(false)
    })

    it('<= 2.0.0 admits 1.5.0', () => {
      expect(semver.satisfies('1.5.0', '<= 2.0.0')).toBe(true)
    })

    it('< 2.0.0 admits 1.5.0 but rejects 2.0.0', () => {
      expect(semver.satisfies('1.5.0', '< 2.0.0')).toBe(true)
      expect(semver.satisfies('2.0.0', '< 2.0.0')).toBe(false)
    })

    it('compound with spaces: >= 1.0.0 < 2.0.0', () => {
      expect(semver.satisfies('1.5.0', '>= 1.0.0 < 2.0.0')).toBe(true)
      expect(semver.satisfies('2.0.0', '>= 1.0.0 < 2.0.0')).toBe(false)
    })
  })

  describe('OR-ranges', () => {
    it('^1.0.0 || ^2.0.0 admits 1.5.0', () => {
      expect(semver.satisfies('1.5.0', '^1.0.0 || ^2.0.0')).toBe(true)
    })

    it('^1.0.0 || ^2.0.0 admits 2.5.0', () => {
      expect(semver.satisfies('2.5.0', '^1.0.0 || ^2.0.0')).toBe(true)
    })

    it('^1.0.0 || ^2.0.0 rejects 3.0.0', () => {
      expect(semver.satisfies('3.0.0', '^1.0.0 || ^2.0.0')).toBe(false)
    })

    it('^1.0.0 || ^2.0.0 rejects 0.9.9', () => {
      expect(semver.satisfies('0.9.9', '^1.0.0 || ^2.0.0')).toBe(false)
    })
  })
})
