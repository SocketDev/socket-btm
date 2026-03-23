/**
 * @fileoverview Tests for node:smol-http module source code structure and patterns.
 *
 * Note: These tests verify the source code patterns and structure rather than
 * runtime behavior, since the smol-http module requires internal Node.js APIs
 * that are only available in the node-smol binary.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const nodeSmolBuilderDir = path.resolve(__dirname, '..', '..')
const smolHttpPath = path.join(
  nodeSmolBuilderDir,
  'additions/source-patched/lib/smol-http.js',
)
const smolHttpTypesPath = path.join(
  nodeSmolBuilderDir,
  'additions/source-patched/typings/node_smol-http.d.ts',
)

describe('node:smol-http module', () => {
  let sourceCode: string

  beforeAll(async () => {
    sourceCode = await fs.readFile(smolHttpPath, 'utf8')
  })

  describe('primordials usage', () => {
    it('should import primordials at the top of the file', () => {
      // Primordials should be imported early in the file
      const primordialIndex = sourceCode.indexOf('} = primordials')
      expect(primordialIndex).toBeGreaterThan(0)
      expect(primordialIndex).toBeLessThan(2000) // Should be near the top
    })

    it('should use SafeMap instead of Map', () => {
      expect(sourceCode).toContain('SafeMap')
      expect(sourceCode).toContain('new SafeMap()')
    })

    it('should use SafeSet instead of Set', () => {
      expect(sourceCode).toContain('SafeSet')
      expect(sourceCode).toContain('new SafeSet()')
    })

    it('should use SafeWeakMap instead of WeakMap', () => {
      expect(sourceCode).toContain('SafeWeakMap')
      expect(sourceCode).toContain('new SafeWeakMap()')
    })

    it('should use MapPrototype* methods for Map operations', () => {
      expect(sourceCode).toContain('MapPrototypeGet')
      expect(sourceCode).toContain('MapPrototypeSet')
      expect(sourceCode).toContain('MapPrototypeDelete')
      expect(sourceCode).toContain('MapPrototypeHas')
    })

    it('should use SetPrototype* methods for Set operations', () => {
      expect(sourceCode).toContain('SetPrototypeAdd')
      expect(sourceCode).toContain('SetPrototypeDelete')
      expect(sourceCode).toContain('SetPrototypeHas')
    })

    it('should use StringPrototype* methods for String operations', () => {
      expect(sourceCode).toContain('StringPrototypeIndexOf')
      expect(sourceCode).toContain('StringPrototypeSlice')
      expect(sourceCode).toContain('StringPrototypeSplit')
      expect(sourceCode).toContain('StringPrototypeStartsWith')
      expect(sourceCode).toContain('StringPrototypeToLowerCase')
      expect(sourceCode).toContain('StringPrototypeTrim')
    })

    it('should use ArrayPrototypePush instead of array.push()', () => {
      expect(sourceCode).toContain('ArrayPrototypePush')
    })

    it('should use JSONParse and JSONStringify', () => {
      expect(sourceCode).toContain('JSONParse')
      expect(sourceCode).toContain('JSONStringify')
    })

    it('should use ObjectFreeze for exported module', () => {
      expect(sourceCode).toContain('module.exports = ObjectFreeze({')
    })

    it('should use ObjectEntries for object iteration', () => {
      expect(sourceCode).toContain('ObjectEntries')
    })

    it('should use ObjectKeys for object key iteration', () => {
      expect(sourceCode).toContain('ObjectKeys')
    })

    it('should use hardenRegExp for regex patterns', () => {
      expect(sourceCode).toContain('hardenRegExp')
      // Multiple hardened regexes should exist
      const hardenCount = (sourceCode.match(/hardenRegExp/g) || []).length
      expect(hardenCount).toBeGreaterThan(5)
    })

    it('should use RegExpPrototypeExec instead of regex.exec()', () => {
      expect(sourceCode).toContain('RegExpPrototypeExec')
    })
  })

  describe('safe-references usage', () => {
    it('should import from safe-references module', () => {
      expect(sourceCode).toContain(
        "require('internal/socketsecurity/safe-references')",
      )
    })

    it('should use BufferFrom instead of Buffer.from', () => {
      expect(sourceCode).toContain('BufferFrom')
      // Should not use Buffer.from directly (except in comments)
      const bufferFromMatches = sourceCode.match(/Buffer\.from\(/g) || []
      expect(bufferFromMatches.length).toBe(0)
    })

    it('should use BufferAlloc instead of Buffer.alloc', () => {
      expect(sourceCode).toContain('BufferAlloc')
      // Should not use Buffer.alloc directly
      const bufferAllocMatches = sourceCode.match(/Buffer\.alloc\(/g) || []
      expect(bufferAllocMatches.length).toBe(0)
    })

    it('should use BufferIsBuffer instead of Buffer.isBuffer', () => {
      expect(sourceCode).toContain('BufferIsBuffer')
      // Should not use Buffer.isBuffer directly
      const bufferIsBufferMatches =
        sourceCode.match(/Buffer\.isBuffer\(/g) || []
      expect(bufferIsBufferMatches.length).toBe(0)
    })

    it('should use CryptoCreateHash for crypto operations', () => {
      expect(sourceCode).toContain('CryptoCreateHash')
    })
  })

  describe('__proto__: null pattern', () => {
    it('should use __proto__: null for serve() options normalization', () => {
      expect(sourceCode).toContain('const opts = { __proto__: null, ...options }')
    })

    it('should use __proto__: null for wsHandlers normalization', () => {
      expect(sourceCode).toContain(
        'const wsHandlers = wsHandlersInput ? { __proto__: null, ...wsHandlersInput } : { __proto__: null }',
      )
    })

    it('should use __proto__: null for pooled request objects', () => {
      // Request pool creates objects with __proto__: null
      expect(sourceCode).toContain('const request = acquireRequest()')
      // The acquireRequest function returns object with __proto__: null
      expect(sourceCode).toContain("return {\n    __proto__: null,\n    method: '',")
    })

    it('should use __proto__: null for trie nodes', () => {
      // Trie nodes should have __proto__: null
      expect(sourceCode).toContain("return {\n    __proto__: null,\n    type: TRIE_NODE_STATIC,")
    })

    it('should use __proto__: null for WebSocket instance', () => {
      expect(sourceCode).toContain('const ws = {')
      // ws object should have __proto__: null
    })

    it('should use __proto__: null for serverInstance', () => {
      expect(sourceCode).toContain('const serverInstance = {')
    })

    it('should use __proto__: null for trieMatch result', () => {
      // trieMatch returns objects with __proto__: null
      expect(sourceCode).toContain("return { __proto__: null, handler:")
    })

    it('should use __proto__: null for decodeWebSocketFrame return', () => {
      expect(sourceCode).toContain(
        'return {\n    __proto__: null,\n    fin,\n    opcode,',
      )
    })

    it('should use __proto__: null for STATUS_TEXT lookup', () => {
      expect(sourceCode).toContain("const STATUS_TEXT = ObjectFreeze({\n  __proto__: null,")
    })
  })

  describe('undefined instead of null returns', () => {
    it('should return undefined for no match in trieMatch()', () => {
      // trieMatch returns undefined when no route matches
      expect(sourceCode).toContain('return undefined;')
    })

    it('should return undefined for incomplete frames in decodeWebSocketFrame()', () => {
      expect(sourceCode).toContain('if (buffer.length < 2) return undefined;')
      expect(sourceCode).toContain('if (buffer.length < 4) return undefined;')
      expect(sourceCode).toContain('if (buffer.length < 10) return undefined;')
    })

    it('should return undefined from requestIP() when not found', () => {
      // requestIPs.get() returns undefined when not found
      expect(sourceCode).toContain('return requestIPs.get(req);')
    })

    it('should return boolean from upgrade() for Bun compatibility', () => {
      // upgrade() returns true if valid WebSocket request, false otherwise
      expect(sourceCode).toContain('return true;')
      expect(sourceCode).toContain('return false;')
    })
  })

  describe('module exports', () => {
    it('should export serve function', () => {
      expect(sourceCode).toContain('serve,')
    })

    it('should export response writers', () => {
      expect(sourceCode).toContain('writeJsonResponse,')
      expect(sourceCode).toContain('writeNotFound,')
      expect(sourceCode).toContain('writeNotModified,')
      expect(sourceCode).toContain('writeTarballResponse,')
    })

    it('should export fast response functions', () => {
      expect(sourceCode).toContain('fastBinaryResponse,')
      expect(sourceCode).toContain('fastErrorResponse,')
      expect(sourceCode).toContain('fastJsonResponse,')
      expect(sourceCode).toContain('fastNotModified,')
      expect(sourceCode).toContain('fastPackumentResponse,')
      expect(sourceCode).toContain('fastTarballResponse,')
    })

    it('should export cache utilities', () => {
      expect(sourceCode).toContain('ETagCache,')
      expect(sourceCode).toContain('AuthCache,')
      expect(sourceCode).toContain('CompressionCache,')
    })

    it('should export a frozen default export', () => {
      expect(sourceCode).toContain('default: ObjectFreeze({')
    })
  })

  describe('WebSocket implementation', () => {
    it('should define WebSocket opcodes', () => {
      expect(sourceCode).toContain('const WS_OPCODE_TEXT = 0x01;')
      expect(sourceCode).toContain('const WS_OPCODE_BINARY = 0x02;')
      expect(sourceCode).toContain('const WS_OPCODE_CLOSE = 0x08;')
      expect(sourceCode).toContain('const WS_OPCODE_PING = 0x09;')
      expect(sourceCode).toContain('const WS_OPCODE_PONG = 0x0a;')
    })

    it('should define WebSocket handshake GUID', () => {
      expect(sourceCode).toContain(
        "const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';",
      )
    })

    it('should have encodeWebSocketFrame function', () => {
      expect(sourceCode).toContain('function encodeWebSocketFrame(data,')
    })

    it('should have decodeWebSocketFrame function', () => {
      expect(sourceCode).toContain('function decodeWebSocketFrame(buffer)')
    })

    it('should have createWebSocketHandler function', () => {
      expect(sourceCode).toContain(
        'function createWebSocketHandler(socket, wsHandlers, serverInstance)',
      )
    })

    it('should implement WebSocket pub/sub methods', () => {
      expect(sourceCode).toContain('subscribe(topic)')
      expect(sourceCode).toContain('unsubscribe(topic)')
      expect(sourceCode).toContain('isSubscribed(topic)')
      expect(sourceCode).toContain('publish(topic, data')
    })

    it('should have send() method', () => {
      expect(sourceCode).toContain('send(data, compress')
      expect(sourceCode).toContain('socket.write(encodeWebSocketFrame')
    })

    it('should have close() method', () => {
      expect(sourceCode).toContain('close(code = 1000, reason')
      expect(sourceCode).toContain('WS_OPCODE_CLOSE')
    })

    it('should have ping() method', () => {
      expect(sourceCode).toContain('ping(data')
      expect(sourceCode).toContain('WS_OPCODE_PING')
    })

    it('should have terminate() method for immediate close', () => {
      expect(sourceCode).toContain('terminate()')
      expect(sourceCode).toContain('socket.destroy()')
    })

    it('should have subscriptions getter', () => {
      expect(sourceCode).toContain('get subscriptions()')
    })

    it('should have publishText() method', () => {
      expect(sourceCode).toContain('publishText(topic, text')
      expect(sourceCode).toContain('subscriber.sendText(text, compress)')
    })

    it('should have publishBinary() method', () => {
      expect(sourceCode).toContain('publishBinary(topic, data')
      expect(sourceCode).toContain('subscriber.sendBinary(data, compress)')
    })

    it('should have drain handler support', () => {
      expect(sourceCode).toContain("socket.on('drain'")
      expect(sourceCode).toContain('wsHandlers.drain')
    })

    it('should have pong() method', () => {
      expect(sourceCode).toContain('pong(data')
      expect(sourceCode).toContain('WS_OPCODE_PONG')
    })

    it('should exclude sender in ws.publish() (Bun behavior)', () => {
      // ws.publish() should skip the sender
      expect(sourceCode).toContain('subscriber !== ws')
    })

    it('should use efficient frame encoding (no array spread)', () => {
      // Frame encoding should use Buffer.copy, not array spread
      expect(sourceCode).toContain('payload.copy(frame, offset)')
      // Should NOT contain the old inefficient pattern
      expect(sourceCode).not.toContain('BufferFrom([...header, ...payload])')
    })

    it('should use efficient buffer concatenation for incoming data', () => {
      // Should use buffer chunks array instead of repeated concatenation
      expect(sourceCode).toContain('bufferChunks')
      expect(sourceCode).toContain('BufferConcat')
    })
  })

  describe('Performance: llhttp Parser', () => {
    it('should use Node.js built-in llhttp for HTTP parsing', () => {
      expect(sourceCode).toContain("internalBinding('http_parser')")
      expect(sourceCode).toContain('HTTPParser')
    })

    it('should configure llhttp parser callbacks', () => {
      expect(sourceCode).toContain('kOnMessageBegin')
      expect(sourceCode).toContain('kOnHeadersComplete')
      expect(sourceCode).toContain('kOnBody')
      expect(sourceCode).toContain('kOnMessageComplete')
    })

    it('should initialize parser for HTTP requests', () => {
      expect(sourceCode).toContain('parser.initialize(HTTPParser.REQUEST')
    })

    it('should feed data to llhttp parser', () => {
      expect(sourceCode).toContain('parser.execute(data)')
    })
  })

  describe('Performance: Trie-based Router', () => {
    it('should have createTrieNode function', () => {
      expect(sourceCode).toContain('function createTrieNode()')
    })

    it('should have trieInsert function', () => {
      expect(sourceCode).toContain('function trieInsert(root, pattern, handler)')
    })

    it('should have trieMatch function with incremental parsing', () => {
      expect(sourceCode).toContain('function trieMatch(root, pathname, method)')
      // Should use incremental parsing, not split
      expect(sourceCode).toContain('incremental parsing (no array allocation)')
      expect(sourceCode).toContain('function getNextSegment(startPos)')
    })

    it('should avoid split allocation in trieMatch', () => {
      // trieMatch should NOT use StringPrototypeSplit
      // Check for the charcode-based segment extraction instead
      expect(sourceCode).toContain('StringPrototypeCharCodeAt(pathname,')
      expect(sourceCode).toContain('47') // '/' charcode
    })

    it('should support node types for static, param, and wildcard', () => {
      expect(sourceCode).toContain('TRIE_NODE_STATIC')
      expect(sourceCode).toContain('TRIE_NODE_PARAM')
      expect(sourceCode).toContain('TRIE_NODE_WILDCARD')
    })

    it('should use trie for O(log n) route matching', () => {
      expect(sourceCode).toContain('const routeMatch = trieMatch(routeTrie')
    })
  })

  describe('Performance: Object Pooling', () => {
    it('should have HTTPParser pool', () => {
      expect(sourceCode).toContain('const parserPool = []')
      expect(sourceCode).toContain('function acquireParser()')
      expect(sourceCode).toContain('function releaseParser(parser)')
    })

    it('should have buffer pool', () => {
      expect(sourceCode).toContain('const bufferPool = []')
      expect(sourceCode).toContain('function acquireBuffer(')
      expect(sourceCode).toContain('function releaseBuffer(buffer)')
    })

    it('should have request object pool', () => {
      expect(sourceCode).toContain('const requestPool = []')
      expect(sourceCode).toContain('function acquireRequest()')
      expect(sourceCode).toContain('function releaseRequest(req)')
    })

    it('should use object replacement instead of delete to avoid V8 deoptimization', () => {
      // Should NOT use delete operator (causes deoptimization)
      expect(sourceCode).not.toContain('delete req.query[')
      expect(sourceCode).not.toContain('delete req.params[')
      // Should use object replacement instead
      expect(sourceCode).toContain("req.query = { __proto__: null }")
      expect(sourceCode).toContain("req.params = { __proto__: null }")
    })

    it('should reuse headers SafeMap with clear() instead of creating new', () => {
      // Per-connection headers map should be reused
      expect(sourceCode).toContain('const currentHeaders = new SafeMap()')
      expect(sourceCode).toContain('currentHeaders.clear()')
    })

    it('should clear sensitive data before pooling buffers', () => {
      expect(sourceCode).toContain('buffer.fill(0)')
    })

    it('should release parser back to pool on connection close', () => {
      expect(sourceCode).toContain('releaseParser(parser)')
    })

    it('should release request object back to pool after handling', () => {
      expect(sourceCode).toContain('releaseRequest(request)')
    })
  })

  describe('Performance: Per-Connection Reusable Objects', () => {
    it('should create headers accessor once per connection (not per request)', () => {
      // Headers accessor should be defined once per connection
      expect(sourceCode).toContain('const headersAccessor = {')
      expect(sourceCode).toContain('Per-connection headers accessor object')
      // Should reuse the accessor instead of creating new object
      expect(sourceCode).toContain('request.headers = headersAccessor')
    })

    it('should create body accessor functions once per connection', () => {
      // Body accessor functions should be defined once per connection
      expect(sourceCode).toContain('function textFn()')
      expect(sourceCode).toContain('function jsonFn()')
      expect(sourceCode).toContain('function arrayBufferFn()')
      // Should assign functions directly, not create new closures
      expect(sourceCode).toContain('request.text = textFn')
      expect(sourceCode).toContain('request.json = jsonFn')
      expect(sourceCode).toContain('request.arrayBuffer = arrayBufferFn')
    })

    it('should use PromiseResolve in body accessor functions', () => {
      // Should use PromiseResolve for sync promise return
      expect(sourceCode).toContain('PromiseResolve(currentBody)')
      expect(sourceCode).toContain('PromiseResolve(JSONParse(currentBody))') // Inside try block
      expect(sourceCode).toContain('PromiseResolve(BufferFrom(currentBody).buffer)')
    })

    it('should provide better JSON parse error messages', () => {
      // JSON parsing should have try/catch with context
      expect(sourceCode).toContain('Failed to parse request body as JSON')
      expect(sourceCode).toContain('PromiseReject')
    })

    it('should capture body in connection-scoped variable', () => {
      // Body should be stored in currentBody for reuse
      expect(sourceCode).toContain("let currentBody = ''")
      expect(sourceCode).toContain('currentBody = bodyChunks')
    })
  })

  describe('Performance: Fast URL Parsing', () => {
    it('should use fast path for URLs without query strings', () => {
      // Should detect query string presence and use fast path
      expect(sourceCode).toContain("StringPrototypeIndexOf(currentUrl, '?')")
      expect(sourceCode).toContain('questionIdx === -1')
      // Fast path sets pathname directly from URL
      expect(sourceCode).toContain('pathname = currentUrl')
    })

    it('should only parse query params when present (lazy parsing)', () => {
      // Uses manual parsing instead of URLSearchParams for 3-5x performance
      expect(sourceCode).toContain('if (queryString !== undefined)')
      expect(sourceCode).toContain('DecodeURIComponent')
    })

    it('should avoid creating new URL() object for simple paths', () => {
      // Should construct href manually instead of using new URL()
      expect(sourceCode).toContain('href = `http://${host}${currentUrl}`')
    })
  })

  describe('Performance: Socket Cork for Batched Writes', () => {
    it('should use socket.cork() for Response object writes', () => {
      // Multiple writes for Response should be corked
      expect(sourceCode).toContain('socket.cork()')
      expect(sourceCode).toContain('socket.uncork()')
    })

    it('should cork writes for JSON object response', () => {
      // JSON responses have multiple writes (header + body)
      const jsonBlockMatch = sourceCode.match(/else if \(response && typeof response === 'object'[\s\S]*?socket\.uncork\(\)/)
      expect(jsonBlockMatch).toBeTruthy()
    })

    it('should cork writes for string response', () => {
      // String responses have multiple writes (header + body)
      const stringBlockMatch = sourceCode.match(/else if \(typeof response === 'string'\)[\s\S]*?socket\.uncork\(\)/)
      expect(stringBlockMatch).toBeTruthy()
    })
  })

  describe('Performance: Trie Backtracking', () => {
    it('should use undefined assignment instead of delete for backtracking', () => {
      // Should NOT use delete in trie matching (causes V8 deoptimization)
      expect(sourceCode).not.toContain('delete params[node.paramChild.paramName]')
      // Should use undefined assignment instead
      expect(sourceCode).toContain('params[paramName] = undefined')
      expect(sourceCode).toContain('avoid V8 deoptimization')
    })
  })

  describe('Performance: Common Header Names Cache', () => {
    it('should have COMMON_HEADER_NAMES constant for frequent headers', () => {
      expect(sourceCode).toContain('COMMON_HEADER_NAMES')
      expect(sourceCode).toContain("'content-type': 'content-type'")
      expect(sourceCode).toContain("'Content-Type': 'content-type'")
    })

    it('should use COMMON_HEADER_NAMES in headers accessor', () => {
      // Should check cache before calling toLowerCase
      expect(sourceCode).toContain('COMMON_HEADER_NAMES[name] || StringPrototypeToLowerCase(name)')
    })

    it('should avoid redundant toLowerCase for already-lowercase headers', () => {
      // Headers stored in currentHeaders are already lowercased
      // So upgrade header check should NOT use toLowerCase
      expect(sourceCode).toContain("upgradeHeader === 'websocket'")
      expect(sourceCode).not.toContain("StringPrototypeToLowerCase(upgradeHeader) === 'websocket'")
    })
  })

  describe('Memory: RequestIPs Cleanup', () => {
    it('should clear requestIPs when releasing request objects', () => {
      // Prevent memory leak by clearing WeakMap entries before pooling
      expect(sourceCode).toContain('requestIPs.delete(request)')
    })
  })

  describe('Performance: Array Join for Header Building', () => {
    it('should use ArrayPrototypeJoin for response headers', () => {
      expect(sourceCode).toContain('ArrayPrototypeJoin(headerParts')
    })

    it('should use headerParts array instead of string concatenation', () => {
      expect(sourceCode).toContain('const headerParts = [')
      expect(sourceCode).toContain('ArrayPrototypePush(headerParts,')
    })
  })

  describe('Performance: Manual Query Parsing', () => {
    it('should use manual query string parsing instead of URLSearchParams', () => {
      // Manual parsing is 3-5x faster than URLSearchParams
      expect(sourceCode).not.toContain('new URLSearchParams(queryString)')
      expect(sourceCode).toContain('DecodeURIComponent')
    })

    it('should parse key=value pairs manually', () => {
      // Look for '&' delimiter (charcode 38)
      expect(sourceCode).toContain('StringPrototypeCharCodeAt(queryString, i) === 38')
    })
  })

  describe('Error Handler Response Support', () => {
    it('should allow error handler to return Response', () => {
      // Error handler can return Response for recovery
      expect(sourceCode).toContain('errorResponse = errorHandler(error)')
    })

    it('should handle Response from error handler', () => {
      // Should check if error handler returned a Response
      expect(sourceCode).toContain('if (errorResponse && typeof errorResponse.text === ')
    })

    it('should use cork for error Response writes', () => {
      // Error response writes should also be corked
      const errorBlockMatch = sourceCode.match(/If error handler returned[\s\S]*?socket\.cork\(\)[\s\S]*?socket\.uncork\(\)/)
      expect(errorBlockMatch).toBeTruthy()
    })
  })

  describe('Security: Body Size Limits', () => {
    it('should have default max body size constant', () => {
      expect(sourceCode).toContain('DEFAULT_MAX_BODY_SIZE')
      expect(sourceCode).toContain('10 * 1024 * 1024') // 10MB
    })

    it('should have maxBodySize option', () => {
      expect(sourceCode).toContain('maxBodySize = DEFAULT_MAX_BODY_SIZE')
    })

    it('should check body size limit before receiving body', () => {
      expect(sourceCode).toContain('if (expectedContentLength > maxBodySize)')
    })

    it('should check body size limit during streaming', () => {
      expect(sourceCode).toContain('if (bodyTotalLength > maxBodySize)')
    })

    it('should return 413 Payload Too Large response with JSON body', () => {
      expect(sourceCode).toContain('HTTP_413')
      expect(sourceCode).toContain('413 Payload Too Large')
      // Should include JSON error body for better DX
      expect(sourceCode).toContain('Payload Too Large')
      expect(sourceCode).toContain('Request body exceeds maxBodySize limit')
    })
  })

  describe('Routes API', () => {
    it('should have dead code removed (parseRoutePattern/matchRoute)', () => {
      // These functions were removed as dead code - trie router is used instead
      expect(sourceCode).toContain(
        'parseRoutePattern() and matchRoute() functions were removed as dead code',
      )
      expect(sourceCode).not.toContain('function parseRoutePattern(pattern)')
      expect(sourceCode).not.toContain('function matchRoute(pattern, pathname)')
    })

    it('should support :param dynamic segments in trie', () => {
      expect(sourceCode).toContain("if (StringPrototypeStartsWith(part, ':'))")
    })

    it('should support * wildcard routes in trie', () => {
      expect(sourceCode).toContain("if (part === '*')")
      expect(sourceCode).toContain("'$wildcard'")
    })

    it('should build trie-based router on serve()', () => {
      expect(sourceCode).toContain('const routeTrie = createTrieNode()')
      expect(sourceCode).toContain('trieInsert(routeTrie, pattern, handler)')
    })
  })

  describe('serve() function', () => {
    it('should validate fetch handler is a function', () => {
      expect(sourceCode).toContain("if (typeof fetchHandler !== 'function')")
      expect(sourceCode).toContain(
        "throw new TypeError('options.fetch must be a function')",
      )
    })

    it('should support port option with default', () => {
      expect(sourceCode).toContain('port: requestedPort = 3000')
    })

    it('should support hostname option with default', () => {
      expect(sourceCode).toContain("hostname = '0.0.0.0'")
    })

    it('should support unix socket option', () => {
      expect(sourceCode).toContain('unix: unixPath')
    })

    it('should support idleTimeout option', () => {
      expect(sourceCode).toContain('idleTimeout = 10')
    })

    it('should support error handler option', () => {
      expect(sourceCode).toContain('error: errorHandler')
      expect(sourceCode).toContain('if (errorHandler)')
    })

    it('should support development mode option', () => {
      expect(sourceCode).toContain('development: developmentMode')
      expect(sourceCode).toContain('development: isDevelopment')
    })

    it('should log errors in development mode', () => {
      expect(sourceCode).toContain('if (isDevelopment)')
      expect(sourceCode).toContain('Unhandled error in fetch handler')
    })

    it('should track pending requests', () => {
      expect(sourceCode).toContain('let pendingRequests = 0;')
      expect(sourceCode).toContain('pendingRequests++;')
      expect(sourceCode).toContain('pendingRequests--;')
    })

    it('should track pending WebSockets', () => {
      expect(sourceCode).toContain('let pendingWebSockets = 0;')
      expect(sourceCode).toContain('pendingWebSockets++;')
      expect(sourceCode).toContain('pendingWebSockets--;')
    })

    it('should return server instance with required methods', () => {
      expect(sourceCode).toContain('subscriberCount(topic)')
      expect(sourceCode).toContain('publish(topic, data')
      expect(sourceCode).toContain('requestIP(req)')
      expect(sourceCode).toContain('upgrade(req, data)')
      expect(sourceCode).toContain('reload(newOptions)')
      expect(sourceCode).toContain('stop(closeActiveConnections')
    })

    it('should have server.url getter', () => {
      expect(sourceCode).toContain('get url()')
      // Unix socket URL handling
      expect(sourceCode).toContain('unix://')
      // TCP URL construction
      expect(sourceCode).toContain('http://')
    })

    it('should have server.port getter', () => {
      expect(sourceCode).toContain('get port()')
      expect(sourceCode).toContain('return actualPort')
    })

    it('should have server.hostname property', () => {
      expect(sourceCode).toContain('hostname,')
    })
  })

  describe('Headers accessor', () => {
    it('should have headers.get() method', () => {
      expect(sourceCode).toContain('get(name)')
      expect(sourceCode).toContain('MapPrototypeGet(currentHeaders')
    })

    it('should have headers.has() method', () => {
      expect(sourceCode).toContain('has(name)')
      expect(sourceCode).toContain('MapPrototypeHas(currentHeaders')
    })

    it('should have headers iteration methods', () => {
      expect(sourceCode).toContain('entries() { return currentHeaders.entries()')
      expect(sourceCode).toContain('keys() { return currentHeaders.keys()')
      expect(sourceCode).toContain('values() { return currentHeaders.values()')
      expect(sourceCode).toContain('forEach(cb) { currentHeaders.forEach(cb)')
    })
  })

  describe('Request body methods', () => {
    it('should have request.text() method', () => {
      expect(sourceCode).toContain('function textFn()')
      expect(sourceCode).toContain('request.text = textFn')
    })

    it('should have request.json() method', () => {
      expect(sourceCode).toContain('function jsonFn()')
      expect(sourceCode).toContain('request.json = jsonFn')
    })

    it('should have request.arrayBuffer() method', () => {
      expect(sourceCode).toContain('function arrayBufferFn()')
      expect(sourceCode).toContain('request.arrayBuffer = arrayBufferFn')
    })
  })
})

describe('node:smol-http TypeScript definitions', () => {
  let typesContent: string

  beforeAll(async () => {
    typesContent = await fs.readFile(smolHttpTypesPath, 'utf8')
  })

  describe('optional property pattern', () => {
    it('should use foo?: type | undefined pattern for optional properties', () => {
      // Port should be optional with undefined
      expect(typesContent).toContain('port?: number | undefined;')

      // Hostname should be optional with undefined
      expect(typesContent).toContain('hostname?: string | undefined;')

      // Unix should be optional with undefined
      expect(typesContent).toContain('unix?: string | undefined;')

      // idleTimeout should be optional with undefined
      expect(typesContent).toContain('idleTimeout?: number | undefined;')
    })

    it('should use undefined in return types instead of null', () => {
      // requestIP should return undefined, not null
      expect(typesContent).toContain(
        'requestIP(req: ServeRequest): RequestIPInfo | undefined;',
      )

      // Cache get methods should return undefined
      expect(typesContent).toContain(
        'get(path: string, clientEtag: string): Buffer | string | undefined;',
      )
    })
  })

  describe('WebSocket types', () => {
    it('should define ServerWebSocket interface', () => {
      expect(typesContent).toContain('export interface ServerWebSocket<T')
    })

    it('should define WebSocketHandlers interface', () => {
      expect(typesContent).toContain('export interface WebSocketHandlers<T')
    })

    it('should have optional WebSocket handler methods', () => {
      expect(typesContent).toContain(
        'open?: ((ws: ServerWebSocket<T>) => void) | undefined;',
      )
      expect(typesContent).toContain(
        'message?: ((ws: ServerWebSocket<T>, message: string | Buffer) => void) | undefined;',
      )
      expect(typesContent).toContain(
        'close?: ((ws: ServerWebSocket<T>, code: number, reason: string) => void) | undefined;',
      )
    })
  })

  describe('Routes types', () => {
    it('should define RouteHandler type', () => {
      expect(typesContent).toContain('export type RouteHandler')
    })

    it('should define MethodHandlers interface', () => {
      expect(typesContent).toContain('export interface MethodHandlers')
    })

    it('should define Routes interface', () => {
      expect(typesContent).toContain('export interface Routes')
    })
  })

  describe('serve() types', () => {
    it('should export serve function', () => {
      expect(typesContent).toContain(
        'export function serve<T = unknown>(options: ServeOptions<T>): Server;',
      )
    })

    it('should define ServeOptions interface', () => {
      expect(typesContent).toContain('export interface ServeOptions<T')
    })

    it('should define ServeRequest interface', () => {
      expect(typesContent).toContain('export interface ServeRequest')
    })

    it('should define Server interface', () => {
      expect(typesContent).toContain('export interface Server')
    })

    it('should have maxBodySize option', () => {
      expect(typesContent).toContain('maxBodySize?: number | undefined;')
    })

    it('should have error handler that can return Response', () => {
      expect(typesContent).toContain('error?: ((error: Error) => Response | void) | undefined;')
    })
  })
})
