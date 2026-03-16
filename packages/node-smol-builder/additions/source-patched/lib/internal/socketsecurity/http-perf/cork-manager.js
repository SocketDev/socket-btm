'use strict';

// Cork/uncork manager for batching socket writes.
// Reduces syscalls by buffering header + body writes together.

const kCorkTimeout = Symbol('kCorkTimeout');
const kSocket = Symbol('kSocket');

class CorkManager {
  constructor(socket) {
    this[kSocket] = socket;
    this[kCorkTimeout] = null;
  }

  // Cork the socket for batched writes.
  cork() {
    const socket = this[kSocket];
    if (!socket || socket.destroyed) {
      return;
    }

    // Cork if not already corked.
    if (typeof socket.cork === 'function') {
      socket.cork();
    }

    // Set timeout to auto-uncork if user forgets.
    if (this[kCorkTimeout] === null) {
      this[kCorkTimeout] = setTimeout(() => {
        this.uncork();
      }, 1);
    }
  }

  // Uncork the socket to flush buffered writes.
  uncork() {
    const socket = this[kSocket];

    // Clear timeout.
    if (this[kCorkTimeout] !== null) {
      clearTimeout(this[kCorkTimeout]);
      this[kCorkTimeout] = null;
    }

    if (!socket || socket.destroyed) {
      return;
    }

    // Uncork if corked.
    if (typeof socket.uncork === 'function') {
      socket.uncork();
    }
  }

  // Write data to socket (will be buffered if corked).
  write(data, encoding) {
    const socket = this[kSocket];
    if (!socket || socket.destroyed) {
      return false;
    }
    return socket.write(data, encoding);
  }

  destroy() {
    this.uncork();
    this[kSocket] = null;
  }
}

// Helper to cork response for duration of callback.
function withCork(response, callback) {
  const { socket } = response;
  if (!socket || socket.destroyed) {
    return callback();
  }

  const manager = new CorkManager(socket);
  manager.cork();

  try {
    return callback();
  } finally {
    manager.uncork();
  }
}

module.exports = {
  CorkManager,
  withCork,
};
