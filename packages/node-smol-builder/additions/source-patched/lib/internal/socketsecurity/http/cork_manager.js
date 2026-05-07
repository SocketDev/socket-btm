'use strict'

// Cork/uncork manager for batching socket writes.
// Reduces syscalls by buffering header + body writes together.

const {
  PromisePrototypeFinally,
  Symbol: SymbolCtor,
} = primordials

const {
  ClearTimeout,
  SetTimeout,
} = require('internal/socketsecurity/safe-references')

const kCorkTimeout = SymbolCtor('kCorkTimeout')
const kCorked = SymbolCtor('kCorked')
const kSocket = SymbolCtor('kSocket')

class CorkManager {
  constructor(socket) {
    this[kSocket] = socket
    this[kCorkTimeout] = undefined
    this[kCorked] = false
  }

  // Cork the socket for batched writes. Idempotent — calling cork()
  // twice in a row without an intervening uncork() is a no-op. Without
  // this guard, Node's cork counter increments twice but uncork()
  // only decrements once, leaving the socket permanently half-corked
  // (writes buffered forever).
  cork() {
    const socket = this[kSocket]
    if (!socket || socket.destroyed) {
      return
    }

    if (!this[kCorked] && typeof socket.cork === 'function') {
      socket.cork()
      this[kCorked] = true
    }

    // Set timeout to auto-uncork if user forgets. unref() so the pending
    // 1ms timer doesn't keep the event loop alive during graceful shutdown.
    if (this[kCorkTimeout] === undefined) {
      this[kCorkTimeout] = SetTimeout(() => {
        this.uncork()
      }, 1)
      this[kCorkTimeout].unref?.()
    }
  }

  // Uncork the socket to flush buffered writes.
  uncork() {
    const socket = this[kSocket]

    // Clear timeout.
    if (this[kCorkTimeout] !== undefined) {
      ClearTimeout(this[kCorkTimeout])
      this[kCorkTimeout] = undefined
    }

    if (!socket || socket.destroyed) {
      this[kCorked] = false
      return
    }

    if (this[kCorked] && typeof socket.uncork === 'function') {
      socket.uncork()
      this[kCorked] = false
    }
  }

  // Write data to socket (will be buffered if corked).
  write(data, encoding) {
    const socket = this[kSocket]
    if (!socket || socket.destroyed) {
      return false
    }
    return socket.write(data, encoding)
  }

  destroy() {
    this.uncork()
    this[kSocket] = undefined
  }
}

// Helper to cork response for duration of callback.
//
// Supports both sync and async callbacks: if the callback returns a
// thenable, uncork runs after the promise settles. A naive
// `try { return callback() } finally { manager.uncork() }` would uncork
// when the sync portion returns (the promise), NOT when it resolves —
// every await inside the callback would then flush to an already-
// uncorked socket, defeating batching entirely. Every async response
// writer (writeJsonResponse, writeTarballResponse, etc.) is an await-
// heavy caller, so the bug affected every HTTP response.
function withCork(response, callback) {
  const { socket } = response
  if (!socket || socket.destroyed) {
    return callback()
  }

  const manager = new CorkManager(socket)
  manager.cork()

  let result
  try {
    result = callback()
  } catch (err) {
    manager.uncork()
    throw err
  }
  if (result !== null && typeof result === 'object' && typeof result.then === 'function') {
    return PromisePrototypeFinally(result, () => {
      manager.uncork()
    })
  }
  manager.uncork()
  return result
}

module.exports = {
  __proto__: null,
  CorkManager,
  withCork,
}
