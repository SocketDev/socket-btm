/**
 * @file Verify-build tests for node:smol-http.
 *   smol-http re-exports an internal barrel via `...httpModule`. Rather
 *   than over-specify the surface here (which would duplicate the
 *   barrel's internals and rot quickly), the suite locks the contract
 *   the smol-https.js shim depends on — `serve` must exist as a
 *   function — plus the standard isBuiltin/builtinModules/freeze/
 *   null-prototype/no-bare-import invariants every smol-* module shares.
 */

import { describe, expect, it } from 'vitest'

import {
  parseExportShape,
  printExportShapeScript,
  runOnSmolBinary,
  smolBuiltinIsAvailable,
} from '../helpers/smol-builtin.mts'

const skipTests = !smolBuiltinIsAvailable('smol-http')

describe.skipIf(skipTests)('node:smol-http integration', () => {
  it("isBuiltin('node:smol-http') returns true; bare 'smol-http' returns false (schemelessBlockList)", async () => {
    const script = `
      const { isBuiltin } = require('node:module')
      console.log('isBuiltin(node:smol-http)=' + isBuiltin('node:smol-http'))
      console.log('isBuiltin(smol-http)=' + isBuiltin('smol-http'))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('isBuiltin(node:smol-http)=true')
    expect(stdout).toContain('isBuiltin(smol-http)=false')
  })

  it("builtinModules contains 'node:smol-http' (prefixed form)", async () => {
    const script = `
      const { builtinModules } = require('node:module')
      console.log('contains-prefixed=' + builtinModules.includes('node:smol-http'))
      console.log('contains-bare=' + builtinModules.includes('smol-http'))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('contains-prefixed=true')
    expect(stdout).toContain('contains-bare=false')
  })

  it('exports `serve` (contract smol-https depends on)', async () => {
    const { code, stdout } = await runOnSmolBinary(
      printExportShapeScript('smol-http'),
    )
    expect(code).toBe(0)
    const shape = parseExportShape(stdout)
    expect(shape.get('serve')).toBe('function')
    expect(shape.get('default')).toBe('object')
  })

  it('METHODS mirrors node:http.METHODS and includes QUERY', async () => {
    const script = `
      const { METHODS } = require('node:smol-http')
      const { METHODS: httpMethods } = require('node:http')
      console.log('hasQuery=' + METHODS.includes('QUERY'))
      console.log('matchesHttp=' + (JSON.stringify(METHODS) === JSON.stringify(httpMethods)))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('hasQuery=true')
    expect(stdout).toContain('matchesHttp=true')
  })

  it('module exports are frozen and null-prototype', async () => {
    const script = `
      const http = require('node:smol-http')
      console.log('frozen=' + Object.isFrozen(http))
      console.log('proto=' + Object.getPrototypeOf(http))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('frozen=true')
    expect(stdout).toContain('proto=null')
  })

  it('rejects bare `smol-http` with MODULE_NOT_FOUND (must use node: prefix)', async () => {
    const script = `
      try {
        require('smol-http')
        console.log('UNEXPECTED-LOAD')
      } catch (e) {
        console.log('blocked-code=' + (e.code || 'no-code'))
      }
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).not.toContain('UNEXPECTED-LOAD')
    expect(stdout).toContain('blocked-code=MODULE_NOT_FOUND')
  })

  // RFC 10008 QUERY method + the HEAD/SOURCE misclassification it was
  // filed alongside (uws_server.cc interned methods by byte-length —
  // HEAD (len 4) collided with POST). Requests go over a raw net.Socket
  // against the loopback server this script starts itself, so the
  // scripted handler property below is assigned rather than declared
  // with call-shaped shorthand syntax.
  it('QUERY request reports req.method === "QUERY" (RFC 10008), not "query"', async () => {
    const script = `
      const smolHttp = require('node:smol-http')
      const net = require('node:net')
      const results = []
      const requestHandler = req => {
        results.push(req.method)
        return ''
      }
      const server = smolHttp.serve({
        port: 0,
        hostname: '127.0.0.1',
        fetch: requestHandler,
      })
      const sock = net.connect(server.port, '127.0.0.1', () => {
        sock.write('QUERY / HTTP/1.1\\r\\nHost: x\\r\\nConnection: close\\r\\n\\r\\n')
      })
      sock.on('data', () => {})
      sock.on('end', () => {
        console.log('RESULT=' + JSON.stringify(results))
        server.stop().then(() => process.exit(0))
      })
      sock.on('error', e => { console.error(e); process.exit(1) })
      setTimeout(() => { console.error('TIMEOUT'); process.exit(1) }, 5000)
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('RESULT=["QUERY"]')
  })

  it('HEAD request reports req.method === "HEAD" (not misclassified as POST)', async () => {
    const script = `
      const smolHttp = require('node:smol-http')
      const net = require('node:net')
      const results = []
      const requestHandler = req => {
        results.push(req.method)
        return ''
      }
      const server = smolHttp.serve({
        port: 0,
        hostname: '127.0.0.1',
        fetch: requestHandler,
      })
      const sock = net.connect(server.port, '127.0.0.1', () => {
        sock.write('HEAD / HTTP/1.1\\r\\nHost: x\\r\\nConnection: close\\r\\n\\r\\n')
      })
      sock.on('data', () => {})
      sock.on('end', () => {
        console.log('RESULT=' + JSON.stringify(results))
        server.stop().then(() => process.exit(0))
      })
      sock.on('error', e => { console.error(e); process.exit(1) })
      setTimeout(() => { console.error('TIMEOUT'); process.exit(1) }, 5000)
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('RESULT=["HEAD"]')
  })

  it('QUERY request body is readable via req.text()', async () => {
    const script = `
      const smolHttp = require('node:smol-http')
      const net = require('node:net')
      let captured = 'UNSET'
      const requestHandler = async req => {
        try {
          captured = await req.text()
        } catch (e) {
          captured = 'ERROR:' + e.message
        }
        return ''
      }
      const server = smolHttp.serve({
        port: 0,
        hostname: '127.0.0.1',
        fetch: requestHandler,
      })
      const body = '{"q":"x"}'
      const sock = net.connect(server.port, '127.0.0.1', () => {
        sock.write(
          'QUERY / HTTP/1.1\\r\\nHost: x\\r\\nConnection: close\\r\\nContent-Length: ' +
          body.length + '\\r\\n\\r\\n' + body,
        )
      })
      sock.on('data', () => {})
      sock.on('end', () => {
        console.log('RESULT=' + captured)
        server.stop().then(() => process.exit(0))
      })
      sock.on('error', e => { console.error(e); process.exit(1) })
      setTimeout(() => { console.error('TIMEOUT'); process.exit(1) }, 5000)
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('RESULT={"q":"x"}')
  })

  // Every `routes` entry used to register as 'GET' regardless of the
  // MethodHandlers key given, so a `{ QUERY: handler }` route silently
  // never matched a QUERY request — only the catch-all handler below
  // ever saw it. Two handlers on the same pattern (GET, QUERY) proves
  // the fix routes by the METHOD key, not just by pattern.
  it('routes registers a MethodHandlers QUERY entry under its own method', async () => {
    const script = `
      const smolHttp = require('node:smol-http')
      const net = require('node:net')
      let getHits = 0
      let queryHits = 0
      const server = smolHttp.serve({
        port: 0,
        hostname: '127.0.0.1',
        routes: {
          '/item': {
            // Arity-1 handlers: a zero-arg handler is a static-response
            // candidate and gets probe-invoked ONCE at registration
            // (TryMakeStatic), which would pollute the hit counters.
            GET: req => { getHits++; return 'got' },
            QUERY: req => { queryHits++; return 'queried' },
          },
        },
        fetch: () => 'catch-all',
      })
      const body = ''
      const sock = net.connect(server.port, '127.0.0.1', () => {
        sock.write('QUERY /item HTTP/1.1\\r\\nHost: x\\r\\nConnection: close\\r\\nContent-Length: ' +
          body.length + '\\r\\n\\r\\n' + body)
      })
      let response = ''
      sock.on('data', d => { response += d.toString() })
      sock.on('end', () => {
        console.log('RESPONSE=' + JSON.stringify(response))
        console.log('getHits=' + getHits)
        console.log('queryHits=' + queryHits)
        server.stop().then(() => process.exit(0))
      })
      sock.on('error', e => { console.error(e); process.exit(1) })
      setTimeout(() => { console.error('TIMEOUT'); process.exit(1) }, 5000)
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('getHits=0')
    expect(stdout).toContain('queryHits=1')
    expect(stdout).toContain('queried')
  })

  // RFC 10008 §2.7: a QUERY response depends on the request body, so the
  // cache key must fold in a body digest — two QUERY requests with
  // different bodies must not collide on the same key. A 2-arg call (no
  // body) must still produce the EXACT prior key, unchanged: callers like
  // fastPackumentResponse never pass a body and must not see their cache
  // invalidated by this change.
  it('createCacheKey folds in a body digest for QUERY, unchanged for GET', async () => {
    const script = `
      const { createCacheKey } = require('node:smol-http')
      const keyA = createCacheKey('QUERY', '/x', '{"q":"a"}')
      const keyB = createCacheKey('QUERY', '/x', '{"q":"b"}')
      console.log('differs=' + (keyA !== keyB))
      console.log('unchanged=' + (createCacheKey('GET', '/lodash') === 'GET:/lodash'))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('differs=true')
    expect(stdout).toContain('unchanged=true')
  })
})
