
import { describe, it, expect, beforeEach } from 'vitest';
import { PlatformCache, PlatformDetector, platformCache } from '../../additions/source-patched/lib/internal/socketsecurity/http-perf/platform-cache';

describe('PlatformDetector', () => {
  describe('Platform Detection', () => {
    it('should detect linux from User-Agent', () => {
      const req = { headers: { 'user-agent': 'pip/23.0 (linux-x86_64)' } };
      expect(PlatformDetector.detect(req)).toBe('linux');
    });

    it('should detect darwin from User-Agent', () => {
      const req = { headers: { 'user-agent': 'pip/23.0 (darwin-arm64)' } };
      expect(PlatformDetector.detect(req)).toBe('darwin');
    });

    it('should detect macos as darwin', () => {
      const req = { headers: { 'user-agent': 'pip/23.0 (macos)' } };
      expect(PlatformDetector.detect(req)).toBe('darwin');
    });

    it('should detect win32 from User-Agent', () => {
      const req = { headers: { 'user-agent': 'pip/23.0 (win32)' } };
      expect(PlatformDetector.detect(req)).toBe('win32');
    });

    it('should detect windows as win32', () => {
      const req = { headers: { 'user-agent': 'pip/23.0 (windows)' } };
      expect(PlatformDetector.detect(req)).toBe('win32');
    });

    it('should detect freebsd from User-Agent', () => {
      const req = { headers: { 'user-agent': 'pip/23.0 (freebsd)' } };
      expect(PlatformDetector.detect(req)).toBe('freebsd');
    });

    it('should fall back to current system platform', () => {
      const req = { headers: { 'user-agent': 'unknown-client' } };
      const platform = PlatformDetector.detect(req);
      expect(platform).toBeTypeOf('string');
    });

    it('should handle missing User-Agent', () => {
      const req = { headers: {} };
      const platform = PlatformDetector.detect(req);
      expect(platform).toBeTypeOf('string');
    });

    it('should handle null request', () => {
      const platform = PlatformDetector.detect(null);
      expect(platform).toBeTypeOf('string');
    });
  });

  describe('Architecture Detection', () => {
    it('should detect x64 from User-Agent', () => {
      const req = { headers: { 'user-agent': 'pip/23.0 (linux-x86_64)' } };
      expect(PlatformDetector.detectArch(req)).toBe('x64');
    });

    it('should detect amd64 as x64', () => {
      const req = { headers: { 'user-agent': 'pip/23.0 (linux-amd64)' } };
      expect(PlatformDetector.detectArch(req)).toBe('x64');
    });

    it('should detect arm64 from User-Agent', () => {
      const req = { headers: { 'user-agent': 'pip/23.0 (darwin-arm64)' } };
      expect(PlatformDetector.detectArch(req)).toBe('arm64');
    });

    it('should detect aarch64 as arm64', () => {
      const req = { headers: { 'user-agent': 'pip/23.0 (linux-aarch64)' } };
      expect(PlatformDetector.detectArch(req)).toBe('arm64');
    });

    it('should detect arm from User-Agent', () => {
      const req = { headers: { 'user-agent': 'pip/23.0 (linux-arm)' } };
      expect(PlatformDetector.detectArch(req)).toBe('arm');
    });

    it('should detect i686 as ia32', () => {
      const req = { headers: { 'user-agent': 'pip/23.0 (linux-i686)' } };
      expect(PlatformDetector.detectArch(req)).toBe('ia32');
    });

    it('should fall back to current system arch', () => {
      const req = { headers: { 'user-agent': 'unknown-client' } };
      const arch = PlatformDetector.detectArch(req);
      expect(arch).toBeTypeOf('string');
    });
  });

  describe('Platform Normalization', () => {
    it('should normalize platform and arch', () => {
      expect(PlatformDetector.normalize('linux', 'x64')).toBe('linux-x64');
      expect(PlatformDetector.normalize('darwin', 'arm64')).toBe('darwin-arm64');
      expect(PlatformDetector.normalize('win32', 'x64')).toBe('win32-x64');
    });
  });
});

describe('PlatformCache', () => {
  let cache;

  beforeEach(() => {
    cache = new PlatformCache(100);
  });

  describe('Platform-Specific Caching', () => {
    it('should cache platform-specific variants', () => {
      const linuxData = Buffer.from('linux binary');
      cache.set('numpy', '1.24.0', 'linux', 'x64', linuxData);

      const cached = cache.get('numpy', '1.24.0', 'linux', 'x64');
      expect(cached).toEqual(linuxData);
    });

    it('should return null for cache miss', () => {
      const cached = cache.get('numpy', '1.24.0', 'win32', 'x64');
      expect(cached).toBeNull();
    });

    it('should isolate variants by platform', () => {
      const linuxData = Buffer.from('linux binary');
      const darwinData = Buffer.from('darwin binary');

      cache.set('numpy', '1.24.0', 'linux', 'x64', linuxData);
      cache.set('numpy', '1.24.0', 'darwin', 'arm64', darwinData);

      const linux = cache.get('numpy', '1.24.0', 'linux', 'x64');
      const darwin = cache.get('numpy', '1.24.0', 'darwin', 'arm64');

      expect(linux).toEqual(linuxData);
      expect(darwin).toEqual(darwinData);
    });

    it('should check if variant exists', () => {
      cache.set('numpy', '1.24.0', 'linux', 'x64', Buffer.from('data'));

      expect(cache.has('numpy', '1.24.0', 'linux', 'x64')).toBe(true);
      expect(cache.has('numpy', '1.24.0', 'win32', 'x64')).toBe(false);
    });
  });

  describe('Get All Variants', () => {
    it('should return all variants for a package', () => {
      cache.set('numpy', '1.24.0', 'linux', 'x64', Buffer.from('linux'));
      cache.set('numpy', '1.24.0', 'darwin', 'arm64', Buffer.from('darwin'));
      cache.set('numpy', '1.24.0', 'win32', 'x64', Buffer.from('win32'));

      const variants = cache.getAllVariants('numpy', '1.24.0');

      expect(variants).toHaveLength(3);
      expect(variants.some(v => v.platform === 'linux' && v.arch === 'x64')).toBe(true);
      expect(variants.some(v => v.platform === 'darwin' && v.arch === 'arm64')).toBe(true);
      expect(variants.some(v => v.platform === 'win32' && v.arch === 'x64')).toBe(true);
    });

    it('should return empty array for package with no variants', () => {
      const variants = cache.getAllVariants('nonexistent', '1.0.0');
      expect(variants).toHaveLength(0);
    });

    it('should not include variants from different packages', () => {
      cache.set('numpy', '1.24.0', 'linux', 'x64', Buffer.from('numpy-linux'));
      cache.set('scipy', '1.11.0', 'linux', 'x64', Buffer.from('scipy-linux'));

      const variants = cache.getAllVariants('numpy', '1.24.0');

      expect(variants).toHaveLength(1);
      expect(variants[0].data.toString()).toBe('numpy-linux');
    });
  });

  describe('Cache Invalidation', () => {
    it('should invalidate all variants for a package', () => {
      cache.set('numpy', '1.24.0', 'linux', 'x64', Buffer.from('l'));
      cache.set('numpy', '1.24.0', 'darwin', 'arm64', Buffer.from('d'));
      cache.set('numpy', '1.24.0', 'win32', 'x64', Buffer.from('w'));

      const invalidated = cache.invalidate('numpy', '1.24.0');

      expect(invalidated).toBe(3);
      expect(cache.getAllVariants('numpy', '1.24.0')).toHaveLength(0);
    });

    it('should return 0 when nothing to invalidate', () => {
      const invalidated = cache.invalidate('nonexistent', '1.0.0');
      expect(invalidated).toBe(0);
    });

    it('should not invalidate other versions', () => {
      cache.set('numpy', '1.24.0', 'linux', 'x64', Buffer.from('old'));
      cache.set('numpy', '1.25.0', 'linux', 'x64', Buffer.from('new'));

      cache.invalidate('numpy', '1.24.0');

      expect(cache.has('numpy', '1.24.0', 'linux', 'x64')).toBe(false);
      expect(cache.has('numpy', '1.25.0', 'linux', 'x64')).toBe(true);
    });
  });

  describe('LRU Eviction', () => {
    it('should evict oldest entries when at capacity', () => {
      const smallCache = new PlatformCache(2);

      smallCache.set('pkg1', '1.0.0', 'linux', 'x64', Buffer.from('1'));
      smallCache.set('pkg2', '1.0.0', 'linux', 'x64', Buffer.from('2'));
      smallCache.set('pkg3', '1.0.0', 'linux', 'x64', Buffer.from('3'));

      expect(smallCache.has('pkg1', '1.0.0', 'linux', 'x64')).toBe(false);
      expect(smallCache.has('pkg2', '1.0.0', 'linux', 'x64')).toBe(true);
      expect(smallCache.has('pkg3', '1.0.0', 'linux', 'x64')).toBe(true);
    });

    it('should update LRU order on access', () => {
      const smallCache = new PlatformCache(2);

      smallCache.set('pkg1', '1.0.0', 'linux', 'x64', Buffer.from('1'));
      smallCache.set('pkg2', '1.0.0', 'linux', 'x64', Buffer.from('2'));

      smallCache.get('pkg1', '1.0.0', 'linux', 'x64');

      smallCache.set('pkg3', '1.0.0', 'linux', 'x64', Buffer.from('3'));

      expect(smallCache.has('pkg1', '1.0.0', 'linux', 'x64')).toBe(true);
      expect(smallCache.has('pkg2', '1.0.0', 'linux', 'x64')).toBe(false);
      expect(smallCache.has('pkg3', '1.0.0', 'linux', 'x64')).toBe(true);
    });
  });

  describe('Statistics', () => {
    it('should track cache hits and misses', () => {
      cache.set('numpy', '1.24.0', 'linux', 'x64', Buffer.from('data'));

      cache.get('numpy', '1.24.0', 'linux', 'x64');
      cache.get('numpy', '1.24.0', 'win32', 'x64');

      const stats = cache.getStats();
      expect(stats.cache_hits).toBe(1);
      expect(stats.cache_misses).toBe(1);
    });

    it('should track platform statistics', () => {
      cache.set('pkg1', '1.0.0', 'linux', 'x64', Buffer.from('l'));
      cache.set('pkg2', '1.0.0', 'darwin', 'arm64', Buffer.from('d'));
      cache.set('pkg3', '1.0.0', 'win32', 'x64', Buffer.from('w'));
      cache.set('pkg4', '1.0.0', 'freebsd', 'x64', Buffer.from('f'));

      const stats = cache.getStats();
      expect(stats.platform_linux).toBe(1);
      expect(stats.platform_darwin).toBe(1);
      expect(stats.platform_win32).toBe(1);
      expect(stats.platform_other).toBe(1);
    });

    it('should calculate hit rate correctly', () => {
      cache.set('numpy', '1.24.0', 'linux', 'x64', Buffer.from('data'));

      cache.get('numpy', '1.24.0', 'linux', 'x64');
      cache.get('numpy', '1.24.0', 'linux', 'x64');
      cache.get('numpy', '1.24.0', 'win32', 'x64');

      const stats = cache.getStats();
      expect(stats.cache_hit_rate).toBe('66.67');
    });

    it('should return 0.00 hit rate for no accesses', () => {
      const stats = cache.getStats();
      expect(stats.cache_hit_rate).toBe('0.00');
    });

    it('should report cache size', () => {
      cache.set('pkg1', '1.0.0', 'linux', 'x64', Buffer.from('1'));
      cache.set('pkg2', '1.0.0', 'darwin', 'arm64', Buffer.from('2'));

      const stats = cache.getStats();
      expect(stats.cache_size).toBe(2);
    });
  });

  describe('Clear Cache', () => {
    it('should clear all cached variants and reset stats', () => {
      cache.set('numpy', '1.24.0', 'linux', 'x64', Buffer.from('data'));
      cache.get('numpy', '1.24.0', 'linux', 'x64');

      cache.clear();

      const stats = cache.getStats();
      expect(stats.cache_size).toBe(0);
      expect(stats.cache_hits).toBe(0);
      expect(stats.cache_misses).toBe(0);
      expect(stats.platform_linux).toBe(0);
    });
  });

  describe('Global Instance', () => {
    it('should provide a global platformCache instance', () => {
      expect(platformCache).toBeInstanceOf(PlatformCache);
    });

    it('should maintain state across calls', () => {
      platformCache.clear();
      platformCache.set('test', '1.0.0', 'linux', 'x64', Buffer.from('data'));

      expect(platformCache.has('test', '1.0.0', 'linux', 'x64')).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty buffer', () => {
      cache.set('empty', '1.0.0', 'linux', 'x64', Buffer.from(''));
      const cached = cache.get('empty', '1.0.0', 'linux', 'x64');
      expect(cached).toEqual(Buffer.from(''));
    });

    it('should handle large binary data', () => {
      const largeData = Buffer.alloc(10_000_000, 'a');
      cache.set('large', '1.0.0', 'linux', 'x64', largeData);

      const cached = cache.get('large', '1.0.0', 'linux', 'x64');
      expect(cached.length).toBe(10_000_000);
    });

    it('should handle special characters in package names', () => {
      cache.set('@scope/package', '1.0.0', 'linux', 'x64', Buffer.from('data'));
      const cached = cache.get('@scope/package', '1.0.0', 'linux', 'x64');
      expect(cached).toBeDefined();
    });

    it('should handle non-Buffer data types', () => {
      const data = { binary: 'content' };
      cache.set('obj', '1.0.0', 'linux', 'x64', data);

      const cached = cache.get('obj', '1.0.0', 'linux', 'x64');
      expect(cached).toEqual(data);
    });

    it('should generate unique keys for similar packages', () => {
      cache.set('numpy', '1.24.0', 'linux', 'x64', Buffer.from('numpy'));
      cache.set('numpy-mkl', '1.24.0', 'linux', 'x64', Buffer.from('numpy-mkl'));

      const numpy = cache.get('numpy', '1.24.0', 'linux', 'x64');
      const numpyMkl = cache.get('numpy-mkl', '1.24.0', 'linux', 'x64');

      expect(numpy.toString()).toBe('numpy');
      expect(numpyMkl.toString()).toBe('numpy-mkl');
    });
  });
});
