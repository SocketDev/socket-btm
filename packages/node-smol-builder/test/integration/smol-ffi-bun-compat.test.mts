/**
 * @fileoverview Verify-build tests for node:smol-ffi/bun.
 *
 * Compatibility shim implementing the bun:ffi public surface
 * (https://bun.sh/docs/api/ffi) atop the canonical smol-ffi internals.
 *
 * The /bun layer is a pure-JS adapter — there is no bun runtime
 * involved. Tests assert the surface shape (FFIType, CString,
 * dlopen-by-defs, read namespace, suffix, etc.) and the Phase-2
 * deferral of JSCallback / CFunction / linkSymbols (each throws
 * FFIError(code=ENOTIMPL)).
 *
 * Skips entirely if the Final/ binary doesn't have smol_ffi wired in
 * (gate via the canonical smol-ffi binding, since /bun is registered
 * alongside in the same patch hunk).
 */

import {
  runOnSmolBinary,
  smolBuiltinIsAvailable,
} from '../helpers/smol-builtin.mts'

const skipTests = !smolBuiltinIsAvailable('smol-ffi')

describe.skipIf(skipTests)('node:smol-ffi/bun integration', () => {
  it("isBuiltin('node:smol-ffi/bun') returns true; bare returns false", async () => {
    const script = `
      const { isBuiltin } = require('node:module')
      console.log('isBuiltin(node:smol-ffi/bun)=' + isBuiltin('node:smol-ffi/bun'))
      console.log('isBuiltin(smol-ffi/bun)=' + isBuiltin('smol-ffi/bun'))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('isBuiltin(node:smol-ffi/bun)=true')
    expect(stdout).toContain('isBuiltin(smol-ffi/bun)=false')
  })

  it('module is loadable, frozen, and null-prototype', async () => {
    const script = `
      const m = require('node:smol-ffi/bun')
      console.log('frozen=' + Object.isFrozen(m))
      console.log('proto=' + Object.getPrototypeOf(m))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('frozen=true')
    expect(stdout).toContain('proto=null')
  })

  it('exports the documented bun-compat surface', async () => {
    const script = `
      const m = require('node:smol-ffi/bun')
      const keys = Object.keys(m).sort()
      console.log('keys=' + keys.join(','))
      console.log('dlopen=' + typeof m.dlopen)
      console.log('FFIType=' + typeof m.FFIType)
      console.log('CString=' + typeof m.CString)
      console.log('JSCallback=' + typeof m.JSCallback)
      console.log('CFunction=' + typeof m.CFunction)
      console.log('linkSymbols=' + typeof m.linkSymbols)
      console.log('ptr=' + typeof m.ptr)
      console.log('toArrayBuffer=' + typeof m.toArrayBuffer)
      console.log('toBuffer=' + typeof m.toBuffer)
      console.log('read=' + typeof m.read)
      console.log('suffix=' + typeof m.suffix)
      console.log('FFIError=' + typeof m.FFIError)
      console.log('FFI_ERROR_CODES=' + typeof m.FFI_ERROR_CODES)
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('dlopen=function')
    expect(stdout).toContain('FFIType=object')
    expect(stdout).toContain('CString=function')
    expect(stdout).toContain('JSCallback=function')
    expect(stdout).toContain('CFunction=function')
    expect(stdout).toContain('linkSymbols=function')
    expect(stdout).toContain('ptr=function')
    expect(stdout).toContain('toArrayBuffer=function')
    expect(stdout).toContain('toBuffer=function')
    expect(stdout).toContain('read=object')
    expect(stdout).toContain('suffix=string')
    expect(stdout).toContain('FFIError=function')
    expect(stdout).toContain('FFI_ERROR_CODES=object')
  })

  it('FFIType maps bun aliases to canonical smol-ffi types', async () => {
    const script = `
      const { FFIType } = require('node:smol-ffi/bun')
      console.log('frozen=' + Object.isFrozen(FFIType))
      console.log('i32=' + FFIType.i32)
      console.log('int32_t=' + FFIType.int32_t)
      console.log('int=' + FFIType.int)
      console.log('u64=' + FFIType.u64)
      console.log('uint64_t=' + FFIType.uint64_t)
      console.log('cstring=' + FFIType.cstring)
      console.log('ptr=' + FFIType.ptr)
      console.log('pointer=' + FFIType.pointer)
      console.log('void-star=' + FFIType['void*'])
      console.log('char-star=' + FFIType['char*'])
      console.log('bool=' + FFIType.bool)
      console.log('float=' + FFIType.float)
      console.log('double=' + FFIType.double)
      console.log('buffer=' + FFIType.buffer)
      console.log('function=' + FFIType.function)
      console.log('fn=' + FFIType.fn)
      console.log('callback=' + FFIType.callback)
      console.log('napi_env=' + FFIType.napi_env)
      console.log('napi_value=' + FFIType.napi_value)
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('frozen=true')
    expect(stdout).toContain('i32=i32')
    expect(stdout).toContain('int32_t=i32')
    expect(stdout).toContain('int=i32')
    expect(stdout).toContain('u64=u64')
    expect(stdout).toContain('uint64_t=u64')
    expect(stdout).toContain('cstring=string')
    expect(stdout).toContain('ptr=pointer')
    expect(stdout).toContain('pointer=pointer')
    expect(stdout).toContain('void-star=pointer')
    expect(stdout).toContain('char-star=pointer')
    expect(stdout).toContain('bool=bool')
    expect(stdout).toContain('float=f32')
    expect(stdout).toContain('double=f64')
    expect(stdout).toContain('buffer=buffer')
    expect(stdout).toContain('function=pointer')
    expect(stdout).toContain('fn=pointer')
    expect(stdout).toContain('callback=pointer')
    expect(stdout).toContain('napi_env=pointer')
    expect(stdout).toContain('napi_value=pointer')
  })

  it('CString reads UTF-8 from a pointer until NUL', async () => {
    const script = `
      const { CString, ptr } = require('node:smol-ffi/bun')
      // "hello world" + NUL + trailing junk that must not be read.
      const buf = Buffer.from('hello world\\x00ignored', 'utf8')
      const p = ptr(buf)
      const s = new CString(p)
      console.log('s=' + s)
      console.log('len=' + s.length)
      console.log('isString=' + (s instanceof String))
      console.log('hasPtr=' + (typeof s.ptr === 'bigint'))
      console.log('byteOffset=' + s.byteOffset)
    `
    const { code, stdout, stderr } = await runOnSmolBinary(script)
    expect(stderr).toBe('')
    expect(code).toBe(0)
    expect(stdout).toContain('s=hello world')
    expect(stdout).toContain('len=11')
    expect(stdout).toContain('isString=true')
    expect(stdout).toContain('hasPtr=true')
    expect(stdout).toContain('byteOffset=0')
  })

  it('CString with byteLength stops at first NUL within the window', async () => {
    const script = `
      const { CString, ptr } = require('node:smol-ffi/bun')
      // Bytes: 'h','i',NUL,'X','Y'. byteLength=5; want 'hi', not 'hi\\0XY'.
      const buf = Buffer.from([0x68, 0x69, 0x00, 0x58, 0x59])
      const p = ptr(buf)
      const s = new CString(p, 0, 5)
      console.log('s=' + s)
      console.log('len=' + s.length)
    `
    const { code, stdout, stderr } = await runOnSmolBinary(script)
    expect(stderr).toBe('')
    expect(code).toBe(0)
    expect(stdout).toContain('s=hi')
    expect(stdout).toContain('len=2')
  })

  it('CString rejects null pointer with FFIError code EBADPTR', async () => {
    const script = `
      const { CString, FFIError } = require('node:smol-ffi/bun')
      try {
        new CString(0n)
        console.log('UNEXPECTED-OK')
      } catch (e) {
        console.log('isFFIError=' + (e instanceof FFIError))
        console.log('code=' + e.code)
      }
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).not.toContain('UNEXPECTED-OK')
    expect(stdout).toContain('isFFIError=true')
    expect(stdout).toContain('code=EBADPTR')
  })

  it('read namespace is the same as on canonical smol-ffi', async () => {
    const script = `
      const bun = require('node:smol-ffi/bun')
      const ffi = require('node:smol-ffi')
      console.log('same=' + (bun.read === ffi.read))
      console.log('i32=' + (bun.read.i32 === ffi.getInt32))
      console.log('batch=' + (typeof bun.read.batch === 'function'))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('same=true')
    expect(stdout).toContain('i32=true')
    expect(stdout).toContain('batch=true')
  })

  it('JSCallback throws ENOTIMPL (Phase 2 deferral)', async () => {
    const script = `
      const { JSCallback, FFIError } = require('node:smol-ffi/bun')
      try {
        new JSCallback(() => {}, { args: [], returns: 'void' })
        console.log('UNEXPECTED-OK')
      } catch (e) {
        console.log('isFFIError=' + (e instanceof FFIError))
        console.log('code=' + e.code)
      }
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).not.toContain('UNEXPECTED-OK')
    expect(stdout).toContain('isFFIError=true')
    expect(stdout).toContain('code=ENOTIMPL')
  })

  it('CFunction throws ENOTIMPL (Phase 2 deferral)', async () => {
    const script = `
      const { CFunction, FFIError } = require('node:smol-ffi/bun')
      try {
        CFunction({ returns: 'i32', args: [], ptr: 0n })
        console.log('UNEXPECTED-OK')
      } catch (e) {
        console.log('isFFIError=' + (e instanceof FFIError))
        console.log('code=' + e.code)
      }
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).not.toContain('UNEXPECTED-OK')
    expect(stdout).toContain('isFFIError=true')
    expect(stdout).toContain('code=ENOTIMPL')
  })

  it('linkSymbols throws ENOTIMPL (Phase 2 deferral)', async () => {
    const script = `
      const { linkSymbols, FFIError } = require('node:smol-ffi/bun')
      try {
        linkSymbols({})
        console.log('UNEXPECTED-OK')
      } catch (e) {
        console.log('isFFIError=' + (e instanceof FFIError))
        console.log('code=' + e.code)
      }
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).not.toContain('UNEXPECTED-OK')
    expect(stdout).toContain('isFFIError=true')
    expect(stdout).toContain('code=ENOTIMPL')
  })

  it('suffix is the platform-correct shared-lib extension', async () => {
    const script = `
      const { suffix } = require('node:smol-ffi/bun')
      console.log('suffix=' + suffix)
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    const expected =
      process.platform === 'win32'
        ? 'dll'
        : process.platform === 'darwin'
          ? 'dylib'
          : 'so'
    expect(stdout).toContain(`suffix=${expected}`)
  })

  it('ptr(buffer) returns a BigInt pointer matching bufferToPtr', async () => {
    const script = `
      const bun = require('node:smol-ffi/bun')
      const ffi = require('node:smol-ffi')
      const buf = Buffer.alloc(16)
      const a = bun.ptr(buf)
      const b = ffi.bufferToPtr(buf)
      console.log('isBigInt=' + (typeof a === 'bigint'))
      console.log('equal=' + (a === b))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('isBigInt=true')
    expect(stdout).toContain('equal=true')
  })

  it('toBuffer copies bytes from a pointer', async () => {
    const script = `
      const bun = require('node:smol-ffi/bun')
      const src = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])
      const p = bun.ptr(src)
      const out = bun.toBuffer(p, 0, 8)
      console.log('len=' + out.length)
      console.log('bytes=' + Array.from(out).join(','))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('len=8')
    expect(stdout).toContain('bytes=1,2,3,4,5,6,7,8')
  })

  it('toArrayBuffer copies bytes from a pointer', async () => {
    const script = `
      const bun = require('node:smol-ffi/bun')
      const src = Buffer.from([10, 20, 30, 40])
      const p = bun.ptr(src)
      const ab = bun.toArrayBuffer(p, 0, 4)
      const view = new Uint8Array(ab)
      console.log('len=' + view.length)
      console.log('bytes=' + Array.from(view).join(','))
    `
    const { code, stdout } = await runOnSmolBinary(script)
    expect(code).toBe(0)
    expect(stdout).toContain('len=4')
    expect(stdout).toContain('bytes=10,20,30,40')
  })

  it('rejects bare `smol-ffi/bun` with MODULE_NOT_FOUND', async () => {
    const script = `
      try {
        require('smol-ffi/bun')
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

  it.skipIf(process.platform !== 'darwin')(
    'dlopen reshapes smol-ffi.open into bun-style { symbols, close }',
    async () => {
      const script = `
        const { dlopen, FFIType } = require('node:smol-ffi/bun')
        const lib = dlopen('/usr/lib/libSystem.B.dylib', {
          abs: { args: [FFIType.i32], returns: FFIType.i32 },
        })
        console.log('hasSymbols=' + (typeof lib.symbols === 'object'))
        console.log('hasClose=' + (typeof lib.close === 'function'))
        console.log('abs5=' + lib.symbols.abs(-5))
        console.log('abs0=' + lib.symbols.abs(0))
        lib.close()
      `
      const { code, stdout, stderr } = await runOnSmolBinary(script)
      expect(stderr).toBe('')
      expect(code).toBe(0)
      expect(stdout).toContain('hasSymbols=true')
      expect(stdout).toContain('hasClose=true')
      expect(stdout).toContain('abs5=5')
      expect(stdout).toContain('abs0=0')
    },
  )
})
