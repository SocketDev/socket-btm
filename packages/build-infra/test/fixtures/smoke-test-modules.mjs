// Core Node.js modules
import 'node:fs'
import 'node:path'
import 'node:os'

// smol-* modules — verify all bindings compiled into the binary.
import { serve } from 'node:smol-http'
import { serve as serveHttps } from 'node:smol-https'
import { parse as parsePurl } from 'node:smol-purl'
import { valid as semverValid } from 'node:smol-versions'
import smolVfs from 'node:smol-vfs'

// Verify exports are functions
if (typeof serve !== 'function') throw new Error('node:smol-http serve missing')
if (typeof serveHttps !== 'function') throw new Error('node:smol-https serve missing')
if (typeof parsePurl !== 'function') throw new Error('node:smol-purl parse missing')
if (typeof semverValid !== 'function') throw new Error('node:smol-versions valid missing')
if (typeof smolVfs.hasVFS !== 'function') throw new Error('node:smol-vfs hasVFS missing')

// Functional checks — verify bindings actually work, not just load
const purl = parsePurl('pkg:npm/%40socket/cli@1.0.0')
if (!purl || purl.type !== 'npm' || purl.name !== 'cli') {
  throw new Error(`smol-purl parse failed: ${JSON.stringify(purl)}`)
}

if (semverValid('1.2.3') !== '1.2.3') {
  throw new Error(`smol-versions valid failed: ${semverValid('1.2.3')}`)
}

// Temporal API — Node 26+ links the temporal_rs Rust crate via
// --v8-enable-temporal-support. If rustup/cargo wasn't present at
// configure time the build silently drops the API; this assertion
// turns that into a hard build failure instead of a runtime surprise
// for SEA consumers.
if (typeof Temporal !== 'object' || Temporal === null) {
  throw new Error('Temporal global missing — temporal_rs not linked')
}
const instant = Temporal.Now.instant()
if (typeof instant?.epochMilliseconds !== 'number') {
  throw new Error(`Temporal.Now.instant() failed: ${instant}`)
}
const plainDate = Temporal.PlainDate.from('2026-01-01')
if (plainDate.toString() !== '2026-01-01') {
  throw new Error(`Temporal.PlainDate.from() failed: ${plainDate}`)
}

console.log('Built-in modules loaded')
