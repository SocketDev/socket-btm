/**
 * Test patterns to run.
 * 100% coverage of all Node.js functionality that node-smol supports.
 *
 * Included (complete coverage of node-smol features):
 *
 * - Core JS: process, buffer, stream (1/2/3), timers, events, errors
 * - File system: all fs operations, File API, FileHandle, watch
 * - Crypto: crypto, webcrypto, hash algorithms, X509 certificates
 * - Networking: net (TCP), http, http2, https, tls, dns, dgram (UDP)
 * - Web APIs: fetch, WebSocket, WebStreams, Blob, WHATWG, EventSource, WebStorage
 * - Modules: require, ES modules, module resolution, module hooks
 * - Async: hooks, local storage, iteration, Promise hooks
 * - Concurrency: child process, cluster, worker threads, MessageChannel/Port
 * - VM: context execution and sandboxing
 * - Compression: zlib (gzip, deflate, brotli)
 * - Database: SQLite (node:sqlite)
 * - System: OS utils, TTY, readline, signals, exit handling, stdio
 * - Stdlib: path, URL, URLPattern, querystring, punycode, util, string decoder,
 *   domain
 * - Dev: console, assert, diagnostics, trace events, test runner (node:test)
 * - Performance: measurement APIs
 * - Abort: AbortController/Signal
 * - Memory: WeakRef, garbage collection
 * - Security: permission model
 * - SEA: Single Executable Application support
 * - Other: structuredClone, validators, unicode, warnings, reports, UV/libuv
 * - Test suites: parallel, sequential, es-module, message, async-hooks,
 *   module-hooks
 *
 * Excluded (disabled features in node-smol):
 *
 * - Full ICU/Intl tests (we use small-icu, English-only)
 * - Npm tests (disabled with --without-npm)
 * - Corepack tests (not bundled in Node.js v25+)
 * - Amaro/TypeScript tests (disabled with --without-amaro)
 * - NODE_OPTIONS tests (disabled with --without-node-options)
 * - Inspector/debugger tests (disabled in prod with --without-inspector)
 * - REPL tests (may rely on disabled features)
 * - Snapshot tests (snapshot builds not covered)
 */
export const TEST_PATTERNS = [
  // Core functionality tests.
  'parallel/test-process-*.js',
  'parallel/test-buffer-*.js',
  'parallel/test-stream-*.js',
  'parallel/test-stream2-*.js',
  'parallel/test-stream3-*.js',
  'parallel/test-timers-*.js',

  // File system tests.
  'parallel/test-fs-*.js',

  // Crypto tests.
  'parallel/test-crypto-*.js',
  'parallel/test-hash-*.js',
  'parallel/test-webcrypto-*.js',

  // Networking tests.
  'parallel/test-net-*.js',
  'parallel/test-http-*.js',
  'parallel/test-http2-*.js',
  'parallel/test-https-*.js',
  'parallel/test-tls-*.js',
  'parallel/test-dns-*.js',
  'parallel/test-dgram-*.js',
  'parallel/test-tcp-*.js',

  // Web APIs tests.
  'parallel/test-fetch-*.js',
  'parallel/test-web-*.js',
  'parallel/test-websocket-*.js',
  'parallel/test-webstream-*.js',
  'parallel/test-blob-*.js',
  'parallel/test-whatwg-*.js',
  'parallel/test-eventsource-*.js',

  // Module system tests.
  'parallel/test-require-*.js',
  'parallel/test-module-*.js',

  // ES module tests.
  'es-module/test-*.mjs',

  // Sequential tests (must not run in parallel).
  'sequential/test-*.js',
  'sequential/test-*.mjs',

  // Message tests (stderr/stdout output validation).
  'message/test-*.js',

  // Async hooks directory tests (comprehensive async hooks testing).
  'async-hooks/test-*.js',

  // Module hooks tests.
  'module-hooks/test-*.mjs',

  // Async tests.
  'parallel/test-async-*.js',
  'parallel/test-async-hooks-*.js',
  'parallel/test-async-local-*.js',

  // Child process and cluster tests.
  'parallel/test-child-process-*.js',
  'parallel/test-cluster-*.js',
  'parallel/test-spawn-*.js',

  // Worker threads tests.
  'parallel/test-worker-*.js',

  // VM tests.
  'parallel/test-vm-*.js',

  // Compression tests.
  'parallel/test-zlib-*.js',

  // SQLite tests.
  'parallel/test-sqlite-*.js',

  // OS utilities tests.
  'parallel/test-os-*.js',

  // Event emitter tests.
  'parallel/test-event-*.js',
  'parallel/test-eventemitter-*.js',

  // Console and assert tests.
  'parallel/test-console-*.js',
  'parallel/test-assert-*.js',

  // Diagnostics tests.
  'parallel/test-diagnostics-*.js',
  'parallel/test-diagnostic-*.js',
  'parallel/test-trace-*.js',

  // Performance tests.
  'parallel/test-perf-*.js',
  'parallel/test-performance-*.js',

  // Standard library tests.
  'parallel/test-path-*.js',
  'parallel/test-url-*.js',
  'parallel/test-querystring-*.js',
  'parallel/test-punycode-*.js',
  'parallel/test-util-*.js',
  'parallel/test-string-decoder-*.js',
  'parallel/test-domain-*.js',
  'parallel/test-errors-*.js',
  'parallel/test-constants-*.js',

  // Abort controller tests.
  'parallel/test-abort-*.js',
  'parallel/test-abortcontroller-*.js',
  'parallel/test-abortsignal-*.js',

  // TTY tests.
  'parallel/test-tty-*.js',

  // Readline tests.
  'parallel/test-readline-*.js',

  // Signal tests.
  'parallel/test-signal-*.js',

  // V8 integration tests (that don't require inspector).
  'parallel/test-v8-*.js',

  // File API tests.
  'parallel/test-file-*.js',
  'parallel/test-filehandle-*.js',

  // MessageChannel and MessagePort tests.
  'parallel/test-messagechannel-*.js',
  'parallel/test-messageport-*.js',
  'parallel/test-messageevent-*.js',

  // Promise hooks tests.
  'parallel/test-promise-*.js',
  'parallel/test-promises-*.js',

  // structuredClone tests.
  'parallel/test-structuredClone-*.js',

  // URLPattern tests.
  'parallel/test-urlpattern-*.js',

  // Watch tests.
  'parallel/test-watch-*.js',

  // Stdio tests.
  'parallel/test-stdin-*.js',
  'parallel/test-stdout-*.js',
  'parallel/test-stderr-*.js',

  // Exit tests.
  'parallel/test-exit-*.js',

  // Report generation tests.
  'parallel/test-report-*.js',

  // WeakRef tests.
  'parallel/test-weakref-*.js',

  // X509 certificate tests.
  'parallel/test-x509-*.js',

  // Unhandled rejection tests.
  'parallel/test-unhandled-*.js',

  // Unicode tests.
  'parallel/test-unicode-*.js',

  // Wrap tests.
  'parallel/test-wrap-*.js',

  // Priority queue tests.
  'parallel/test-priority-*.js',

  // Tracing tests.
  'parallel/test-tracing-*.js',

  // Warning tests.
  'parallel/test-warn-*.js',

  // Test runner tests (node:test module).
  'parallel/test-runner-*.js',

  // Single Executable Application tests (SEA).
  'parallel/test-sea-*.js',

  // Permission model tests.
  'parallel/test-permission-*.js',

  // Garbage collection tests.
  'parallel/test-gc-*.js',

  // WebStorage tests.
  'parallel/test-webstorage-*.js',

  // UV (libuv) tests.
  'parallel/test-uv-*.js',

  // TTY wrap tests.
  'parallel/test-ttywrap-*.js',

  // Timezone tests.
  'parallel/test-tz-*.js',

  // Validator tests.
  'parallel/test-validators-*.js',
]

/**
 * Test patterns to explicitly skip.
 * These tests require features disabled in node-smol.
 */
export const SKIP_PATTERNS = [
  // ICU/Intl tests (we use small-icu).
  '*intl*',
  '*icu*',
  '*collator*',
  '*locale*',

  // npm tests (disabled with --without-npm).
  '*npm*',

  // corepack tests (excluded by default).
  '*corepack*',

  // TypeScript/amaro tests (disabled with --without-amaro).
  '*amaro*',
  '*typescript*',
  '*strip-types*',
  '*type-stripping*',
  // TypeScript eval tests
  '*test-esm-import-meta-main-eval*',

  // NODE_OPTIONS tests (disabled with --without-node-options).
  '*node-options*',
  // Tests NODE_OPTIONS import order
  '*test-esm-import-flag*',

  // Inspector tests (disabled in prod with --without-inspector).
  '*inspector*',
  '*debugger*',
  '*debug-process*',
  '*debug-port*',
  '*heapsnapshot*',
  '*cpu-prof*',
  '*coverage*',

  // REPL tests (may rely on disabled features).
  '*repl*',

  // V8 tests that require inspector.
  '*v8-coverage*',
  '*v8-serialize-leak*',
  '*v8-takecoverage*',

  // Tests that require specific build configurations.
  '*sea-snapshot*',
  '*snapshot-*',

  // Tests that explicitly check for features we disabled.
  '*experimental-strip-types*',
]
