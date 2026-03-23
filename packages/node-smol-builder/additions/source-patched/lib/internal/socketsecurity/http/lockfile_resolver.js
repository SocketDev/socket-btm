'use strict';

const {
  MapPrototypeClear,
  MapPrototypeDelete,
  MapPrototypeGet,
  MapPrototypeHas,
  MapPrototypeKeys,
  MapPrototypeSet,
  ObjectEntries,
  SafeMap,
} = primordials;

// Dependency resolution from manifest files.
// Optimized for batch resolution of entire dependency trees.
//
// Features:
// - Parse various lockfile formats
// - Resolve all dependencies in single request
// - Parallel package fetching
// - Deterministic resolution

const crypto = require('crypto');

// Lockfile format parsers.
const LockfileFormats = {
  __proto__: null,

  // Parse package-lock.json (npm/pnpm).
  parsePackageLock(content) {
    try {
      const lock = JSON.parse(content);
      const packages = [];

      // npm v2/v3 format.
      if (lock.dependencies) {
        for (const [name, info] of ObjectEntries(lock.dependencies)) {
          packages.push({
            __proto__: null,
            name,
            resolved: info.resolved,
            version: info.version,
          });
        }
      }

      // npm v7+ format.
      if (lock.packages) {
        for (const [path, info] of ObjectEntries(lock.packages)) {
          if (path === '') continue;
          const name = path.replace(/^node_modules\//, '');
          packages.push({
            __proto__: null,
            name,
            resolved: info.resolved,
            version: info.version,
          });
        }
      }

      return { __proto__: null, format: 'package-lock', packages };
    } catch (e) {
      return { __proto__: null, error: 'Invalid package-lock.json', format: 'package-lock' };
    }
  },

  // Parse yarn.lock.
  parseYarnLock(content) {
    const packages = [];
    const lines = content.split('\n');

    let currentPackage = null;
    let currentVersion = null;
    let currentResolved = null;

    for (const line of lines) {
      // Package header: lodash@^4.17.0: or "@babel/core@^7.0.0":
      if (/^["@a-z].*:$/.test(line)) {
        if (currentPackage && currentVersion) {
          packages.push({
            __proto__: null,
            name: currentPackage,
            resolved: currentResolved,
            version: currentVersion,
          });
        }

        // Handle both scoped (@babel/core) and unscoped (lodash) packages.
        // Scoped: "@babel/core@^7.0.0": or @babel/core@^7.0.0:
        // Unscoped: lodash@^4.17.0:
        let match;
        if (line.startsWith('"@') || line.startsWith('@')) {
          // Scoped package: find last @ that's not part of scope.
          const cleaned = line.replace(/^"?/, '').replace(/:$/, '').replace(/"$/, '');
          const lastAt = cleaned.lastIndexOf('@');
          if (lastAt > 0) {
            currentPackage = cleaned.substring(0, lastAt);
          } else {
            currentPackage = null;
          }
        } else {
          match = line.match(/^([^@]+)@.*:/);
          currentPackage = match ? match[1] : null;
        }
        currentVersion = null;
        currentResolved = null;
      }
      // Version: version "4.17.21"
      else if (line.includes('version')) {
        const match = line.match(/version\s+"([^"]+)"/);
        if (match) currentVersion = match[1];
      }
      // Resolved: resolved "https://..."
      else if (line.includes('resolved')) {
        const match = line.match(/resolved\s+"([^"]+)"/);
        if (match) currentResolved = match[1];
      }
    }

    // Add last package.
    if (currentPackage && currentVersion) {
      packages.push({
        __proto__: null,
        name: currentPackage,
        resolved: currentResolved,
        version: currentVersion,
      });
    }

    return { __proto__: null, format: 'yarn.lock', packages };
  },

  // Parse pnpm-lock.yaml.
  parsePnpmLock(content) {
    // Simple YAML parsing for pnpm lockfiles.
    const packages = [];
    const lines = content.split('\n');

    let inPackagesSection = false;
    let currentPackage = null;

    for (const line of lines) {
      if (line.trim() === 'packages:') {
        inPackagesSection = true;
        continue;
      }

      if (!inPackagesSection) continue;

      // Package entry: /lodash/4.17.21:
      const match = line.match(/^\s+\/([^/]+)\/([^:]+):/);
      if (match) {
        currentPackage = { __proto__: null, name: match[1], version: match[2] };
        packages.push(currentPackage);
      }
    }

    return { __proto__: null, format: 'pnpm-lock.yaml', packages };
  },

  // Parse Cargo.lock (Rust).
  parseCargoLock(content) {
    const packages = [];
    const lines = content.split('\n');

    let currentPackage = null;

    for (const line of lines) {
      if (line.trim() === '[[package]]') {
        currentPackage = { __proto__: null };
        continue;
      }

      if (currentPackage) {
        const nameMatch = line.match(/^name\s*=\s*"([^"]+)"/);
        if (nameMatch) {
          currentPackage.name = nameMatch[1];
        }

        const versionMatch = line.match(/^version\s*=\s*"([^"]+)"/);
        if (versionMatch) {
          currentPackage.version = versionMatch[1];
        }

        const sourceMatch = line.match(/^source\s*=\s*"([^"]+)"/);
        if (sourceMatch) {
          currentPackage.resolved = sourceMatch[1];
          packages.push(currentPackage);
          currentPackage = null;
        }
      }
    }

    return { __proto__: null, format: 'Cargo.lock', packages };
  },

  // Parse Gemfile.lock (Ruby).
  parseGemfileLock(content) {
    const packages = [];
    const lines = content.split('\n');

    let inSpecsSection = false;

    for (const line of lines) {
      if (line.trim() === 'specs:') {
        inSpecsSection = true;
        continue;
      }

      if (!inSpecsSection) continue;

      // Gem entry: lodash (4.17.21)
      const match = line.match(/^\s+(\S+)\s+\(([^)]+)\)/);
      if (match) {
        packages.push({
          __proto__: null,
          name: match[1],
          version: match[2],
        });
      }
    }

    return { __proto__: null, format: 'Gemfile.lock', packages };
  },
};

// Lockfile resolver for batch resolution.
class LockfileResolver {
  constructor() {
    this.stats = {
      __proto__: null,
      cache_hits: 0,
      resolutions: 0,
      total_packages: 0,
    };
    this.cache = new SafeMap();
  }

  // Detect lockfile format.
  detectFormat(content) {
    if (content.includes('"lockfileVersion"')) return 'package-lock';
    if (content.includes('# yarn lockfile')) return 'yarn.lock';
    if (content.includes('lockfileVersion:')) return 'pnpm-lock.yaml';
    if (content.includes('[[package]]')) return 'Cargo.lock';
    if (content.includes('GEM\n  specs:')) return 'Gemfile.lock';
    return 'unknown';
  }

  // Parse lockfile.
  parseLockfile(content) {
    const format = this.detectFormat(content);

    switch (format) {
      case 'package-lock':
        return LockfileFormats.parsePackageLock(content);
      case 'yarn.lock':
        return LockfileFormats.parseYarnLock(content);
      case 'pnpm-lock.yaml':
        return LockfileFormats.parsePnpmLock(content);
      case 'Cargo.lock':
        return LockfileFormats.parseCargoLock(content);
      case 'Gemfile.lock':
        return LockfileFormats.parseGemfileLock(content);
      default:
        return { __proto__: null, error: 'Unknown lockfile format', format: 'unknown' };
    }
  }

  // Resolve all packages from lockfile.
  async resolveFromLockfile(lockfileContent, fetchPackage) {
    this.stats.resolutions++;

    // Generate cache key.
    const cacheKey = crypto
      .createHash('sha256')
      .update(lockfileContent)
      .digest('hex')
      .substring(0, 16);

    // Check cache.
    if (MapPrototypeHas(this.cache, cacheKey)) {
      this.stats.cache_hits++;
      return MapPrototypeGet(this.cache, cacheKey);
    }

    // Parse lockfile.
    const parsed = this.parseLockfile(lockfileContent);
    if (parsed.error) {
      return { __proto__: null, error: parsed.error };
    }

    this.stats.total_packages += parsed.packages.length;

    // Fetch all packages in parallel.
    const results = await Promise.allSettled(
      parsed.packages.map(pkg =>
        fetchPackage(pkg.name, pkg.version)
      )
    );

    const resolved = [];
    const errors = [];

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const pkg = parsed.packages[i];

      if (result.status === 'fulfilled') {
        resolved.push({
          __proto__: null,
          metadata: result.value,
          name: pkg.name,
          version: pkg.version,
        });
      } else {
        errors.push({
          __proto__: null,
          error: result.reason.message,
          name: pkg.name,
          version: pkg.version,
        });
      }
    }

    const response = {
      __proto__: null,
      errors: errors.length > 0 ? errors : undefined,
      format: parsed.format,
      packages: resolved,
      total: parsed.packages.length,
    };

    // Cache result.
    MapPrototypeSet(this.cache, cacheKey, response);

    // Evict old cache entries (keep last 1000).
    if (this.cache.size > 1_000) {
      const firstKey = MapPrototypeKeys(this.cache).next().value;
      MapPrototypeDelete(this.cache, firstKey);
    }

    return response;
  }

  // Get statistics.
  getStats() {
    const hitRate =
      this.stats.resolutions > 0
        ? ((this.stats.cache_hits / this.stats.resolutions) * 100).toFixed(2)
        : '0.00';

    return {
      __proto__: null,
      ...this.stats,
      cache_hit_rate: hitRate,
      cache_size: this.cache.size,
    };
  }

  // Clear cache.
  clearCache() {
    MapPrototypeClear(this.cache);
  }
}

// Global lockfile resolver instance.
const globalLockfileResolver = new LockfileResolver();

module.exports = {
  __proto__: null,
  LockfileFormats,
  LockfileResolver,
  lockfileResolver: globalLockfileResolver,
};
