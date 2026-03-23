'use strict';

// WebSocket Protocol Implementation
// Frame encoding/decoding and connection handling.

const {
  ArrayPrototypePush,
  BigInt: BigIntCtor,
  MapPrototypeDelete,
  MapPrototypeGet,
  MapPrototypeSet,
  Number: NumberCtor,
  SafeMap,
  SafeSet,
  SetPrototypeAdd,
  SetPrototypeDelete,
  SetPrototypeHas,
} = primordials;

const {
  BufferAlloc,
  BufferFrom,
  BufferIsBuffer,
} = require('internal/socketsecurity/safe-references');

// Buffer.concat captured for safe usage
const BufferConcat = Buffer.concat;

const {
  WS_OPCODE_TEXT,
  WS_OPCODE_BINARY,
  WS_OPCODE_CLOSE,
  WS_OPCODE_PING,
  WS_OPCODE_PONG,
} = require('internal/socketsecurity/http/constants');

// ============================================================================
// Frame Encoding/Decoding
// ============================================================================

/**
 * Encode WebSocket frame.
 * @param {string|Buffer} data - Data to encode
 * @param {number} [opcode=WS_OPCODE_TEXT] - WebSocket opcode
 * @returns {Buffer} Encoded frame
 */
function encodeWebSocketFrame(data, opcode = WS_OPCODE_TEXT) {
  const payload = BufferIsBuffer(data) ? data : BufferFrom(data);
  const len = payload.length;

  // Calculate header size and allocate single buffer for header + payload
  let headerSize;
  if (len < 126) {
    headerSize = 2;
  } else if (len < 65536) {
    headerSize = 4;
  } else {
    headerSize = 10;
  }

  const frame = BufferAlloc(headerSize + len);
  let offset = 0;

  frame[offset++] = 0x80 | opcode; // FIN + opcode

  if (len < 126) {
    frame[offset++] = len;
  } else if (len < 65536) {
    frame[offset++] = 126;
    frame.writeUInt16BE(len, offset);
    offset += 2;
  } else {
    frame[offset++] = 127;
    frame.writeBigUInt64BE(BigIntCtor(len), offset);
    offset += 8;
  }

  // Copy payload directly (fast native copy)
  payload.copy(frame, offset);
  return frame;
}

/**
 * Decode WebSocket frame.
 * @param {Buffer} buffer - Buffer to decode
 * @returns {{fin: boolean, opcode: number, payload: Buffer, totalLength: number}|undefined}
 */
function decodeWebSocketFrame(buffer) {
  if (buffer.length < 2) return undefined;

  const firstByte = buffer[0];
  const secondByte = buffer[1];

  const fin = (firstByte & 0x80) !== 0;
  const opcode = firstByte & 0x0f;
  const masked = (secondByte & 0x80) !== 0;
  let payloadLen = secondByte & 0x7f;

  let offset = 2;

  if (payloadLen === 126) {
    if (buffer.length < 4) return undefined;
    payloadLen = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buffer.length < 10) return undefined;
    payloadLen = NumberCtor(buffer.readBigUInt64BE(2));
    offset = 10;
  }

  let maskKey;
  if (masked) {
    if (buffer.length < offset + 4) return undefined;
    maskKey = buffer.slice(offset, offset + 4);
    offset += 4;
  }

  if (buffer.length < offset + payloadLen) return undefined;

  let payload = buffer.slice(offset, offset + payloadLen);

  // Unmask if needed - using 32-bit XOR for 4x fewer iterations
  if (masked && maskKey) {
    payload = BufferFrom(payload);
    const len = payload.length;
    // Process 4 bytes at a time using 32-bit XOR (4x faster for large payloads)
    const mask32 = maskKey.readUInt32LE(0);
    let i = 0;
    // Fast path: 4-byte aligned chunks
    const alignedEnd = len - (len % 4);
    for (; i < alignedEnd; i += 4) {
      payload.writeUInt32LE(payload.readUInt32LE(i) ^ mask32, i);
    }
    // Handle remaining 0-3 bytes
    for (; i < len; i++) {
      payload[i] ^= maskKey[i % 4];
    }
  }

  return {
    __proto__: null,
    fin,
    opcode,
    payload,
    totalLength: offset + payloadLen,
  };
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
  const subscribers = new SafeMap(); // topic -> SafeSet of ws

  const ws = {
    __proto__: null,
    readyState: 1, // OPEN
    data: undefined, // User-attached data
    _socket: socket, // Internal socket reference for optimized broadcast

    send(data, compress = false) {
      if (ws.readyState !== 1) return;
      const opcode = BufferIsBuffer(data) ? WS_OPCODE_BINARY : WS_OPCODE_TEXT;
      socket.write(encodeWebSocketFrame(data, opcode));
    },

    sendText(text, compress = false) {
      if (ws.readyState !== 1) return;
      socket.write(encodeWebSocketFrame(text, WS_OPCODE_TEXT));
    },

    sendBinary(data, compress = false) {
      if (ws.readyState !== 1) return;
      socket.write(encodeWebSocketFrame(data, WS_OPCODE_BINARY));
    },

    close(code = 1000, reason = '') {
      if (ws.readyState !== 1) return;
      ws.readyState = 2; // CLOSING
      const reasonBuf = BufferFrom(reason);
      const payload = BufferAlloc(2 + reasonBuf.length);
      payload.writeUInt16BE(code, 0);
      reasonBuf.copy(payload, 2);
      socket.write(encodeWebSocketFrame(payload, WS_OPCODE_CLOSE));
      socket.end();
      ws.readyState = 3; // CLOSED
    },

    ping(data = '') {
      if (ws.readyState !== 1) return;
      socket.write(encodeWebSocketFrame(data, WS_OPCODE_PING));
    },

    pong(data = '') {
      if (ws.readyState !== 1) return;
      socket.write(encodeWebSocketFrame(data, WS_OPCODE_PONG));
    },

    subscribe(topic) {
      let subs = MapPrototypeGet(serverInstance._wsTopics, topic);
      if (!subs) {
        subs = new SafeSet();
        MapPrototypeSet(serverInstance._wsTopics, topic, subs);
      }
      SetPrototypeAdd(subs, ws);
      MapPrototypeSet(subscribers, topic, subs);
    },

    unsubscribe(topic) {
      const subs = MapPrototypeGet(serverInstance._wsTopics, topic);
      if (subs) {
        SetPrototypeDelete(subs, ws);
        MapPrototypeDelete(subscribers, topic);
      }
    },

    isSubscribed(topic) {
      const subs = MapPrototypeGet(serverInstance._wsTopics, topic);
      return subs ? SetPrototypeHas(subs, ws) : false;
    },

    /**
     * Publish to all subscribers EXCEPT this WebSocket (Bun behavior).
     * Use server.publish() to include all subscribers.
     * OPTIMIZATION: Encodes frame ONCE, then writes pre-encoded buffer to all subscribers.
     */
    publish(topic, data, compress = false) {
      const subs = MapPrototypeGet(serverInstance._wsTopics, topic);
      if (!subs || subs.size === 0) return 0;

      // Encode frame ONCE for all subscribers (major perf win for broadcast)
      const opcode = BufferIsBuffer(data) ? WS_OPCODE_BINARY : WS_OPCODE_TEXT;
      const frame = encodeWebSocketFrame(data, opcode);

      let count = 0;
      for (const subscriber of subs) {
        if (subscriber !== ws && subscriber.readyState === 1) {
          subscriber._socket.write(frame);
          count++;
        }
      }
      return count;
    },

    publishText(topic, text, compress = false) {
      const subs = MapPrototypeGet(serverInstance._wsTopics, topic);
      if (!subs || subs.size === 0) return 0;

      // Encode frame ONCE for all subscribers
      const frame = encodeWebSocketFrame(text, WS_OPCODE_TEXT);

      let count = 0;
      for (const subscriber of subs) {
        if (subscriber !== ws && subscriber.readyState === 1) {
          subscriber._socket.write(frame);
          count++;
        }
      }
      return count;
    },

    publishBinary(topic, data, compress = false) {
      const subs = MapPrototypeGet(serverInstance._wsTopics, topic);
      if (!subs || subs.size === 0) return 0;

      // Encode frame ONCE for all subscribers
      const frame = encodeWebSocketFrame(data, WS_OPCODE_BINARY);

      let count = 0;
      for (const subscriber of subs) {
        if (subscriber !== ws && subscriber.readyState === 1) {
          subscriber._socket.write(frame);
          count++;
        }
      }
      return count;
    },

    get subscriptions() {
      const topics = [];
      for (const [topic] of subscribers) {
        ArrayPrototypePush(topics, topic);
      }
      return topics;
    },

    terminate() {
      if (ws.readyState === 3) return;
      ws.readyState = 3; // CLOSED
      socket.destroy();
    },

    cork(callback) {
      socket.cork();
      try {
        callback();
      } finally {
        socket.uncork();
      }
    },

    remoteAddress: socket.remoteAddress,
  };

  // Call open handler
  if (wsHandlers.open) {
    wsHandlers.open(ws);
  }

  // Use array of buffers to avoid O(n²) concatenation
  const bufferChunks = [];
  let bufferTotalLength = 0;

  socket.on('data', (data) => {
    ArrayPrototypePush(bufferChunks, data);
    bufferTotalLength += data.length;

    // Concatenate only when we need to parse
    let buffer = bufferChunks.length === 1
      ? bufferChunks[0]
      : BufferConcat(bufferChunks, bufferTotalLength);

    while (buffer.length > 0) {
      const frame = decodeWebSocketFrame(buffer);
      if (!frame) break;

      // Update buffer to remaining data after frame
      const remaining = buffer.slice(frame.totalLength);
      bufferChunks.length = 0;
      if (remaining.length > 0) {
        ArrayPrototypePush(bufferChunks, remaining);
      }
      bufferTotalLength = remaining.length;
      buffer = remaining;

      switch (frame.opcode) {
        case WS_OPCODE_TEXT:
          if (wsHandlers.message) {
            wsHandlers.message(ws, frame.payload.toString('utf8'));
          }
          break;
        case WS_OPCODE_BINARY:
          if (wsHandlers.message) {
            wsHandlers.message(ws, frame.payload);
          }
          break;
        case WS_OPCODE_PING:
          ws.pong(frame.payload);
          if (wsHandlers.ping) {
            wsHandlers.ping(ws, frame.payload);
          }
          break;
        case WS_OPCODE_PONG:
          if (wsHandlers.pong) {
            wsHandlers.pong(ws, frame.payload);
          }
          break;
        case WS_OPCODE_CLOSE:
          ws.readyState = 3;
          // Unsubscribe from all topics
          for (const [topic, subs] of subscribers) {
            SetPrototypeDelete(subs, ws);
          }
          if (wsHandlers.close) {
            const code = frame.payload.length >= 2 ? frame.payload.readUInt16BE(0) : 1000;
            const reason = frame.payload.length > 2 ? frame.payload.slice(2).toString() : '';
            wsHandlers.close(ws, code, reason);
          }
          socket.end();
          break;
      }
    }
  });

  socket.on('close', () => {
    if (ws.readyState !== 3) {
      ws.readyState = 3;
      // Unsubscribe from all topics
      for (const [topic, subs] of subscribers) {
        SetPrototypeDelete(subs, ws);
      }
      if (wsHandlers.close) {
        wsHandlers.close(ws, 1006, 'Connection closed');
      }
    }
  });

  socket.on('drain', () => {
    if (wsHandlers.drain) {
      wsHandlers.drain(ws);
    }
  });

  socket.on('error', (err) => {
    if (wsHandlers.error) {
      wsHandlers.error(ws, err);
    }
  });

  return ws;
}

module.exports = {
  __proto__: null,
  encodeWebSocketFrame,
  decodeWebSocketFrame,
  createWebSocketHandler,
};
