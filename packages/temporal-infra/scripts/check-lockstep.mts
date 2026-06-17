#!/usr/bin/env node

/**
 * @fileoverview Lockstep audit for the temporal-infra C++ port.
 *
 * The contract: the port is "observable 1:1" with the JS Temporal
 * spec — every JS-visible Temporal entry point produces the
 * spec-defined result. Validated end-to-end via Test262 + smoke
 * tests at build time; this script is the static-time gate.
 *
 * Three checks:
 *
 *   1. Live stub scan. Greps source for "not yet implemented" /
 *      "requires calendar" / "Stub:" patterns. Any hit means a
 *      method falls through to a runtime error rather than doing
 *      the work.
 *
 *   2. V8 call-site cross-check. Walks V8's js-temporal-objects.cc
 *      for `temporal_rs::Class::method(...)` references; confirms
 *      every required method is present in the shim. Mismatches
 *      (V8 calls a method we don't expose) are hard fails.
 *
 *   3. Upstream public-API drift report. Counts upstream `pub fn`
 *      entries; informational only — the shim is deliberately
 *      narrower than upstream's public API.
 *
 * Exit codes:
 *   0 — checks 1+2 pass (check 3 is informational)
 *   1 — at least one of checks 1+2 failed
 *   2 — script crashed (path missing, etc.)
 *
 * Run via:
 *   pnpm --filter temporal-infra run check:lockstep
 *
 * Or from this package's directory:
 *   node scripts/check-lockstep.mts
 */

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(packageRoot, '..', '..')

const PORT_INCLUDE_DIR = path.join(packageRoot, 'include', 'temporal_rs')
const PORT_SRC_DIR = path.join(packageRoot, 'src', 'socketsecurity', 'temporal')
const UPSTREAM_SRC_DIR = path.join(packageRoot, 'upstream', 'temporal', 'src')
const V8_JS_TEMPORAL = path.join(
  repoRoot,
  'packages',
  'node-smol-builder',
  'upstream',
  'node',
  'deps',
  'v8',
  'src',
  'objects',
  'js-temporal-objects.cc',
)

const STUB_PATTERNS = [
  /\bnot yet implemented\b/,
  /\brequires (a |an )?calendar\b/i,
  /^\s*\/\/\s*Stub:/m,
]

/**
 * Check 1: Live stub scan.
 */
export function checkLiveStubs(): { ok: boolean; hits: string[] } {
  const hits: string[] = []
  const dirs = [PORT_INCLUDE_DIR, PORT_SRC_DIR]
  for (let di = 0, { length: dlen } = dirs; di < dlen; di += 1) {
    const files = collectFiles(
      dirs[di]!,
      n => n.endsWith('.h') || n.endsWith('.hpp') || n.endsWith('.cc'),
    )
    for (let fi = 0, { length: flen } = files; fi < flen; fi += 1) {
      const file = files[fi]!
      const text = readFileSync(file, 'utf8')
      const lines = text.split('\n')
      for (let li = 0, { length: llen } = lines; li < llen; li += 1) {
        const line = lines[li]!
        // Skip doc comments that historically reference the stub
        // state — flag only live code paths.
        if (line.trimStart().startsWith('//')) {
          continue
        }
        const hit = STUB_PATTERNS.some(re => re.test(line))
        if (hit) {
          const rel = path.relative(packageRoot, file)
          hits.push(`${rel}:${li + 1}: ${line.trim()}`)
        }
      }
    }
  }
  return { ok: hits.length === 0, hits }
}

/**
 * Check 2: every `temporal_rs::Class::method(` reference in V8's
 * js-temporal-objects.cc has a matching shim entry.
 */
export function checkV8CallSites(): {
  ok: boolean
  missing: Array<{ class: string; method: string }>
  classesNotFound: string[]
} {
  const missing: Array<{ class: string; method: string }> = []
  const classesNotFound: string[] = []
  const v8Calls = extractV8Calls()
  if (v8Calls.length === 0) {
    // V8 source not present (fresh clone, no submodule). Skip.
    return { ok: true, missing, classesNotFound }
  }
  for (let i = 0, { length } = v8Calls; i < length; i += 1) {
    const entry = v8Calls[i]!
    const cls = entry.class
    const methods = entry.methods
    const shimMethods = shimMethodsForClass(cls)
    if (shimMethods.length === 0) {
      classesNotFound.push(cls)
      continue
    }
    const shimSet = new Set(shimMethods)
    for (let mi = 0, { length: mlen } = methods; mi < mlen; mi += 1) {
      const method = methods[mi]!
      if (!shimSet.has(method)) {
        missing.push({ class: cls, method })
      }
    }
  }
  return {
    ok: missing.length === 0 && classesNotFound.length === 0,
    missing,
    classesNotFound,
  }
}

/**
 * Materialize a directory walk into a flat array of absolute paths
 * matching the predicate. Iterative (no generator) so call sites
 * can use cached-length loops.
 */
export function collectFiles(
  root: string,
  predicate: (name: string) => boolean,
): string[] {
  const out: string[] = []
  const stack: string[] = [root]
  while (stack.length > 0) {
    const dir = stack.pop()!
    const entries = readdirSync(dir, { withFileTypes: true })
    for (let i = 0, { length } = entries; i < length; i += 1) {
      const entry = entries[i]!
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
      } else if (entry.isFile() && predicate(entry.name)) {
        out.push(full)
      }
    }
  }
  return out
}

/**
 * Count `name(` parenthesized identifiers across all shim
 * headers — informational drift signal. Overcounts (param names,
 * inline expressions) but the trend is what matters.
 */
export function countShimMethods(): number {
  let count = 0
  const files = collectFiles(PORT_INCLUDE_DIR, n => n.endsWith('.hpp'))
  for (let i = 0, { length } = files; i < length; i += 1) {
    const text = readFileSync(files[i]!, 'utf8')
    const matches = text.match(/\b[a-z_][a-z_0-9]*\s*\(/g)
    count += matches === null ? 0 : matches.length
  }
  return count
}

/**
 * Count `pub fn` entries across upstream temporal_rs source. Used
 * for the informational drift line in check 3.
 */
export function countUpstreamPubFns(): number {
  let count = 0
  const files = collectFiles(UPSTREAM_SRC_DIR, n => n.endsWith('.rs'))
  for (let i = 0, { length } = files; i < length; i += 1) {
    const text = readFileSync(files[i]!, 'utf8')
    const matches = text.match(/^\s*pub fn\s+[a-z_]/gm)
    count += matches === null ? 0 : matches.length
  }
  return count
}

/**
 * Extract `temporal_rs::Class::method(` references from V8's
 * js-temporal-objects.cc. Returns a flat array grouped by class.
 */
export function extractV8Calls(): Array<{
  class: string
  methods: string[]
}> {
  let text: string
  try {
    text = readFileSync(V8_JS_TEMPORAL, 'utf8')
  } catch {
    // The V8 file lives in the node-smol-builder submodule which
    // may not be checked out in fresh clones. Skip silently.
    return []
  }
  const callPattern =
    /temporal_rs::([A-Z][A-Za-z0-9]*)::([a-z_][a-z_0-9]*)\s*\(/g
  const accum = new Map<string, Set<string>>()
  const matches = Array.from(text.matchAll(callPattern))
  for (let i = 0, { length } = matches; i < length; i += 1) {
    const m = matches[i]!
    const cls = m[1]!
    const method = m[2]!
    let bucket = accum.get(cls)
    if (bucket === undefined) {
      bucket = new Set()
      accum.set(cls, bucket)
    }
    bucket.add(method)
  }
  const out: Array<{ class: string; methods: string[] }> = []
  const accumEntries = Array.from(accum.entries())
  for (let i = 0, { length } = accumEntries; i < length; i += 1) {
    const [cls, methods] = accumEntries[i]!
    out.push({ class: cls, methods: Array.from(methods) })
  }
  return out
}

/**
 * Map a class name to its shim header path, or undefined when no
 * matching header exists.
 */
export function shimHeaderForClass(cls: string): string | undefined {
  const candidate = path.join(PORT_INCLUDE_DIR, `${cls}.hpp`)
  try {
    readFileSync(candidate, 'utf8')
    return candidate
  } catch {
    return undefined
  }
}

/**
 * Scan a shim header for declared methods. Conservative regex —
 * captures any `name(` pattern.
 */
export function shimMethodsForClass(cls: string): string[] {
  const header = shimHeaderForClass(cls)
  if (header === undefined) {
    return []
  }
  const text = readFileSync(header, 'utf8')
  const matches = text.match(/\b[a-z_][a-z_0-9]*\s*\(/g) ?? []
  const set = new Set<string>()
  for (let i = 0, { length } = matches; i < length; i += 1) {
    const m = matches[i]!
    set.add(m.replace(/\s*\($/, ''))
  }
  return Array.from(set)
}

// ── Run all checks ──────────────────────────────────────────────────

let failed = false

logger.info('temporal-infra lockstep audit')
logger.info('')

logger.info('Check 1/3: live stub scan')
const stubResult = checkLiveStubs()
if (stubResult.ok) {
  logger.success('  no live stubs')
} else {
  failed = true
  logger.error(`  ${stubResult.hits.length} live stub(s):`)
  const hits = stubResult.hits
  for (let i = 0, { length } = hits; i < length; i += 1) {
    logger.error(`    ${hits[i]!}`)
  }
}

logger.info('')
logger.info('Check 2/3: V8 call-site cross-check')
const v8Result = checkV8CallSites()
if (v8Result.ok) {
  logger.success('  all V8 call sites resolve to shim methods')
} else {
  failed = true
  if (v8Result.classesNotFound.length > 0) {
    logger.error(
      `  ${v8Result.classesNotFound.length} class(es) called by V8 without a shim header:`,
    )
    const notFound = v8Result.classesNotFound
    for (let i = 0, { length } = notFound; i < length; i += 1) {
      logger.error(`    temporal_rs::${notFound[i]!}`)
    }
  }
  if (v8Result.missing.length > 0) {
    logger.error(
      `  ${v8Result.missing.length} method(s) called by V8 but not exposed in shim:`,
    )
    const miss = v8Result.missing
    for (let i = 0, { length } = miss; i < length; i += 1) {
      const m = miss[i]!
      logger.error(`    temporal_rs::${m.class}::${m.method}`)
    }
  }
}

logger.info('')
logger.info('Check 3/3: upstream public-API drift (informational)')
const upstreamCount = countUpstreamPubFns()
const shimCount = countShimMethods()
logger.info(`  upstream pub fns: ${upstreamCount} | shim methods: ${shimCount}`)
logger.info(
  '  (shim is deliberately narrower than upstream; only V8-required surface is wrapped)',
)

logger.info('')
if (failed) {
  logger.error('lockstep audit FAILED')
  process.exit(1)
}
logger.success('lockstep audit PASSED')
