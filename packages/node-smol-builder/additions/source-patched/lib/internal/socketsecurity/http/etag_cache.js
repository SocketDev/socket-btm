'use strict'

const {
  IteratorPrototypeNext,
  MapPrototypeClear,
  MapPrototypeDelete,
  MapPrototypeGet,
  MapPrototypeHas,
  MapPrototypeKeys,
  MapPrototypeSet,
  SafeMap,
  StringPrototypeSlice,
} = primordials

const { CryptoCreateHash } = require('internal/socketsecurity/safe-references')

// ETag generation and caching for HTTP responses.
class ETagCache {
  constructor(maxSize = 10_000) {
    this.cache = new SafeMap()
    this.maxSize = maxSize
  }

  // Generate ETag from content.
  generateETag(content) {
    const hash = CryptoCreateHash('sha256').update(content).digest('hex')
    return `"${StringPrototypeSlice(hash, 0, 16)}"`
  }

  // Generate ETag from package metadata.
  generatePackageETag(packageName, version, contentHash) {
    const input = `${packageName}@${version}:${contentHash}`
    const hash = CryptoCreateHash('sha256').update(input).digest('hex')
    return `"${StringPrototypeSlice(hash, 0, 16)}"`
  }

  // Get cached ETag.
  get(key) {
    const entry = MapPrototypeGet(this.cache, key)
    if (!entry) {
      return undefined
    }

    // Move to end (LRU).
    MapPrototypeDelete(this.cache, key)
    MapPrototypeSet(this.cache, key, entry)

    return entry
  }

  // Set ETag in cache.
  set(key, etag) {
    // Evict oldest only if adding a NEW key would exceed capacity.
    // Updating an existing key doesn't grow the map, so evicting
    // another entry in that case silently shrinks the cache by one
    // per update.
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
    // of the LRU order (reflects recent activity).
    MapPrototypeDelete(this.cache, key)
    MapPrototypeSet(this.cache, key, etag)
  }

  // Check if client's ETag matches current.
  checkETag(req, etag) {
    const clientEtag = req.headers['if-none-match']
    return clientEtag === etag
  }

  // Get cache statistics.
  getStats() {
    return {
      __proto__: null,
      size: this.cache.size,
      maxSize: this.maxSize,
    }
  }

  // Clear cache.
  clear() {
    MapPrototypeClear(this.cache)
  }
}

// Lazy global ETag cache instance.
let _globalETagCache
function getETagCache() {
  if (!_globalETagCache) {
    _globalETagCache = new ETagCache()
  }
  return _globalETagCache
}

module.exports = {
  __proto__: null,
  ETagCache,
  get etagCache() {
    return getETagCache()
  },
}
