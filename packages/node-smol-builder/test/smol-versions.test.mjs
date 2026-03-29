/**
 * Versions Tests for node:smol-versions
 *
 * Test cases derived from npm semver behavior (gold standard):
 * @see https://www.npmjs.com/package/semver
 * @see https://semver.org/
 *
 * Gold standard: npm semver v7.x
 * Key behaviors validated:
 * - SemVer parsing (major.minor.patch-prerelease+build)
 * - Version comparison (prerelease ordering)
 * - Range satisfaction (^, ~, >=, etc.)
 * - Prerelease restriction: prereleases only match ranges with explicit prerelease on same tuple
 */

import { describe, it, expect } from 'vitest';
import {
  parse,
  tryParse,
  compare,
  lt,
  lte,
  gt,
  gte,
  eq,
  neq,
  sort,
  rsort,
  max,
  min,
  satisfies,
  maxSatisfying,
  minSatisfying,
  filter,
  valid,
  coerce,
  inc,
  ecosystems,
} from '../additions/source-patched/lib/internal/socketsecurity/versions.js';

describe('node:smol-versions', () => {
  describe('parse() - Basic SemVer parsing', () => {
    it('should parse simple version', () => {
      const v = parse('1.2.3');
      expect(v.major).toBe(1);
      expect(v.minor).toBe(2);
      expect(v.patch).toBe(3);
      expect(v.prerelease).toEqual([]);
      expect(v.buildMetadata).toBeUndefined();
    });

    it('should parse version with v prefix', () => {
      const v = parse('v1.2.3');
      expect(v.major).toBe(1);
      expect(v.minor).toBe(2);
      expect(v.patch).toBe(3);
    });

    it('should parse version with prerelease', () => {
      const v = parse('1.2.3-alpha.1');
      expect(v.major).toBe(1);
      expect(v.minor).toBe(2);
      expect(v.patch).toBe(3);
      expect(v.prerelease).toEqual(['alpha', 1]);
    });

    it('should parse version with build metadata', () => {
      const v = parse('1.2.3+build.123');
      expect(v.major).toBe(1);
      expect(v.minor).toBe(2);
      expect(v.patch).toBe(3);
      expect(v.buildMetadata).toBe('build.123');
    });

    it('should parse version with prerelease and build', () => {
      const v = parse('1.2.3-beta.2+build.456');
      expect(v.major).toBe(1);
      expect(v.prerelease).toEqual(['beta', 2]);
      expect(v.buildMetadata).toBe('build.456');
    });

    it('should reject partial versions in strict mode (missing patch)', () => {
      // Per semver spec: strict mode requires major.minor.patch
      expect(() => parse('1.2')).toThrow(/Invalid npm version/);
    });

    it('should reject partial versions in strict mode (major only)', () => {
      // Per semver spec: strict mode requires major.minor.patch
      expect(() => parse('1')).toThrow(/Invalid npm version/);
    });

    it('should throw on invalid version', () => {
      expect(() => parse('invalid')).toThrow();
      expect(() => parse('1.2.x')).toThrow();
    });
  });

  describe('tryParse()', () => {
    it('should return parsed version for valid input', () => {
      const v = tryParse('1.2.3');
      expect(v).not.toBeUndefined();
      expect(v.major).toBe(1);
    });

    it('should return null for invalid input', () => {
      expect(tryParse('invalid')).toBeUndefined();
      expect(tryParse('not-a-version')).toBeUndefined();
    });
  });

  describe('compare() - Version comparison', () => {
    it('should compare major versions', () => {
      expect(compare('2.0.0', '1.0.0')).toBe(1);
      expect(compare('1.0.0', '2.0.0')).toBe(-1);
      expect(compare('1.0.0', '1.0.0')).toBe(0);
    });

    it('should compare minor versions', () => {
      expect(compare('1.2.0', '1.1.0')).toBe(1);
      expect(compare('1.1.0', '1.2.0')).toBe(-1);
    });

    it('should compare patch versions', () => {
      expect(compare('1.0.2', '1.0.1')).toBe(1);
      expect(compare('1.0.1', '1.0.2')).toBe(-1);
    });

    it('should compare prerelease vs release (release wins)', () => {
      // Per semver spec: prerelease < release
      expect(compare('1.0.0', '1.0.0-alpha')).toBe(1);
      expect(compare('1.0.0-alpha', '1.0.0')).toBe(-1);
    });

    it('should compare prerelease identifiers', () => {
      // Numeric identifiers compare numerically
      expect(compare('1.0.0-alpha.2', '1.0.0-alpha.1')).toBe(1);
      // Alpha before beta
      expect(compare('1.0.0-alpha', '1.0.0-beta')).toBe(-1);
      // Numeric before string (per semver spec)
      expect(compare('1.0.0-1', '1.0.0-alpha')).toBe(-1);
    });

    it('should compare complex prerelease', () => {
      // Fewer identifiers < more identifiers when prefix matches
      expect(compare('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1);
      expect(compare('1.0.0-alpha.1', '1.0.0-alpha')).toBe(1);
    });
  });

  describe('Comparison helpers', () => {
    it('lt() should return true for less than', () => {
      expect(lt('1.0.0', '2.0.0')).toBe(true);
      expect(lt('2.0.0', '1.0.0')).toBe(false);
      expect(lt('1.0.0', '1.0.0')).toBe(false);
    });

    it('lte() should return true for less than or equal', () => {
      expect(lte('1.0.0', '2.0.0')).toBe(true);
      expect(lte('1.0.0', '1.0.0')).toBe(true);
      expect(lte('2.0.0', '1.0.0')).toBe(false);
    });

    it('gt() should return true for greater than', () => {
      expect(gt('2.0.0', '1.0.0')).toBe(true);
      expect(gt('1.0.0', '2.0.0')).toBe(false);
    });

    it('gte() should return true for greater than or equal', () => {
      expect(gte('2.0.0', '1.0.0')).toBe(true);
      expect(gte('1.0.0', '1.0.0')).toBe(true);
    });

    it('eq() should return true for equal versions', () => {
      expect(eq('1.0.0', '1.0.0')).toBe(true);
      expect(eq('1.0.0', '1.0.1')).toBe(false);
    });

    it('neq() should return true for not equal', () => {
      expect(neq('1.0.0', '1.0.1')).toBe(true);
      expect(neq('1.0.0', '1.0.0')).toBe(false);
    });
  });

  describe('sort() and rsort()', () => {
    it('should sort versions ascending', () => {
      const versions = ['2.0.0', '1.0.0', '1.5.0', '1.0.0-alpha'];
      const sorted = sort(versions);
      expect(sorted).toEqual(['1.0.0-alpha', '1.0.0', '1.5.0', '2.0.0']);
    });

    it('should sort versions descending with rsort', () => {
      const versions = ['1.0.0', '2.0.0', '1.5.0'];
      const sorted = rsort(versions);
      expect(sorted).toEqual(['2.0.0', '1.5.0', '1.0.0']);
    });
  });

  describe('max() and min()', () => {
    it('should return max version', () => {
      expect(max(['1.0.0', '2.0.0', '1.5.0'])).toBe('2.0.0');
    });

    it('should return min version', () => {
      expect(min(['1.0.0', '2.0.0', '1.5.0'])).toBe('1.0.0');
    });

    it('should return null for empty array', () => {
      expect(max([])).toBeUndefined();
      expect(min([])).toBeUndefined();
    });
  });

  describe('satisfies() - Range matching', () => {
    describe('Exact match', () => {
      it('should match exact version', () => {
        expect(satisfies('1.0.0', '1.0.0')).toBe(true);
        expect(satisfies('1.0.1', '1.0.0')).toBe(false);
      });
    });

    describe('Comparison operators', () => {
      it('should match >= range', () => {
        expect(satisfies('1.5.0', '>=1.0.0')).toBe(true);
        expect(satisfies('1.0.0', '>=1.0.0')).toBe(true);
        expect(satisfies('0.9.0', '>=1.0.0')).toBe(false);
      });

      it('should match > range', () => {
        expect(satisfies('1.5.0', '>1.0.0')).toBe(true);
        expect(satisfies('1.0.0', '>1.0.0')).toBe(false);
      });

      it('should match <= range', () => {
        expect(satisfies('1.0.0', '<=1.0.0')).toBe(true);
        expect(satisfies('0.9.0', '<=1.0.0')).toBe(true);
        expect(satisfies('1.0.1', '<=1.0.0')).toBe(false);
      });

      it('should match < range', () => {
        expect(satisfies('0.9.0', '<1.0.0')).toBe(true);
        expect(satisfies('1.0.0', '<1.0.0')).toBe(false);
      });
    });

    describe('Caret ranges (^)', () => {
      it('should match ^1.2.3 (>=1.2.3 <2.0.0)', () => {
        expect(satisfies('1.2.3', '^1.2.3')).toBe(true);
        expect(satisfies('1.9.9', '^1.2.3')).toBe(true);
        expect(satisfies('2.0.0', '^1.2.3')).toBe(false);
        expect(satisfies('1.2.2', '^1.2.3')).toBe(false);
      });

      it('should match ^0.2.3 (>=0.2.3 <0.3.0)', () => {
        expect(satisfies('0.2.3', '^0.2.3')).toBe(true);
        expect(satisfies('0.2.9', '^0.2.3')).toBe(true);
        expect(satisfies('0.3.0', '^0.2.3')).toBe(false);
      });

      it('should match ^0.0.3 (>=0.0.3 <0.0.4)', () => {
        expect(satisfies('0.0.3', '^0.0.3')).toBe(true);
        expect(satisfies('0.0.4', '^0.0.3')).toBe(false);
      });
    });

    describe('Tilde ranges (~)', () => {
      it('should match ~1.2.3 (>=1.2.3 <1.3.0)', () => {
        expect(satisfies('1.2.3', '~1.2.3')).toBe(true);
        expect(satisfies('1.2.9', '~1.2.3')).toBe(true);
        expect(satisfies('1.3.0', '~1.2.3')).toBe(false);
      });
    });

    describe('OR ranges (||)', () => {
      it('should match any OR branch', () => {
        expect(satisfies('1.0.0', '1.0.0 || 2.0.0')).toBe(true);
        expect(satisfies('2.0.0', '1.0.0 || 2.0.0')).toBe(true);
        expect(satisfies('1.5.0', '1.0.0 || 2.0.0')).toBe(false);
      });
    });

    describe('AND ranges (space-separated)', () => {
      it('should match all AND conditions', () => {
        expect(satisfies('1.5.0', '>=1.0.0 <2.0.0')).toBe(true);
        expect(satisfies('2.0.0', '>=1.0.0 <2.0.0')).toBe(false);
        expect(satisfies('0.9.0', '>=1.0.0 <2.0.0')).toBe(false);
      });
    });

    describe('Hyphen ranges', () => {
      it('should match hyphen range (1.0.0 - 2.0.0)', () => {
        expect(satisfies('1.5.0', '1.0.0 - 2.0.0')).toBe(true);
        expect(satisfies('1.0.0', '1.0.0 - 2.0.0')).toBe(true);
        expect(satisfies('2.0.0', '1.0.0 - 2.0.0')).toBe(true);
        expect(satisfies('2.0.1', '1.0.0 - 2.0.0')).toBe(false);
      });
    });

    describe('Prerelease restriction (semver spec compliance)', () => {
      // Per semver spec: "a pre-release version MAY be denoted by appending a hyphen
      // and a series of dot separated identifiers... When determining version
      // precedence, a pre-release version has lower precedence than a normal
      // version. Example: 1.0.0-alpha < 1.0.0."

      // The key rule: prerelease versions only satisfy a range that explicitly
      // includes a prerelease tag on the same [major, minor, patch] tuple.

      it('should NOT match prerelease against non-prerelease range', () => {
        // 1.0.0-alpha should NOT satisfy >=1.0.0 because the range doesn't
        // explicitly include prereleases
        expect(satisfies('1.0.0-alpha', '>=1.0.0')).toBe(false);
        expect(satisfies('1.0.0-beta.2', '^1.0.0')).toBe(false);
      });

      it('should match prerelease when range explicitly includes same tuple', () => {
        // 1.0.0-beta satisfies >=1.0.0-alpha because range has prerelease on same tuple
        expect(satisfies('1.0.0-beta', '>=1.0.0-alpha')).toBe(true);
        expect(satisfies('1.0.0-alpha.2', '>=1.0.0-alpha.1')).toBe(true);
      });

      it('should NOT match prerelease on different tuple', () => {
        // 1.0.1-alpha should NOT match >=1.0.0-alpha because they're different tuples
        expect(satisfies('1.0.1-alpha', '>=1.0.0-alpha')).toBe(false);
      });

      it('should match release version after prerelease in range', () => {
        // 1.0.0 (release) should satisfy >=1.0.0-alpha
        expect(satisfies('1.0.0', '>=1.0.0-alpha')).toBe(true);
      });
    });
  });

  describe('maxSatisfying() and minSatisfying()', () => {
    const versions = ['1.0.0', '1.5.0', '2.0.0', '2.5.0'];

    it('should return max satisfying version', () => {
      expect(maxSatisfying(versions, '^1.0.0')).toBe('1.5.0');
      expect(maxSatisfying(versions, '>=2.0.0')).toBe('2.5.0');
    });

    it('should return min satisfying version', () => {
      expect(minSatisfying(versions, '^1.0.0')).toBe('1.0.0');
      expect(minSatisfying(versions, '>=2.0.0')).toBe('2.0.0');
    });

    it('should return null when no version satisfies', () => {
      expect(maxSatisfying(versions, '^3.0.0')).toBeUndefined();
    });
  });

  describe('filter()', () => {
    const versions = ['1.0.0', '1.5.0', '2.0.0', '2.5.0'];

    it('should filter versions by range', () => {
      const filtered = filter(versions, '^1.0.0');
      expect(filtered).toEqual(['1.0.0', '1.5.0']);
    });
  });

  describe('valid()', () => {
    it('should return raw version for valid input', () => {
      expect(valid('1.2.3')).toBe('1.2.3');
      expect(valid('v1.2.3')).toBe('v1.2.3');
    });

    it('should return null for invalid input', () => {
      expect(valid('invalid')).toBeUndefined();
    });
  });

  describe('coerce()', () => {
    it('should coerce version-like strings', () => {
      expect(coerce('1')).toBe('1.0.0');
      expect(coerce('1.2')).toBe('1.2.0');
      expect(coerce('v1.2.3')).toBe('1.2.3');
    });

    it('should extract version from complex strings', () => {
      expect(coerce('version 1.2.3 release')).toBe('1.2.3');
    });

    it('should return null for non-coercible strings', () => {
      expect(coerce('no version here')).toBeUndefined();
    });
  });

  describe('inc()', () => {
    it('should increment major version', () => {
      expect(inc('1.2.3', 'major')).toBe('2.0.0');
    });

    it('should increment minor version', () => {
      expect(inc('1.2.3', 'minor')).toBe('1.3.0');
    });

    it('should increment patch version', () => {
      expect(inc('1.2.3', 'patch')).toBe('1.2.4');
    });

    it('should increment prerelease', () => {
      expect(inc('1.2.3-alpha.1', 'prerelease')).toBe('1.2.3-alpha.2');
    });

    it('should add prerelease with identifier', () => {
      expect(inc('1.2.3', 'prerelease', 'npm', 'beta')).toBe('1.2.4-beta.0');
    });

    it('should throw on invalid release type', () => {
      expect(() => inc('1.2.3', 'invalid')).toThrow(/Invalid release type/);
    });
  });

  describe('ecosystems constant', () => {
    it('should have npm ecosystem', () => {
      expect(ecosystems.NPM).toBe('npm');
    });

    it('should have other ecosystems', () => {
      expect(ecosystems.MAVEN).toBe('maven');
      expect(ecosystems.PYPI).toBe('pypi');
      expect(ecosystems.CARGO).toBe('cargo');
      expect(ecosystems.GOLANG).toBe('golang');
    });
  });

  describe('Multi-ecosystem parsing', () => {
    it('should parse maven versions', () => {
      const v = parse('1.0.0-SNAPSHOT', 'maven');
      expect(v.major).toBe(1);
      expect(v.minor).toBe(0);
      expect(v.patch).toBe(0);
    });

    it('should parse pypi versions', () => {
      const v = parse('1.0.0a1', 'pypi');
      expect(v.major).toBe(1);
      expect(v.minor).toBe(0);
      expect(v.patch).toBe(0);
    });

    it('should parse pypi version with epoch', () => {
      const v = parse('1!2.0.0', 'pypi');
      expect(v.epoch).toBe(1);
      expect(v.major).toBe(2);
    });
  });
});
