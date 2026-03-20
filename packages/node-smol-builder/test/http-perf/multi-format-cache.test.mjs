
import { describe, it, expect, beforeEach } from 'vitest';
import { CACHE_TIERS, MultiFormatCache, multiFormatCache } from '../../additions/source-patched/lib/internal/socketsecurity/http-perf/multi-format-cache';

describe('MultiFormatCache', () => {
  let cache;

  beforeEach(() => {
    cache = new MultiFormatCache({
      maxBinarySize: 100,
      maxMetadataSize: 100,
      maxPlatformSize: 100,
    });
  });

  describe('Metadata Caching', () => {
    it('should cache metadata separately from binaries', () => {
      const metadata = { description: 'Test package', name: 'lodash', version: '4.17.21' };
      cache.setMetadata('npm', 'lodash', '4.17.21', metadata);

      const cached = cache.getMetadata('npm', 'lodash', '4.17.21');
      expect(cached).toEqual(metadata);
    });

    it('should return null for cache miss', () => {
      const cached = cache.getMetadata('npm', 'nonexistent', '1.0.0');
      expect(cached).toBeNull();
    });

    it('should track metadata hits and misses', () => {
      cache.setMetadata('npm', 'lodash', '4.17.21', { name: 'lodash' });

      cache.getMetadata('npm', 'lodash', '4.17.21');
      cache.getMetadata('npm', 'nonexistent', '1.0.0');

      const stats = cache.getStats();
      expect(stats.stats.metadata_hits).toBe(1);
      expect(stats.stats.metadata_misses).toBe(1);
    });

    it('should update LRU order on access', () => {
      cache.setMetadata('npm', 'pkg1', '1.0.0', { name: 'pkg1' });
      cache.setMetadata('npm', 'pkg2', '1.0.0', { name: 'pkg2' });

      cache.getMetadata('npm', 'pkg1', '1.0.0');

      expect(cache.hasMetadata('npm', 'pkg1', '1.0.0')).toBe(true);
      expect(cache.hasMetadata('npm', 'pkg2', '1.0.0')).toBe(true);
    });

    it('should evict oldest entries when at capacity', () => {
      const smallCache = new MultiFormatCache({ maxMetadataSize: 2 });

      smallCache.setMetadata('npm', 'pkg1', '1.0.0', { name: 'pkg1' });
      smallCache.setMetadata('npm', 'pkg2', '1.0.0', { name: 'pkg2' });
      smallCache.setMetadata('npm', 'pkg3', '1.0.0', { name: 'pkg3' });

      expect(smallCache.hasMetadata('npm', 'pkg1', '1.0.0')).toBe(false);
      expect(smallCache.hasMetadata('npm', 'pkg2', '1.0.0')).toBe(true);
      expect(smallCache.hasMetadata('npm', 'pkg3', '1.0.0')).toBe(true);
    });

    it('should return hash of cached content', () => {
      const metadata = { name: 'lodash', version: '4.17.21' };
      const hash = cache.setMetadata('npm', 'lodash', '4.17.21', metadata);

      expect(hash).toBeTypeOf('string');
      expect(hash).toHaveLength(16);
    });
  });

  describe('Binary Caching', () => {
    it('should cache binary packages', () => {
      const binary = Buffer.from('package content');
      cache.setBinary('npm', 'lodash', '4.17.21', binary);

      const cached = cache.getBinary('npm', 'lodash', '4.17.21');
      expect(cached).toEqual(binary);
    });

    it('should return null for binary cache miss', () => {
      const cached = cache.getBinary('npm', 'nonexistent', '1.0.0');
      expect(cached).toBeNull();
    });

    it('should track binary hits and misses', () => {
      const binary = Buffer.from('content');
      cache.setBinary('npm', 'lodash', '4.17.21', binary);

      cache.getBinary('npm', 'lodash', '4.17.21');
      cache.getBinary('npm', 'nonexistent', '1.0.0');

      const stats = cache.getStats();
      expect(stats.stats.binary_hits).toBe(1);
      expect(stats.stats.binary_misses).toBe(1);
    });

    it('should store size information', () => {
      const binary = Buffer.from('package content');
      cache.setBinary('npm', 'lodash', '4.17.21', binary);

      const entry = cache.binaryCache.get('npm:lodash@4.17.21');
      expect(entry.size).toBe(binary.length);
    });

    it('should evict oldest binaries when at capacity', () => {
      const smallCache = new MultiFormatCache({ maxBinarySize: 2 });

      smallCache.setBinary('npm', 'pkg1', '1.0.0', Buffer.from('data1'));
      smallCache.setBinary('npm', 'pkg2', '1.0.0', Buffer.from('data2'));
      smallCache.setBinary('npm', 'pkg3', '1.0.0', Buffer.from('data3'));

      expect(smallCache.hasBinary('npm', 'pkg1', '1.0.0')).toBe(false);
      expect(smallCache.hasBinary('npm', 'pkg2', '1.0.0')).toBe(true);
      expect(smallCache.hasBinary('npm', 'pkg3', '1.0.0')).toBe(true);
    });
  });

  describe('Platform-Specific Caching', () => {
    it('should handle platform-specific variants', () => {
      const linuxBinary = Buffer.from('linux-x64 binary');
      const darwinBinary = Buffer.from('darwin-arm64 binary');

      cache.setPlatformVariant('pip', 'numpy', '1.24.0', 'linux-x64', linuxBinary);
      cache.setPlatformVariant('pip', 'numpy', '1.24.0', 'darwin-arm64', darwinBinary);

      const linux = cache.getPlatformVariant('pip', 'numpy', '1.24.0', 'linux-x64');
      const darwin = cache.getPlatformVariant('pip', 'numpy', '1.24.0', 'darwin-arm64');

      expect(linux).toEqual(linuxBinary);
      expect(darwin).toEqual(darwinBinary);
    });

    it('should return null for platform variant miss', () => {
      const cached = cache.getPlatformVariant('pip', 'numpy', '1.24.0', 'win32-x64');
      expect(cached).toBeNull();
    });

    it('should track platform hits and misses', () => {
      cache.setPlatformVariant('pip', 'numpy', '1.24.0', 'linux-x64', Buffer.from('data'));

      cache.getPlatformVariant('pip', 'numpy', '1.24.0', 'linux-x64');
      cache.getPlatformVariant('pip', 'numpy', '1.24.0', 'win32-x64');

      const stats = cache.getStats();
      expect(stats.stats.platform_hits).toBe(1);
      expect(stats.stats.platform_misses).toBe(1);
    });

    it('should evict oldest platform variants when at capacity', () => {
      const smallCache = new MultiFormatCache({ maxPlatformSize: 2 });

      smallCache.setPlatformVariant('pip', 'pkg', '1.0.0', 'linux', Buffer.from('l'));
      smallCache.setPlatformVariant('pip', 'pkg', '1.0.0', 'darwin', Buffer.from('d'));
      smallCache.setPlatformVariant('pip', 'pkg', '1.0.0', 'win32', Buffer.from('w'));

      expect(smallCache.platformCache.has('pip:pkg@1.0.0:linux')).toBe(false);
      expect(smallCache.platformCache.has('pip:pkg@1.0.0:darwin')).toBe(true);
      expect(smallCache.platformCache.has('pip:pkg@1.0.0:win32')).toBe(true);
    });
  });

  describe('Format-Specific Keys', () => {
    it('should isolate caches by format', () => {
      cache.setMetadata('npm', 'lodash', '4.17.21', { name: 'npm-lodash' });
      cache.setMetadata('pip', 'lodash', '4.17.21', { name: 'pip-lodash' });

      const npmData = cache.getMetadata('npm', 'lodash', '4.17.21');
      const pipData = cache.getMetadata('pip', 'lodash', '4.17.21');

      expect(npmData.name).toBe('npm-lodash');
      expect(pipData.name).toBe('pip-lodash');
    });

    it('should generate unique keys for different formats', () => {
      const npmKey = cache._generateKey('npm', 'lodash', '4.17.21');
      const pipKey = cache._generateKey('pip', 'lodash', '4.17.21');

      expect(npmKey).not.toBe(pipKey);
      expect(npmKey).toBe('npm:lodash@4.17.21');
      expect(pipKey).toBe('pip:lodash@4.17.21');
    });

    it('should generate keys with platform suffix', () => {
      const key = cache._generateKey('pip', 'numpy', '1.24.0', 'linux-x64');
      expect(key).toBe('pip:numpy@1.24.0:linux-x64');
    });
  });

  describe('Cache Invalidation', () => {
    it('should invalidate all cache tiers for a package', () => {
      cache.setMetadata('npm', 'lodash', '4.17.21', { name: 'lodash' });
      cache.setBinary('npm', 'lodash', '4.17.21', Buffer.from('binary'));
      cache.setPlatformVariant('npm', 'lodash', '4.17.21', 'linux-x64', Buffer.from('linux'));

      cache.invalidate('npm', 'lodash', '4.17.21');

      expect(cache.hasMetadata('npm', 'lodash', '4.17.21')).toBe(false);
      expect(cache.hasBinary('npm', 'lodash', '4.17.21')).toBe(false);
      expect(cache.getPlatformVariant('npm', 'lodash', '4.17.21', 'linux-x64')).toBeNull();
    });

    it('should invalidate all platform variants for a package', () => {
      cache.setPlatformVariant('pip', 'numpy', '1.24.0', 'linux-x64', Buffer.from('l'));
      cache.setPlatformVariant('pip', 'numpy', '1.24.0', 'darwin-arm64', Buffer.from('d'));
      cache.setPlatformVariant('pip', 'numpy', '1.24.0', 'win32-x64', Buffer.from('w'));

      cache.invalidate('pip', 'numpy', '1.24.0');

      expect(cache.getPlatformVariant('pip', 'numpy', '1.24.0', 'linux-x64')).toBeNull();
      expect(cache.getPlatformVariant('pip', 'numpy', '1.24.0', 'darwin-arm64')).toBeNull();
      expect(cache.getPlatformVariant('pip', 'numpy', '1.24.0', 'win32-x64')).toBeNull();
    });

    it('should not invalidate other packages', () => {
      cache.setMetadata('npm', 'lodash', '4.17.21', { name: 'lodash' });
      cache.setMetadata('npm', 'axios', '1.6.0', { name: 'axios' });

      cache.invalidate('npm', 'lodash', '4.17.21');

      expect(cache.hasMetadata('npm', 'lodash', '4.17.21')).toBe(false);
      expect(cache.hasMetadata('npm', 'axios', '1.6.0')).toBe(true);
    });
  });

  describe('Statistics', () => {
    it('should calculate hit rates correctly', () => {
      cache.setMetadata('npm', 'lodash', '4.17.21', { name: 'lodash' });

      cache.getMetadata('npm', 'lodash', '4.17.21');
      cache.getMetadata('npm', 'lodash', '4.17.21');
      cache.getMetadata('npm', 'nonexistent', '1.0.0');

      const stats = cache.getStats();
      expect(stats.metadata_hit_rate).toBe('66.67');
    });

    it('should return 0.00 hit rate for no accesses', () => {
      const stats = cache.getStats();
      expect(stats.metadata_hit_rate).toBe('0.00');
      expect(stats.binary_hit_rate).toBe('0.00');
      expect(stats.platform_hit_rate).toBe('0.00');
    });

    it('should report cache sizes', () => {
      cache.setMetadata('npm', 'pkg1', '1.0.0', {});
      cache.setBinary('npm', 'pkg1', '1.0.0', Buffer.from('data'));
      cache.setPlatformVariant('pip', 'pkg2', '1.0.0', 'linux', Buffer.from('l'));

      const stats = cache.getStats();
      expect(stats.cache_sizes.metadata).toBe(1);
      expect(stats.cache_sizes.binary).toBe(1);
      expect(stats.cache_sizes.platform).toBe(1);
    });
  });

  describe('Clear All', () => {
    it('should clear all caches and reset stats', () => {
      cache.setMetadata('npm', 'lodash', '4.17.21', { name: 'lodash' });
      cache.setBinary('npm', 'lodash', '4.17.21', Buffer.from('binary'));
      cache.setPlatformVariant('pip', 'numpy', '1.24.0', 'linux', Buffer.from('l'));

      cache.getMetadata('npm', 'lodash', '4.17.21');

      cache.clearAll();

      const stats = cache.getStats();
      expect(stats.cache_sizes.metadata).toBe(0);
      expect(stats.cache_sizes.binary).toBe(0);
      expect(stats.cache_sizes.platform).toBe(0);
      expect(stats.stats.metadata_hits).toBe(0);
      expect(stats.stats.metadata_misses).toBe(0);
    });
  });

  describe('Global Instance', () => {
    it('should provide a global multiFormatCache instance', () => {
      expect(multiFormatCache).toBeInstanceOf(MultiFormatCache);
    });

    it('should maintain state across calls', () => {
      multiFormatCache.clearAll();
      multiFormatCache.setMetadata('npm', 'test', '1.0.0', { name: 'test' });

      expect(multiFormatCache.hasMetadata('npm', 'test', '1.0.0')).toBe(true);
    });
  });

  describe('CACHE_TIERS constant', () => {
    it('should export cache tier constants', () => {
      expect(CACHE_TIERS.METADATA).toBe('metadata');
      expect(CACHE_TIERS.BINARY).toBe('binary');
      expect(CACHE_TIERS.PLATFORM).toBe('platform');
    });

    it('should have null prototype', () => {
      expect(Object.getPrototypeOf(CACHE_TIERS)).toBeNull();
    });
  });
});
