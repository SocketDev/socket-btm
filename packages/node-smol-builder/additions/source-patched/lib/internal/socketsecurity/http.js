'use strict';

// Socket Security HTTP performance optimizations — full barrel.
//
// This module re-exports everything from core.js (bootstrap-safe) plus
// heavy modules (caches, http2, compression) that require full Node.js
// runtime (process.env, debuglog, setInterval, etc.).
//
// Loaded by: node:smol-http (user code, after bootstrap)
// NOT loaded by: _http_server.js (uses core.js instead)

// Re-export all core exports (serve, fast writers, feature detection)
const core = require('internal/socketsecurity/http/core');

// Heavy modules — loaded lazily or at require() time (NOT bootstrap)
const {
  clearCache,
  createCacheKey,
  getCachedJson,
  getCacheStats,
  invalidate,
  stringifyWithCache,
} = require('internal/socketsecurity/http/json_cache');

const etagCacheMod = require('internal/socketsecurity/http/etag_cache');
const { ETagCache } = etagCacheMod;

const authCacheMod = require('internal/socketsecurity/http/auth_cache');
const { AuthCache } = authCacheMod;

const compressionCacheMod = require('internal/socketsecurity/http/compression_cache');
const { CompressionCache } = compressionCacheMod;

const {
  getSubsetStats,
  semver,
  subsetPackument,
} = require('internal/socketsecurity/http/version_subset');

const {
  DependencyGraph,
  dependencyGraph,
} = require('internal/socketsecurity/http/dependency_graph');

const {
  createHttp2Server,
  getHttp2Stats,
  optimizeHttp2Session,
  sendPackumentWithDeps,
  sendWithPreloads,
} = require('internal/socketsecurity/http/http2_helpers');

module.exports = {
  __proto__: null,
  // Core (re-exported from core.js)
  ...core,
  // JSON cache
  clearCache,
  createCacheKey,
  getCachedJson,
  getCacheStats,
  invalidate,
  stringifyWithCache,
  // ETag cache (lazy getter to avoid triggering init at import time)
  ETagCache,
  get etagCache() { return etagCacheMod.etagCache; },
  // Auth cache (lazy getter)
  AuthCache,
  get authCache() { return authCacheMod.authCache; },
  // Compression cache (lazy getter)
  CompressionCache,
  get compressionCache() { return compressionCacheMod.compressionCache; },
  // Version subset
  getSubsetStats,
  semver,
  subsetPackument,
  // Dependency graph
  DependencyGraph,
  dependencyGraph,
  // HTTP/2 helpers
  createHttp2Server,
  getHttp2Stats,
  optimizeHttp2Session,
  sendPackumentWithDeps,
  sendWithPreloads,
};
