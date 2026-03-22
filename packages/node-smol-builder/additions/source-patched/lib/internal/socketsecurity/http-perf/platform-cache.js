'use strict';

const {
  MapPrototypeClear,
  MapPrototypeDelete,
  MapPrototypeEntries,
  MapPrototypeGet,
  MapPrototypeHas,
  MapPrototypeKeys,
  MapPrototypeSet,
  SafeMap,
} = primordials;

// Platform-aware package caching.
// Optimized for cross-platform binary packages.
//
// Handles platform-specific variants such as:
// - Python wheels (manylinux, macosx, win32)
// - Native Node.js addons
// - Platform-specific binaries

const os = require('os');

// Platform detection utilities.
const PlatformDetector = {
  __proto__: null,
  // Detect platform from User-Agent or system.
  detect(req) {
    const userAgent = req ? req.headers['user-agent'] || '' : '';

    // Check User-Agent for platform hints.
    if (userAgent.includes('linux')) return 'linux';
    if (userAgent.includes('darwin') || userAgent.includes('macos')) return 'darwin';
    if (userAgent.includes('win32') || userAgent.includes('windows')) return 'win32';
    if (userAgent.includes('freebsd')) return 'freebsd';

    // Fall back to current system platform.
    return os.platform();
  },

  // Detect architecture.
  detectArch(req) {
    const userAgent = req ? req.headers['user-agent'] || '' : '';

    if (userAgent.includes('x86_64') || userAgent.includes('amd64')) return 'x64';
    if (userAgent.includes('aarch64') || userAgent.includes('arm64')) return 'arm64';
    if (userAgent.includes('arm')) return 'arm';
    if (userAgent.includes('i686')) return 'ia32';

    // Fall back to current system arch.
    return os.arch();
  },

  // Normalize platform identifier.
  normalize(platform, arch) {
    return `${platform}-${arch}`;
  },
};

// Platform-specific caching.
class PlatformCache {
  constructor(maxSize = 20_000) {
    this.cache = new SafeMap();
    this.maxSize = maxSize;
    this.stats = {
      __proto__: null,
      cache_hits: 0,
      cache_misses: 0,
      platform_linux: 0,
      platform_darwin: 0,
      platform_win32: 0,
      platform_other: 0,
    };
  }

  // Generate platform-aware cache key.
  _generateKey(name, version, platform, arch) {
    const platformId = PlatformDetector.normalize(platform, arch);
    return `${name}@${version}:${platformId}`;
  }

  // Set platform-specific package.
  set(name, version, platform, arch, data) {
    const key = this._generateKey(name, version, platform, arch);
    const entry = {
      __proto__: null,
      arch,
      cached_at: Date.now(),
      data,
      platform,
    };

    MapPrototypeSet(this.cache, key, entry);

    // Track platform stats.
    const statKey = `platform_${platform}`;
    if (this.stats[statKey] !== undefined) {
      this.stats[statKey]++;
    } else {
      this.stats.platform_other++;
    }

    // Evict oldest if at capacity.
    if (this.cache.size > this.maxSize) {
      const firstKey = MapPrototypeKeys(this.cache).next().value;
      MapPrototypeDelete(this.cache, firstKey);
    }
  }

  // Get platform-specific package.
  get(name, version, platform, arch) {
    const key = this._generateKey(name, version, platform, arch);
    const entry = MapPrototypeGet(this.cache, key);

    if (!entry) {
      this.stats.cache_misses++;
      return null;
    }

    // Move to end (LRU).
    MapPrototypeDelete(this.cache, key);
    MapPrototypeSet(this.cache, key, entry);

    this.stats.cache_hits++;
    return entry.data;
  }

  // Get all platform variants for a package.
  getAllVariants(name, version) {
    const prefix = `${name}@${version}:`;
    const variants = [];

    for (const [key, entry] of MapPrototypeEntries(this.cache)) {
      if (key.startsWith(prefix)) {
        variants.push({
          __proto__: null,
          arch: entry.arch,
          data: entry.data,
          platform: entry.platform,
        });
      }
    }

    return variants;
  }

  // Check if platform-specific variant exists.
  has(name, version, platform, arch) {
    const key = this._generateKey(name, version, platform, arch);
    return MapPrototypeHas(this.cache, key);
  }

  // Invalidate all variants for a package.
  invalidate(name, version) {
    const prefix = `${name}@${version}:`;
    const keysToDelete = [];

    for (const key of MapPrototypeKeys(this.cache)) {
      if (key.startsWith(prefix)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      MapPrototypeDelete(this.cache, key);
    }

    return keysToDelete.length;
  }

  // Get statistics.
  getStats() {
    const total = this.stats.cache_hits + this.stats.cache_misses;
    const hitRate = total > 0
      ? ((this.stats.cache_hits / total) * 100).toFixed(2)
      : '0.00';

    return {
      __proto__: null,
      ...this.stats,
      cache_hit_rate: hitRate,
      cache_size: this.cache.size,
    };
  }

  // Clear cache.
  clear() {
    MapPrototypeClear(this.cache);
    this.stats = {
      __proto__: null,
      cache_hits: 0,
      cache_misses: 0,
      platform_linux: 0,
      platform_darwin: 0,
      platform_win32: 0,
      platform_other: 0,
    };
  }
}

// Global platform cache instance.
const globalPlatformCache = new PlatformCache();

module.exports = {
  __proto__: null,
  PlatformCache,
  PlatformDetector,
  platformCache: globalPlatformCache,
};
