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

console.log('Built-in modules loaded')
