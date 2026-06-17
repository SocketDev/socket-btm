#!/usr/bin/env node

/**
 * @fileoverview Static feature detector for node-smol SEA bundles.
 *
 * USAGE:
 *   pnpm --filter node-smol-builder run detect -- --bundle=path/to/main.js [--vfs=path/to/vfs.tar] [--overrides=package.json] [--json]
 *
 * What it does:
 *   1. Reads the consumer's bundled SEA main (esbuild output) and, if given, the
 *      VFS tarball entries.
 *   2. Scans for each registered feature's string signals (substring match,
 *      minification-robust) and AST member signals (Temporal./navigator.gpu/Intl.).
 *   3. Detects computed require()/import() that static analysis can't resolve and
 *      marks affected features ambiguous (conservative keep).
 *   4. Applies per-bundle overrides from package.json `smol.keep` / `smol.drop`.
 *   5. Runs the V8-lite heuristic (recommend --v8-lite-mode for non-compute bundles).
 *   6. Emits a feature-usage manifest (JSON) that drives the flag mapper, the
 *      fail-closed gate, and the flaggable test harness.
 *
 * This tool does NOT mutate the build or pick flags by itself beyond emitting the
 * recommended set — the build orchestration consumes the manifest. Drops are
 * always backstopped by the fail-closed gate that runs the app against the
 * trimmed binary, so a missed dynamic require cannot ship silently.
 */

import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import * as acorn from 'acorn'
import * as walk from 'acorn-walk'

import { errorMessage } from 'build-infra/lib/error-utils'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'

import { SMOL_FEATURES } from './lib/smol-features.mts'
import type { SmolFeature } from './lib/smol-features.mts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const logger = getDefaultLogger()

type UsageKind = 'hard' | 'soft' | 'none'

type FeatureVerdict = {
  __proto__: null
  use: UsageKind
  drop: boolean
  reason: string
  note?: string | undefined
}

export type FeatureManifest = {
  __proto__: null
  bundleHash: string
  features: { [name: string]: FeatureVerdict }
  ambiguous: string[]
  v8Lite: { recommended: boolean; reason: string }
  /** The exact ./configure args the mapper derives from `features` + v8Lite. */
  configureFlags: string[]
}

type ScanResult = {
  __proto__: null
  /** feature name → matched string signal (first hit). */
  stringHits: Map<string, string>
  /** feature name → matched member signal description. */
  memberHits: Map<string, string>
  /** feature names guarded by isBuiltin(...) (soft use). */
  guardedByIsBuiltin: Set<string>
  /** true if a computed require()/import() was seen anywhere. */
  hasComputedRequire: boolean
  /** compute-intensity signals for the V8-lite heuristic. */
  compute: ComputeSignals
}

type ComputeSignals = {
  __proto__: null
  /** Count of TypedArray allocations (AST NewExpression) — hot-loop proxy. */
  typedArrayAllocs: number
  /** WebAssembly.* references (string scan). */
  wasm: number
  /** BigInt literals + Atomics.* (AST). */
  bigint: number
  /** crypto-hashing API references (string scan). */
  cryptoHashing: number
  /** Total scanned source bytes, for density normalization. */
  totalBytes: number
}

const TYPED_ARRAY_NAMES = [
  'Float64Array',
  'Float32Array',
  'Int32Array',
  'Uint32Array',
  'BigInt64Array',
  'BigUint64Array',
]

/**
 * Substring scan + computed-require + isBuiltin-guard detection over raw source.
 * Robust to minification because it matches string literals, not identifiers.
 */
export function scanSource(source: string, acc: ScanResult): void {
  for (const f of SMOL_FEATURES) {
    if (!acc.stringHits.has(f.name)) {
      for (const sig of f.stringSignals) {
        if (source.includes(sig)) {
          acc.stringHits.set(f.name, sig)
          break
        }
      }
    }
  }
  // Computed require/import: require(<not a quote>) or import(<not a quote>).
  // A literal require('x')/import('x') has a quote immediately after the paren;
  // anything else (a variable, template, concat) is dynamic.
  if (
    /\brequire\s*\(\s*[^'"`)]/.test(source) ||
    /\bimport\s*\(\s*[^'"`)]/.test(source)
  ) {
    acc.hasComputedRequire = true
  }
  // isBuiltin('node:smol-…') guards mark soft use.
  for (const f of SMOL_FEATURES) {
    for (const sig of f.stringSignals) {
      const re = new RegExp(
        `isBuiltin\\s*\\(\\s*['"\`]${escapeRegExp(sig)}['"\`]`,
      )
      if (re.test(source)) {
        acc.guardedByIsBuiltin.add(f.name)
        break
      }
    }
  }
  // Compute-signal counts for the V8-lite density heuristic. Counts (not
  // booleans) let us distinguish a proxy that touches createHash once for a
  // cache key from a crypto-mining hot loop.
  acc.compute.totalBytes += source.length
  acc.compute.wasm += countOccurrences(source, 'WebAssembly')
  for (const api of ['createHash', 'createHmac', 'pbkdf2', 'scrypt']) {
    acc.compute.cryptoHashing += countOccurrences(source, api)
  }
}

export function countOccurrences(haystack: string, needle: string): number {
  let count = 0
  let idx = haystack.indexOf(needle)
  while (idx !== -1) {
    count += 1
    idx = haystack.indexOf(needle, idx + needle.length)
  }
  return count
}

/**
 * AST pass for member-access signals (Temporal./navigator.gpu/Intl.) and
 * TypedArray/BigInt compute signals. Minified bundles may use syntax acorn's
 * default ecmaVersion rejects, so failures degrade gracefully — the string scan
 * already covers the specifier-based features.
 */
export function scanAst(source: string, acc: ScanResult): void {
  let ast: acorn.Node
  try {
    ast = acorn.parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowHashBang: true,
    })
  } catch {
    try {
      ast = acorn.parse(source, {
        ecmaVersion: 'latest',
        sourceType: 'script',
        allowHashBang: true,
      })
    } catch (e) {
      logger.warn(
        `AST parse failed (string-scan signals still applied): ${errorMessage(e)}`,
      )
      return
    }
  }
  walk.simple(ast, {
    MemberExpression(node: any) {
      const objName =
        node.object?.type === 'Identifier' ? node.object.name : undefined
      if (!objName) {
        return
      }
      const propName =
        node.property?.type === 'Identifier' && !node.computed
          ? node.property.name
          : undefined
      for (const f of SMOL_FEATURES) {
        for (const m of f.memberSignals) {
          if (
            m.object === objName &&
            (m.property === undefined || m.property === propName)
          ) {
            if (!acc.memberHits.has(f.name)) {
              acc.memberHits.set(
                f.name,
                m.property ? `${m.object}.${m.property}` : m.object,
              )
            }
          }
        }
      }
      if (objName === 'Atomics') {
        acc.compute.bigint += 1
      }
    },
    NewExpression(node: any) {
      if (
        node.callee?.type === 'Identifier' &&
        TYPED_ARRAY_NAMES.includes(node.callee.name)
      ) {
        acc.compute.typedArrayAllocs += 1
      }
    },
    Literal(node: any) {
      if (typeof node.value === 'bigint') {
        acc.compute.bigint += 1
      }
    },
  })
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * V8-lite heuristic. --v8-lite-mode drops the optimizing JIT (TurboFan/Maglev),
 * keeping only the Ignition interpreter + Liftoff (WASM baseline). It saves
 * ~6-8MB and lowers RSS, at the cost of ~5-10x slower hot JS. The right call for
 * a network/IO-bound app (a proxy, a CLI that mostly shells out) where wall-clock
 * is dominated by syscalls/RTT, not JS compute.
 *
 * Why DENSITY, not presence: any nontrivial bundle contains createHash (a TLS
 * cache key), a stray TypedArray (a decoder in undici), or "WebAssembly" (a
 * feature-detect) somewhere in its deps. Binary presence therefore always says
 * "no" and is useless. We instead normalize compute signals per-MB and only
 * back off when density crosses a threshold that suggests a genuine hot path.
 *
 * This is ADVISORY — surfaced with its evidence so the operator decides; never
 * auto-applied. The recommendation defaults to lite for server/proxy-shaped
 * bundles (the common node-smol case) unless compute density is high.
 */
const COMPUTE_DENSITY_THRESHOLD = 8 // signals per MB above which we keep full JIT

export function v8LiteRecommendation(c: ComputeSignals): {
  recommended: boolean
  reason: string
} {
  const mb = Math.max(c.totalBytes / (1024 * 1024), 0.001)
  const totalSignals =
    c.typedArrayAllocs + c.wasm + c.bigint + c.cryptoHashing
  const density = totalSignals / mb
  const breakdown =
    `TypedArray×${c.typedArrayAllocs}, WASM×${c.wasm}, ` +
    `BigInt/Atomics×${c.bigint}, cryptoHash×${c.cryptoHashing} ` +
    `over ${mb.toFixed(1)}MB ⇒ ${density.toFixed(1)}/MB`
  // Heavy compute usually means a real hot loop (WASM-backed lib, lots of typed
  // arrays). High WASM count alone is a strong keep signal — Liftoff is fine but
  // a WASM-heavy app likely wants TurboFan tiering for the JS glue too.
  if (density >= COMPUTE_DENSITY_THRESHOLD || c.wasm >= 4) {
    return {
      recommended: false,
      reason: `high compute density (${breakdown}) — keep full JIT`,
    }
  }
  return {
    recommended: true,
    reason: `low compute density (${breakdown}) — bundle looks network/IO-bound; --v8-lite-mode trades ~5-10x hot-JS speed for ~6-8MB + lower RSS. Advisory: benchmark the app's p99 before committing.`,
  }
}

/**
 * Read a NUL-padded fixed-width tar header field as a string, slicing at the
 * first NUL byte. Operates on the buffer (not a decoded string) to avoid a
 * control character in a regex (oxlint no-control-regex).
 */
export function tarField(buf, start, end) {
  const nul = buf.indexOf(0, start)
  const stop = nul === -1 || nul > end ? end : nul
  return buf.toString('utf8', start, stop)
}

export async function readVfsEntries(vfsPath) {
  // Minimal POSIX/ustar tar walker: 512-byte header blocks, name at 0..100,
  // size (octal) at 124..136, file data padded to 512. Good enough to pull JS
  // entries out of the SEA VFS tarball without extracting to disk.
  const buf = await fs.readFile(vfsPath)
  const sources = []
  let off = 0
  while (off + 512 <= buf.length) {
    const name = tarField(buf, off, off + 100)
    if (!name) {
      break // two zero blocks = end of archive
    }
    const size = parseInt(tarField(buf, off + 124, off + 136).trim(), 8) || 0
    const dataStart = off + 512
    if (/\.(?:cjs|js|mjs)$/.test(name)) {
      sources.push(buf.toString('utf8', dataStart, dataStart + size))
    }
    off = dataStart + Math.ceil(size / 512) * 512
  }
  return sources
}

export function hashSource(source: string): string {
  return `sha256:${createHash('sha256').update(source).digest('hex')}`
}

export async function detectBundleFeatures(opts: {
  bundlePath: string
  vfsPath?: string | undefined
  overrides?: { keep?: string[] | undefined; drop?: string[] | undefined } | undefined
}): Promise<FeatureManifest> {
  const { bundlePath, vfsPath, overrides } = opts
  const mainSource = await fs.readFile(bundlePath, 'utf8')

  const acc: ScanResult = {
    __proto__: null,
    stringHits: new Map(),
    memberHits: new Map(),
    guardedByIsBuiltin: new Set(),
    hasComputedRequire: false,
    compute: {
      __proto__: null,
      typedArrayAllocs: 0,
      wasm: 0,
      bigint: 0,
      cryptoHashing: 0,
      totalBytes: 0,
    },
  }

  const allSources = [mainSource]
  if (vfsPath) {
    allSources.push(...(await readVfsEntries(vfsPath)))
  }
  for (let i = 0, { length } = allSources; i < length; i += 1) {
    const src = allSources[i]!
    scanSource(src, acc)
    scanAst(src, acc)
  
  }

  const keepSet = new Set(overrides?.keep ?? [])
  const dropSet = new Set(overrides?.drop ?? [])

  const features: { [name: string]: FeatureVerdict } = { __proto__: null }
  const ambiguous: string[] = []
  const configureFlags: string[] = []

  for (const f of SMOL_FEATURES) {
    const verdict = decideFeature(f, acc, { keepSet, dropSet })
    features[f.name] = verdict
    if (verdict.use === 'none' && acc.hasComputedRequire && !dropSet.has(f.name)) {
      // A computed require could be pulling this in; we can't prove it's unused.
      if (verdict.drop && f.policy !== 'soft') {
        ambiguous.push(f.name)
      }
    }
  }

  // Re-resolve drops after ambiguity: anything ambiguous becomes keep unless the
  // operator explicitly listed it in `drop`.
  for (let i = 0, { length } = ambiguous; i < length; i += 1) {
    const name = ambiguous[i]!
    const v = features[name]!
    if (!dropSet.has(name)) {
      v.drop = false
      v.note =
        (v.note ? `${v.note}; ` : '') +
        'computed require() present — kept conservatively (override with smol.drop)'
    }
  
  }

  // Derive configure flags from final drop decisions.
  for (const f of SMOL_FEATURES) {
    const v = features[f.name]!
    if (v.drop && f.configureFlagWhenDropped) {
      configureFlags.push(f.configureFlagWhenDropped)
    }
    // Opt-in features (postgres/dawn/iouring): dropping means simply not adding
    // the optInFlag, which is the default — nothing to emit.
  }

  const v8Lite = v8LiteRecommendation(acc.compute)
  // The heuristic is advisory: surfaced in the manifest, but only added to the
  // emitted flag set when explicitly opted in via overrides.keep/drop semantics
  // is wrong here — use a dedicated override key handled by the caller. We do
  // NOT auto-append --v8-lite-mode.

  return {
    __proto__: null,
    bundleHash: hashSource(allSources.join('\n')),
    features,
    ambiguous,
    v8Lite,
    configureFlags: dedupe(configureFlags),
  }
}

export function decideFeature(
  f: SmolFeature,
  acc: ScanResult,
  sets: { keepSet: Set<string>; dropSet: Set<string> },
): FeatureVerdict {
  const { keepSet, dropSet } = sets
  const hasString = acc.stringHits.has(f.name)
  const hasMember = acc.memberHits.has(f.name)
  const guarded = acc.guardedByIsBuiltin.has(f.name)
  const used = hasString || hasMember

  // Explicit overrides win.
  if (keepSet.has(f.name)) {
    return {
      __proto__: null,
      use: used ? (guarded ? 'soft' : 'hard') : 'none',
      drop: false,
      reason: 'kept by package.json smol.keep override',
    }
  }
  if (dropSet.has(f.name)) {
    return {
      __proto__: null,
      use: used ? (guarded ? 'soft' : 'hard') : 'none',
      drop: true,
      reason: 'dropped by package.json smol.drop override',
    }
  }

  // Never-auto-drop policies.
  if (f.policy === 'always' || f.policy === 'keep-unless-explicit') {
    return {
      __proto__: null,
      use: used ? 'hard' : 'none',
      drop: false,
      reason:
        f.policy === 'always'
          ? 'core runtime — never gated'
          : 'keep-unless-explicit policy (deep coupling); override with smol.drop',
    }
  }

  if (used) {
    if (guarded || f.policy === 'soft') {
      const sig = acc.stringHits.get(f.name) ?? acc.memberHits.get(f.name)
      return {
        __proto__: null,
        use: 'soft',
        // Soft use behind isBuiltin() with a fallback ⇒ still droppable; the
        // gate must verify the fallback path runs without the binding.
        drop: true,
        reason: `isBuiltin-guarded use (${sig}) — droppable, gate must verify fallback`,
        note: 'soft use: gate runs the fallback path',
      }
    }
    const sig = acc.stringHits.get(f.name) ?? acc.memberHits.get(f.name)
    return {
      __proto__: null,
      use: 'hard',
      drop: false,
      reason: `used (${sig})`,
    }
  }

  // No evidence of use ⇒ drop (auto policy).
  return {
    __proto__: null,
    use: 'none',
    drop: true,
    reason: 'no usage signals found',
  }
}

export function dedupe(xs: string[]): string[] {
  return [...new Set(xs)]
}

async function main(): Promise<void> {
  // `pnpm run detect -- --bundle=…` forwards a literal `--` into argv, which
  // parseArgs treats as end-of-options. Drop a leading `--` so both the direct
  // `node scripts/…` form and the `pnpm run` form behave the same.
  const rawArgs = process.argv.slice(2)
  const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs
  const { values } = parseArgs({
    args,
    options: {
      bundle: { type: 'string' },
      vfs: { type: 'string' },
      overrides: { type: 'string' },
      'v8-lite': { type: 'boolean' },
      json: { type: 'boolean' },
    },
    strict: false,
  })

  const bundlePath = values['bundle'] as string | undefined
  if (!bundlePath || !existsSync(bundlePath)) {
    logger.fail(`--bundle is required and must exist (got: ${bundlePath ?? '<none>'})`)
    process.exitCode = 1
    return
  }
  const vfsPath = values['vfs'] as string | undefined
  if (vfsPath && !existsSync(vfsPath)) {
    logger.fail(`--vfs path does not exist: ${vfsPath}`)
    process.exitCode = 1
    return
  }

  let overrides: { keep?: string[] | undefined; drop?: string[] | undefined } | undefined
  const overridesPath = values['overrides'] as string | undefined
  if (overridesPath) {
    try {
      const pkg = JSON.parse(await fs.readFile(overridesPath, 'utf8'))
      overrides = pkg?.smol
        ? { keep: pkg.smol.keep, drop: pkg.smol.drop }
        : undefined
    } catch (e) {
      logger.warn(`could not read overrides from ${overridesPath}: ${errorMessage(e)}`)
    }
  }

  const manifest = await detectBundleFeatures({ bundlePath, vfsPath, overrides })

  // The operator may force the V8-lite recommendation into the emitted flags.
  if (values['v8-lite'] && manifest.v8Lite.recommended) {
    manifest.configureFlags.push('--v8-lite-mode')
  }

  if (values['json']) {
    logger.log(JSON.stringify(manifest, replacerStripProto, 2))
    return
  }

  // Human report.
  logger.log(`Bundle: ${bundlePath}`)
  logger.log(`Hash:   ${manifest.bundleHash}`)
  logger.log('')
  logger.log('Feature          Use    Drop  Reason')
  logger.log('───────────────  ─────  ────  ──────')
  for (const f of SMOL_FEATURES) {
    const v = manifest.features[f.name]!
    logger.log(
      `${f.name.padEnd(15)}  ${v.use.padEnd(5)}  ${(v.drop ? 'yes' : 'no').padEnd(4)}  ${v.reason}`,
    )
  }
  logger.log('')
  const dropped = SMOL_FEATURES.filter(f => manifest.features[f.name]!.drop)
  const savedMb = dropped.reduce((s, f) => s + f.approxBinaryMb, 0)
  logger.log(
    `Dropping ${dropped.length} feature(s) — est. ~${savedMb.toFixed(1)}MB binary reduction`,
  )
  logger.log(`V8-lite: ${manifest.v8Lite.recommended ? 'RECOMMENDED' : 'no'} — ${manifest.v8Lite.reason}`)
  if (manifest.ambiguous.length) {
    logger.warn(`Ambiguous (kept conservatively): ${manifest.ambiguous.join(', ')}`)
  }
  logger.log('')
  logger.log(`Configure flags: ${manifest.configureFlags.join(' ') || '(none)'}`)
}

export function replacerStripProto(_key: string, value: unknown): unknown {
  return value
}

// Run as a script (not when imported by tests).
if (import.meta.url === pathToFileURLString(process.argv[1])) {
  main().catch((e: unknown) => {
    logger.fail(errorMessage(e))
    process.exitCode = 1
  })
}

export function pathToFileURLString(p: string | undefined): string {
  if (!p) {
    return ''
  }
  return new URL(`file://${path.resolve(p)}`).href
}
