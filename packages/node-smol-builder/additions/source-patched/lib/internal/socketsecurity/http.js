'use strict';

// Socket Security HTTP performance optimizations.
// Entry point for all HTTP perf enhancements.

const {
  writeJsonResponse,
  writeNotFound,
  writeNotModified,
  writeTarballResponse,
} = require('internal/socketsecurity/http/response_writer');

const {
  CorkManager,
  withCork,
} = require('internal/socketsecurity/http/cork_manager');

const {
  getContentLength,
  getHeader,
  getStatusLine,
} = require('internal/socketsecurity/http/header_cache');

const {
  fastBinaryResponse,
  fastErrorResponse,
  fastJsonResponse,
  fastNotModified,
  fastPackumentResponse,
  fastTarballResponse,
} = require('internal/socketsecurity/http/fast_response');

const {
  clearCache,
  createCacheKey,
  getCachedJson,
  getCacheStats,
  invalidate,
  stringifyWithCache,
} = require('internal/socketsecurity/http/json_cache');

const {
  ETagCache,
  etagCache,
} = require('internal/socketsecurity/http/etag_cache');

const {
  AuthCache,
  authCache,
} = require('internal/socketsecurity/http/auth_cache');

const {
  CompressionCache,
  compressionCache,
} = require('internal/socketsecurity/http/compression_cache');

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

const {
  serve,
} = require('internal/socketsecurity/http/server');

// Feature detection from native binding (lazy, exposed for diagnostics).
let _smolHttpBinding;
function smolHttp() {
  if (!_smolHttpBinding) _smolHttpBinding = internalBinding('smol_http');
  return _smolHttpBinding;
}
function isIoUringAvailable() { return smolHttp().isIoUringAvailable; }
function isMimallocAvailable() { return smolHttp().isMimallocAvailable; }

module.exports = {
  __proto__: null,
  AuthCache,
  CompressionCache,
  CorkManager,
  DependencyGraph,
  ETagCache,
  authCache,
  clearCache,
  compressionCache,
  createCacheKey,
  createHttp2Server,
  dependencyGraph,
  etagCache,
  fastBinaryResponse,
  fastErrorResponse,
  fastJsonResponse,
  fastNotModified,
  fastPackumentResponse,
  fastTarballResponse,
  getCachedJson,
  getCacheStats,
  getContentLength,
  getHeader,
  getHttp2Stats,
  getStatusLine,
  getSubsetStats,
  invalidate,
  optimizeHttp2Session,
  semver,
  sendPackumentWithDeps,
  sendWithPreloads,
  stringifyWithCache,
  subsetPackument,
  serve,
  withCork,
  writeJsonResponse,
  writeNotFound,
  writeNotModified,
  writeTarballResponse,
  // Feature detection (diagnostics)
  isIoUringAvailable,
  isMimallocAvailable,
};
