'use strict';

// node:smol-http - High-Performance HTTP Utilities
// Fast HTTP response writing, caching, and optimization tools.
//
// Usage:
//   import http from 'node:smol-http';
//   // or: import { serve, fastJsonResponse } from 'node:smol-http';
//
//   // Bun.serve-style API
//   const server = http.serve({
//     port: 3000,
//     fetch(req) {
//       return new Response(JSON.stringify({ hello: 'world' }), {
//         headers: { 'Content-Type': 'application/json' }
//       });
//     }
//   });

const { ObjectFreeze } = primordials;

// Import everything from internal http module
const {
  // Server
  serve,

  // Response writers
  writeJsonResponse,
  writeNotFound,
  writeNotModified,
  writeTarballResponse,

  // Cork manager
  CorkManager,
  withCork,

  // Header cache
  getContentLength,
  getHeader,
  getStatusLine,

  // Fast responses (native bindings)
  fastBinaryResponse,
  fastErrorResponse,
  fastJsonResponse,
  fastNotModified,
  fastPackumentResponse,
  fastTarballResponse,

  // JSON cache
  clearCache,
  createCacheKey,
  getCachedJson,
  getCacheStats,
  invalidate,
  stringifyWithCache,

  // ETag cache
  ETagCache,
  etagCache,

  // Auth cache
  AuthCache,
  authCache,

  // Compression cache
  CompressionCache,
  compressionCache,

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

  // Feature detection (diagnostics)
  isIoUringAvailable,
  isMimallocAvailable,
} = require('internal/socketsecurity/http');

module.exports = ObjectFreeze({
  __proto__: null,
  // Bun.serve-style API
  serve,

  // Response writers
  writeJsonResponse,
  writeNotFound,
  writeNotModified,
  writeTarballResponse,

  // Cork manager
  CorkManager,
  withCork,

  // Header cache
  getContentLength,
  getHeader,
  getStatusLine,

  // Fast responses (native bindings)
  fastBinaryResponse,
  fastErrorResponse,
  fastJsonResponse,
  fastNotModified,
  fastPackumentResponse,
  fastTarballResponse,

  // JSON cache
  clearCache,
  createCacheKey,
  getCachedJson,
  getCacheStats,
  invalidate,
  stringifyWithCache,

  // ETag cache
  ETagCache,
  etagCache,

  // Auth cache
  AuthCache,
  authCache,

  // Compression cache
  CompressionCache,
  compressionCache,

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

  // Feature detection (diagnostics)
  isIoUringAvailable,
  isMimallocAvailable,

  // Default export
  default: ObjectFreeze({
    __proto__: null,
    serve,
    writeJsonResponse,
    writeNotFound,
    writeNotModified,
    writeTarballResponse,
    CorkManager,
    withCork,
    getContentLength,
    getHeader,
    getStatusLine,
    fastBinaryResponse,
    fastErrorResponse,
    fastJsonResponse,
    fastNotModified,
    fastPackumentResponse,
    fastTarballResponse,
    clearCache,
    createCacheKey,
    getCachedJson,
    getCacheStats,
    invalidate,
    stringifyWithCache,
    ETagCache,
    etagCache,
    AuthCache,
    authCache,
    CompressionCache,
    compressionCache,
    getSubsetStats,
    semver,
    subsetPackument,
    DependencyGraph,
    dependencyGraph,
    createHttp2Server,
    getHttp2Stats,
    optimizeHttp2Session,
    sendPackumentWithDeps,
    sendWithPreloads,
    isIoUringAvailable,
    isMimallocAvailable,
  }),
});
