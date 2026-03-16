'use strict';

// Pre-compiled JSON response cache for frequently-requested data.
// Eliminates JSON.stringify() overhead for identical responses.
//
// Use case: npm registry packuments are requested repeatedly.
// Cache stringified JSON to avoid re-serialization.

const kMaxCacheSize = 10_000; // Max cached entries
const kMaxEntrySize = 1_000_000; // Max 1MB per entry

// LRU cache implementation using Map (insertion order = LRU order).
class JSONCache {
  constructor(maxSize = kMaxCacheSize) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.hits = 0;
    this.misses = 0;
  }

  // Get cached JSON string by key.
  get(key) {
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      // Move to end (most recently used).
      this.cache.delete(key);
      this.cache.set(key, cached);
      this.hits++;
      return cached;
    }
    this.misses++;
    return undefined;
  }

  // Store JSON string with key.
  set(key, value) {
    // Don't cache huge entries.
    if (value.length > kMaxEntrySize) {
      return;
    }

    // Delete oldest if at capacity.
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, value);
  }

  // Check if key exists.
  has(key) {
    return this.cache.get(key) !== undefined;
  }

  // Clear cache.
  clear() {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  // Get cache statistics.
  stats() {
    const total = this.hits + this.misses;
    const hitRate = total > 0 ? (this.hits / total) * 100 : 0;
    return {
      hits: this.hits,
      hitRate,
      misses: this.misses,
      size: this.cache.size,
      total,
    };
  }
}

// Global cache instance.
const jsonCache = new JSONCache();

// Get cached JSON or stringify and cache.
function getCachedJson(obj, key) {
  // Try cache first.
  const cached = jsonCache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  // Miss: stringify and cache.
  const json = JSON.stringify(obj);
  jsonCache.set(key, json);
  return json;
}

// Stringify with optional caching.
function stringifyWithCache(obj, cacheKey) {
  if (cacheKey === undefined) {
    // No cache key: just stringify.
    return JSON.stringify(obj);
  }

  // Use cache if key provided.
  return getCachedJson(obj, cacheKey);
}

// Create cache key from request URL.
// For registry: "GET:/lodash" or "GET:/lodash/-/lodash-4.17.21.tgz"
function createCacheKey(method, url) {
  return `${method}:${url}`;
}

// Invalidate cache entry.
function invalidate(key) {
  jsonCache.cache.delete(key);
}

// Clear entire cache.
function clearCache() {
  jsonCache.clear();
}

// Get cache stats.
function getCacheStats() {
  return jsonCache.stats();
}

module.exports = {
  clearCache,
  createCacheKey,
  getCachedJson,
  getCacheStats,
  invalidate,
  stringifyWithCache,
};
