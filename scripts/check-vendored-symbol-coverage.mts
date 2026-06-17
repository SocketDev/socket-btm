#!/usr/bin/env node
/**
 * @file Vendored-symbol coverage gate.
 *   Cross-checks every `*_binding.cc` under
 *   `packages/node-smol-builder/additions/source-patched/src/socketsecurity/`
 *   against the list of vendored sources gyp will actually compile, and
 *   fails if a binding references an external symbol whose defining .c /
 *   .cpp file isn't in any gyp source list.
 *   Catches the class of failure that hit builds #9-#10:
 *
 *   - tui/tui_binding.cc writes `YGConfigNew(...)`, expects libyoga to be linked,
 *     but no yoga .cpp files were listed in patch 004's 'sources':. Link fails
 *     with "_YGConfigNew not found".
 *   - quic/quic_binding.cc writes `lsquic_engine_new(...)`, same shape: no lsquic
 *     .c files listed, link fails on 30+ symbols. The check is necessary
 *     because:
 *
 *   1. Bindings reference vendored symbols via header includes — those resolve at
 *      compile time (so a missing include_dir surfaces as a clean error during
 *      preprocessing).
 *   2. The defining .c files only surface at LINK time, which is the LAST 5% of a
 *      30-minute build. Catching it pre-build saves the 30 minutes. Vendored
 *      libraries with auto-generated gypi (preferred form): yoga →
 *      additions/source-patched/deps/yoga.gypi lsquic →
 *      additions/source-patched/deps/lsquic.gypi ls-qpack →
 *      additions/source-patched/deps/ls-qpack.gypi Vendored libraries with
 *      inline gyp source lists (legacy form, in patch 004): qrcode
 *      (libqrencode), markdown (md4c), tree-sitter. Algorithm:
 *   3. Walk every `*_binding.cc` under the additions tree.
 *   4. Extract `<prefix>_<symbol>(` patterns whose prefix matches a known
 *      vendored-library prefix (YG, lsquic_, ts_, MD_, qrcode_, QR, lsqpack_).
 *   5. For each unique symbol, search: a. All
 *      `additions/source-patched/deps/<lib>.gypi` source manifests
 *      (auto-generated). b. Patch 004's inline 'sources': lists. c. All .c/.cpp
 *      files inside additions/source-patched/deps/ whose path appears in (a) or
 *      (b).
 *   6. Confirm each symbol has at least one source listed AND that source contains
 *      a matching `<symbol>(` definition. Usage: node
 *      scripts/check-vendored-symbol-coverage.mts node
 *      scripts/check-vendored-symbol-coverage.mts --explain node
 *      scripts/check-vendored-symbol-coverage.mts --json Exit codes: 0 — all
 *      binding symbols are covered by listed sources. 1 — at least one symbol
 *      has no covering source. 2 — usage / args error.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const REPO_ROOT = path.resolve(__dirname, '..')
const ADDITIONS_DIR = path.join(
  REPO_ROOT,
  'packages',
  'node-smol-builder',
  'additions',
  'source-patched',
)
const ADDITIONS_SRC = path.join(ADDITIONS_DIR, 'src', 'socketsecurity')
const ADDITIONS_DEPS = path.join(ADDITIONS_DIR, 'deps')
const PATCH_004_PATH = path.join(
  REPO_ROOT,
  'packages',
  'node-smol-builder',
  'patches',
  'source-patched',
  '004-node-gyp-smol-sources.patch',
)

const logger = getDefaultLogger()

interface VendorPrefix {
  readonly name: string
  // Regex matching <prefix><symbol>( call sites in C++ source.
  readonly callRegex: RegExp
  // gypi file name (relative to additions/source-patched/deps/) if
  // auto-generated; undefined if sources live inline in patch 004.
  readonly gypi?: string | undefined
}

const VENDOR_PREFIXES: readonly VendorPrefix[] = [
  {
    name: 'yoga',
    callRegex: /\b(YG[A-Z][A-Za-z0-9]*)\s*\(/g,
    gypi: 'yoga.gypi',
  },
  {
    name: 'lsquic',
    callRegex: /\b(lsquic_[A-Za-z0-9_]+)\s*\(/g,
    gypi: 'lsquic.gypi',
  },
  {
    name: 'ls-qpack',
    callRegex: /\b(lsqpack_[A-Za-z0-9_]+)\s*\(/g,
    gypi: 'ls-qpack.gypi',
  },
  {
    name: 'tree-sitter',
    callRegex: /\b(ts_[a-z][A-Za-z0-9_]+)\s*\(/g,
    // tree-sitter sources are listed inline in patch 004 (lib.c
    // umbrella + tree_sitter_binding.cc).
  },
  {
    name: 'libqrencode',
    callRegex:
      /\b(QR(?:cmEval|cmTask|code|encode|input|spec)[A-Za-z0-9_]*)\s*\(/g,
  },
  {
    name: 'md4c',
    callRegex: /\b(md_parse|MD_[A-Z][A-Za-z0-9_]*)\s*\(/g,
  },
]

/**
 * Main coverage check.
 */
// oxlint-disable-next-line socket/sort-source-methods
// oxlint-disable-next-line socket/export-top-level-functions
function checkCoverage(): readonly Finding[] {
  // 1. Collect every binding's referenced (vendor, symbol) set.
  const bindings = walkFiles(
    ADDITIONS_SRC,
    f => f.endsWith('_binding.cc') || f.endsWith('_binding.cpp'),
  )
  const refs: BindingSymbol[] = []
  for (let i = 0, { length } = bindings; i < length; i += 1) {
    const found = extractSymbols(bindings[i]!)
    for (let j = 0, fl = found.length; j < fl; j += 1) {
      refs.push(found[j]!)
    }
  }

  // 2. Group by (vendor, symbol).
  const byKey = new Map<string, BindingSymbol[]>()
  for (let i = 0, { length } = refs; i < length; i += 1) {
    const r = refs[i]!
    const key = `${r.vendor}::${r.symbol}`
    const arr = byKey.get(key)
    if (arr === undefined) {
      byKey.set(key, [r])
    } else {
      arr.push(r)
    }
  }

  // 3. Build the union of "sources gyp will actually compile":
  //    gypi-listed sources (per vendor) + patch-004 inline sources.
  const gypiSourcesByVendor = new Map<string, readonly string[]>()
  for (let i = 0, { length } = VENDOR_PREFIXES; i < length; i += 1) {
    const vp = VENDOR_PREFIXES[i]!
    if (vp.gypi === undefined) {
      continue
    }
    const gypiPath = path.join(ADDITIONS_DEPS, vp.gypi)
    const sources = readGypiSources(gypiPath)
    const gypiDir = path.dirname(gypiPath)
    const absSources = sources.map(s => resolveSourcePath(s, gypiDir))
    gypiSourcesByVendor.set(vp.name, absSources)
  }
  const inlinePatchSources = readPatch004InlineSources().map(s =>
    resolveSourcePath(s, undefined),
  )

  // 4. For each (vendor, symbol), find a covering source.
  const findings: Finding[] = []
  for (const [key, bs] of byKey) {
    const [vendor, symbol] = key.split('::') as [string, string]
    const gypiSources = gypiSourcesByVendor.get(vendor) ?? []
    const candidates = [...gypiSources, ...inlinePatchSources]
    let covered = false
    for (let i = 0, { length } = candidates; i < length; i += 1) {
      if (fileDefinesSymbol(candidates[i]!, symbol)) {
        covered = true
        break
      }
    }
    if (!covered) {
      findings.push({
        vendor,
        symbol,
        bindings: [...new Set(bs.map(b => b.binding))].toSorted(),
        reason:
          gypiSources.length === 0
            ? `vendor "${vendor}" has no gypi manifest at additions/source-patched/deps/${vendor}.gypi and no patch-004 inline source defines ${symbol}()`
            : `none of ${gypiSources.length} ${vendor}.gypi sources nor patch-004 inline sources define ${symbol}()`,
      })
    }
  }
  findings.sort((a, b) => {
    const v = a.vendor.localeCompare(b.vendor)
    return v !== 0 ? v : a.symbol.localeCompare(b.symbol)
  })
  return findings
}

/**
 * Extract all (binding, vendor, symbol) triples for one binding file.
 */
// oxlint-disable-next-line socket/sort-source-methods
// oxlint-disable-next-line socket/export-top-level-functions
function extractSymbols(bindingPath: string): readonly BindingSymbol[] {
  let content: string
  try {
    content = readFileSync(bindingPath, 'utf8')
  } catch {
    return []
  }
  const out: BindingSymbol[] = []
  const rel = path.relative(REPO_ROOT, bindingPath)
  for (let i = 0, { length } = VENDOR_PREFIXES; i < length; i += 1) {
    const vp = VENDOR_PREFIXES[i]!
    // Reset lastIndex since callRegex is a /g pattern.
    vp.callRegex.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = vp.callRegex.exec(content)) !== null) {
      out.push({ binding: rel, vendor: vp.name, symbol: m[1]! })
    }
  }
  return out
}

/**
 * Check whether a source file (absolute path) contains a definition
 * matching `<symbol>(`. This is naive — it only catches the C/C++
 * call-shape, not declarations — but a defining occurrence in a .c/.cpp
 * is what gives the linker a symbol.
 */
// oxlint-disable-next-line socket/sort-source-methods
// oxlint-disable-next-line socket/export-top-level-functions
function fileDefinesSymbol(filePath: string, symbol: string): boolean {
  if (!existsSync(filePath)) {
    return false
  }
  let content: string
  try {
    content = readFileSync(filePath, 'utf8')
  } catch {
    return false
  }
  // <symbol>( at the start of a line OR after `*`/`(` characters,
  // preceded by a return-type token (very loose; catches `void foo(`,
  // `int foo(`, `static foo(`, `template <T> Foo<T>::foo(`, etc.).
  const re = new RegExp(`\\b${symbol}\\s*\\(`)
  return re.test(content)
}

interface ParsedArgs {
  readonly explain: boolean
  readonly json: boolean
}

// oxlint-disable-next-line socket/sort-source-methods
// oxlint-disable-next-line socket/export-top-level-functions
function parseArgs(): ParsedArgs {
  const argv = process.argv.slice(2)
  let explain = false
  let json = false
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const a = argv[i]!
    if (a === '--explain') {
      explain = true
    } else if (a === '--json') {
      json = true
    } else if (a === '--help' || a === '-h') {
      logger.log(
        'Usage: node scripts/check-vendored-symbol-coverage.mts [--explain] [--json]',
      )
      process.exit(0)
    } else {
      logger.error(`Unknown argument: ${a}`)
      process.exit(2)
    }
  }
  return { explain, json }
}

/**
 * Read a gypi file's 'sources': list. Returns each entry's relative
 * path as it appears in the gypi (gyp resolves these relative to the
 * gypi's location).
 */
// oxlint-disable-next-line socket/sort-source-methods
// oxlint-disable-next-line socket/export-top-level-functions
function readGypiSources(gypiPath: string): readonly string[] {
  if (!existsSync(gypiPath)) {
    return []
  }
  const content = readFileSync(gypiPath, 'utf8')
  const out: string[] = []
  // Match 'path/to/file.c' inside a 'sources': [ ... ] block. We don't
  // parse the full gypi (it's Python-ish dict literals); a single regex
  // over the file is sufficient because the auto-generated gypi is
  // strictly one sources block.
  const re = /'([^']+\.(?:c|cpp|cc))'/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    out.push(m[1]!)
  }
  return out
}

/**
 * Extract patch 004's inline 'sources': entries for files under
 * deps/<vendor>/. Used for vendors whose sources live in patch 004
 * directly (no auto-gypi).
 */
// oxlint-disable-next-line socket/sort-source-methods
// oxlint-disable-next-line socket/export-top-level-functions
function readPatch004InlineSources(): readonly string[] {
  if (!existsSync(PATCH_004_PATH)) {
    return []
  }
  const content = readFileSync(PATCH_004_PATH, 'utf8')
  const out: string[] = []
  // Match added-line entries like `+            'src/.../foo.cc',` or
  // `+            'deps/.../foo.c',`.
  const re = /^\+\s+'(src\/[^']+\.(?:c|cpp|cc)|deps\/[^']+\.(?:c|cpp|cc))'/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    out.push(m[1]!)
  }
  return out
}

/**
 * Resolve a source path (as it appears in a gypi/patch) to its absolute
 * path on disk under additions/source-patched/. gypi-relative paths
 * resolve relative to the gypi's parent dir; patch-relative paths
 * resolve relative to additions/source-patched/ (which corresponds to
 * the node source root once additions are copied in).
 */
// oxlint-disable-next-line socket/sort-source-methods
// oxlint-disable-next-line socket/export-top-level-functions
function resolveSourcePath(
  sourceRef: string,
  gypiDir: string | undefined,
): string {
  if (gypiDir !== undefined) {
    return path.join(gypiDir, sourceRef)
  }
  return path.join(ADDITIONS_DIR, sourceRef)
}

interface BindingSymbol {
  readonly binding: string
  readonly vendor: string
  readonly symbol: string
}

interface Finding {
  readonly vendor: string
  readonly symbol: string
  readonly bindings: readonly string[]
  readonly reason: string
}

/**
 * Walk a directory tree, returning all files matching `predicate`.
 */
// oxlint-disable-next-line socket/sort-source-methods -- helpers grouped by topic (file walks, gyp parsing, symbol extraction); alphabetical interleave reads worse than topical clusters.
// oxlint-disable-next-line socket/export-top-level-functions -- internal pure helper; not part of the script's external contract.
function walkFiles(
  root: string,
  predicate: (p: string) => boolean,
): readonly string[] {
  const out: string[] = []
  function walk(dir: string): void {
    let entries: ReturnType<typeof readdirSync>
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (let i = 0, { length } = entries; i < length; i += 1) {
      const entry = entries[i]!
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (entry.isFile() && predicate(full)) {
        out.push(full)
      }
    }
  }
  walk(root)
  out.sort()
  return out
}

const { explain, json } = parseArgs()

// Verify additions tree exists (the check is meaningless before
// prepareExternalSources has run; emit a clear skip-message so the
// commit gate distinguishes "not yet built" from "broken").
if (!existsSync(ADDITIONS_SRC) || !existsSync(ADDITIONS_DEPS)) {
  if (json) {
    process.stdout.write(
      JSON.stringify({ status: 'skipped', reason: 'additions tree absent' }) +
        '\n',
    )
  } else {
    logger.warn(
      '[check-vendored-symbol-coverage] additions tree absent; run prepareExternalSources first. Skipping.',
    )
  }
  process.exit(0)
}

const findings = checkCoverage()

if (json) {
  process.stdout.write(
    JSON.stringify({
      status: findings.length === 0 ? 'ok' : 'fail',
      findings,
    }) + '\n',
  )
} else if (findings.length === 0) {
  logger.success('[check-vendored-symbol-coverage] all symbols covered')
} else {
  logger.fail(
    `[check-vendored-symbol-coverage] ${findings.length} symbol(s) missing from gyp source coverage:`,
  )
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const f = findings[i]!
    logger.log(
      `  - ${f.vendor}::${f.symbol}  referenced from ${f.bindings.join(', ')}`,
    )
    if (explain) {
      logger.log(`      reason: ${f.reason}`)
    }
  }
  logger.log('')
  logger.log(
    'Fix: ensure the vendored library is listed in additions/source-patched/deps/<lib>.gypi (auto-generated by prepare-external-sources.mts) OR has its sources inlined in patch 004.',
  )
}

process.exitCode = findings.length === 0 ? 0 : 1
