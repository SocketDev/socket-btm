'use strict';

const {
  MapPrototypeClear,
  MapPrototypeDelete,
  MapPrototypeGet,
  MapPrototypeHas,
  MapPrototypeKeys,
  MapPrototypeSet,
  SafeMap,
} = primordials;

// Multi-format package caching for registry servers.
// Optimized for various package formats and metadata structures.
//
// Features:
// - Format-aware cache keys
// - Separate metadata and binary caching
// - Platform-specific variants

const crypto = require('crypto');

// Cache tiers for different data types.
const CACHE_TIERS = {
  __proto__: null,
  BINARY: 'binary',
  METADATA: 'metadata',
  PLATFORM: 'platform',
};

// Multi-format cache with tiered storage.
class MultiFormatCache {
  constructor(config) {
    const cfg = { __proto__: null, ...config };
    this.metadataCache = new SafeMap();
    this.binaryCache = new SafeMap();
    this.platformCache = new SafeMap();

    this.maxMetadataSize = cfg.maxMetadataSize || 50_000;
    this.maxBinarySize = cfg.maxBinarySize || 10_000;
    this.maxPlatformSize = cfg.maxPlatformSize || 20_000;

    this.stats = {
      __proto__: null,
      binary_hits: 0,
      binary_misses: 0,
      metadata_hits: 0,
      metadata_misses: 0,
      platform_hits: 0,
      platform_misses: 0,
    };
  }

  // Generate cache key with format prefix.
  _generateKey(format, name, version, platform = null) {
    const base = `${format}:${name}@${version}`;
    if (platform) {
      return `${base}:${platform}`;
    }
    return base;
  }

  // Hash content for integrity checks.
  _hashContent(content) {
    return crypto
      .createHash('sha256')
      .update(content)
      .digest('hex')
      .substring(0, 16);
  }

  // Cache metadata (small, hot data).
  setMetadata(format, name, version, metadata) {
    const key = this._generateKey(format, name, version);
    const entry = {
      __proto__: null,
      cached_at: Date.now(),
      data: metadata,
      format,
      hash: this._hashContent(JSON.stringify(metadata)),
    };

    MapPrototypeSet(this.metadataCache, key, entry);

    // Evict oldest if at capacity.
    if (this.metadataCache.size > this.maxMetadataSize) {
      const firstKey = MapPrototypeKeys(this.metadataCache).next().value;
      MapPrototypeDelete(this.metadataCache, firstKey);
    }

    return entry.hash;
  }

  // Get cached metadata.
  getMetadata(format, name, version) {
    const key = this._generateKey(format, name, version);
    const entry = MapPrototypeGet(this.metadataCache, key);

    if (!entry) {
      this.stats.metadata_misses++;
      return null;
    }

    // Move to end (LRU).
    MapPrototypeDelete(this.metadataCache, key);
    MapPrototypeSet(this.metadataCache, key, entry);

    this.stats.metadata_hits++;
    return entry.data;
  }

  // Cache binary package (large, warm data).
  setBinary(format, name, version, binary) {
    const key = this._generateKey(format, name, version);
    const entry = {
      __proto__: null,
      cached_at: Date.now(),
      data: binary,
      format,
      hash: this._hashContent(binary),
      size: Buffer.isBuffer(binary) ? binary.length : binary.size,
    };

    MapPrototypeSet(this.binaryCache, key, entry);

    // Evict oldest if at capacity.
    if (this.binaryCache.size > this.maxBinarySize) {
      const firstKey = MapPrototypeKeys(this.binaryCache).next().value;
      MapPrototypeDelete(this.binaryCache, firstKey);
    }

    return entry.hash;
  }

  // Get cached binary.
  getBinary(format, name, version) {
    const key = this._generateKey(format, name, version);
    const entry = MapPrototypeGet(this.binaryCache, key);

    if (!entry) {
      this.stats.binary_misses++;
      return null;
    }

    // Move to end (LRU).
    MapPrototypeDelete(this.binaryCache, key);
    MapPrototypeSet(this.binaryCache, key, entry);

    this.stats.binary_hits++;
    return entry.data;
  }

  // Cache platform-specific variant (e.g., Python wheels).
  setPlatformVariant(format, name, version, platform, data) {
    const key = this._generateKey(format, name, version, platform);
    const entry = {
      __proto__: null,
      cached_at: Date.now(),
      data,
      format,
      platform,
    };

    MapPrototypeSet(this.platformCache, key, entry);

    // Evict oldest if at capacity.
    if (this.platformCache.size > this.maxPlatformSize) {
      const firstKey = MapPrototypeKeys(this.platformCache).next().value;
      MapPrototypeDelete(this.platformCache, firstKey);
    }
  }

  // Get platform-specific variant.
  getPlatformVariant(format, name, version, platform) {
    const key = this._generateKey(format, name, version, platform);
    const entry = MapPrototypeGet(this.platformCache, key);

    if (!entry) {
      this.stats.platform_misses++;
      return null;
    }

    // Move to end (LRU).
    MapPrototypeDelete(this.platformCache, key);
    MapPrototypeSet(this.platformCache, key, entry);

    this.stats.platform_hits++;
    return entry.data;
  }

  // Check if metadata exists.
  hasMetadata(format, name, version) {
    const key = this._generateKey(format, name, version);
    return MapPrototypeHas(this.metadataCache, key);
  }

  // Check if binary exists.
  hasBinary(format, name, version) {
    const key = this._generateKey(format, name, version);
    return MapPrototypeHas(this.binaryCache, key);
  }

  // Invalidate all caches for a package.
  invalidate(format, name, version) {
    const baseKey = this._generateKey(format, name, version);

    // Invalidate metadata.
    MapPrototypeDelete(this.metadataCache, baseKey);

    // Invalidate binary.
    MapPrototypeDelete(this.binaryCache, baseKey);

    // Invalidate all platform variants.
    for (const key of MapPrototypeKeys(this.platformCache)) {
      if (key.startsWith(baseKey + ':')) {
        MapPrototypeDelete(this.platformCache, key);
      }
    }
  }

  // Get cache statistics.
  getStats() {
    const metadata_total = this.stats.metadata_hits + this.stats.metadata_misses;
    const binary_total = this.stats.binary_hits + this.stats.binary_misses;
    const platform_total = this.stats.platform_hits + this.stats.platform_misses;

    return {
      __proto__: null,
      binary_hit_rate: binary_total > 0
        ? ((this.stats.binary_hits / binary_total) * 100).toFixed(2)
        : '0.00',
      cache_sizes: {
        __proto__: null,
        binary: this.binaryCache.size,
        metadata: this.metadataCache.size,
        platform: this.platformCache.size,
      },
      metadata_hit_rate: metadata_total > 0
        ? ((this.stats.metadata_hits / metadata_total) * 100).toFixed(2)
        : '0.00',
      platform_hit_rate: platform_total > 0
        ? ((this.stats.platform_hits / platform_total) * 100).toFixed(2)
        : '0.00',
      stats: this.stats,
    };
  }

  // Clear all caches.
  clearAll() {
    MapPrototypeClear(this.metadataCache);
    MapPrototypeClear(this.binaryCache);
    MapPrototypeClear(this.platformCache);
    this.stats = {
      __proto__: null,
      binary_hits: 0,
      binary_misses: 0,
      metadata_hits: 0,
      metadata_misses: 0,
      platform_hits: 0,
      platform_misses: 0,
    };
  }
}

// Global multi-format cache instance.
const globalMultiFormatCache = new MultiFormatCache();

module.exports = {
  __proto__: null,
  CACHE_TIERS,
  MultiFormatCache,
  multiFormatCache: globalMultiFormatCache,
};
