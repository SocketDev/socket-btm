'use strict'

// Shared LRU cache utilities for SQL adapters.
// Extracted to avoid duplication between postgres.js and sqlite.js.

const {
  IteratorPrototypeNext,
  MapPrototypeDelete,
  MapPrototypeGet,
  MapPrototypeHas,
  MapPrototypeKeys,
  MapPrototypeSet,
} = primordials

/**
 * Evict the oldest entry from a SafeMap cache if at max size.
 * Uses Map's insertion order (first key = oldest).
 *
 * @param {SafeMap} cache - The cache map
 * @param {number} maxSize - Maximum cache size
 */
function lruEvictOldest(cache, maxSize) {
  if (cache.size >= maxSize) {
    const keysIter = MapPrototypeKeys(cache)
    const { value: oldest } = IteratorPrototypeNext(keysIter)
    if (oldest !== undefined) {
      MapPrototypeDelete(cache, oldest)
    }
  }
}

/**
 * Get a value from a SafeMap cache with LRU ordering.
 * If found, moves the entry to the end (most recently used).
 *
 * @param {SafeMap} cache - The cache map
 * @param {any} key - The key to look up
 * @returns {any} The cached value, or undefined if not found
 */
function lruGet(cache, key) {
  const value = MapPrototypeGet(cache, key)
  if (value !== undefined) {
    // Move to end to mark as recently used
    MapPrototypeDelete(cache, key)
    MapPrototypeSet(cache, key, value)
  }
  return value
}

/**
 * Set a value in a SafeMap cache with LRU eviction.
 * Evicts the oldest entry if cache is at max size.
 *
 * @param {SafeMap} cache - The cache map
 * @param {any} key - The key to set
 * @param {any} value - The value to cache
 * @param {number} maxSize - Maximum cache size
 */
function lruSet(cache, key, value, maxSize) {
  // If the key already exists, update-in-place. Evicting first would drop
  // an unrelated hot entry and shrink the cache by one when we're just
  // overwriting.
  if (MapPrototypeHas(cache, key)) {
    MapPrototypeDelete(cache, key)
    MapPrototypeSet(cache, key, value)
    return
  }
  lruEvictOldest(cache, maxSize)
  MapPrototypeSet(cache, key, value)
}

/**
 * Get or create a cached value with full LRU semantics.
 * If found, returns cached value with LRU update.
 * If not found, creates new value, caches with eviction, and returns it.
 *
 * @param {SafeMap} cache - The cache map
 * @param {any} key - The key to look up/set
 * @param {number} maxSize - Maximum cache size
 * @param {function} createFn - Function to create the value if not cached
 * @returns {any} The cached or newly created value
 */
function lruGetOrCreate(cache, key, maxSize, createFn) {
  let value = MapPrototypeGet(cache, key)
  if (value !== undefined) {
    // Move to end to mark as recently used
    MapPrototypeDelete(cache, key)
    MapPrototypeSet(cache, key, value)
    return value
  }
  lruEvictOldest(cache, maxSize)
  // Create and cache new value
  value = createFn()
  MapPrototypeSet(cache, key, value)
  return value
}

module.exports = {
  __proto__: null,
  lruGet,
  lruSet,
  lruGetOrCreate,
}
