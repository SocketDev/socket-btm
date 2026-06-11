/**
 * @fileoverview Unit tests for the SEA-bundle feature detector.
 *
 * Synthetic in-memory bundles (written to a temp file because the detector
 * reads from a path) exercise the decision matrix: drop-when-absent,
 * keep-when-used, sqlite both ways, soft-use isBuiltin guards, computed-require
 * ambiguity, package.json overrides, and the V8-lite density heuristic. No
 * dependency on a real built bundle.
 */

import { describe, expect, it } from 'vitest'

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { detectBundleFeatures } from '../../scripts/detect-bundle-features.mts'
import { SMOL_FEATURES } from '../../scripts/lib/smol-features.mts'

const tmp = mkdtempSync(path.join(tmpdir(), 'detect-feat-'))

export function bundle(source: string, name = 'main.js'): string {
  const p = path.join(tmp, `${name}-${Math.abs(hashName(source))}.js`)
  writeFileSync(p, source)
  return p
}

// Deterministic name suffix without Date.now/Math.random (banned in this env's
// scripts; cheap string hash is fine for fixture filenames).
export function hashName(s: string): number {
  let h = 0
  for (let i = 0, { length } = s; i < length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) | 0
  }
  return h
}

describe('detectBundleFeatures', () => {
  it('drops every auto feature when the bundle uses none', async () => {
    const p = bundle(`
      import http from 'node:http'
      http.createServer(() => {}).listen(3000)
    `)
    const m = await detectBundleFeatures({ bundlePath: p })
    expect(m.features['quic']!.drop).toBe(true)
    expect(m.features['quic']!.use).toBe('none')
    expect(m.features['tui']!.drop).toBe(true)
    expect(m.features['ffi']!.drop).toBe(true)
    // Opt-in features emit no flag (dropping = default off).
    expect(m.configureFlags).not.toContain('--with-postgres')
    expect(m.configureFlags).toContain('--without-smol-quic')
  })

  it('detects node:sqlite use and KEEPS sqlite', async () => {
    const p = bundle(`
      const { DatabaseSync } = require('node:sqlite')
      const db = new DatabaseSync(':memory:')
    `)
    const m = await detectBundleFeatures({ bundlePath: p })
    expect(m.features['sqlite']!.use).toBe('hard')
    expect(m.features['sqlite']!.drop).toBe(false)
    expect(m.configureFlags).not.toContain('--without-sqlite')
  })

  it('emits --without-sqlite when node:sqlite is absent', async () => {
    const p = bundle(`console.log('no database here')`)
    const m = await detectBundleFeatures({ bundlePath: p })
    expect(m.features['sqlite']!.drop).toBe(true)
    expect(m.configureFlags).toContain('--without-sqlite')
  })

  it('keeps power always-on (not gated — too small to split across 4 gyp blocks)', async () => {
    const p = bundle(`
      import { isBuiltin } from 'node:module'
      if (isBuiltin('node:smol-power')) {
        const { onAcPower } = require('node:smol-power')
      } else {
        // shellout fallback
      }
    `)
    const m = await detectBundleFeatures({ bundlePath: p })
    // power is policy:'always' — never dropped, never emits a flag.
    expect(m.features['power']!.drop).toBe(false)
    expect(m.configureFlags).not.toContain('--without-smol-power')
  })

  it('never auto-drops Temporal or Intl (keep-unless-explicit)', async () => {
    const p = bundle(`const x = Temporal.Now.instant(); const f = new Intl.NumberFormat()`)
    const m = await detectBundleFeatures({ bundlePath: p })
    expect(m.features['temporal']!.drop).toBe(false)
    expect(m.features['intl']!.drop).toBe(false)
    expect(m.configureFlags).not.toContain('--with-intl=none')
  })

  it('marks features ambiguous (keep) when a computed require is present', async () => {
    const p = bundle(`
      const mod = 'node:sm' + 'ol-quic'
      const q = require(mod)   // dynamic — static scan can't see the specifier
    `)
    const m = await detectBundleFeatures({ bundlePath: p })
    // quic has no literal signal here; computed require ⇒ conservative keep.
    expect(m.ambiguous).toContain('quic')
    expect(m.features['quic']!.drop).toBe(false)
    expect(m.configureFlags).not.toContain('--without-smol-quic')
  })

  it('honors package.json smol.drop / smol.keep overrides', async () => {
    // tui is unused (would auto-drop) but force-kept; quic is unused and
    // explicitly dropped even though a computed require exists.
    const p = bundle(`const m = require(dynamicName); 'node:smol-tui'`)
    const m = await detectBundleFeatures({
      bundlePath: p,
      overrides: { keep: ['tui'], drop: ['quic'] },
    })
    expect(m.features['tui']!.drop).toBe(false)
    expect(m.features['tui']!.reason).toMatch(/smol\.keep/)
    expect(m.features['quic']!.drop).toBe(true)
    expect(m.features['quic']!.reason).toMatch(/smol\.drop/)
  })

  it('recommends V8-lite for a low-compute (network-bound) bundle', async () => {
    const p = bundle(`
      import http from 'node:http'
      const server = http.createServer((req, res) => res.end('ok'))
      server.listen(8080)
    `)
    const m = await detectBundleFeatures({ bundlePath: p })
    expect(m.v8Lite.recommended).toBe(true)
    expect(m.v8Lite.reason).toMatch(/low compute density/)
  })

  it('does NOT recommend V8-lite for a compute-dense bundle', async () => {
    // Dense TypedArray allocations + WASM in a small bundle ⇒ high signals/MB.
    const lines: string[] = []
    for (let i = 0, length = 40; i < length; i += 1) {
      lines.push(`const a${i} = new Float64Array(1024); WebAssembly.instantiate(b${i});`)
    }
    const p = bundle(lines.join('\n'))
    const m = await detectBundleFeatures({ bundlePath: p })
    expect(m.v8Lite.recommended).toBe(false)
    expect(m.v8Lite.reason).toMatch(/high compute density/)
  })

  it('every emittable --without-smol-* flag maps to a wired gyp gate', () => {
    // Guards against silent drift: a detector flag with no node_use_* gypVar
    // would be a feature the detector "drops" that the build never actually
    // excludes. Each smol feature that emits a flag must name its gypVar.
    for (const f of SMOL_FEATURES) {
      if (f.configureFlagWhenDropped?.startsWith('--without-smol-')) {
        expect(
          f.gypVar,
          `${f.name} emits ${f.configureFlagWhenDropped} but has no gypVar`,
        ).toBeTruthy()
      }
    }
  })

  it('produces a stable content hash for identical input', async () => {
    const src = `console.log('stable')`
    const a = await detectBundleFeatures({ bundlePath: bundle(src, 'a') })
    const b = await detectBundleFeatures({ bundlePath: bundle(src, 'b') })
    expect(a.bundleHash).toBe(b.bundleHash)
    expect(a.bundleHash).toMatch(/^sha256:[0-9a-f]{64}$/)
  })
})
