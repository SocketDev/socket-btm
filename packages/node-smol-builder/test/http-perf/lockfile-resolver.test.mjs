
import { describe, it, expect, beforeEach } from 'vitest';
import { LockfileFormats, LockfileResolver, lockfileResolver } from '../../additions/source-patched/lib/internal/socketsecurity/http-perf/lockfile-resolver';

describe('LockfileResolver', () => {
  let resolver;

  beforeEach(() => {
    resolver = new LockfileResolver();
  });

  describe('Format Detection', () => {
    it('should detect package-lock.json format', () => {
      const content = JSON.stringify({ lockfileVersion: 2 });
      expect(resolver.detectFormat(content)).toBe('package-lock');
    });

    it('should detect yarn.lock format', () => {
      const content = '# yarn lockfile v1\n\nlodash@^4.17.0:\n  version "4.17.21"';
      expect(resolver.detectFormat(content)).toBe('yarn.lock');
    });

    it('should detect pnpm-lock.yaml format', () => {
      const content = 'lockfileVersion: 6.0\n\npackages:\n  /lodash/4.17.21:';
      expect(resolver.detectFormat(content)).toBe('pnpm-lock.yaml');
    });

    it('should detect Cargo.lock format', () => {
      const content = '[[package]]\nname = "serde"\nversion = "1.0.0"';
      expect(resolver.detectFormat(content)).toBe('Cargo.lock');
    });

    it('should detect Gemfile.lock format', () => {
      const content = 'GEM\n  specs:\n    rails (7.0.0)';
      expect(resolver.detectFormat(content)).toBe('Gemfile.lock');
    });

    it('should return unknown for unrecognized formats', () => {
      const content = 'random content';
      expect(resolver.detectFormat(content)).toBe('unknown');
    });
  });

  describe('Package-lock.json Parsing', () => {
    it('should parse npm v2/v3 format (dependencies)', () => {
      const content = JSON.stringify({
        dependencies: {
          axios: { resolved: 'https://registry.npmjs.org/axios/-/axios-1.6.0.tgz', version: '1.6.0' },
          lodash: { resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz', version: '4.17.21' },
        },
        lockfileVersion: 1,
      });

      const result = LockfileFormats.parsePackageLock(content);
      expect(result.format).toBe('package-lock');
      expect(result.packages).toHaveLength(2);
      expect(result.packages[0].name).toBe('axios');
      expect(result.packages[0].version).toBe('1.6.0');
    });

    it('should parse npm v7+ format (packages)', () => {
      const content = JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': { name: 'my-project', version: '1.0.0' },
          'node_modules/axios': { resolved: 'https://registry.npmjs.org/axios/-/axios-1.6.0.tgz', version: '1.6.0' },
          'node_modules/lodash': { resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz', version: '4.17.21' },
        },
      });

      const result = LockfileFormats.parsePackageLock(content);
      expect(result.format).toBe('package-lock');
      expect(result.packages).toHaveLength(2);
      expect(result.packages.some(p => p.name === 'axios')).toBe(true);
    });

    it('should handle invalid JSON gracefully', () => {
      const content = 'not valid json';
      const result = LockfileFormats.parsePackageLock(content);
      expect(result.error).toBe('Invalid package-lock.json');
      expect(result.format).toBe('package-lock');
    });
  });

  describe('yarn.lock Parsing', () => {
    it('should parse yarn.lock format', () => {
      const content = `# yarn lockfile v1

lodash@^4.17.0:
  version "4.17.21"
  resolved "https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz"

axios@^1.6.0:
  version "1.6.0"
  resolved "https://registry.yarnpkg.com/axios/-/axios-1.6.0.tgz"`;

      const result = LockfileFormats.parseYarnLock(content);
      expect(result.format).toBe('yarn.lock');
      expect(result.packages).toHaveLength(2);
      expect(result.packages[0].name).toBe('lodash');
      expect(result.packages[0].version).toBe('4.17.21');
    });

    it('should handle packages without resolved URLs', () => {
      const content = `lodash@^4.17.0:
  version "4.17.21"`;

      const result = LockfileFormats.parseYarnLock(content);
      expect(result.packages[0].resolved).toBeNull();
    });

    it('should handle scoped packages', () => {
      const content = `@babel/core@^7.0.0:
  version "7.23.0"
  resolved "https://registry.yarnpkg.com/@babel/core/-/core-7.23.0.tgz"`;

      const result = LockfileFormats.parseYarnLock(content);
      expect(result.packages[0].name).toBe('@babel/core');
    });
  });

  describe('pnpm-lock.yaml Parsing', () => {
    it('should parse pnpm lockfile format', () => {
      const content = `lockfileVersion: 6.0

packages:
  /lodash/4.17.21:
    resolution: { integrity: sha512-... }
  /axios/1.6.0:
    resolution: { integrity: sha512-... }`;

      const result = LockfileFormats.parsePnpmLock(content);
      expect(result.format).toBe('pnpm-lock.yaml');
      expect(result.packages).toHaveLength(2);
      expect(result.packages[0].name).toBe('lodash');
      expect(result.packages[0].version).toBe('4.17.21');
    });

    it('should ignore content before packages section', () => {
      const content = `lockfileVersion: 6.0

dependencies:
  lodash: 4.17.21

packages:
  /axios/1.6.0:
    resolution: { integrity: sha512-... }`;

      const result = LockfileFormats.parsePnpmLock(content);
      expect(result.packages).toHaveLength(1);
      expect(result.packages[0].name).toBe('axios');
    });
  });

  describe('Cargo.lock Parsing', () => {
    it('should parse Cargo lockfile format', () => {
      const content = `[[package]]
name = "serde"
version = "1.0.0"
source = "registry+https://github.com/rust-lang/crates.io-index"

[[package]]
name = "tokio"
version = "1.35.0"
source = "registry+https://github.com/rust-lang/crates.io-index"`;

      const result = LockfileFormats.parseCargoLock(content);
      expect(result.format).toBe('Cargo.lock');
      expect(result.packages).toHaveLength(2);
      expect(result.packages[0].name).toBe('serde');
      expect(result.packages[0].version).toBe('1.0.0');
    });

    it('should handle packages without source', () => {
      const content = `[[package]]
name = "my-crate"
version = "0.1.0"`;

      const result = LockfileFormats.parseCargoLock(content);
      expect(result.packages).toHaveLength(0);
    });
  });

  describe('Gemfile.lock Parsing', () => {
    it('should parse Gemfile.lock format', () => {
      const content = `GEM
  remote: https://rubygems.org/
  specs:
    rails (7.0.0)
    nokogiri (1.15.0)`;

      const result = LockfileFormats.parseGemfileLock(content);
      expect(result.format).toBe('Gemfile.lock');
      expect(result.packages).toHaveLength(2);
      expect(result.packages[0].name).toBe('rails');
      expect(result.packages[0].version).toBe('7.0.0');
    });

    it('should ignore content before specs section', () => {
      const content = `GEM
  remote: https://rubygems.org/
  specs:
    rails (7.0.0)

PLATFORMS
  ruby`;

      const result = LockfileFormats.parseGemfileLock(content);
      expect(result.packages).toHaveLength(1);
    });
  });

  describe('Lockfile Resolution', () => {
    it('should resolve all packages from lockfile', async () => {
      const lockfileContent = JSON.stringify({
        dependencies: {
          axios: { version: '1.6.0' },
          lodash: { version: '4.17.21' },
        },
        lockfileVersion: 1,
      });

      const mockFetchPackage = async (name, version) => ({
        description: `${name} package`,
        name,
        version,
      });

      const result = await resolver.resolveFromLockfile(lockfileContent, mockFetchPackage);

      expect(result.format).toBe('package-lock');
      expect(result.total).toBe(2);
      expect(result.packages).toHaveLength(2);
      expect(result.packages[0].name).toBe('axios');
      expect(result.packages[0].metadata).toBeDefined();
    });

    it('should handle fetch errors gracefully', async () => {
      const lockfileContent = JSON.stringify({
        dependencies: {
          axios: { version: '1.6.0' },
          nonexistent: { version: '99.99.99' },
        },
        lockfileVersion: 1,
      });

      const mockFetchPackage = async (name) => {
        if (name === 'nonexistent') {
          throw new Error('Package not found');
        }
        return { name, version: '1.6.0' };
      };

      const result = await resolver.resolveFromLockfile(lockfileContent, mockFetchPackage);

      expect(result.packages).toHaveLength(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].name).toBe('nonexistent');
      expect(result.errors[0].error).toBe('Package not found');
    });

    it('should return error for invalid lockfile', async () => {
      const lockfileContent = 'invalid lockfile content';
      const mockFetchPackage = async () => ({});

      const result = await resolver.resolveFromLockfile(lockfileContent, mockFetchPackage);

      expect(result.error).toBe('Unknown lockfile format');
    });
  });

  describe('Caching', () => {
    it('should cache resolved lockfiles', async () => {
      const lockfileContent = JSON.stringify({
        dependencies: { lodash: { version: '4.17.21' } },
        lockfileVersion: 1,
      });

      let fetchCount = 0;
      const mockFetchPackage = async (name, version) => {
        fetchCount++;
        return { name, version };
      };

      await resolver.resolveFromLockfile(lockfileContent, mockFetchPackage);
      await resolver.resolveFromLockfile(lockfileContent, mockFetchPackage);

      expect(fetchCount).toBe(1);
    });

    it('should track cache hits', async () => {
      const lockfileContent = JSON.stringify({
        dependencies: { lodash: { version: '4.17.21' } },
        lockfileVersion: 1,
      });

      const mockFetchPackage = async () => ({});

      await resolver.resolveFromLockfile(lockfileContent, mockFetchPackage);
      await resolver.resolveFromLockfile(lockfileContent, mockFetchPackage);

      const stats = resolver.getStats();
      expect(stats.cache_hits).toBe(1);
      expect(stats.resolutions).toBe(2);
    });

    it('should evict old cache entries when at capacity', async () => {
      for (let i = 0; i < 1_001; i++) {
        const content = JSON.stringify({
          dependencies: { [`pkg${i}`]: { version: '1.0.0' } },
          lockfileVersion: 1,
        });
        await resolver.resolveFromLockfile(content, async () => ({}));
      }

      const stats = resolver.getStats();
      expect(stats.cache_size).toBeLessThanOrEqual(1_000);
    });

    it('should clear cache', async () => {
      const lockfileContent = JSON.stringify({
        dependencies: { lodash: { version: '4.17.21' } },
        lockfileVersion: 1,
      });

      await resolver.resolveFromLockfile(lockfileContent, async () => ({}));

      resolver.clearCache();

      const stats = resolver.getStats();
      expect(stats.cache_size).toBe(0);
    });
  });

  describe('Statistics', () => {
    it('should track resolutions and packages', async () => {
      const lockfileContent = JSON.stringify({
        dependencies: {
          axios: { version: '1.6.0' },
          lodash: { version: '4.17.21' },
        },
        lockfileVersion: 1,
      });

      await resolver.resolveFromLockfile(lockfileContent, async () => ({}));

      const stats = resolver.getStats();
      expect(stats.resolutions).toBe(1);
      expect(stats.total_packages).toBe(2);
    });

    it('should calculate cache hit rate', async () => {
      const content = JSON.stringify({
        dependencies: { lodash: { version: '4.17.21' } },
        lockfileVersion: 1,
      });

      await resolver.resolveFromLockfile(content, async () => ({}));
      await resolver.resolveFromLockfile(content, async () => ({}));
      await resolver.resolveFromLockfile(content, async () => ({}));

      const stats = resolver.getStats();
      expect(stats.cache_hit_rate).toBe('66.67');
    });

    it('should return 0.00 hit rate for no resolutions', () => {
      const stats = resolver.getStats();
      expect(stats.cache_hit_rate).toBe('0.00');
    });
  });

  describe('Global Instance', () => {
    it('should provide a global lockfileResolver instance', () => {
      expect(lockfileResolver).toBeInstanceOf(LockfileResolver);
    });

    it('should maintain cache across calls', async () => {
      lockfileResolver.clearCache();

      const content = JSON.stringify({
        dependencies: { test: { version: '1.0.0' } },
        lockfileVersion: 1,
      });

      await lockfileResolver.resolveFromLockfile(content, async () => ({}));

      const stats = lockfileResolver.getStats();
      expect(stats.cache_size).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty lockfile', async () => {
      const content = JSON.stringify({ dependencies: {}, lockfileVersion: 1 });
      const result = await resolver.resolveFromLockfile(content, async () => ({}));

      expect(result.total).toBe(0);
      expect(result.packages).toHaveLength(0);
    });

    it('should handle lockfile with no dependencies field', async () => {
      const content = JSON.stringify({ lockfileVersion: 1 });
      const result = await resolver.resolveFromLockfile(content, async () => ({}));

      expect(result.total).toBe(0);
    });

    it('should handle concurrent resolutions', async () => {
      const content1 = JSON.stringify({
        dependencies: { pkg1: { version: '1.0.0' } },
        lockfileVersion: 1,
      });
      const content2 = JSON.stringify({
        dependencies: { pkg2: { version: '2.0.0' } },
        lockfileVersion: 1,
      });

      const [result1, result2] = await Promise.all([
        resolver.resolveFromLockfile(content1, async () => ({})),
        resolver.resolveFromLockfile(content2, async () => ({})),
      ]);

      expect(result1.packages[0].name).toBe('pkg1');
      expect(result2.packages[0].name).toBe('pkg2');
    });
  });
});
