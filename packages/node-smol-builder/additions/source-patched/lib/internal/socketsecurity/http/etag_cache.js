'use strict'

const {
  MapPrototypeClear,
  MapPrototypeDelete,
  MapPrototypeGet,
  MapPrototypeKeys,
  MapPrototypeSet,
  SafeMap,
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
    return `"${hash.substring(0, 16)}"`
  }

  // Generate ETag from package metadata.
  generatePackageETag(packageName, version, contentHash) {
    const input = `${packageName}@${version}:${contentHash}`
    const hash = CryptoCreateHash('sha256').update(input).digest('hex')
    return `"${hash.substring(0, 16)}"`
  }

  // Get cached ETag.
  get(key) {
    const entry = MapPrototypeGet(this.cache, key)
    if (!entry) return null

    // Move to end (LRU).
    MapPrototypeDelete(this.cache, key)
    MapPrototypeSet(this.cache, key, entry)

    return entry
  }

  // Set ETag in cache.
  set(key, etag) {
    // Evict oldest if at capacity.
    if (this.cache.size >= this.maxSize) {
      const firstKey = MapPrototypeKeys(this.cache).next().value
      MapPrototypeDelete(this.cache, firstKey)
    }

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
  if (!_globalETagCache) _globalETagCache = new ETagCache()
  return _globalETagCache
}

module.exports = {
  __proto__: null,
  ETagCache,
  get etagCache() {
    return getETagCache()
  },
}
