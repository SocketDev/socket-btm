/**
 * PURL Tests for node:smol-purl
 *
 * Test cases derived from the official PURL spec test suite:
 * https://github.com/package-url/purl-spec/tree/master/test-suite-data
 *
 * Gold standard: socket-packageurl-js
 * @see /Users/jdalton/projects/socket-packageurl-js/test/purl-spec.test.mts
 * @see /Users/jdalton/projects/socket-packageurl-js/test/data/contrib-tests.json
 */

import { describe, it, expect } from 'vitest';
import {
  parse,
  tryParse,
  build,
  isValid,
  normalize,
  equals,
  types,
} from '../additions/source-patched/lib/internal/socketsecurity/purl.js';

describe('node:smol-purl', () => {
  describe('parse() - Basic parsing', () => {
    it('should parse simple npm package', () => {
      const purl = parse('pkg:npm/lodash@4.17.21');
      expect(purl.type).toBe('npm');
      expect(purl.namespace).toBeUndefined();
      expect(purl.name).toBe('lodash');
      expect(purl.version).toBe('4.17.21');
    });

    it('should parse scoped npm package', () => {
      const purl = parse('pkg:npm/%40scope/name@1.0.0');
      expect(purl.type).toBe('npm');
      expect(purl.namespace).toBe('@scope');
      expect(purl.name).toBe('name');
      expect(purl.version).toBe('1.0.0');
    });

    it('should parse npm package with qualifiers', () => {
      const purl = parse('pkg:npm/express@4.18.0?repository_url=https://github.com');
      expect(purl.type).toBe('npm');
      expect(purl.name).toBe('express');
      expect(purl.version).toBe('4.18.0');
      expect(purl.qualifiers).toEqual({ __proto__: null, repository_url: 'https://github.com' });
    });

    it('should parse golang with namespace slashes', () => {
      // From contrib-tests.json
      const purl = parse('pkg:golang/github.com/etcd-io/etcd@v2.4.0');
      expect(purl.type).toBe('golang');
      expect(purl.namespace).toBe('github.com/etcd-io');
      expect(purl.name).toBe('etcd');
      expect(purl.version).toBe('v2.4.0');
    });

    it('should parse golang with multiple namespace slashes', () => {
      // From contrib-tests.json
      const purl = parse('pkg:golang/github.com/cncf/xds/go@v0.0.0-20210922020428-25de7278fc84');
      expect(purl.type).toBe('golang');
      expect(purl.namespace).toBe('github.com/cncf/xds');
      expect(purl.name).toBe('go');
      expect(purl.version).toBe('v0.0.0-20210922020428-25de7278fc84');
    });

    it('should parse debian with plus sign in version', () => {
      // From contrib-tests.json
      const purl = parse('pkg:deb/debian/libssl1.1@1.1.1n-0+deb10u3?arch=amd64&distro=debian-10');
      expect(purl.type).toBe('deb');
      expect(purl.namespace).toBe('debian');
      expect(purl.name).toBe('libssl1.1');
      expect(purl.version).toBe('1.1.1n-0+deb10u3');
      expect(purl.qualifiers.arch).toBe('amd64');
      expect(purl.qualifiers.distro).toBe('debian-10');
    });
  });

  describe('parse() - NPM pnpm peer dependency syntax', () => {
    // From contrib-tests.json: "pnpm ids with parens in the version"
    it('should handle pnpm peer dep syntax in version', () => {
      const purl = parse('pkg:npm/next@14.2.10(react-dom@18.3.1(react@18.3.1))(react@18.3.1)');
      expect(purl.type).toBe('npm');
      expect(purl.name).toBe('next');
      expect(purl.version).toBe('14.2.10(react-dom@18.3.1(react@18.3.1))(react@18.3.1)');
    });

    it('should handle scoped package with pnpm peer deps', () => {
      const purl = parse('pkg:npm/@next/env@14.2.10(react@18.3.1)');
      expect(purl.type).toBe('npm');
      expect(purl.namespace).toBe('@next');
      expect(purl.name).toBe('env');
      expect(purl.version).toBe('14.2.10(react@18.3.1)');
    });
  });

  describe('parse() - Type normalization', () => {
    it('should lowercase npm namespace and name', () => {
      const purl = parse('pkg:npm/%40SCOPE/NAME@1.0.0');
      expect(purl.namespace).toBe('@scope');
      expect(purl.name).toBe('name');
    });

    it('should normalize pypi names (underscore and period to hyphen)', () => {
      const purl1 = parse('pkg:pypi/my_package@1.0.0');
      expect(purl1.name).toBe('my-package');

      const purl2 = parse('pkg:pypi/my.package@1.0.0');
      expect(purl2.name).toBe('my-package');
    });

    it('should lowercase type', () => {
      // Type portion is lowercased (not the scheme - scheme must be lowercase pkg:)
      const purl = parse('pkg:TYPE/foo/bar@1.0.0');
      expect(purl.type).toBe('type');
    });
  });

  describe('parse() - Qualifier normalization', () => {
    it('should lowercase qualifier keys', () => {
      const purl = parse('pkg:npm/foo@1.0.0?ARCH=amd64');
      expect(purl.qualifiers.arch).toBe('amd64');
      expect(purl.qualifiers.ARCH).toBe(undefined);
    });

    it('should trim qualifier values', () => {
      const purl = parse('pkg:npm/foo@1.0.0?key=%20value%20');
      expect(purl.qualifiers.key).toBe('value');
    });

    it('should preserve + as literal in qualifier values (per PURL spec)', () => {
      // Per PURL spec and gold standard: + is preserved as literal, NOT decoded as space
      // This differs from application/x-www-form-urlencoded
      const purl = parse('pkg:npm/foo@1.0.0?desc=hello+world');
      expect(purl.qualifiers.desc).toBe('hello+world');
    });
  });

  describe('parse() - Special characters', () => {
    // From contrib-tests.json
    it('should handle special characters in namespace', () => {
      const purl = parse('pkg:type/%40namespace%40%3F%23/name@1.0.0');
      expect(purl.namespace).toBe('@namespace@?#');
    });

    it('should handle special characters in name', () => {
      const purl = parse('pkg:type/foo/bar%40%3F%23@1.0.0');
      expect(purl.name).toBe('bar@?#');
    });

    it('should handle special characters in version', () => {
      const purl = parse('pkg:type/foo/bar@1.0.0-%40%3F%23');
      expect(purl.version).toBe('1.0.0-@?#');
    });

    it('should handle colons without encoding', () => {
      // From contrib-tests.json: "the colon ':' does not need to be encoded"
      const purl = parse('pkg:type/fo:o/ba:r@v1.0.0');
      expect(purl.namespace).toBe('fo:o');
      expect(purl.name).toBe('ba:r');
    });
  });

  describe('parse() - pkg:// handling', () => {
    it('should handle pkg:// with double slashes', () => {
      const purl = parse('pkg://npm/lodash@4.17.21');
      expect(purl.type).toBe('npm');
      expect(purl.name).toBe('lodash');
    });
  });

  describe('parse() - Gold standard compliance', () => {
    it('should handle case-insensitive scheme (PkG:)', () => {
      // Per PURL spec and gold standard: scheme is case-insensitive
      const purl = parse('PkG:npm/lodash@4.17.21');
      expect(purl.type).toBe('npm');
      expect(purl.name).toBe('lodash');
      expect(purl.version).toBe('4.17.21');
    });

    it('should handle PKG: uppercase scheme', () => {
      const purl = parse('PKG:npm/express@4.0.0');
      expect(purl.type).toBe('npm');
      expect(purl.name).toBe('express');
    });

    it('should collapse multiple slashes in namespace', () => {
      // Per gold standard: foo//bar should become foo/bar
      const purl = parse('pkg:golang/github.com//user//repo/pkg@v1.0.0');
      expect(purl.namespace).toBe('github.com/user/repo');
      expect(purl.name).toBe('pkg');
    });

    it('should filter . segments from subpath', () => {
      // Per PURL spec: . segments should be removed
      const purl = parse('pkg:npm/foo@1.0.0#./src/./index.js');
      expect(purl.subpath).toBe('src/index.js');
    });

    it('should filter .. segments from subpath', () => {
      // Per PURL spec: .. segments should be removed
      const purl = parse('pkg:npm/foo@1.0.0#src/../lib/index.js');
      expect(purl.subpath).toBe('src/lib/index.js');
    });

    it('should return null for subpath with only . and ..', () => {
      // Per gold standard: if all segments are filtered, subpath is null
      const purl = parse('pkg:npm/foo@1.0.0#./../.');
      expect(purl.subpath).toBeUndefined();
    });

    it('should filter empty segments from subpath', () => {
      // Per PURL spec: empty segments (from //) should be removed
      const purl = parse('pkg:npm/foo@1.0.0#src//lib//index.js');
      expect(purl.subpath).toBe('src/lib/index.js');
    });
  });

  describe('parse() - Error cases', () => {
    it('should throw on missing pkg: prefix', () => {
      expect(() => parse('npm/lodash@4.17.21')).toThrow(/must start with "pkg:"/);
    });

    it('should throw on missing name', () => {
      // Empty name after type/namespace
      expect(() => parse('pkg:npm/')).toThrow();
    });

    it('should throw on empty qualifier key', () => {
      expect(() => parse('pkg:npm/foo@1.0.0?=value')).toThrow(/qualifier key must not be empty/);
    });
  });

  describe('tryParse()', () => {
    it('should return parsed result for valid PURL', () => {
      const result = tryParse('pkg:npm/lodash@4.17.21');
      expect(result).not.toBeUndefined();
      expect(result.name).toBe('lodash');
    });

    it('should return null for invalid PURL', () => {
      expect(tryParse('invalid')).toBeUndefined();
      expect(tryParse('npm/lodash')).toBeUndefined();
    });
  });

  describe('build()', () => {
    it('should build simple npm PURL', () => {
      const purl = build({ type: 'npm', name: 'lodash', version: '4.17.21' });
      expect(purl).toBe('pkg:npm/lodash@4.17.21');
    });

    it('should build scoped npm PURL', () => {
      const purl = build({ type: 'npm', namespace: '@scope', name: 'name', version: '1.0.0' });
      expect(purl).toBe('pkg:npm/%40scope/name@1.0.0');
    });

    it('should build PURL with qualifiers (sorted)', () => {
      const purl = build({
        type: 'npm',
        name: 'foo',
        version: '1.0.0',
        qualifiers: { b: '2', a: '1' },
      });
      // Qualifiers should be sorted lexicographically
      expect(purl).toBe('pkg:npm/foo@1.0.0?a=1&b=2');
    });

    it('should encode spaces as %20 in qualifier values', () => {
      const purl = build({
        type: 'npm',
        name: 'foo',
        version: '1.0.0',
        qualifiers: { desc: 'hello world' },
      });
      expect(purl).toContain('desc=hello%20world');
    });

    it('should encode + as %2B in qualifier values', () => {
      const purl = build({
        type: 'npm',
        name: 'foo',
        version: '1.0.0',
        qualifiers: { key: 'a+b' },
      });
      expect(purl).toContain('key=a%2Bb');
    });

    it('should preserve slashes in golang namespace', () => {
      const purl = build({
        type: 'golang',
        namespace: 'github.com/user/repo',
        name: 'pkg',
        version: 'v1.0.0',
      });
      expect(purl).toBe('pkg:golang/github.com/user/repo/pkg@v1.0.0');
    });

    it('should throw on missing type', () => {
      expect(() => build({ name: 'foo' })).toThrow(/type is required/);
    });

    it('should throw on missing name', () => {
      expect(() => build({ type: 'npm' })).toThrow(/name is required/);
    });
  });

  describe('isValid()', () => {
    it('should return true for valid PURLs', () => {
      expect(isValid('pkg:npm/lodash@4.17.21')).toBe(true);
      expect(isValid('pkg:pypi/requests@2.28.0')).toBe(true);
    });

    it('should return false for invalid PURLs', () => {
      expect(isValid('invalid')).toBe(false);
      expect(isValid('npm/lodash')).toBe(false);
    });
  });

  describe('normalize()', () => {
    it('should normalize PURL string', () => {
      // Uppercase type should be lowercased
      const normalized = normalize('pkg:NPM/lodash@4.17.21');
      expect(normalized).toBe('pkg:npm/lodash@4.17.21');
    });
  });

  describe('equals()', () => {
    it('should return true for equivalent PURLs', () => {
      expect(equals('pkg:npm/lodash@4.17.21', 'pkg:NPM/lodash@4.17.21')).toBe(true);
    });

    it('should return false for different PURLs', () => {
      expect(equals('pkg:npm/lodash@4.17.21', 'pkg:npm/lodash@4.17.20')).toBe(false);
    });
  });

  describe('types constant', () => {
    it('should have common package types', () => {
      expect(types.NPM).toBe('npm');
      expect(types.PYPI).toBe('pypi');
      expect(types.MAVEN).toBe('maven');
      expect(types.GOLANG).toBe('golang');
      expect(types.CARGO).toBe('cargo');
    });
  });
});
