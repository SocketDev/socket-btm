'use strict';

// HTTP/2 helpers for improved performance.
// Note: HTTP/2 server push was removed from Chrome in 2022.
// Instead, use Link preload headers and multiplexing.

const http2 = require('node:http2');

// Create HTTP/2 server with optimized settings.
function createHttp2Server(options = {}) {
  const serverOptions = {
    // Allow max concurrent streams (default is 100).
    maxConcurrentStreams: options.maxConcurrentStreams || 1000,

    // Increase initial window size for better throughput.
    initialWindowSize: options.initialWindowSize || 1048576, // 1MB

    // Enable server push (even though browsers removed support).
    enablePush: options.enablePush !== false,

    // Set max frame size.
    maxFrameSize: options.maxFrameSize || 16384,

    // Set max header list size.
    maxHeaderListSize: options.maxHeaderListSize || 65536,

    // Enable session timeout.
    sessionTimeout: options.sessionTimeout || 120000, // 2 minutes

    ...options,
  };

  return http2.createSecureServer(serverOptions);
}

// Send response with Link preload headers for dependencies.
function sendWithPreloads(stream, headers, data, dependencies = []) {
  // Add Link headers for preloading dependencies.
  if (dependencies.length > 0) {
    const linkHeader = dependencies
      .map(dep => `</${dep}>; rel=preload; as=fetch`)
      .join(', ');

    headers['link'] = linkHeader;
  }

  // Send response.
  stream.respond(headers);
  stream.end(data);
}

// Send packument with dependency preloads.
function sendPackumentWithDeps(stream, packument, dependencies) {
  const headers = {
    ':status': 200,
    'content-type': 'application/json',
    'cache-control': 'public, max-age=3600',
  };

  sendWithPreloads(
    stream,
    headers,
    JSON.stringify(packument),
    dependencies
  );
}

// Handle HTTP/2 session with optimizations.
function optimizeHttp2Session(session) {
  // Set priority for streams.
  session.on('stream', (stream, headers) => {
    // Prioritize packument requests over tarballs.
    const path = headers[':path'];
    if (path && !path.endsWith('.tgz')) {
      // Higher priority for metadata.
      stream.priority({
        exclusive: false,
        parent: 0,
        weight: 16,
      });
    }
  });

  // Monitor session health.
  session.on('error', (err) => {
    console.error('HTTP/2 session error:', err);
  });

  session.on('goaway', (errorCode, lastStreamID) => {
    console.log('HTTP/2 GOAWAY:', { errorCode, lastStreamID });
  });
}

// Get session statistics.
function getHttp2Stats(session) {
  const state = session.state;
  return {
    effectiveLocalWindowSize: state.effectiveLocalWindowSize,
    effectiveRecvDataLength: state.effectiveRecvDataLength,
    localSettings: session.localSettings,
    localWindowSize: state.localWindowSize,
    nextStreamID: state.nextStreamID,
    outboundQueueSize: state.outboundQueueSize,
    remoteSettings: session.remoteSettings,
    remoteWindowSize: state.remoteWindowSize,
  };
}

module.exports = {
  createHttp2Server,
  getHttp2Stats,
  optimizeHttp2Session,
  sendPackumentWithDeps,
  sendWithPreloads,
};
