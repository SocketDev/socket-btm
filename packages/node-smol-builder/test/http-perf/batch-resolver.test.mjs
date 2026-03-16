
import { describe, it, expect, beforeEach } from 'vitest';
import { BatchResolver, batchResolver } from '../../additions/source-patched/lib/internal/socketsecurity/http-perf/batch-resolver';

describe('BatchResolver', () => {
  let resolver;

  beforeEach(() => {
    resolver = new BatchResolver(10);
  });

  describe('Batch Resolution', () => {
    it('should resolve batch of packages', async () => {
      const packages = [
        { name: 'axios', version: '1.6.0' },
        { name: 'lodash', version: '4.17.21' },
      ];

      const mockFetchPackage = async (name, version) => ({
        description: `${name} package`,
        name,
        version,
      });

      const result = await resolver.resolveBatch(packages, mockFetchPackage);

      expect(result.total_requested).toBe(2);
      expect(result.total_unique).toBe(2);
      expect(result.packages).toHaveLength(2);
      expect(result.packages[0].name).toBe('axios');
      expect(result.packages[1].name).toBe('lodash');
    });

    it('should deduplicate identical packages', async () => {
      const packages = [
        { name: 'axios', version: '1.6.0' },
        { name: 'axios', version: '1.6.0' },
        { name: 'lodash', version: '4.17.21' },
        { name: 'lodash', version: '4.17.21' },
        { name: 'lodash', version: '4.17.21' },
      ];

      const mockFetchPackage = async (name, version) => ({ name, version });

      const result = await resolver.resolveBatch(packages, mockFetchPackage);

      expect(result.total_requested).toBe(5);
      expect(result.total_unique).toBe(2);
      expect(result.deduplication_saved).toBe(3);
      expect(result.packages).toHaveLength(2);
    });

    it('should handle fetch errors gracefully', async () => {
      const packages = [
        { name: 'axios', version: '1.6.0' },
        { name: 'nonexistent', version: '99.99.99' },
      ];

      const mockFetchPackage = async (name) => {
        if (name === 'nonexistent') {
          throw new Error('Package not found');
        }
        return { name, version: '1.6.0' };
      };

      const result = await resolver.resolveBatch(packages, mockFetchPackage);

      expect(result.packages).toHaveLength(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].name).toBe('nonexistent');
      expect(result.errors[0].error).toBe('Package not found');
    });

    it('should return empty arrays for empty input', async () => {
      const result = await resolver.resolveBatch([], async () => ({}));

      expect(result.total_requested).toBe(0);
      expect(result.total_unique).toBe(0);
      expect(result.packages).toHaveLength(0);
    });
  });

  describe('Concurrency Limiting', () => {
    it('should respect concurrency limits', async () => {
      const smallResolver = new BatchResolver(2);
      const packages = Array.from({ length: 10 }, (_, i) => ({
        name: `pkg${i}`,
        version: '1.0.0',
      }));

      let concurrentRequests = 0;
      let maxConcurrent = 0;

      const mockFetchPackage = async () => {
        concurrentRequests++;
        maxConcurrent = Math.max(maxConcurrent, concurrentRequests);
        await new Promise(resolve => setTimeout(resolve, 10));
        concurrentRequests--;
        return {};
      };

      await smallResolver.resolveBatch(packages, mockFetchPackage);

      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });

    it('should process all packages despite concurrency limit', async () => {
      const smallResolver = new BatchResolver(3);
      const packages = Array.from({ length: 15 }, (_, i) => ({
        name: `pkg${i}`,
        version: '1.0.0',
      }));

      const mockFetchPackage = async (name, version) => ({ name, version });

      const result = await smallResolver.resolveBatch(packages, mockFetchPackage);

      expect(result.packages).toHaveLength(15);
    });
  });

  describe('Dependency Graph Expansion', () => {
    it('should expand dependency graph', async () => {
      const rootPackages = [{ name: 'express', version: '4.18.0' }];

      const mockFetchPackage = async (name) => {
        if (name === 'express') {
          return {
            dependencies: {
              'body-parser': '^1.20.0',
              'cookie-parser': '^1.4.0',
            },
            name: 'express',
            version: '4.18.0',
          };
        }
        if (name === 'body-parser') {
          return {
            dependencies: {
              'raw-body': '^2.5.0',
            },
            name: 'body-parser',
            version: '1.20.0',
          };
        }
        return { name, version: '1.0.0' };
      };

      const result = await resolver.resolveWithDeps(rootPackages, mockFetchPackage, 2);

      expect(result.total).toBeGreaterThanOrEqual(3);
      expect(result.depth_reached).toBeLessThanOrEqual(2);
    });

    it('should respect maxDepth parameter', async () => {
      const rootPackages = [{ name: 'root', version: '1.0.0' }];

      const mockFetchPackage = async (name) => ({
        dependencies: {
          child: '1.0.0',
        },
        name,
        version: '1.0.0',
      });

      const result = await resolver.resolveWithDeps(rootPackages, mockFetchPackage, 1);

      expect(result.depth_reached).toBe(1);
    });

    it('should avoid circular dependencies', async () => {
      const rootPackages = [{ name: 'pkgA', version: '1.0.0' }];

      const mockFetchPackage = async (name) => {
        if (name === 'pkgA') {
          return {
            dependencies: { pkgB: '1.0.0' },
            name: 'pkgA',
            version: '1.0.0',
          };
        }
        if (name === 'pkgB') {
          return {
            dependencies: { pkgA: '1.0.0' },
            name: 'pkgB',
            version: '1.0.0',
          };
        }
        return { name, version: '1.0.0' };
      };

      const result = await resolver.resolveWithDeps(rootPackages, mockFetchPackage, 5);

      expect(result.total).toBe(2);
    });

    it('should handle packages without dependencies', async () => {
      const rootPackages = [{ name: 'leaf-package', version: '1.0.0' }];

      const mockFetchPackage = async (name, version) => ({
        name,
        version,
      });

      const result = await resolver.resolveWithDeps(rootPackages, mockFetchPackage, 3);

      expect(result.total).toBe(1);
      expect(result.packages).toHaveLength(1);
    });
  });

  describe('Statistics', () => {
    it('should track batches resolved', async () => {
      const packages = [{ name: 'lodash', version: '4.17.21' }];
      await resolver.resolveBatch(packages, async () => ({}));
      await resolver.resolveBatch(packages, async () => ({}));

      const stats = resolver.getStats();
      expect(stats.batches_resolved).toBe(2);
    });

    it('should track packages fetched', async () => {
      const packages = [
        { name: 'axios', version: '1.6.0' },
        { name: 'lodash', version: '4.17.21' },
      ];

      await resolver.resolveBatch(packages, async () => ({}));

      const stats = resolver.getStats();
      expect(stats.packages_fetched).toBe(2);
    });

    it('should track deduplication savings', async () => {
      const packages = [
        { name: 'lodash', version: '4.17.21' },
        { name: 'lodash', version: '4.17.21' },
        { name: 'lodash', version: '4.17.21' },
      ];

      await resolver.resolveBatch(packages, async () => ({}));

      const stats = resolver.getStats();
      expect(stats.deduplication_saved).toBe(2);
    });

    it('should calculate average dedup savings', async () => {
      const packages1 = [
        { name: 'pkg1', version: '1.0.0' },
        { name: 'pkg1', version: '1.0.0' },
      ];
      const packages2 = [
        { name: 'pkg2', version: '1.0.0' },
        { name: 'pkg2', version: '1.0.0' },
        { name: 'pkg2', version: '1.0.0' },
        { name: 'pkg2', version: '1.0.0' },
      ];

      await resolver.resolveBatch(packages1, async () => ({}));
      await resolver.resolveBatch(packages2, async () => ({}));

      const stats = resolver.getStats();
      expect(stats.avg_dedup_savings).toBe('2.00');
    });

    it('should clear statistics', () => {
      resolver.clearStats();

      const stats = resolver.getStats();
      expect(stats.batches_resolved).toBe(0);
      expect(stats.packages_fetched).toBe(0);
      expect(stats.deduplication_saved).toBe(0);
    });
  });

  describe('Global Instance', () => {
    it('should provide a global batchResolver instance', () => {
      expect(batchResolver).toBeInstanceOf(BatchResolver);
    });

    it('should maintain state across calls', async () => {
      batchResolver.clearStats();

      const packages = [{ name: 'test', version: '1.0.0' }];
      await batchResolver.resolveBatch(packages, async () => ({}));

      const stats = batchResolver.getStats();
      expect(stats.batches_resolved).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle null packages array', async () => {
      const result = await resolver.resolveBatch(null, async () => ({}));
      expect(result.total_requested).toBe(0);
    });

    it('should handle packages with missing name or version', async () => {
      const packages = [
        { name: 'valid', version: '1.0.0' },
        { name: 'no-version' },
        { version: '1.0.0' },
      ];

      const mockFetchPackage = async (name, version) => {
        if (!name || !version) {
          throw new Error('Missing name or version');
        }
        return { name, version };
      };

      const result = await resolver.resolveBatch(packages, mockFetchPackage);

      expect(result.packages.length).toBeLessThanOrEqual(packages.length);
    });

    it('should handle concurrent batch resolutions', async () => {
      const packages1 = [{ name: 'pkg1', version: '1.0.0' }];
      const packages2 = [{ name: 'pkg2', version: '2.0.0' }];

      const mockFetch = async (name, version) => ({ name, version });

      const [result1, result2] = await Promise.all([
        resolver.resolveBatch(packages1, mockFetch),
        resolver.resolveBatch(packages2, mockFetch),
      ]);

      expect(result1.packages[0].name).toBe('pkg1');
      expect(result2.packages[0].name).toBe('pkg2');
    });

    it('should handle slow fetch operations', async () => {
      const packages = Array.from({ length: 5 }, (_, i) => ({
        name: `pkg${i}`,
        version: '1.0.0',
      }));

      const mockFetchPackage = async (name, version) => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return { name, version };
      };

      const start = Date.now();
      await resolver.resolveBatch(packages, mockFetchPackage);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(150);
    });
  });

  describe('Deduplication', () => {
    it('should deduplicate by name@version key', async () => {
      const packages = [
        { name: 'lodash', version: '4.17.21' },
        { name: 'lodash', version: '4.17.20' },
        { name: 'lodash', version: '4.17.21' },
      ];

      const mockFetchPackage = async (name, version) => ({ name, version });

      const result = await resolver.resolveBatch(packages, mockFetchPackage);

      expect(result.total_unique).toBe(2);
      expect(result.deduplication_saved).toBe(1);
    });

    it('should not deduplicate different packages', async () => {
      const packages = [
        { name: 'axios', version: '1.6.0' },
        { name: 'lodash', version: '1.6.0' },
      ];

      const mockFetchPackage = async (name, version) => ({ name, version });

      const result = await resolver.resolveBatch(packages, mockFetchPackage);

      expect(result.total_unique).toBe(2);
      expect(result.deduplication_saved).toBe(0);
    });
  });
});
