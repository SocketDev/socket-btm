# smol-util.js -- Public API for fast primordial helpers (node:smol-util)

## What This File Does

This is the entry point for `require('node:smol-util')`. It re-exports
five C++-backed helpers that replace common JS patterns (BoundFunction
adapter, Function.prototype.{call,apply} trampoline, try/catch around
WeakRef construction) with single V8 dispatches that bypass the
trampolines entirely.

## How It Fits Together

```text
require('node:smol-util') -> this file (smol-util.js)
  -> require('internal/socketsecurity/util') (frozen, null-prototype barrel)
    -> internalBinding('smol_util') (C++ native binding)
```

The C++ binding lives at
`additions/source-patched/src/socketsecurity/util/util_binding.cc`.
Each entry installs a v8::FunctionTemplate whose call handler reads
state captured at register time via `args.Data()` and invokes the
target through `v8::Function::Call` (or `Function::NewInstance` for
`weakRefSafe`) directly.

## Public API

```ts
import {
  applyBind,
  applySafe,
  bindCall,
  uncurryThis,
  weakRefSafe,
} from 'node:smol-util'

// uncurryThis(fn): single-dispatch fn.call(self, ...args).
const slice = uncurryThis(String.prototype.slice)
slice('hello', 0, 3) // 'hel'

// applyBind(fn): single-dispatch fn.apply(self, args).
const concat = applyBind(Array.prototype.concat)
concat([1, 2], [[3, 4]]) // [1, 2, 3, 4]

// bindCall(fn, this, ...preset): partial-apply with bound this.
const greet = bindCall(
  function (greeting, name) {
    return `${greeting}, ${name}`
  },
  null,
  'Hello',
)
greet('world') // 'Hello, world'

// applySafe(fn): like applyBind but swallows synchronous throws.
const swallow = applySafe(() => {
  throw new Error('boom')
})
swallow(null, []) // undefined (no propagation)

// weakRefSafe(target): like new WeakRef(target) but undefined on
// non-wrappable inputs instead of throwing.
weakRefSafe({ x: 1 }) // WeakRef instance
weakRefSafe(42) // undefined
weakRefSafe(Symbol.for('registered')) // undefined
```

## Design Choices

The native form bypasses **two** JS-level trampolines for
uncurryThis/applyBind. The classic JS form

```js
const uncurryThis = Function.prototype.bind.bind(Function.prototype.call)
const slice = uncurryThis(String.prototype.slice)
slice('hi', 0, 1) // 'h'
```

walks through a BoundFunction wrapper (V8 has to remember "this should
be String.prototype.slice", copy args, then call Function.prototype.call)
AND through Function.prototype.call (re-dispatches with the right this
and args). Two dispatches per call. The native form captures the target
at register time and calls through it once via args.Data(). One
dispatch.

`applySafe` and `weakRefSafe` adopt the project-wide `Safe` suffix
convention -- non-throwing wrappers end in `Safe`. See template
CLAUDE.md "Code style" for the rule.

## Where the Real Work Happens

The native binding has the full design rationale at the top of
`util_binding.cc`. Each entry has its own section explaining the
single-dispatch shape, the args.Data() capture pattern, and why the
work it replaces benefits from skipping V8's BoundFunction adapter.
