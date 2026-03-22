
import { describe, it, expect, beforeEach } from 'vitest';
import { CrossEcosystemIndex, PackageIdentifier, crossEcosystemIndex } from '../../additions/source-patched/lib/internal/socketsecurity/http-perf/cross-ecosystem-index';

describe('PackageIdentifier', () => {
  describe('Normalization', () => {
    it('should normalize npm scoped packages', () => {
      expect(PackageIdentifier.normalize('npm', '@babel/core')).toBe('babel-core');
      expect(PackageIdentifier.normalize('npm', '@types/node')).toBe('types-node');
    });

    it('should normalize npm unscoped packages', () => {
      expect(PackageIdentifier.normalize('npm', 'lodash')).toBe('lodash');
      expect(PackageIdentifier.normalize('npm', 'express')).toBe('express');
    });

    it('should normalize yarn packages', () => {
      expect(PackageIdentifier.normalize('yarn', '@babel/core')).toBe('babel-core');
      expect(PackageIdentifier.normalize('yarn', 'lodash')).toBe('lodash');
    });

    it('should normalize pnpm packages', () => {
      expect(PackageIdentifier.normalize('pnpm', '@babel/core')).toBe('babel-core');
      expect(PackageIdentifier.normalize('pnpm', 'lodash')).toBe('lodash');
    });

    it('should normalize Maven packages', () => {
      expect(PackageIdentifier.normalize('maven', 'org.example:artifact')).toBe('artifact');
      expect(PackageIdentifier.normalize('maven', 'com.google:guava')).toBe('guava');
    });

    it('should normalize Gradle packages', () => {
      expect(PackageIdentifier.normalize('gradle', 'org.example:artifact')).toBe('artifact');
    });

    it('should convert to lowercase', () => {
      expect(PackageIdentifier.normalize('npm', 'UpperCase')).toBe('uppercase');
      expect(PackageIdentifier.normalize('npm', 'MixedCase')).toBe('mixedcase');
    });

    it('should remove special characters', () => {
      expect(PackageIdentifier.normalize('npm', 'package.name')).toBe('package-name');
      expect(PackageIdentifier.normalize('npm', 'package_name')).toBe('package-name');
      expect(PackageIdentifier.normalize('npm', 'package#name')).toBe('package-name');
    });

    it('should handle multiple special characters', () => {
      expect(PackageIdentifier.normalize('npm', 'my.package_name')).toBe('my-package-name');
    });
  });

  describe('Identifier Generation', () => {
    it('should generate unique identifiers', () => {
      const id1 = PackageIdentifier.generate('npm', 'lodash', '4.17.21');
      const id2 = PackageIdentifier.generate('pip', 'lodash', '4.17.21');

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^lodash-[a-f0-9]{8}$/);
      expect(id2).toMatch(/^lodash-[a-f0-9]{8}$/);
    });

    it('should include normalized name and hash', () => {
      const id = PackageIdentifier.generate('npm', '@babel/core', '7.23.0');
      expect(id).toMatch(/^babel-core-[a-f0-9]{8}$/);
    });

    it('should generate consistent hashes for same input', () => {
      const id1 = PackageIdentifier.generate('npm', 'lodash', '4.17.21');
      const id2 = PackageIdentifier.generate('npm', 'lodash', '4.17.21');

      expect(id1).toBe(id2);
    });

    it('should generate different hashes for different versions', () => {
      const id1 = PackageIdentifier.generate('npm', 'lodash', '4.17.21');
      const id2 = PackageIdentifier.generate('npm', 'lodash', '4.17.20');

      expect(id1).not.toBe(id2);
    });
  });
});

describe('CrossEcosystemIndex', () => {
  let index;

  beforeEach(() => {
    index = new CrossEcosystemIndex(100);
  });

  describe('Package Indexing', () => {
    it('should index packages', () => {
      index.indexPackage('npm', 'lodash', '4.17.21', { description: 'Utility library' });

      const stats = index.getStats();
      expect(stats.indexed_packages).toBe(1);
      expect(stats.index_size).toBe(1);
    });

    it('should index packages from different ecosystems', () => {
      index.indexPackage('npm', 'lodash', '4.17.21', {});
      index.indexPackage('pip', 'lodash', '1.0.0', {});

      const stats = index.getStats();
      expect(stats.indexed_packages).toBe(2);
    });

    it('should not duplicate identical packages', () => {
      index.indexPackage('npm', 'lodash', '4.17.21', {});
      index.indexPackage('npm', 'lodash', '4.17.21', {});

      const stats = index.getStats();
      expect(stats.indexed_packages).toBe(1);
    });

    it('should track shared packages across ecosystems', () => {
      index.indexPackage('npm', 'lodash', '4.17.21', {});
      index.indexPackage('pip', 'lodash', '1.0.0', {});

      const stats = index.getStats();
      expect(stats.shared_packages).toBeGreaterThan(0);
    });
  });

  describe('Package Search', () => {
    beforeEach(() => {
      index.indexPackage('npm', 'lodash', '4.17.21', { description: 'JavaScript utility' });
      index.indexPackage('pip', 'numpy', '1.24.0', { description: 'Scientific computing' });
      index.indexPackage('maven', 'org.example:lodash-java', '1.0.0', { description: 'Java utility' });
    });

    it('should find packages by exact normalized name', () => {
      const results = index.search('lodash');

      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results.some(r => r.ecosystem === 'npm')).toBe(true);
      expect(results.some(r => r.ecosystem === 'maven')).toBe(true);
    });

    it('should find packages by partial match', () => {
      const results = index.search('lod');

      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.name === 'lodash')).toBe(true);
    });

    it('should return empty array for no matches', () => {
      const results = index.search('nonexistent');
      expect(results).toHaveLength(0);
    });

    it('should handle case-insensitive search', () => {
      const results = index.search('LODASH');
      expect(results.length).toBeGreaterThan(0);
    });

    it('should track search statistics', () => {
      index.search('lodash');
      index.search('numpy');

      const stats = index.getStats();
      expect(stats.cross_ecosystem_searches).toBe(2);
    });
  });

  describe('Find Package', () => {
    beforeEach(() => {
      index.indexPackage('npm', 'lodash', '4.17.21', { description: 'Utility library' });
    });

    it('should find package by ecosystem, name, and version', () => {
      const pkg = index.find('npm', 'lodash', '4.17.21');

      expect(pkg).toBeDefined();
      expect(pkg.name).toBe('lodash');
      expect(pkg.version).toBe('4.17.21');
      expect(pkg.ecosystem).toBe('npm');
    });

    it('should return undefined for non-existent package', () => {
      const pkg = index.find('npm', 'nonexistent', '1.0.0');
      expect(pkg).toBeUndefined();
    });

    it('should distinguish between ecosystems', () => {
      index.indexPackage('pip', 'lodash', '4.17.21', { description: 'Python version' });

      const npmPkg = index.find('npm', 'lodash', '4.17.21');
      const pipPkg = index.find('pip', 'lodash', '4.17.21');

      expect(npmPkg.metadata.description).toBe('Utility library');
      expect(pipPkg.metadata.description).toBe('Python version');
    });
  });

  describe('Get Ecosystems', () => {
    it('should return all ecosystems for a package', () => {
      index.indexPackage('npm', 'lodash', '4.17.21', {});
      index.indexPackage('pip', 'lodash', '1.0.0', {});
      index.indexPackage('cargo', 'lodash', '0.1.0', {});

      const ecosystems = index.getEcosystems('lodash');

      expect(ecosystems).toContain('npm');
      expect(ecosystems).toContain('pip');
      expect(ecosystems).toContain('cargo');
    });

    it('should return empty array for non-existent package', () => {
      const ecosystems = index.getEcosystems('nonexistent');
      expect(ecosystems).toHaveLength(0);
    });

    it('should handle normalized names', () => {
      index.indexPackage('npm', '@babel/core', '7.23.0', {});
      index.indexPackage('pip', 'babel-core', '1.0.0', {});

      const ecosystems = index.getEcosystems('babel-core');

      expect(ecosystems.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('LRU Eviction', () => {
    it('should evict oldest entries when at capacity', () => {
      const smallIndex = new CrossEcosystemIndex(2);

      smallIndex.indexPackage('npm', 'pkg1', '1.0.0', {});
      smallIndex.indexPackage('npm', 'pkg2', '1.0.0', {});
      smallIndex.indexPackage('npm', 'pkg3', '1.0.0', {});

      const stats = smallIndex.getStats();
      expect(stats.index_size).toBe(2);
    });

    it('should clean up reverse index on eviction', () => {
      const smallIndex = new CrossEcosystemIndex(2);

      smallIndex.indexPackage('npm', 'pkg1', '1.0.0', {});
      smallIndex.indexPackage('npm', 'pkg2', '1.0.0', {});
      smallIndex.indexPackage('npm', 'pkg3', '1.0.0', {});

      const results = smallIndex.search('pkg1');
      expect(results).toHaveLength(0);
    });
  });

  describe('Statistics', () => {
    it('should track indexed packages count', () => {
      index.indexPackage('npm', 'lodash', '4.17.21', {});
      index.indexPackage('pip', 'numpy', '1.24.0', {});

      const stats = index.getStats();
      expect(stats.indexed_packages).toBe(2);
      expect(stats.index_size).toBe(2);
    });

    it('should track normalized packages count', () => {
      index.indexPackage('npm', 'lodash', '4.17.21', {});
      index.indexPackage('npm', 'lodash', '4.17.20', {});

      const stats = index.getStats();
      expect(stats.normalized_packages).toBeGreaterThanOrEqual(1);
    });

    it('should count shared packages correctly', () => {
      index.indexPackage('npm', 'lodash', '4.17.21', {});
      index.indexPackage('pip', 'lodash', '1.0.0', {});
      index.indexPackage('cargo', 'lodash', '0.1.0', {});

      const stats = index.getStats();
      expect(stats.shared_packages).toBeGreaterThan(0);
    });
  });

  describe('Clear Index', () => {
    it('should clear all indexes and reset stats', () => {
      index.indexPackage('npm', 'lodash', '4.17.21', {});
      index.search('lodash');

      index.clear();

      const stats = index.getStats();
      expect(stats.index_size).toBe(0);
      expect(stats.indexed_packages).toBe(0);
      expect(stats.cross_ecosystem_searches).toBe(0);
      expect(stats.normalized_packages).toBe(0);
    });
  });

  describe('Global Instance', () => {
    it('should provide a global crossEcosystemIndex instance', () => {
      expect(crossEcosystemIndex).toBeInstanceOf(CrossEcosystemIndex);
    });

    it('should maintain state across calls', () => {
      crossEcosystemIndex.clear();
      crossEcosystemIndex.indexPackage('npm', 'test', '1.0.0', {});

      const stats = crossEcosystemIndex.getStats();
      expect(stats.index_size).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle packages with identical normalized names', () => {
      index.indexPackage('npm', '@types/lodash', '4.17.0', {});
      index.indexPackage('npm', 'types-lodash', '1.0.0', {});

      const results = index.search('types-lodash');
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle empty metadata', () => {
      index.indexPackage('npm', 'empty-meta', '1.0.0', null);

      const pkg = index.find('npm', 'empty-meta', '1.0.0');
      expect(pkg).toBeDefined();
    });

    it('should handle special characters in search', () => {
      index.indexPackage('npm', '@babel/core', '7.23.0', {});

      const results = index.search('@babel/core');
      expect(results.length).toBeGreaterThan(0);
    });

    it('should handle very long package names', () => {
      const longName = 'a'.repeat(200);
      index.indexPackage('npm', longName, '1.0.0', {});

      const pkg = index.find('npm', longName, '1.0.0');
      expect(pkg).toBeDefined();
    });

    it('should handle concurrent indexing', () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        Promise.resolve(index.indexPackage('npm', `pkg${i}`, '1.0.0', {}))
      );

      return Promise.all(promises).then(() => {
        const stats = index.getStats();
        expect(stats.indexed_packages).toBe(10);
      });
    });

    it('should handle version strings with special characters', () => {
      index.indexPackage('npm', 'lodash', '4.17.21-beta', {});

      const pkg = index.find('npm', 'lodash', '4.17.21-beta');
      expect(pkg).toBeDefined();
      expect(pkg.version).toBe('4.17.21-beta');
    });

    it('should distinguish between similar package names', () => {
      index.indexPackage('npm', 'lodash', '4.17.21', { description: 'lodash' });
      index.indexPackage('npm', 'lodash-es', '4.17.21', { description: 'lodash-es' });

      const lodash = index.find('npm', 'lodash', '4.17.21');
      const lodashEs = index.find('npm', 'lodash-es', '4.17.21');

      expect(lodash.metadata.description).toBe('lodash');
      expect(lodashEs.metadata.description).toBe('lodash-es');
    });
  });

  describe('Reverse Index', () => {
    it('should maintain reverse index correctly', () => {
      index.indexPackage('npm', 'lodash', '4.17.21', {});
      index.indexPackage('npm', 'lodash', '4.17.20', {});
      index.indexPackage('pip', 'lodash', '1.0.0', {});

      const normalized = PackageIdentifier.normalize('npm', 'lodash');
      expect(index.reverseIndex.has(normalized)).toBe(true);

      const ids = index.reverseIndex.get(normalized);
      expect(ids.size).toBeGreaterThanOrEqual(3);
    });

    it('should clean up reverse index when all packages removed', () => {
      const smallIndex = new CrossEcosystemIndex(1);

      smallIndex.indexPackage('npm', 'pkg1', '1.0.0', {});
      smallIndex.indexPackage('npm', 'pkg2', '1.0.0', {});

      const normalized = PackageIdentifier.normalize('npm', 'pkg1');
      expect(smallIndex.reverseIndex.has(normalized)).toBe(false);
    });
  });
});
