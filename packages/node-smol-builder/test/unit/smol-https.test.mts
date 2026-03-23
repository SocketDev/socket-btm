/**
 * @fileoverview Tests for node:smol-https module source code structure and patterns.
 *
 * Note: These tests verify the source code patterns and structure rather than
 * runtime behavior, since the smol-https module requires internal Node.js APIs
 * that are only available in the node-smol binary.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const nodeSmolBuilderDir = path.resolve(__dirname, '..', '..')
const smolHttpsPath = path.join(
  nodeSmolBuilderDir,
  'additions/source-patched/lib/smol-https.js',
)
const smolHttpsTypesPath = path.join(
  nodeSmolBuilderDir,
  'additions/source-patched/typings/node_smol-https.d.ts',
)

describe('node:smol-https module', () => {
  let sourceCode: string

  beforeAll(async () => {
    sourceCode = await fs.readFile(smolHttpsPath, 'utf8')
  })

  describe('module structure', () => {
    it('should be a thin wrapper around smol-http', () => {
      expect(sourceCode).toContain("require('smol-http')")
    })

    it('should import primordials at the top of the file', () => {
      const primordialIndex = sourceCode.indexOf('} = primordials')
      expect(primordialIndex).toBeGreaterThan(0)
      // File has documentation header, so primordials is after the comments
      expect(primordialIndex).toBeLessThan(1000)
    })

    it('should use ObjectFreeze for exported module', () => {
      expect(sourceCode).toContain('module.exports = ObjectFreeze({')
    })

    it('should have __proto__: null in exports', () => {
      expect(sourceCode).toContain('__proto__: null')
    })
  })

  describe('TLS validation', () => {
    it('should require TLS options', () => {
      expect(sourceCode).toContain('node:smol-https requires TLS options')
    })

    it('should throw TypeError when TLS options missing', () => {
      expect(sourceCode).toContain('throw new TypeError(')
    })

    it('should check for key, cert, or tls option', () => {
      expect(sourceCode).toContain('opts.tls')
      expect(sourceCode).toContain('opts.key')
      expect(sourceCode).toContain('opts.cert')
    })

    it('should validate TLS options before calling httpServe', () => {
      // hasTls check should come before httpServe call
      const hasTlsIndex = sourceCode.indexOf('const hasTls')
      const httpServeIndex = sourceCode.indexOf('return httpServe(')
      expect(hasTlsIndex).toBeGreaterThan(0)
      expect(httpServeIndex).toBeGreaterThan(hasTlsIndex)
    })
  })

  describe('default port', () => {
    it('should default to port 443 for HTTPS', () => {
      expect(sourceCode).toContain('opts.port = 443')
    })

    it('should only set default port if not already specified', () => {
      expect(sourceCode).toContain('if (opts.port === undefined)')
    })
  })

  describe('serve() function', () => {
    it('should export serve function', () => {
      expect(sourceCode).toContain('serve,')
      expect(sourceCode).toContain('function serve(options)')
    })

    it('should normalize options with __proto__: null', () => {
      expect(sourceCode).toContain('const opts = { __proto__: null, ...options }')
    })

    it('should call httpServe with options', () => {
      expect(sourceCode).toContain('return httpServe(opts)')
    })
  })

  describe('module exports', () => {
    it('should export serve function', () => {
      expect(sourceCode).toContain('serve,')
    })

    it('should have a frozen default export with serve', () => {
      expect(sourceCode).toContain('default: { __proto__: null, serve }')
    })

    it('should NOT export HTTP utilities (those should come from smol-http)', () => {
      // smol-https is intentionally minimal - utilities come from smol-http
      expect(sourceCode).not.toContain('writeJsonResponse,')
      expect(sourceCode).not.toContain('fastJsonResponse,')
      expect(sourceCode).not.toContain('ETagCache,')
    })
  })

  describe('documentation', () => {
    it('should have JSDoc for serve function', () => {
      expect(sourceCode).toContain('/**')
      expect(sourceCode).toContain('* Create an HTTPS server')
      expect(sourceCode).toContain('@param')
      expect(sourceCode).toContain('@returns')
      expect(sourceCode).toContain('@throws')
    })

    it('should document TLS options', () => {
      expect(sourceCode).toContain('@param {Buffer|string} [options.key]')
      expect(sourceCode).toContain('@param {Buffer|string} [options.cert]')
      expect(sourceCode).toContain('@param {Buffer|string} [options.ca]')
      expect(sourceCode).toContain('@param {string} [options.passphrase]')
      expect(sourceCode).toContain('@param {object} [options.tls]')
    })

    it('should document default port 443', () => {
      expect(sourceCode).toContain('default 443')
    })

    it('should have module-level usage documentation', () => {
      expect(sourceCode).toContain('// node:smol-https')
      expect(sourceCode).toContain('// Usage:')
    })

    it('should reference smol-http for HTTP utilities', () => {
      expect(sourceCode).toContain('import from')
      expect(sourceCode).toContain('node:smol-http directly')
    })
  })

  describe('error messages', () => {
    it('should have helpful error message for missing TLS', () => {
      expect(sourceCode).toContain('node:smol-https requires TLS options')
    })

    it('should suggest using smol-http for non-TLS', () => {
      expect(sourceCode).toContain('For HTTP without TLS, use node:smol-http instead')
    })

    it('should explain valid TLS options in error', () => {
      expect(sourceCode).toContain('Provide key/cert options or a tls options object')
    })
  })
})

describe('node:smol-https TypeScript definitions', () => {
  let typesContent: string
  let typesExist: boolean

  beforeAll(async () => {
    try {
      typesContent = await fs.readFile(smolHttpsTypesPath, 'utf8')
      typesExist = true
    } catch {
      typesExist = false
      typesContent = ''
    }
  })

  it('should have TypeScript definitions file', () => {
    expect(typesExist).toBe(true)
  })

  describe('serve function types', () => {
    it('should export serve function', () => {
      if (!typesExist) return
      expect(typesContent).toContain('export function serve')
    })

    it('should define ServeOptions interface with TLS options', () => {
      if (!typesExist) return
      expect(typesContent).toContain('key?:')
      expect(typesContent).toContain('cert?:')
    })

    it('should return Server type', () => {
      if (!typesExist) return
      expect(typesContent).toContain('Server')
    })
  })

  describe('optional property pattern', () => {
    it('should use foo?: type | undefined pattern for optional properties', () => {
      if (!typesExist) return
      // TLS options should be optional with undefined
      expect(typesContent).toMatch(/key\?:.*\| undefined/)
      expect(typesContent).toMatch(/cert\?:.*\| undefined/)
    })
  })
})
