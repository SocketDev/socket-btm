'use strict'

// Core HTTP module — safe to load during Node.js bootstrap.
//
// CRITICAL: Everything in this module must be LAZY.
// _http_server.js loads this during bootstrap. Any eager require() here
// adds to Node.js startup time for ALL programs, not just HTTP servers.
//
// Pattern: use getter functions that require() on first access.

// Lazy module loaders — each module is loaded only when its export is accessed.
let _server, _client, _responseWriter, _fastResponse, _headerCache, _corkManager

function getServer() {
  return _server || (_server = require('internal/socketsecurity/http/server'))
}
function getClient() {
  return _client || (_client = require('internal/socketsecurity/http/client'))
}
function getResponseWriter() {
  return (
    _responseWriter ||
    (_responseWriter = require('internal/socketsecurity/http/response_writer'))
  )
}
function getFastResponse() {
  return (
    _fastResponse ||
    (_fastResponse = require('internal/socketsecurity/http/fast_response'))
  )
}
function getHeaderCache() {
  return (
    _headerCache ||
    (_headerCache = require('internal/socketsecurity/http/header_cache'))
  )
}
function getCorkManager() {
  return (
    _corkManager ||
    (_corkManager = require('internal/socketsecurity/http/cork_manager'))
  )
}

// Native binding (lazy — only loaded when a direct writer is called).
let _smolHttpBinding
function smolHttp() {
  if (!_smolHttpBinding) _smolHttpBinding = internalBinding('smol_http')
  return _smolHttpBinding
}

module.exports = {
  __proto__: null,

  // serve() — loaded lazily (initializes uWS on first call)
  get serve() {
    return getServer().serve
  },

  // request() — lean HTTP client with pipelining support
  get request() {
    return getClient().request
  },
  get setPipelining() {
    return getClient().setPipelining
  },

  // Response writers (http.ServerResponse wrappers)
  get writeJsonResponse() {
    return getResponseWriter().writeJsonResponse
  },
  get writeNotFound() {
    return getResponseWriter().writeNotFound
  },
  get writeNotModified() {
    return getResponseWriter().writeNotModified
  },
  get writeTarballResponse() {
    return getResponseWriter().writeTarballResponse
  },

  // Fast response writers (http.ServerResponse + native fast path)
  get fastBinaryResponse() {
    return getFastResponse().fastBinaryResponse
  },
  get fastErrorResponse() {
    return getFastResponse().fastErrorResponse
  },
  get fastJsonResponse() {
    return getFastResponse().fastJsonResponse
  },
  get fastNotModified() {
    return getFastResponse().fastNotModified
  },
  get fastPackumentResponse() {
    return getFastResponse().fastPackumentResponse
  },
  get fastTarballResponse() {
    return getFastResponse().fastTarballResponse
  },

  // Direct UV stream writers (raw net.Socket — bypass Writable stream)
  writePrecomputed(socket, buffer) {
    return smolHttp().writePrecomputed(socket, buffer)
  },
  writeTextResponse(socket, statusCode, text) {
    return smolHttp().writeTextResponse(socket, statusCode, text)
  },
  writeJsonDirect(socket, statusCode, json) {
    return smolHttp().writeJsonResponse(socket, statusCode, json)
  },
  writeBinaryDirect(socket, statusCode, buffer, contentType) {
    return smolHttp().writeBinaryResponse(
      socket,
      statusCode,
      buffer,
      contentType,
    )
  },

  // Header utilities
  get getContentLength() {
    return getHeaderCache().getContentLength
  },
  get getHeader() {
    return getHeaderCache().getHeader
  },
  get getStatusLine() {
    return getHeaderCache().getStatusLine
  },
  get CorkManager() {
    return getCorkManager().CorkManager
  },
  get withCork() {
    return getCorkManager().withCork
  },

  // Feature detection
  get isIoUringAvailable() {
    return smolHttp().isIoUringAvailable
  },
  get isMimallocAvailable() {
    return smolHttp().isMimallocAvailable
  },
}
