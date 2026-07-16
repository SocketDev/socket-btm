/**
 * WPT testharness.js polyfill, composed as TEXT (not imported).
 *
 * The host-side runner (test/scripts/wpt-streams-runner.mts) reads this file
 * with readFileSync and concatenates it with the WPT META scripts and the test
 * source, then runs the whole thing via `<binary> -e <composed script>` — the
 * same shape the test262 runner uses (see
 * packages/temporal-infra/test/scripts/test262/harness.mts).
 *
 * Because this file is concatenated as text and never loaded as a module entry
 * point, the built node-smol binary's `--without-amaro` (no TS stripping)
 * constraint does NOT apply here. It stays plain .js for normal editing + lint,
 * not because the binary couldn't strip it.
 *
 * The test runs in the binary's MAIN realm, so globalThis.ReadableStream (and
 * the rest) are the patched fast-webstreams versions. `self` is aliased to
 * globalThis. Tests register via test()/promise_test()/ async_test(); the
 * runner appends an epilogue (see RUN_EPILOGUE in the .mts runner) that drains
 * __wptTests and prints one JSON result line.
 */

// WPT tests reference `self` as the global object (e.g.
// `self.readableStreamDefaultController = c`). The node-smol binary
// exposes it, but stock `node -e` does not — bootstrap from globalThis
// so the harness works in either runtime.
var self = globalThis.self ?? globalThis
self.self = self

const __wptTests = []
self.__wptTests = __wptTests

self.__WPT_TEST_TIMEOUT = 2000

// Crash containment: WPT tests legitimately create rejections that a later
// subtest handles, and buggy stream paths create ones nothing ever handles.
// Under `node -e` the default --unhandled-rejections=throw kills the whole
// file before any per-test results print. Track them instead; RUN_EPILOGUE
// folds any still-unhandled ones into a synthetic failing entry.
self.__wptUnhandled = []
process.on('unhandledRejection', reason => {
  self.__wptUnhandled.push(reason)
})
process.on('rejectionHandled', () => {
  self.__wptUnhandled.pop()
})

function formatMsg(msg) {
  return msg ? `: ${msg}` : ''
}

// JSON.stringify throws on BigInt and cyclic values and prints undefined for
// undefined — fall back to String() so an assertion FAILURE message can never
// itself throw and mask the real result.
function fmt(v) {
  try {
    return JSON.stringify(v) ?? String(v)
  } catch {
    return String(v)
  }
}

self.assert_equals = function assert_equals(a, b, msg) {
  if (!Object.is(a, b)) {
    throw new Error(
      `assert_equals: expected ${fmt(b)} but got ${fmt(a)}${formatMsg(msg)}`,
    )
  }
}

self.assert_not_equals = function assert_not_equals(a, b, msg) {
  if (Object.is(a, b)) {
    throw new Error(`assert_not_equals: values are equal${formatMsg(msg)}`)
  }
}

self.assert_true = function assert_true(val, msg) {
  if (val !== true) {
    throw new Error(`assert_true: got ${fmt(val)}${formatMsg(msg)}`)
  }
}

self.assert_false = function assert_false(val, msg) {
  if (val !== false) {
    throw new Error(`assert_false: got ${fmt(val)}${formatMsg(msg)}`)
  }
}

self.assert_array_equals = function assert_array_equals(a, b, msg) {
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

self.assert_object_equals = function assert_object_equals(a, b, msg) {
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  if (keysA.length !== keysB.length) {
    throw new Error(`assert_object_equals: key count differs${formatMsg(msg)}`)
  }
  for (const key of keysA) {
    if (!Object.is(a[key], b[key])) {
      throw new Error(
        `assert_object_equals: mismatch at key "${key}"${formatMsg(msg)}`,
      )
    }
  }
}

self.assert_throws_js = function assert_throws_js(Type, fn, msg) {
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
    throw new Error(`assert_throws_js: function did not throw${formatMsg(msg)}`)
  }
}

self.assert_throws_exactly = function assert_throws_exactly(val, fn, msg) {
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

self.assert_unreached = function assert_unreached(msg) {
  throw new Error(`assert_unreached: ${msg || 'should not have been reached'}`)
}

self.assert_class_string = function assert_class_string(obj, expected, msg) {
  const actual = Object.prototype.toString.call(obj)
  const expectedStr = `[object ${expected}]`
  if (actual !== expectedStr) {
    throw new Error(
      `assert_class_string: expected ${expectedStr} but got ${actual}${formatMsg(msg)}`,
    )
  }
}

self.assert_typeof = function assert_typeof(val, type, msg) {
  if (typeof val !== type) {
    throw new Error(
      `assert_typeof: expected ${type} but got ${typeof val}${formatMsg(msg)}`,
    )
  }
}

self.assert_in_array = function assert_in_array(val, arr, msg) {
  if (!arr.includes(val)) {
    throw new Error(
      `assert_in_array: ${fmt(val)} not in array${formatMsg(msg)}`,
    )
  }
}

self.assert_regexp_match = function assert_regexp_match(val, re, msg) {
  if (!re.test(val)) {
    throw new Error(
      `assert_regexp_match: ${fmt(val)} does not match ${re}${formatMsg(msg)}`,
    )
  }
}

self.assert_less_than = function assert_less_than(a, b, msg) {
  if (!(a < b)) {
    throw new Error(
      `assert_less_than: ${a} is not less than ${b}${formatMsg(msg)}`,
    )
  }
}

self.assert_greater_than = function assert_greater_than(a, b, msg) {
  if (!(a > b)) {
    throw new Error(
      `assert_greater_than: ${a} is not greater than ${b}${formatMsg(msg)}`,
    )
  }
}

self.assert_less_than_equal = function assert_less_than_equal(a, b, msg) {
  if (!(a <= b)) {
    throw new Error(
      `assert_less_than_equal: ${a} is not <= ${b}${formatMsg(msg)}`,
    )
  }
}

self.assert_greater_than_equal = function assert_greater_than_equal(a, b, msg) {
  if (!(a >= b)) {
    throw new Error(
      `assert_greater_than_equal: ${a} is not >= ${b}${formatMsg(msg)}`,
    )
  }
}

self.promise_rejects_js = async function promise_rejects_js(
  _t,
  Type,
  promise,
  msg,
) {
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

self.promise_rejects_dom = async function promise_rejects_dom(
  _t,
  name,
  promise,
  msg,
) {
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

self.promise_rejects_exactly = async function promise_rejects_exactly(
  _t,
  val,
  promise,
  msg,
) {
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

self.test = function test(fn, description) {
  __wptTests.push({
    type: 'sync',
    fn,
    description: description || '(unnamed test)',
  })
}

self.promise_test = function promise_test(fn, description) {
  __wptTests.push({
    type: 'promise',
    fn,
    description: description || '(unnamed promise_test)',
  })
}

self.async_test = function async_test(description) {
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

  __wptTests.push({
    type: 'async',
    t,
    donePromise,
    description: description || '(unnamed async_test)',
  })
  return t
}

self.step_timeout = function step_timeout(fn, ms) {
  return setTimeout(fn, ms)
}
