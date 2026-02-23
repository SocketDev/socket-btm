#!/usr/bin/env node
/**
 * Runs a single WPT test file and outputs JSON results to stdout.
 * Designed to be spawned as a subprocess by validate.mjs.
 *
 * Usage: <binary> run-file.mjs <testFile>
 *
 * This script runs INSIDE the built binary, so globalThis.ReadableStream
 * etc are the patched fast-webstreams versions.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { createContext, runInContext } from 'node:vm'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const WPT_DIR = path.resolve(__dirname, 'streams')

process.on('unhandledRejection', () => {})
process.on('uncaughtException', () => {})

const TEST_TIMEOUT = 2000

const testFile = process.argv[2]
if (!testFile) {
  console.log(
    JSON.stringify({
      file: 'unknown',
      passed: 0,
      failed: 1,
      total: 1,
      errors: ['No test file specified'],
    }),
  )
  process.exitCode = 0
} else {
// Harness implementation (inline to avoid import issues)
function createHarnessGlobals() {
  const tests = []

  function formatMsg(msg) {
    return msg ? `: ${msg}` : ''
  }

  function assert_equals(a, b, msg) {
    if (!Object.is(a, b)) {
      throw new Error(
        `assert_equals: expected ${JSON.stringify(b)} but got ${JSON.stringify(a)}${formatMsg(msg)}`,
      )
    }
  }

  function assert_not_equals(a, b, msg) {
    if (Object.is(a, b)) {
      throw new Error(`assert_not_equals: values are equal${formatMsg(msg)}`)
    }
  }

  function assert_true(val, msg) {
    if (val !== true) {
      throw new Error(
        `assert_true: got ${JSON.stringify(val)}${formatMsg(msg)}`,
      )
    }
  }

  function assert_false(val, msg) {
    if (val !== false) {
      throw new Error(
        `assert_false: got ${JSON.stringify(val)}${formatMsg(msg)}`,
      )
    }
  }

  function assert_array_equals(a, b, msg) {
    if (!Array.isArray(a) && !ArrayBuffer.isView(a)) {
      throw new Error(
        `assert_array_equals: first argument is not array-like${formatMsg(msg)}`,
      )
    }
    if (a.length !== b.length) {
      throw new Error(
        `assert_array_equals: lengths differ (${a.length} vs ${b.length})${formatMsg(msg)}`,
      )
    }
    for (let i = 0; i < a.length; i++) {
      if (!Object.is(a[i], b[i])) {
        throw new Error(
          `assert_array_equals: mismatch at index ${i}${formatMsg(msg)}`,
        )
      }
    }
  }

  function assert_object_equals(a, b, msg) {
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)
    if (keysA.length !== keysB.length) {
      throw new Error(
        `assert_object_equals: key count differs${formatMsg(msg)}`,
      )
    }
    for (const key of keysA) {
      if (!Object.is(a[key], b[key])) {
        throw new Error(
          `assert_object_equals: mismatch at key "${key}"${formatMsg(msg)}`,
        )
      }
    }
  }

  function assert_throws_js(Type, fn, msg) {
    let threw = false
    try {
      fn()
    } catch (e) {
      threw = true
      if (e?.constructor?.name !== Type.name) {
        throw new Error(
          `assert_throws_js: expected ${Type.name} but got ${e?.constructor?.name}${formatMsg(msg)}`,
        )
      }
    }
    if (!threw) {
      throw new Error(
        `assert_throws_js: function did not throw${formatMsg(msg)}`,
      )
    }
  }

  function assert_throws_exactly(val, fn, msg) {
    let threw = false
    try {
      fn()
    } catch (e) {
      threw = true
      if (e !== val) {
        throw new Error(
          `assert_throws_exactly: thrown value does not match${formatMsg(msg)}`,
        )
      }
    }
    if (!threw) {
      throw new Error(
        `assert_throws_exactly: function did not throw${formatMsg(msg)}`,
      )
    }
  }

  function assert_unreached(msg) {
    throw new Error(
      `assert_unreached: ${msg || 'should not have been reached'}`,
    )
  }

  function assert_class_string(obj, expected, msg) {
    const actual = Object.prototype.toString.call(obj)
    const expectedStr = `[object ${expected}]`
    if (actual !== expectedStr) {
      throw new Error(
        `assert_class_string: expected ${expectedStr} but got ${actual}${formatMsg(msg)}`,
      )
    }
  }

  function assert_typeof(val, type, msg) {
    if (typeof val !== type) {
      throw new Error(
        `assert_typeof: expected ${type} but got ${typeof val}${formatMsg(msg)}`,
      )
    }
  }

  function assert_in_array(val, arr, msg) {
    if (!arr.includes(val)) {
      throw new Error(
        `assert_in_array: ${JSON.stringify(val)} not in array${formatMsg(msg)}`,
      )
    }
  }

  function assert_regexp_match(val, re, msg) {
    if (!re.test(val)) {
      throw new Error(
        `assert_regexp_match: ${JSON.stringify(val)} does not match ${re}${formatMsg(msg)}`,
      )
    }
  }

  function assert_less_than(a, b, msg) {
    if (!(a < b)) {
      throw new Error(
        `assert_less_than: ${a} is not less than ${b}${formatMsg(msg)}`,
      )
    }
  }

  function assert_greater_than(a, b, msg) {
    if (!(a > b)) {
      throw new Error(
        `assert_greater_than: ${a} is not greater than ${b}${formatMsg(msg)}`,
      )
    }
  }

  function assert_less_than_equal(a, b, msg) {
    if (!(a <= b)) {
      throw new Error(
        `assert_less_than_equal: ${a} is not <= ${b}${formatMsg(msg)}`,
      )
    }
  }

  function assert_greater_than_equal(a, b, msg) {
    if (!(a >= b)) {
      throw new Error(
        `assert_greater_than_equal: ${a} is not >= ${b}${formatMsg(msg)}`,
      )
    }
  }

  async function promise_rejects_js(_t, Type, promise, msg) {
    try {
      await promise
      throw new Error(
        `promise_rejects_js: promise did not reject${formatMsg(msg)}`,
      )
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('promise_rejects_js:')) {
        throw e
      }
      if (e?.constructor?.name !== Type.name) {
        throw new Error(
          `promise_rejects_js: expected ${Type.name} but got ${e?.constructor?.name}${formatMsg(msg)}`,
        )
      }
    }
  }

  async function promise_rejects_dom(_t, name, promise, msg) {
    try {
      await promise
      throw new Error(
        `promise_rejects_dom: promise did not reject${formatMsg(msg)}`,
      )
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('promise_rejects_dom:')) {
        throw e
      }
      if (!(e instanceof DOMException)) {
        throw new Error(
          `promise_rejects_dom: expected DOMException but got ${e?.constructor?.name}${formatMsg(msg)}`,
        )
      }
      if (e.name !== name) {
        throw new Error(
          `promise_rejects_dom: expected name "${name}" but got "${e.name}"${formatMsg(msg)}`,
        )
      }
    }
  }

  async function promise_rejects_exactly(_t, val, promise, msg) {
    try {
      await promise
      throw new Error(
        `promise_rejects_exactly: promise did not reject${formatMsg(msg)}`,
      )
    } catch (e) {
      if (
        e instanceof Error &&
        e.message.startsWith('promise_rejects_exactly:')
      ) {
        throw e
      }
      if (e !== val) {
        throw new Error(
          `promise_rejects_exactly: rejection value does not match${formatMsg(msg)}`,
        )
      }
    }
  }

  function test(fn, description) {
    tests.push({
      type: 'sync',
      fn,
      description: description || '(unnamed test)',
    })
  }

  function promise_test(fn, description) {
    tests.push({
      type: 'promise',
      fn,
      description: description || '(unnamed promise_test)',
    })
  }

  function async_test(description) {
    let resolveDone
    let rejectDone
    const donePromise = new Promise((resolve, reject) => {
      resolveDone = resolve
      rejectDone = reject
    })

    const t = {
      step(fn) {
        try {
          fn()
        } catch (e) {
          rejectDone(e)
        }
      },
      step_func(fn) {
        return (...args) => {
          try {
            return fn(...args)
          } catch (e) {
            rejectDone(e)
          }
        }
      },
      step_func_done(fn) {
        return (...args) => {
          try {
            if (fn) {
              fn(...args)
            }
            resolveDone()
          } catch (e) {
            rejectDone(e)
          }
        }
      },
      unreached_func(msg) {
        return () => rejectDone(new Error(`unreached: ${msg}`))
      },
      done() {
        resolveDone()
      },
      step_timeout(fn, ms) {
        return setTimeout(() => {
          try {
            fn()
          } catch (e) {
            rejectDone(e)
          }
        }, ms)
      },
    }

    tests.push({
      type: 'async',
      t,
      donePromise,
      description: description || '(unnamed async_test)',
    })
    return t
  }

  const step_timeout = (fn, ms) => setTimeout(fn, ms)

  // Use globalThis streams - these are the patched fast-webstreams in the binary
  const globals = {
    ReadableStream: globalThis.ReadableStream,
    WritableStream: globalThis.WritableStream,
    TransformStream: globalThis.TransformStream,
    ByteLengthQueuingStrategy: globalThis.ByteLengthQueuingStrategy,
    CountQueuingStrategy: globalThis.CountQueuingStrategy,
    test,
    promise_test,
    async_test,
    assert_equals,
    assert_not_equals,
    assert_true,
    assert_false,
    assert_array_equals,
    assert_object_equals,
    assert_throws_js,
    assert_throws_exactly,
    assert_unreached,
    assert_class_string,
    assert_typeof,
    assert_in_array,
    assert_regexp_match,
    assert_less_than,
    assert_greater_than,
    assert_less_than_equal,
    assert_greater_than_equal,
    promise_rejects_js,
    promise_rejects_dom,
    promise_rejects_exactly,
    step_timeout,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    queueMicrotask: globalThis.queueMicrotask,
    Promise,
    Error,
    TypeError,
    RangeError,
    Uint8Array,
    Uint16Array,
    Int8Array,
    Int32Array,
    Float32Array,
    Float64Array,
    ArrayBuffer,
    SharedArrayBuffer: globalThis.SharedArrayBuffer,
    DataView,
    Map,
    Set,
    WeakRef: globalThis.WeakRef,
    structuredClone: globalThis.structuredClone,
    console,
    Object,
    Symbol,
    JSON,
    Number,
    String,
    Array,
    Math,
    BigInt,
    Proxy,
    Reflect,
    Date,
    RegExp,
    undefined,
    NaN,
    Infinity,
    isNaN,
    isFinite,
    parseInt,
    parseFloat,
    encodeURIComponent,
    decodeURIComponent,
    gc: globalThis.gc,
    Boolean,
    Function,
    WeakMap,
    BigUint64Array: globalThis.BigUint64Array,
    BigInt64Array: globalThis.BigInt64Array,
    ReadableStreamBYOBReader: globalThis.ReadableStreamBYOBReader,
    ReadableByteStreamController: globalThis.ReadableByteStreamController,
    ReadableStreamDefaultController: globalThis.ReadableStreamDefaultController,
    ReadableStreamDefaultReader: globalThis.ReadableStreamDefaultReader,
    WritableStreamDefaultWriter: globalThis.WritableStreamDefaultWriter,
    WritableStreamDefaultController: globalThis.WritableStreamDefaultController,
    TransformStreamDefaultController:
      globalThis.TransformStreamDefaultController,
    AbortController: globalThis.AbortController,
    AbortSignal: globalThis.AbortSignal,
    DOMException: globalThis.DOMException,
    TextEncoder: globalThis.TextEncoder,
    TextDecoder: globalThis.TextDecoder,
    MessageChannel: globalThis.MessageChannel,
    atob: globalThis.atob,
    btoa: globalThis.btoa,
  }

  globals.self = globals
  return { globals, tests }
}

async function run() {
  const relPath = path.relative(WPT_DIR, testFile)
  const testDir = path.dirname(testFile)
  const content = readFileSync(testFile, 'utf8')

  // Parse META scripts
  const metaScripts = []
  for (const line of content.split('\n')) {
    const match = line.match(/^\/\/\s*META:\s*script=(.+)$/)
    if (match) {
      metaScripts.push(path.resolve(testDir, match[1].trim()))
    }
    if (
      !line.startsWith('//') &&
      line.trim() !== '' &&
      !line.startsWith("'use strict'")
    ) {
      break
    }
  }

  const { globals, tests } = createHarnessGlobals()
  const ctx = createContext(globals)
  ctx.self = ctx

  // Load META scripts
  for (const script of metaScripts) {
    try {
      runInContext(readFileSync(script, 'utf8'), ctx, {
        filename: script,
        timeout: 5000,
      })
    } catch (err) {
      output({
        file: relPath,
        passed: 0,
        failed: 1,
        total: 1,
        errors: [`META load failed: ${err.message}`],
      })
      return
    }
  }

  // Run test file
  try {
    runInContext(content, ctx, { filename: testFile, timeout: 5000 })
  } catch (err) {
    output({
      file: relPath,
      passed: 0,
      failed: 1,
      total: 1,
      errors: [`Execute failed: ${err.message}`],
    })
    return
  }

  // Execute collected tests
  let passed = 0
  let failed = 0
  const errors = []

  for (const t of tests) {
    try {
      if (t.type === 'sync') {
        const testObj = {
          step(fn) {
            return fn()
          },
          step_func(fn) {
            return fn
          },
          step_func_done(fn) {
            return fn || (() => {})
          },
          unreached_func(msg) {
            return () => {
              throw new Error(`unreached: ${msg}`)
            }
          },
          step_timeout: setTimeout,
          add_cleanup() {},
        }
        t.fn(testObj)
        passed++
      } else if (t.type === 'promise') {
        const cleanups = []
        const testObj = {
          step(fn) {
            return fn()
          },
          step_func(fn) {
            return fn
          },
          step_func_done(fn) {
            return fn || (() => {})
          },
          unreached_func(msg) {
            return () => {
              throw new Error(`unreached: ${msg}`)
            }
          },
          step_timeout: setTimeout,
          add_cleanup(fn) {
            cleanups.push(fn)
          },
        }
        try {
          await Promise.race([
            Promise.resolve(t.fn(testObj)),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('timeout')), TEST_TIMEOUT),
            ),
          ])
        } finally {
          for (const fn of cleanups) {
            try {
              fn()
            } catch {}
          }
        }
        passed++
      } else if (t.type === 'async') {
        await Promise.race([
          t.donePromise,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), TEST_TIMEOUT),
          ),
        ])
        passed++
      }
    } catch (err) {
      failed++
      errors.push(`${t.description}: ${err?.message ?? String(err)}`)
    }
  }

  output({ file: relPath, passed, failed, total: tests.length, errors })
}

function output(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

  run().then(() => {
    setTimeout(() => {
      process.exitCode = 0
    }, 100)
  })
}
