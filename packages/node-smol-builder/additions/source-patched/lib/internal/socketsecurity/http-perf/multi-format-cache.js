'use strict';

// Multi-format package caching for registry servers.
// Optimized for various package formats and metadata structures.
//
// Features:
// - Format-aware cache keys
// - Separate metadata and binary caching
// - Platform-specific variants

const crypto = require('node:crypto');

// Cache tiers for different data types.
const CACHE_TIERS = {
  __proto__: null,
  BINARY: 'binary',
  METADATA: 'metadata',
  PLATFORM: 'platform',
};

// Multi-format cache with tiered storage.
class MultiFormatCache {
  constructor(config = {}) {
    this.metadataCache = new Map();
    this.binaryCache = new Map();
    this.platformCache = new Map();

    this.maxMetadataSize = config.maxMetadataSize || 50_000;
    this.maxBinarySize = config.maxBinarySize || 10_000;
    this.maxPlatformSize = config.maxPlatformSize || 20_000;

    this.stats = {
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
      cached_at: Date.now(),
      data: metadata,
      format,
      hash: this._hashContent(JSON.stringify(metadata)),
    };

    this.metadataCache.set(key, entry);

    // Evict oldest if at capacity.
    if (this.metadataCache.size > this.maxMetadataSize) {
      const firstKey = this.metadataCache.keys().next().value;
      this.metadataCache.delete(firstKey);
    }

    return entry.hash;
  }

  // Get cached metadata.
  getMetadata(format, name, version) {
    const key = this._generateKey(format, name, version);
    const entry = this.metadataCache.get(key);

    if (!entry) {
      this.stats.metadata_misses++;
      return null;
    }

    // Move to end (LRU).
    this.metadataCache.delete(key);
    this.metadataCache.set(key, entry);

    this.stats.metadata_hits++;
    return entry.data;
  }

  // Cache binary package (large, warm data).
  setBinary(format, name, version, binary) {
    const key = this._generateKey(format, name, version);
    const entry = {
      cached_at: Date.now(),
      data: binary,
      format,
      hash: this._hashContent(binary),
      size: Buffer.isBuffer(binary) ? binary.length : binary.size,
    };

    this.binaryCache.set(key, entry);

    // Evict oldest if at capacity.
    if (this.binaryCache.size > this.maxBinarySize) {
      const firstKey = this.binaryCache.keys().next().value;
      this.binaryCache.delete(firstKey);
    }

    return entry.hash;
  }

  // Get cached binary.
  getBinary(format, name, version) {
    const key = this._generateKey(format, name, version);
    const entry = this.binaryCache.get(key);

    if (!entry) {
      this.stats.binary_misses++;
      return null;
    }

    // Move to end (LRU).
    this.binaryCache.delete(key);
    this.binaryCache.set(key, entry);

    this.stats.binary_hits++;
    return entry.data;
  }

  // Cache platform-specific variant (e.g., Python wheels).
  setPlatformVariant(format, name, version, platform, data) {
    const key = this._generateKey(format, name, version, platform);
    const entry = {
      cached_at: Date.now(),
      data,
      format,
      platform,
    };

    this.platformCache.set(key, entry);

    // Evict oldest if at capacity.
    if (this.platformCache.size > this.maxPlatformSize) {
      const firstKey = this.platformCache.keys().next().value;
      this.platformCache.delete(firstKey);
    }
  }

  // Get platform-specific variant.
  getPlatformVariant(format, name, version, platform) {
    const key = this._generateKey(format, name, version, platform);
    const entry = this.platformCache.get(key);

    if (!entry) {
      this.stats.platform_misses++;
      return null;
    }

    // Move to end (LRU).
    this.platformCache.delete(key);
    this.platformCache.set(key, entry);

    this.stats.platform_hits++;
    return entry.data;
  }

  // Check if metadata exists.
  hasMetadata(format, name, version) {
    const key = this._generateKey(format, name, version);
    return this.metadataCache.has(key);
  }

  // Check if binary exists.
  hasBinary(format, name, version) {
    const key = this._generateKey(format, name, version);
    return this.binaryCache.has(key);
  }

  // Invalidate all caches for a package.
  invalidate(format, name, version) {
    const baseKey = this._generateKey(format, name, version);

    // Invalidate metadata.
    this.metadataCache.delete(baseKey);

    // Invalidate binary.
    this.binaryCache.delete(baseKey);

    // Invalidate all platform variants.
    for (const key of this.platformCache.keys()) {
      if (key.startsWith(baseKey + ':')) {
        this.platformCache.delete(key);
      }
    }
  }

  // Get cache statistics.
  getStats() {
    const metadata_total = this.stats.metadata_hits + this.stats.metadata_misses;
    const binary_total = this.stats.binary_hits + this.stats.binary_misses;
    const platform_total = this.stats.platform_hits + this.stats.platform_misses;

    return {
      binary_hit_rate: binary_total > 0
        ? ((this.stats.binary_hits / binary_total) * 100).toFixed(2)
        : '0.00',
      cache_sizes: {
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
    this.metadataCache.clear();
    this.binaryCache.clear();
    this.platformCache.clear();
    this.stats = {
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
  CACHE_TIERS,
  MultiFormatCache,
  multiFormatCache: globalMultiFormatCache,
};
