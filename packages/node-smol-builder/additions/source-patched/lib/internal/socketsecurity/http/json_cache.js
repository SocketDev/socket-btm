'use strict'

const {
  IteratorPrototypeNext,
  JSONStringify,
  MapPrototypeClear,
  MapPrototypeDelete,
  MapPrototypeGet,
  MapPrototypeHas,
  MapPrototypeKeys,
  MapPrototypeSet,
  SafeMap,
} = primordials

// Pre-compiled JSON response cache for frequently-requested data.
// Eliminates JSON.stringify() overhead for identical responses.
//
// Use case: npm registry packuments are requested repeatedly.
// Cache stringified JSON to avoid re-serialization.

const kMaxCacheSize = 10_000 // Max cached entries
const kMaxEntrySize = 1_000_000 // Max 1MB per entry

// LRU cache implementation using SafeMap (insertion order = LRU order).
class JSONCache {
  constructor(maxSize = kMaxCacheSize) {
    this.cache = new SafeMap()
    this.maxSize = maxSize
    this.hits = 0
    this.misses = 0
  }

  // Get cached JSON string by key.
  get(key) {
    const cached = MapPrototypeGet(this.cache, key)
    if (cached !== undefined) {
      // Move to end (most recently used).
      MapPrototypeDelete(this.cache, key)
      MapPrototypeSet(this.cache, key, cached)
      this.hits++
      return cached
    }
    this.misses++
    return undefined
  }

  // Store JSON string with key.
  set(key, value) {
    // Don't cache huge entries.
    if (value.length > kMaxEntrySize) {
      return
    }

    // Only evict on capacity pressure when adding a NEW key. Updating
    // an existing key doesn't grow the map, so evicting another entry
    // in that case silently shrinks the cache by one per update. Same
    // class as etag_cache.js.
    if (
      !MapPrototypeHas(this.cache, key) &&
      this.cache.size >= this.maxSize
    ) {
      const { value: firstKey } = IteratorPrototypeNext(
        MapPrototypeKeys(this.cache),
      )
      if (firstKey !== undefined) {
        MapPrototypeDelete(this.cache, firstKey)
      }
    }

    // Delete-then-set so updating an existing key moves it to the end
    // of LRU order.
    MapPrototypeDelete(this.cache, key)
    MapPrototypeSet(this.cache, key, value)
  }

  // Check if key exists.
  has(key) {
    return MapPrototypeGet(this.cache, key) !== undefined
  }

  // Clear cache.
  clear() {
    MapPrototypeClear(this.cache)
    this.hits = 0
    this.misses = 0
  }

  // Get cache statistics.
  stats() {
    const total = this.hits + this.misses
    const hitRate = total > 0 ? (this.hits / total) * 100 : 0
    return {
      __proto__: null,
      hits: this.hits,
      hitRate,
      misses: this.misses,
      size: this.cache.size,
      total,
    }
  }
}

// Lazy global cache instance.
let _jsonCache
function getJSONCache() {
  if (!_jsonCache) {
    _jsonCache = new JSONCache()
  }
  return _jsonCache
}

// Get cached JSON or stringify and cache.
function getCachedJson(obj, key) {
  const cache = getJSONCache()
  // Try cache first.
  const cached = cache.get(key)
  if (cached !== undefined) {
    return cached
  }

  // Miss: stringify and cache.
  const json = JSONStringify(obj)
  cache.set(key, json)
  return json
}

// Stringify with optional caching.
function stringifyWithCache(obj, cacheKey) {
  if (cacheKey === undefined) {
    // No cache key: just stringify.
    return JSONStringify(obj)
  }

  // Use cache if key provided.
  return getCachedJson(obj, cacheKey)
}

// Create cache key from request URL.
// For registry: "GET:/lodash" or "GET:/lodash/-/lodash-4.17.21.tgz"
function createCacheKey(method, url) {
  return `${method}:${url}`
}

// Invalidate cache entry.
function invalidate(key) {
  MapPrototypeDelete(getJSONCache().cache, key)
}

// Clear entire cache.
function clearCache() {
  getJSONCache().clear()
}

// Get cache stats.
function getCacheStats() {
  return getJSONCache().stats()
}

module.exports = {
  __proto__: null,
  clearCache,
  createCacheKey,
  getCachedJson,
  getCacheStats,
  invalidate,
  stringifyWithCache,
}
