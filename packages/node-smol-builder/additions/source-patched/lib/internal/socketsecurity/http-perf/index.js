'use strict';

// Socket Security HTTP performance optimizations.
// Entry point for all HTTP perf enhancements.

const {
  writeJsonResponse,
  writeNotFound,
  writeNotModified,
  writeTarballResponse,
} = require('internal/socketsecurity/http-perf/response-writer');

const {
  CorkManager,
  withCork,
} = require('internal/socketsecurity/http-perf/cork-manager');

const {
  getContentLength,
  getHeader,
  getStatusLine,
} = require('internal/socketsecurity/http-perf/header-cache');

const {
  fastBinaryResponse,
  fastErrorResponse,
  fastJsonResponse,
  fastNotModified,
  fastPackumentResponse,
  fastTarballResponse,
} = require('internal/socketsecurity/http-perf/fast-response');

const {
  clearCache,
  createCacheKey,
  getCachedJson,
  getCacheStats,
  invalidate,
  stringifyWithCache,
} = require('internal/socketsecurity/http-perf/json-cache');

const {
  ETagCache,
  etagCache,
} = require('internal/socketsecurity/http-perf/etag-cache');

const {
  AuthCache,
  authCache,
} = require('internal/socketsecurity/http-perf/auth-cache');

const {
  CompressionCache,
  compressionCache,
} = require('internal/socketsecurity/http-perf/compression-cache');

const {
  getSubsetStats,
  semver,
  subsetPackument,
} = require('internal/socketsecurity/http-perf/version-subset');

const {
  DependencyGraph,
  dependencyGraph,
} = require('internal/socketsecurity/http-perf/dependency-graph');

const {
  createHttp2Server,
  getHttp2Stats,
  optimizeHttp2Session,
  sendPackumentWithDeps,
  sendWithPreloads,
} = require('internal/socketsecurity/http-perf/http2-helpers');

module.exports = {
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
  withCork,
  writeJsonResponse,
  writeNotFound,
  writeNotModified,
  writeTarballResponse,
};
