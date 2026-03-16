'use strict';

const crypto = require('node:crypto');

// ETag generation and caching for HTTP responses.
class ETagCache {
  constructor(maxSize = 10_000) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  // Generate ETag from content.
  generateETag(content) {
    const hash = crypto
      .createHash('sha256')
      .update(content)
      .digest('hex');
    return `"${hash.substring(0, 16)}"`;
  }

  // Generate ETag from package metadata.
  generatePackageETag(packageName, version, contentHash) {
    const input = `${packageName}@${version}:${contentHash}`;
    const hash = crypto
      .createHash('sha256')
      .update(input)
      .digest('hex');
    return `"${hash.substring(0, 16)}"`;
  }

  // Get cached ETag.
  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // Move to end (LRU).
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry;
  }

  // Set ETag in cache.
  set(key, etag) {
    // Evict oldest if at capacity.
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, etag);
  }

  // Check if client's ETag matches current.
  checkETag(req, etag) {
    const clientEtag = req.headers['if-none-match'];
    return clientEtag === etag;
  }

  // Get cache statistics.
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
    };
  }

  // Clear cache.
  clear() {
    this.cache.clear();
  }
}

// Global ETag cache instance.
const globalETagCache = new ETagCache();

module.exports = {
  ETagCache,
  etagCache: globalETagCache,
};
