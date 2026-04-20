'use strict'

// node:smol-http server — powered by uWebSockets.
//
// Uses uWebSockets for HTTP parsing + response writing:
//   - Custom SWAR HTTP parser (zero-copy, bloom filter headers)
//   - 16KB cork buffer (single send() syscall per response)
//   - Direct socket I/O (no Node.js Writable stream pipeline)
//   - No Buffer allocations in the response path
//
// Bun.serve()-compatible API with workers option for multi-process scaling.

const {
  ArrayPrototypeIndexOf,
  ArrayPrototypePush,
  ObjectEntries,
  TypeError: TypeErrorCtor,
} = primordials

// Native HTTP binding (lazy).
let _smolHttpBinding
function smolHttp() {
  if (!_smolHttpBinding) _smolHttpBinding = internalBinding('smol_http')
  return _smolHttpBinding
}

/**
 * Create a single uWS server instance (called by primary or worker).
 * @returns {object} Server instance
 */
function createServer(opts) {
  const {
    port: requestedPort = 3000,
    hostname = '0.0.0.0',
    fetch: fetchHandler,
    routes: routeHandlers,
  } = opts

  if (typeof fetchHandler !== 'function') {
    throw new TypeErrorCtor('options.fetch must be a function')
  }

  const binding = smolHttp()
  const uwsServer = binding.createUwsServer()

  // Register route handlers.
  let nextHandlerId = 0
  if (routeHandlers) {
    const entries = ObjectEntries(routeHandlers)
    for (let i = 0; i < entries.length; i++) {
      const [pattern, handler] = entries[i]
      const id = nextHandlerId++
      binding.uwsServerAddRoute(uwsServer, 'GET', pattern, id, handler)
    }
  }

  // Register fetch handler as catch-all.
  const fetchId = nextHandlerId++
  binding.uwsServerAddRoute(uwsServer, 'ANY', '/*', fetchId, fetchHandler)

  // Start listening. uSockets sets SO_REUSEPORT by default,
  // so multiple processes can bind the same port.
  const actualPort = binding.uwsServerListen(uwsServer, hostname, requestedPort)

  return {
    __proto__: null,
    get port() {
      return actualPort
    },
    hostname,

    get url() {
      return new URL(
        `http://${hostname === '0.0.0.0' ? 'localhost' : hostname}:${actualPort}/`,
      )
    },

    stop() {
      return new Promise(resolve => {
        binding.uwsServerStop(uwsServer)
        resolve()
      })
    },
  }
}

/**
 * Create a high-performance HTTP server.
 *
 * @param {object} options Server options
 * @param {number} [options.port=3000] Port to listen on
 * @param {string} [options.hostname='0.0.0.0'] Hostname to bind to
 * @param {function} options.fetch Request handler
 * @param {object} [options.routes] Route handlers
 * @param {number} [options.workers=1] Number of worker processes.
 *   Each worker runs an independent uWS server on the same port
 *   (SO_REUSEPORT). Set to os.availableParallelism() for max throughput.
 * @param {number} [options.idleTimeout=10] Connection idle timeout in seconds
 * @returns {object} Server instance
 */
function serve(options) {
  const opts = { __proto__: null, ...options }
  const workers = opts.workers || 1

  if (workers <= 1) {
    // Single process — direct serve.
    return createServer(opts)
  }

  // Multi-process: fork independent workers, each binds the same port.
  // Uses SO_REUSEPORT (enabled by default in uSockets) — the kernel
  // distributes incoming connections across all bound processes.
  // No Node.js cluster module — avoids IPC distribution overhead.
  const { fork } = require('child_process')

  // Workers re-execute the user's entry script. We signal them via env.
  const workerProcesses = []
  const entryScript = require('module')._resolveFilename(
    process.argv[1],
    null,
    true,
  )

  // If we're already a worker, just serve.
  if (process.env._SMOL_HTTP_WORKER === '1') {
    return createServer(opts)
  }

  // Set when stop() begins so monitor() doesn't respawn workers we're
  // intentionally killing. Without this, child.kill() exits with
  // code === null (signal kill), monitor sees `null !== 0` and forks a
  // replacement, leaking workers past the stop() resolution.
  let stopping = false

  // Monitor a worker for unexpected exit; on crash, fork a replacement
  // and re-arm monitoring on it so the slot keeps self-healing past the
  // first crash.
  function monitor(child) {
    child.on('exit', (code, signal) => {
      // Don't respawn during shutdown.
      if (stopping) {
        return
      }
      // Treat clean exit (code 0) and signal-terminated exit (code === null
      // with a signal) as intended; only crashes get replacement workers.
      if (code === 0 || signal) {
        return
      }
      const idx = ArrayPrototypeIndexOf(workerProcesses, child)
      const newChild = fork(entryScript, [], {
        env: { ...process.env, _SMOL_HTTP_WORKER: '1' },
        stdio: 'inherit',
      })
      if (idx >= 0) {
        workerProcesses[idx] = newChild
      }
      monitor(newChild)
    })
  }

  // Primary: fork workers and arm monitoring on each.
  for (let i = 0; i < workers; i++) {
    const child = fork(entryScript, [], {
      env: { ...process.env, _SMOL_HTTP_WORKER: '1' },
      stdio: 'inherit',
    })
    ArrayPrototypePush(workerProcesses, child)
    monitor(child)
  }

  // Return a server-like object for the primary.
  const port = opts.port || 3000
  const hostname = opts.hostname || '0.0.0.0'

  return {
    __proto__: null,
    get port() {
      return port
    },
    hostname,
    workers: workerProcesses.length,

    get url() {
      return new URL(
        `http://${hostname === '0.0.0.0' ? 'localhost' : hostname}:${port}/`,
      )
    },

    stop() {
      // Flip the flag BEFORE killing so monitor() ignores the signaled exits.
      stopping = true
      return new Promise(resolve => {
        if (workerProcesses.length === 0) {
          resolve()
          return
        }
        let remaining = workerProcesses.length
        const done = () => {
          if (--remaining === 0) resolve()
        }
        for (let i = 0; i < workerProcesses.length; i++) {
          const child = workerProcesses[i]
          // If the worker is already gone, count it immediately. Attaching
          // `exit` after `kill()` would never fire, hanging the Promise.
          if (child.exitCode !== null || child.signalCode !== null) {
            done()
            continue
          }
          child.once('exit', done)
          child.kill()
        }
      })
    },
  }
}

module.exports = {
  __proto__: null,
  serve,
}
