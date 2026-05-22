# smol-webgpu.js -- Public API for WebGPU (node:smol-webgpu) — STUB

## What This File Does

This is the entry point for `require('node:smol-webgpu')`. It exposes
the W3C WebGPU surface so userland code that imports it resolves.
**Currently a stub** — every method except `isAvailable()` throws
until Dawn integration lands.

## How It Fits Together

```
require('node:smol-webgpu') -> this file (smol-webgpu.js)
  -> internalBinding('smol_webgpu') (C++ stub binding)
    -> (future) Dawn (Chromium's WebGPU implementation)
```

The C++ binding lives at
`additions/source-patched/src/socketsecurity/webgpu/webgpu_binding.cc`.
Every method except `isAvailable()` calls `ThrowPending()` which raises
an Error pointing at the design doc. `isAvailable()` returns `false`.

When Dawn is wired (Phase C work), this binding gets replaced with a
real implementation that wraps Dawn's `src/dawn/node/binding/` surface.
Userland code that uses the API with `isAvailable()` guards will work
unchanged.

## Public API

```ts
import {
  isAvailable,
  createInstance,
  requestAdapter,
  requestDevice,
  getPreferredCanvasFormat,
} from 'node:smol-webgpu'

// Feature detection — always check before using the rest.
if (!isAvailable()) {
  // Fall back to userland shim, or skip WebGPU features.
  return
}

const adapter = await requestAdapter({ powerPreference: 'high-performance' })
const device = await adapter.requestDevice()
const format = getPreferredCanvasFormat()
// ... use device per the WebGPU IDL
```

## Design Choices

**Stub-first, Dawn-later.** Dawn is ~436 MB cloned and pulls Tint +
SPIRV-Tools + per-platform GPU drivers; first compile is hours.
Shipping the stub now lets:

1. Userland code reference `node:smol-webgpu` in imports without the
   resolver crashing.
2. Feature-detection patterns (the `isAvailable()` guard) get
   established before users start writing WebGPU code.
3. Tooling (TypeScript types, doc generators, linters) discover the
   surface.

When Dawn lands, only the C++ binding changes; this file and consumer
code stay the same.

**`isAvailable()` returns false today.** This is the contract: callers
that respect it never hit the throwing code paths in the stub. Bad
callers (those that skip the check) get a structured error pointing at
the design doc — actionable rather than `TypeError: undefined is not a
function`.

**Surface mirrors W3C WebGPU IDL.** Function names are 1:1 with
<https://www.w3.org/TR/webgpu/>. When Dawn ships, the surface grows to
include GPUAdapter / GPUDevice / GPUCommandEncoder / GPURenderPassEncoder
/ etc. — all reachable via the existing entry points.

## Where the Real Work Happens (future)

- Dawn upstream: <https://dawn.googlesource.com/dawn>
- Dawn's Node.js binding: <https://dawn.googlesource.com/dawn/+/refs/heads/main/src/dawn/node/>
- Integration design: `.claude/plans/opentui-smol-tui-completion.md`
  Phase C.

The integration is a separate multi-week effort tracked in the plan
doc. This stub is the contract; Dawn is the implementation.
