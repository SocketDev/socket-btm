/**
 * Comprehensive comparison test between node:smol-versions and semver package
 * This validates that our implementation matches the gold standard in all aspects
 */

import { describe, it, expect } from 'vitest';
import semver from '../../node_modules/.pnpm/semver@7.7.4/node_modules/semver/index.js';
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
} from '../additions/source-patched/lib/internal/socketsecurity/versions.js';

describe('Comparison with semver gold standard', () => {
  describe('Version parsing', () => {
    const testVersions = [
      '1.2.3',
      'v1.2.3',
      '1.2.3-alpha',
      '1.2.3-alpha.1',
      '1.2.3-alpha.beta',
      '1.2.3-alpha.1.2',
      '1.2.3-0',
      '1.2.3+build',
      '1.2.3-alpha+build',
      '1.2.3-alpha.1+build.123',
      '1.2',
      '1',
      '0.0.0',
      '0.0.1',
      '10.20.30',
    ];

    testVersions.forEach((v) => {
      it(`should parse ${v} identically to semver`, () => {
        const semverParsed = semver.parse(v);

        // Handle cases where semver returns null for invalid versions
        if (semverParsed === null) {
          expect(() => parse(v)).toThrow();
        } else {
          const ourParsed = parse(v);
          expect(ourParsed.major).toBe(semverParsed.major);
          expect(ourParsed.minor).toBe(semverParsed.minor);
          expect(ourParsed.patch).toBe(semverParsed.patch);
          expect(ourParsed.prerelease).toEqual(semverParsed.prerelease);
        }
      });
    });

    it('should handle prerelease identifiers the same way', () => {
      // Test that numeric identifiers are converted to numbers
      const v1 = parse('1.0.0-1.2.3');
      const sv1 = semver.parse('1.0.0-1.2.3');
      expect(v1.prerelease).toEqual(sv1.prerelease);
      expect(typeof v1.prerelease[0]).toBe('number');

      // Test mixed numeric and string
      const v2 = parse('1.0.0-alpha.1.beta.2');
      const sv2 = semver.parse('1.0.0-alpha.1.beta.2');
      expect(v2.prerelease).toEqual(sv2.prerelease);
    });

    it('should reject invalid versions like semver', () => {
      const invalidVersions = [
        'not-a-version',
        '1.2.x',
        'x.y.z',
        '',
        'v',
      ];

      invalidVersions.forEach((v) => {
        const semverValid = semver.valid(v);
        const ourValid = valid(v);
        expect(ourValid).toBe(semverValid);
      });
    });
  });

  describe('Version comparison', () => {
    const comparisonPairs = [
      ['1.0.0', '2.0.0'],
      ['1.0.0', '1.1.0'],
      ['1.0.0', '1.0.1'],
      ['1.0.0-alpha', '1.0.0'],
      ['1.0.0-alpha', '1.0.0-beta'],
      ['1.0.0-1', '1.0.0-alpha'],
      ['1.0.0-alpha.1', '1.0.0-alpha.2'],
      ['1.0.0-alpha', '1.0.0-alpha.1'],
      ['0.0.1', '0.0.2'],
      ['10.0.0', '2.0.0'],
    ];

    comparisonPairs.forEach(([a, b]) => {
      it(`should compare ${a} and ${b} identically to semver`, () => {
        const semverResult = semver.compare(a, b);
        const ourResult = compare(a, b);
        expect(ourResult).toBe(semverResult);

        // Also test reverse
        const semverReverseResult = semver.compare(b, a);
        const ourReverseResult = compare(b, a);
        expect(ourReverseResult).toBe(semverReverseResult);
      });

      it(`should test lt/gt/lte/gte for ${a} and ${b} identically to semver`, () => {
        expect(lt(a, b)).toBe(semver.lt(a, b));
        expect(gt(a, b)).toBe(semver.gt(a, b));
        expect(lte(a, b)).toBe(semver.lte(a, b));
        expect(gte(a, b)).toBe(semver.gte(a, b));
        expect(eq(a, b)).toBe(semver.eq(a, b));
        expect(neq(a, b)).toBe(semver.neq(a, b));
      });
    });
  });

  describe('Prerelease comparison edge cases', () => {
    it('should compare numeric prerelease identifiers numerically', () => {
      // Per semver spec: "1.0.0-2" < "1.0.0-10" (numeric comparison)
      expect(compare('1.0.0-2', '1.0.0-10')).toBe(semver.compare('1.0.0-2', '1.0.0-10'));
      expect(lt('1.0.0-2', '1.0.0-10')).toBe(semver.lt('1.0.0-2', '1.0.0-10'));
      expect(lt('1.0.0-2', '1.0.0-10')).toBe(true);
    });

    it('should compare non-numeric prerelease identifiers lexically', () => {
      expect(compare('1.0.0-alpha', '1.0.0-beta')).toBe(semver.compare('1.0.0-alpha', '1.0.0-beta'));
      expect(lt('1.0.0-alpha', '1.0.0-beta')).toBe(semver.lt('1.0.0-alpha', '1.0.0-beta'));
    });

    it('should compare mixed prerelease identifiers correctly', () => {
      // Numeric < string
      expect(compare('1.0.0-1', '1.0.0-alpha')).toBe(semver.compare('1.0.0-1', '1.0.0-alpha'));
      expect(lt('1.0.0-1', '1.0.0-alpha')).toBe(semver.lt('1.0.0-1', '1.0.0-alpha'));
      expect(lt('1.0.0-1', '1.0.0-alpha')).toBe(true);
    });

    it('should handle length differences in prerelease arrays', () => {
      // Shorter < longer when all else equal
      expect(compare('1.0.0-alpha', '1.0.0-alpha.1')).toBe(semver.compare('1.0.0-alpha', '1.0.0-alpha.1'));
      expect(lt('1.0.0-alpha', '1.0.0-alpha.1')).toBe(semver.lt('1.0.0-alpha', '1.0.0-alpha.1'));
      expect(lt('1.0.0-alpha', '1.0.0-alpha.1')).toBe(true);
    });
  });

  describe('Range satisfaction', () => {
    const rangeTests = [
      ['1.0.0', '1.0.0'],
      ['1.0.0', '>=1.0.0'],
      ['1.5.0', '>=1.0.0'],
      ['1.5.0', '>1.0.0'],
      ['1.0.0', '<=1.0.0'],
      ['0.9.0', '<=1.0.0'],
      ['0.9.0', '<1.0.0'],
      ['1.2.3', '^1.2.3'],
      ['1.9.9', '^1.2.3'],
      ['2.0.0', '^1.2.3'],
      ['0.2.3', '^0.2.3'],
      ['0.2.9', '^0.2.3'],
      ['0.3.0', '^0.2.3'],
      ['0.0.3', '^0.0.3'],
      ['0.0.4', '^0.0.3'],
      ['1.2.3', '~1.2.3'],
      ['1.2.9', '~1.2.3'],
      ['1.3.0', '~1.2.3'],
      ['1.0.0', '1.0.0 || 2.0.0'],
      ['2.0.0', '1.0.0 || 2.0.0'],
      ['1.5.0', '1.0.0 || 2.0.0'],
      ['1.5.0', '>=1.0.0 <2.0.0'],
      ['2.0.0', '>=1.0.0 <2.0.0'],
      ['1.5.0', '1.0.0 - 2.0.0'],
      ['2.0.0', '1.0.0 - 2.0.0'],
      ['2.0.1', '1.0.0 - 2.0.0'],
    ];

    rangeTests.forEach(([version, range]) => {
      it(`should test ${version} satisfies ${range} identically to semver`, () => {
        const semverResult = semver.satisfies(version, range);
        const ourResult = satisfies(version, range);
        expect(ourResult).toBe(semverResult);
      });
    });
  });

  describe('Prerelease restriction in ranges', () => {
    it('should NOT match prerelease against non-prerelease range', () => {
      const tests = [
        ['1.0.0-alpha', '>=1.0.0'],
        ['1.0.0-beta.2', '^1.0.0'],
        ['1.2.3-alpha', '~1.2.3'],
        ['2.0.0-rc.1', '>=1.0.0'],
      ];

      tests.forEach(([version, range]) => {
        const semverResult = semver.satisfies(version, range);
        const ourResult = satisfies(version, range);
        expect(ourResult).toBe(semverResult);
        expect(ourResult).toBe(false);
      });
    });

    it('should match prerelease when range explicitly includes same tuple', () => {
      const tests = [
        ['1.0.0-beta', '>=1.0.0-alpha'],
        ['1.0.0-alpha.2', '>=1.0.0-alpha.1'],
        ['1.0.0-rc.1', '^1.0.0-alpha.1'],
      ];

      tests.forEach(([version, range]) => {
        const semverResult = semver.satisfies(version, range);
        const ourResult = satisfies(version, range);
        expect(ourResult).toBe(semverResult);
        expect(ourResult).toBe(true);
      });
    });

    it('should NOT match prerelease on different tuple', () => {
      const tests = [
        ['1.0.1-alpha', '>=1.0.0-alpha'],
        ['1.1.0-alpha', '>=1.0.0-alpha'],
      ];

      tests.forEach(([version, range]) => {
        const semverResult = semver.satisfies(version, range);
        const ourResult = satisfies(version, range);
        expect(ourResult).toBe(semverResult);
        expect(ourResult).toBe(false);
      });
    });

    it('should match release version after prerelease in range', () => {
      const tests = [
        ['1.0.0', '>=1.0.0-alpha'],
        ['1.0.1', '>=1.0.0-alpha'],
      ];

      tests.forEach(([version, range]) => {
        const semverResult = semver.satisfies(version, range);
        const ourResult = satisfies(version, range);
        expect(ourResult).toBe(semverResult);
        expect(ourResult).toBe(true);
      });
    });
  });

  describe('Sorting and min/max', () => {
    const versions = ['2.0.0', '1.0.0', '1.5.0', '1.0.0-alpha', '3.0.0'];

    it('should sort versions identically to semver', () => {
      const semverSorted = semver.sort([...versions]);
      const ourSorted = sort([...versions]);
      expect(ourSorted).toEqual(semverSorted);
    });

    it('should reverse sort versions identically to semver', () => {
      const semverRsorted = semver.rsort([...versions]);
      const ourRsorted = rsort([...versions]);
      expect(ourRsorted).toEqual(semverRsorted);
    });

    it('should find max version identically to semver', () => {
      const semverMax = semver.maxSatisfying(versions, '*');
      const ourMax = max(versions);
      expect(ourMax).toBe(semverMax);
    });

    it('should find min version identically to semver', () => {
      // Note: semver doesn't have a min() function, it uses minSatisfying
      // min() should return the smallest version including prereleases
      const semverMin = semver.minSatisfying(versions, '*');
      const ourMin = minSatisfying(versions, '*');
      expect(ourMin).toBe(semverMin);

      // Our min() function should return the absolute minimum
      expect(min(versions)).toBe('1.0.0-alpha');
    });
  });

  describe('maxSatisfying and minSatisfying', () => {
    const versions = ['1.0.0', '1.5.0', '2.0.0', '2.5.0', '3.0.0'];

    it('should find maxSatisfying identically to semver', () => {
      const ranges = ['^1.0.0', '>=2.0.0', '~1.5.0', '<3.0.0'];
      ranges.forEach((range) => {
        const semverResult = semver.maxSatisfying(versions, range);
        const ourResult = maxSatisfying(versions, range);
        expect(ourResult).toBe(semverResult);
      });
    });

    it('should find minSatisfying identically to semver', () => {
      const ranges = ['^1.0.0', '>=2.0.0', '~1.5.0', '<3.0.0'];
      ranges.forEach((range) => {
        const semverResult = semver.minSatisfying(versions, range);
        const ourResult = minSatisfying(versions, range);
        expect(ourResult).toBe(semverResult);
      });
    });
  });

  describe('Coercion', () => {
    const coerceTests = [
      '1',
      '1.2',
      'v1.2.3',
      'version 1.2.3 release',
      '  1.2.3  ',
      'V1.2.3',
      'not-a-version',
    ];

    coerceTests.forEach((input) => {
      it(`should coerce "${input}" identically to semver`, () => {
        const semverResult = semver.coerce(input);
        const ourResult = coerce(input);

        if (semverResult === null) {
          expect(ourResult).toBe(null);
        } else {
          expect(ourResult).toBe(semverResult.version);
        }
      });
    });
  });

  describe('Increment', () => {
    const incrementTests = [
      ['1.2.3', 'major'],
      ['1.2.3', 'minor'],
      ['1.2.3', 'patch'],
      ['1.2.3-alpha.1', 'prerelease'],
      ['1.2.3', 'prerelease'],
    ];

    incrementTests.forEach(([version, release]) => {
      it(`should increment ${version} ${release} identically to semver`, () => {
        const semverResult = semver.inc(version, release);
        const ourResult = inc(version, release);
        expect(ourResult).toBe(semverResult);
      });
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle very long version strings', () => {
      // semver has MAX_LENGTH = 256
      const longVersion = '1.2.3-' + 'a'.repeat(300);

      let semverThrows = false;
      try {
        semver.parse(longVersion);
      } catch (e) {
        semverThrows = true;
      }

      let ourThrows = false;
      try {
        parse(longVersion);
      } catch (e) {
        ourThrows = true;
      }

      // Both should handle it the same way (throw or not throw)
      expect(ourThrows).toBe(semverThrows);
    });

    it('should handle leading zeros correctly', () => {
      // semver strict mode rejects leading zeros
      // Note: our implementation uses loose mode equivalent
      const versions = ['01.2.3', '1.02.3', '1.2.03'];

      versions.forEach((v) => {
        const semverValid = semver.valid(v);
        const ourValid = valid(v);
        // Both should reject or both should accept
        expect(!!ourValid).toBe(!!semverValid);
      });
    });

    it('should handle null/undefined inputs gracefully', () => {
      expect(tryParse(null)).toBe(null);
      expect(valid(null)).toBe(null);
      expect(coerce(null)).toBe(null);
    });

    it('should handle empty arrays in max/min', () => {
      expect(max([])).toBe(null);
      expect(min([])).toBe(null);
    });
  });

  describe('Build metadata handling', () => {
    it('should ignore build metadata in comparisons like semver', () => {
      // Per semver spec: build metadata SHOULD be ignored when determining version precedence
      const v1 = '1.0.0+build1';
      const v2 = '1.0.0+build2';

      expect(compare(v1, v2)).toBe(semver.compare(v1, v2));
      expect(eq(v1, v2)).toBe(semver.eq(v1, v2));
      expect(eq(v1, v2)).toBe(true);
    });

    it('should preserve build metadata in parsing', () => {
      const v = parse('1.0.0+build.123');
      expect(v.buildMetadata).toBe('build.123');
    });
  });

  describe('Complex range expressions', () => {
    it('should handle complex OR expressions like semver', () => {
      const ranges = [
        '1.0.0 || 2.0.0 || 3.0.0',
        '^1.0.0 || ^2.0.0',
        '>=1.0.0 <2.0.0 || >=3.0.0',
      ];

      const testVersions = ['1.0.0', '1.5.0', '2.0.0', '2.5.0', '3.0.0'];

      ranges.forEach((range) => {
        testVersions.forEach((version) => {
          const semverResult = semver.satisfies(version, range);
          const ourResult = satisfies(version, range);
          expect(ourResult).toBe(semverResult);
        });
      });
    });

    it('should handle complex AND expressions like semver', () => {
      const ranges = [
        '>=1.0.0 <2.0.0',
        '>=1.0.0 <=2.0.0',
        '>1.0.0 <2.0.0',
        '>=1.2.0 <1.3.0',
      ];

      const testVersions = ['1.0.0', '1.1.0', '1.2.0', '1.2.5', '1.3.0', '2.0.0'];

      ranges.forEach((range) => {
        testVersions.forEach((version) => {
          const semverResult = semver.satisfies(version, range);
          const ourResult = satisfies(version, range);
          expect(ourResult).toBe(semverResult);
        });
      });
    });
  });
});
