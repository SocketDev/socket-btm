'use strict'

// WebSocket Protocol Implementation
// Frame encoding/decoding and connection handling.

const {
  ArrayPrototypePush,
  MapPrototypeDelete,
  MapPrototypeForEach,
  MapPrototypeGet,
  MapPrototypeSet,
  SafeMap,
  SafeSet,
  SetPrototypeAdd,
  SetPrototypeDelete,
  SetPrototypeForEach,
  SetPrototypeHas,
} = primordials

const {
  BufferAlloc,
  BufferConcat,
  BufferFrom,
  BufferIsBuffer,
  BufferPrototypeSlice,
  BufferPrototypeToString,
} = require('internal/socketsecurity/safe-references')

const {
  WS_OPCODE_TEXT,
  WS_OPCODE_BINARY,
  WS_OPCODE_CLOSE,
  WS_OPCODE_PING,
  WS_OPCODE_PONG,
} = require('internal/socketsecurity/http/constants')

// Native WebSocket frame operations from C++ binding (lazy).
let _smolHttpBinding
function smolHttp() {
  if (!_smolHttpBinding) {
    _smolHttpBinding = internalBinding('smol_http')
  }
  return _smolHttpBinding
}
function nativeEncodeFrame(...args) {
  return smolHttp().encodeWebSocketFrame(...args)
}
function nativeDecodeFrame(...args) {
  return smolHttp().decodeWebSocketFrame(...args)
}

// ============================================================================
// Frame Encoding/Decoding
// ============================================================================

/**
 * Encode WebSocket frame using native C++ implementation.
 * @param {string|Buffer} data - Data to encode
 * @param {number} [opcode=WS_OPCODE_TEXT] - WebSocket opcode
 * @returns {Buffer} Encoded frame
 */
function encodeWebSocketFrame(data, opcode = WS_OPCODE_TEXT) {
  // Native encoder accepts string or ArrayBufferView, returns Uint8Array
  const result = nativeEncodeFrame(data, opcode)
  // Fallback should never trigger — native handles both string and buffer.
  // C++ returns null on error via SetNull().
  if (result == null) {
    return BufferAlloc(0)
  }
  return BufferFrom(result.buffer, result.byteOffset, result.byteLength)
}

/**
 * Decode WebSocket frame using native C++ implementation.
 * The native decoder handles unmasking internally.
 * @param {Buffer} buffer - Buffer to decode
 * @returns {{fin: boolean, opcode: number, payload: Buffer, totalLength: number}|undefined}
 */
function decodeWebSocketFrame(buffer) {
  if (buffer.length < 2) {
    return undefined
  }

  // Native decoder returns {fin, opcode, masked, totalLength, payload} or null.
  // C++ uses SetNull() for incomplete/invalid frames.
  const frame = nativeDecodeFrame(buffer)
  if (frame == null) {
    return undefined
  }

  return {
    __proto__: null,
    fin: frame.fin,
    opcode: frame.opcode,
    payload: BufferFrom(
      frame.payload.buffer,
      frame.payload.byteOffset,
      frame.payload.byteLength,
    ),
    totalLength: frame.totalLength,
  }
}

// ============================================================================
// WebSocket Handler
// ============================================================================

/**
 * Create WebSocket handler for a socket.
 * @param {Socket} socket - Net socket
 * @param {object} wsHandlers - WebSocket event handlers
 * @param {object} serverInstance - Server instance
 * @returns {object} WebSocket instance
 */
function createWebSocketHandler(socket, wsHandlers, serverInstance) {
  const subscribers = new SafeMap() // topic -> SafeSet of ws

  const ws = {
    __proto__: null,
    readyState: 1, // OPEN
    data: undefined, // User-attached data
    _socket: socket, // Internal socket reference for optimized broadcast

    send(data, compress = false) {
      if (ws.readyState !== 1) {
        return
      }
      const opcode = BufferIsBuffer(data) ? WS_OPCODE_BINARY : WS_OPCODE_TEXT
      socket.write(encodeWebSocketFrame(data, opcode))
    },

    sendText(text, compress = false) {
      if (ws.readyState !== 1) {
        return
      }
      socket.write(encodeWebSocketFrame(text, WS_OPCODE_TEXT))
    },

    sendBinary(data, compress = false) {
      if (ws.readyState !== 1) {
        return
      }
      socket.write(encodeWebSocketFrame(data, WS_OPCODE_BINARY))
    },

    close(code = 1000, reason = '') {
      if (ws.readyState !== 1) {
        return
      }
      ws.readyState = 2 // CLOSING
      const reasonBuf = BufferFrom(reason)
      const payload = BufferAlloc(2 + reasonBuf.length)
      payload.writeUInt16BE(code, 0)
      reasonBuf.copy(payload, 2)
      socket.write(encodeWebSocketFrame(payload, WS_OPCODE_CLOSE))
      socket.end()
      ws.readyState = 3 // CLOSED
    },

    ping(data = '') {
      if (ws.readyState !== 1) {
        return
      }
      socket.write(encodeWebSocketFrame(data, WS_OPCODE_PING))
    },

    pong(data = '') {
      if (ws.readyState !== 1) {
        return
      }
      socket.write(encodeWebSocketFrame(data, WS_OPCODE_PONG))
    },

    subscribe(topic) {
      let subs = MapPrototypeGet(serverInstance._wsTopics, topic)
      if (!subs) {
        subs = new SafeSet()
        MapPrototypeSet(serverInstance._wsTopics, topic, subs)
      }
      SetPrototypeAdd(subs, ws)
      MapPrototypeSet(subscribers, topic, subs)
    },

    unsubscribe(topic) {
      const subs = MapPrototypeGet(serverInstance._wsTopics, topic)
      if (subs) {
        SetPrototypeDelete(subs, ws)
        MapPrototypeDelete(subscribers, topic)
        // Prune empty topic sets so `_wsTopics` doesn't grow unbounded with
        // short-lived topics (per-user, per-session, etc.).
        if (subs.size === 0) {
          MapPrototypeDelete(serverInstance._wsTopics, topic)
        }
      }
    },

    isSubscribed(topic) {
      const subs = MapPrototypeGet(serverInstance._wsTopics, topic)
      return subs ? SetPrototypeHas(subs, ws) : false
    },

    /**
     * Publish to all subscribers EXCEPT this WebSocket (Bun behavior).
     * Use server.publish() to include all subscribers.
     * OPTIMIZATION: Encodes frame ONCE, then writes pre-encoded buffer to all subscribers.
     */
    publish(topic, data, compress = false) {
      const subs = MapPrototypeGet(serverInstance._wsTopics, topic)
      if (!subs || subs.size === 0) {
        return 0
      }

      // Encode frame ONCE for all subscribers (major perf win for broadcast)
      const opcode = BufferIsBuffer(data) ? WS_OPCODE_BINARY : WS_OPCODE_TEXT
      const frame = encodeWebSocketFrame(data, opcode)

      let count = 0
      SetPrototypeForEach(subs, subscriber => {
        if (subscriber !== ws && subscriber.readyState === 1) {
          subscriber._socket.write(frame)
          count++
        }
      })
      return count
    },

    publishText(topic, text, compress = false) {
      const subs = MapPrototypeGet(serverInstance._wsTopics, topic)
      if (!subs || subs.size === 0) {
        return 0
      }

      // Encode frame ONCE for all subscribers
      const frame = encodeWebSocketFrame(text, WS_OPCODE_TEXT)

      let count = 0
      SetPrototypeForEach(subs, subscriber => {
        if (subscriber !== ws && subscriber.readyState === 1) {
          subscriber._socket.write(frame)
          count++
        }
      })
      return count
    },

    publishBinary(topic, data, compress = false) {
      const subs = MapPrototypeGet(serverInstance._wsTopics, topic)
      if (!subs || subs.size === 0) {
        return 0
      }

      // Encode frame ONCE for all subscribers
      const frame = encodeWebSocketFrame(data, WS_OPCODE_BINARY)

      let count = 0
      SetPrototypeForEach(subs, subscriber => {
        if (subscriber !== ws && subscriber.readyState === 1) {
          subscriber._socket.write(frame)
          count++
        }
      })
      return count
    },

    get subscriptions() {
      const topics = []
      MapPrototypeForEach(subscribers, (_subs, topic) => {
        ArrayPrototypePush(topics, topic)
      })
      return topics
    },

    terminate() {
      if (ws.readyState === 3) {
        return
      }
      ws.readyState = 3 // CLOSED
      socket.destroy()
    },

    cork(callback) {
      socket.cork()
      try {
        callback()
      } finally {
        socket.uncork()
      }
    },

    remoteAddress: socket.remoteAddress,
  }

  // Call open handler
  if (wsHandlers.open) {
    wsHandlers.open(ws)
  }

  // Use array of buffers to avoid O(n²) concatenation
  const bufferChunks = []
  let bufferTotalLength = 0

  socket.on('data', data => {
    ArrayPrototypePush(bufferChunks, data)
    bufferTotalLength += data.length

    // Concatenate only when we need to parse
    let buffer =
      bufferChunks.length === 1
        ? bufferChunks[0]
        : BufferConcat(bufferChunks, bufferTotalLength)

    while (buffer.length > 0) {
      const frame = decodeWebSocketFrame(buffer)
      if (!frame) {
        break
      }

      // Update buffer to remaining data after frame
      const remaining = BufferPrototypeSlice(buffer, frame.totalLength)
      bufferChunks.length = 0
      if (remaining.length > 0) {
        ArrayPrototypePush(bufferChunks, remaining)
      }
      bufferTotalLength = remaining.length
      buffer = remaining

      switch (frame.opcode) {
        case WS_OPCODE_TEXT:
          if (wsHandlers.message) {
            wsHandlers.message(
              ws,
              BufferPrototypeToString(frame.payload, 'utf8'),
            )
          }
          break
        case WS_OPCODE_BINARY:
          if (wsHandlers.message) {
            wsHandlers.message(ws, frame.payload)
          }
          break
        case WS_OPCODE_PING:
          ws.pong(frame.payload)
          if (wsHandlers.ping) {
            wsHandlers.ping(ws, frame.payload)
          }
          break
        case WS_OPCODE_PONG:
          if (wsHandlers.pong) {
            wsHandlers.pong(ws, frame.payload)
          }
          break
        case WS_OPCODE_CLOSE:
          ws.readyState = 3
          // Unsubscribe from all topics
          MapPrototypeForEach(subscribers, subs => {
            SetPrototypeDelete(subs, ws)
          })
          if (wsHandlers.close) {
            const code =
              frame.payload.length >= 2 ? frame.payload.readUInt16BE(0) : 1000
            const reason =
              frame.payload.length > 2
                ? BufferPrototypeToString(
                    BufferPrototypeSlice(frame.payload, 2),
                  )
                : ''
            wsHandlers.close(ws, code, reason)
          }
          socket.end()
          break
      }
    }
  })

  socket.on('close', () => {
    if (ws.readyState !== 3) {
      ws.readyState = 3
      // Unsubscribe from all topics
      MapPrototypeForEach(subscribers, subs => {
        SetPrototypeDelete(subs, ws)
      })
      if (wsHandlers.close) {
        wsHandlers.close(ws, 1006, 'Connection closed')
      }
    }
  })

  socket.on('drain', () => {
    if (wsHandlers.drain) {
      wsHandlers.drain(ws)
    }
  })

  socket.on('error', err => {
    if (wsHandlers.error) {
      wsHandlers.error(ws, err)
    }
  })

  return ws
}

module.exports = {
  __proto__: null,
  encodeWebSocketFrame,
  decodeWebSocketFrame,
  createWebSocketHandler,
}
