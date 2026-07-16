#!/usr/bin/env node

/**
 * @file Lockstep audit for the codesign-infra C++ port. The contract: a Mach-O
 *   signed by codesign-infra verifies under Apple's `codesign -v` and loads via
 *   dlopen (validated end-to-end in the phase tests). This script is the
 *   static-time gate. Three checks:
 *
 *   1. Declared-vs-implemented. Every entry point declared in codesign.h must have
 *      a real body in src/ — a `CODESIGN_STUB(` marker means it falls through
 *      to a "phase pending" error. Stubbed entries are reported with their
 *      phase; they are NOT a hard fail while that phase is unstarted
 *      (informational), so the scaffold stays green and the snapshot stays
 *      honest.
 *   2. Crypto provenance. boringssl-builder must be the package's crypto
 *      dependency, and no hand-rolled hash/cipher primitive should appear in
 *      src/ (greps for tell-tale tables). A hand-rolled primitive is a hard
 *      fail.
 *   3. Tracker presence. docs/ports/codesign-infra-lockstep.md must exist. Exit: 0
 *      — checks 2+3 pass (check 1 is informational while phases are staged); 1
 *      — a hard-fail (hand-rolled crypto, missing tracker); 2 — script crashed.
 *      Run: pnpm --filter codesign-infra run check:lockstep
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(packageRoot, '..', '..')

const HEADER = path.join(
  packageRoot,
  'include',
  'socketsecurity',
  'codesign',
  'codesign.h',
)
const SRC_DIR = path.join(packageRoot, 'src', 'socketsecurity', 'codesign')
const TRACKER = path.join(
  repoRoot,
  'docs',
  'ports',
  'codesign-infra-lockstep.md',
)

// A hand-rolled crypto primitive is the one thing this port must never carry —
// BoringSSL owns all of it. These markers would betray one.
const HAND_ROLLED_CRYPTO = [
  /\b0x6a09e667\b/, // SHA-256 initial hash constant
  /\b0x428a2f98\b/, // SHA-256 round constant table head
  /\bRijndael\b/i,
]

function cppSources(): string[] {
  if (!existsSync(SRC_DIR)) {
    return []
  }
  return readdirSync(SRC_DIR)
    .filter(name => name.endsWith('.cpp') || name.endsWith('.c'))
    .map(name => path.join(SRC_DIR, name))
}

let hardFail = false

// Check 3 — tracker present.
if (!existsSync(TRACKER)) {
  logger.error(`missing lockstep tracker: ${path.relative(repoRoot, TRACKER)}`)
  hardFail = true
} else {
  logger.success('lockstep tracker present')
}

// Check 2 — crypto provenance.
const pkg = JSON.parse(
  readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
)
if (!pkg.dependencies?.['boringssl-builder']) {
  logger.error(
    'boringssl-builder must be the crypto dependency (none declared)',
  )
  hardFail = true
} else {
  logger.success('crypto sourced from boringssl-builder')
}
const sources = cppSources()
for (const file of sources) {
  const text = readFileSync(file, 'utf8')
  for (let i = 0, { length } = HAND_ROLLED_CRYPTO; i < length; i += 1) {
    const marker = HAND_ROLLED_CRYPTO[i]!
    if (marker.test(text)) {
      logger.error(
        `hand-rolled crypto in ${path.basename(file)} (${marker}); use BoringSSL`,
      )
      hardFail = true
    }
  }
}

// Check 1 — declared vs implemented (informational while phases are staged).
const header = existsSync(HEADER) ? readFileSync(HEADER, 'utf8') : ''
const declared = [...header.matchAll(/^int (codesign_macho_\w+)\(/gm)].map(
  m => m[1]!,
)
const srcText = sources.map(f => readFileSync(f, 'utf8')).join('\n')
const stubbed = declared.filter(fn => {
  const body = srcText.indexOf(fn)
  return (
    body === -1 || srcText.slice(body, body + 400).includes('CODESIGN_STUB(')
  )
})
if (stubbed.length) {
  logger.info(`staged (not yet implemented): ${stubbed.join(', ')}`)
} else if (declared.length) {
  logger.success(`all ${declared.length} entry points implemented`)
}

process.exitCode = hardFail ? 1 : 0
