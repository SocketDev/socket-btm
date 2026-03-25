// Core Node.js modules
import 'node:fs'
import 'node:path'
import 'node:os'

// smol-* modules — these require native bindings compiled into the binary.
// If any import fails, the smol_http binding was not compiled.
import { serve } from 'node:smol-http'
import { serve as serveHttps } from 'node:smol-https'

if (typeof serve !== 'function') {
  throw new Error('node:smol-http serve is not a function')
}
if (typeof serveHttps !== 'function') {
  throw new Error('node:smol-https serve is not a function')
}

// Verify the native binding is functional — not just loaded.
// Start a server, make a request, stop it. This exercises the full
// C++ binding chain: Initialize → createRouter → addRoute → matchRoute
// → writeJsonResponse / writeTextResponse.
const server = serve({
  port: 0, // OS-assigned port
  routes: {
    '/smoke': () => ({ ok: true }),
  },
  fetch() {
    return undefined
  },
})

const res = await fetch(`http://localhost:${server.port}/smoke`)
const body = await res.json()

server.stop()

if (!body || body.ok !== true) {
  throw new Error(`Smoke test failed: expected { ok: true }, got ${JSON.stringify(body)}`)
}

console.log('Built-in modules loaded')
