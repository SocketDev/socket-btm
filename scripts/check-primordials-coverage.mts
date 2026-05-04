#!/usr/bin/env node
/**
 * @fileoverview Primordials drift detector.
 *
 * `additions/source-patched/lib/**\/*.js` files run inside the patched
 * Node binary as internal modules and destructure names from the
 * built-in `primordials` global. `socket-lib/src/primordials.ts`
 * provides a parallel userland mirror for our npm-shipped packages.
 *
 * The two should stay shape-aligned: every name socket-btm destructures
 * from `primordials` should either be exported by socket-lib (modulo a
 * known alias map for naming-convention differences like `Array` →
 * `ArrayCtor`) or be in the small allowlist of Node-internal-only
 * names we deliberately don't mirror (`Safe*` wrappers, `hardenRegExp`,
 * `globalThis`).
 *
 * Run by `pnpm run check`. Fails CI on any unaccounted name so adding
 * a new primordials use forces an explicit decision: extend socket-lib,
 * extend the alias map, or extend the allowlist.
 *
 * Usage:
 *   node scripts/check-primordials-coverage.mts
 *   node scripts/check-primordials-coverage.mts --explain
 *   node scripts/check-primordials-coverage.mts --json
 *   node scripts/check-primordials-coverage.mts --quiet
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { joinAnd, joinOr } from '@socketsecurity/lib/arrays'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')

/**
 * Names socket-btm destructures from the Node-internal `primordials`
 * global that map to socket-lib exports under a different name.
 *
 * Convention: keys are the Node-internal name (left side of socket-btm's
 * destructure); values are the socket-lib export. Update both this map
 * and `socket-lib/src/primordials.ts` together.
 */
const SOCKET_LIB_ALIASES: ReadonlyMap<string, string> = new Map([
  // Constructors — socket-lib uses Ctor suffix to avoid shadowing globals.
  ['Array', 'ArrayCtor'],
  ['ArrayBuffer', 'ArrayBufferCtor'],
  ['BigInt', 'BigIntCtor'],
  ['Boolean', 'BooleanCtor'],
  ['DataView', 'DataViewCtor'],
  ['Date', 'DateCtor'],
  ['Error', 'ErrorCtor'],
  ['EvalError', 'EvalErrorCtor'],
  ['Map', 'MapCtor'],
  ['Number', 'NumberCtor'],
  ['Object', 'ObjectCtor'],
  ['Promise', 'PromiseCtor'],
  ['Proxy', 'ProxyCtor'],
  ['RangeError', 'RangeErrorCtor'],
  ['ReferenceError', 'ReferenceErrorCtor'],
  ['RegExp', 'RegExpCtor'],
  ['Set', 'SetCtor'],
  ['SharedArrayBuffer', 'SharedArrayBufferCtor'],
  ['String', 'StringCtor'],
  ['Symbol', 'SymbolCtor'],
  ['SyntaxError', 'SyntaxErrorCtor'],
  ['TypeError', 'TypeErrorCtor'],
  ['URIError', 'URIErrorCtor'],
  ['URL', 'URLCtor'],

  // Global function renames.
  ['decodeURIComponent', 'decodeComponent'],
  ['encodeURIComponent', 'encodeComponent'],
])

/**
 * Names that exist only in Node's internal `primordials` and have
 * intentionally NOT been mirrored to socket-lib.
 *
 * `Safe*` wrappers come from Node's per-context primordials and rely
 * on V8 internals userland can't replicate. `hardenRegExp` is Node-
 * internal. `globalThis` is captured directly in socket-lib without
 * routing through primordials.
 *
 * Adding to this list is a deliberate decision: confirm the name has
 * no userland equivalent before extending.
 */
const NODE_INTERNAL_ONLY: ReadonlySet<string> = new Set([
  'SafeMap',
  'SafePromise',
  'SafePromiseAllReturnVoid',
  'SafePromiseAllSettled',
  'SafeSet',
  'SafeWeakMap',
  'SafeWeakSet',
  'globalThis',
  'hardenRegExp',
])

interface Finding {
  readonly kind: 'unmapped' | 'missing-from-socket-lib'
  readonly name: string
  readonly files: readonly string[]
  readonly hint: string
}

interface ScanResult {
  readonly btmNames: ReadonlySet<string>
  readonly btmNameToFiles: ReadonlyMap<string, readonly string[]>
  readonly socketLibNames: ReadonlySet<string>
  readonly findings: readonly Finding[]
}

/** Strip line + block comments so commentary inside destructures
 * doesn't leak into the captured names. */
function stripComments(src: string): string {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '')
  out = out.replace(/^[\t ]*\/\/.*$/gm, '')
  out = out.replace(/[\t ]+\/\/.*$/gm, '')
  return out
}

/** Recursively collect every `*.js` file under `dir`. */
function collectJsFiles(dir: string): string[] {
  const out: string[] = []
  if (!existsSync(dir)) {
    return out
  }
  const stack = [dir]
  while (stack.length > 0) {
    const cur = stack.pop()!
    let entries: string[]
    try {
      entries = readdirSync(cur)
    } catch {
      continue
    }
    for (const name of entries) {
      const full = path.join(cur, name)
      let stat
      try {
        stat = statSync(full)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        stack.push(full)
      } else if (stat.isFile() && full.endsWith('.js')) {
        out.push(full)
      }
    }
  }
  return out
}

/** Pull every `const { … } = primordials` destructure body out of `src`. */
function extractPrimordialsNames(src: string): string[] {
  const cleaned = stripComments(src)
  // `const { … }` where body has no nested `}`, then `= primordials`.
  // Comments are already stripped, so this is safe against cross-block
  // matches that span an intervening `} = require(...)`.
  const re = /const\s*\{\s*([^}]*?)\}\s*=\s*primordials\b/g
  const out: string[] = []
  let m
  while ((m = re.exec(cleaned)) !== null) {
    for (const raw of m[1]!.split(',')) {
      const trimmed = raw.trim()
      if (!trimmed) {
        continue
      }
      // `Foo: BarAlias` keeps `Foo` (the source name on the LHS).
      const nameMatch = /^([A-Za-z_$][A-Za-z0-9_$]*)/.exec(trimmed)
      if (nameMatch) {
        out.push(nameMatch[1]!)
      }
    }
  }
  return out
}

/** Pull every `export const Foo` / `export function Foo` /
 * `export { Foo }` from a TS file. */
function extractTsExports(src: string): string[] {
  const out = new Set<string>()
  for (const m of src.matchAll(
    /^export\s+const\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm,
  )) {
    out.add(m[1]!)
  }
  for (const m of src.matchAll(
    /^export\s+function\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm,
  )) {
    out.add(m[1]!)
  }
  for (const m of src.matchAll(/^export\s*\{\s*([^}]+)\}/gm)) {
    for (const raw of m[1]!.split(',')) {
      const trimmed = raw.trim()
      if (!trimmed) {
        continue
      }
      const nameMatch = /^([A-Za-z_$][A-Za-z0-9_$]*)/.exec(trimmed)
      if (nameMatch) {
        out.add(nameMatch[1]!)
      }
    }
  }
  return [...out]
}

/** Locate socket-lib's primordials source. Prefers a sibling clone
 * (`../socket-lib/src/primordials.ts`) since that's the canonical
 * editable source; falls back to the resolved `node_modules` copy so
 * CI without the sibling clone still passes. */
function resolveSocketLibPrimordials(): string {
  const sibling = path.resolve(
    repoRoot,
    '..',
    'socket-lib',
    'src',
    'primordials.ts',
  )
  if (existsSync(sibling)) {
    return sibling
  }
  const installed = path.resolve(
    repoRoot,
    'node_modules',
    '@socketsecurity',
    'lib',
    'dist',
    'primordials.d.ts',
  )
  if (existsSync(installed)) {
    return installed
  }
  throw new Error(
    'Cannot locate socket-lib primordials source. ' +
      `Looked at:\n  ${sibling}\n  ${installed}\n` +
      'Either clone socket-lib at ../socket-lib or run `pnpm install`.',
  )
}

function scan(): ScanResult {
  // Collect socket-btm primordial names + which files use them.
  const additionsRoot = path.join(
    repoRoot,
    'packages',
    'node-smol-builder',
    'additions',
    'source-patched',
  )
  const jsFiles = collectJsFiles(additionsRoot)

  const btmNames = new Set<string>()
  const btmNameToFiles = new Map<string, string[]>()
  for (const file of jsFiles) {
    let src
    try {
      src = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    if (!src.includes('primordials')) {
      continue
    }
    const names = extractPrimordialsNames(src)
    if (names.length === 0) {
      continue
    }
    const rel = path.relative(repoRoot, file)
    for (const name of names) {
      btmNames.add(name)
      const arr = btmNameToFiles.get(name) ?? []
      if (!arr.includes(rel)) {
        arr.push(rel)
      }
      btmNameToFiles.set(name, arr)
    }
  }

  // Collect socket-lib's exported names.
  const socketLibPath = resolveSocketLibPrimordials()
  const socketLibNames = new Set(
    extractTsExports(readFileSync(socketLibPath, 'utf8')),
  )

  // Diff: every socket-btm name must be either (a) in socket-lib
  // verbatim, (b) in socket-lib via the alias map, or (c) in the
  // explicit Node-internal-only allowlist.
  const findings: Finding[] = []
  for (const name of [...btmNames].sort()) {
    if (NODE_INTERNAL_ONLY.has(name)) {
      continue
    }
    if (socketLibNames.has(name)) {
      continue
    }
    const aliased = SOCKET_LIB_ALIASES.get(name)
    if (aliased) {
      if (socketLibNames.has(aliased)) {
        continue
      }
      findings.push({
        kind: 'missing-from-socket-lib',
        name,
        files: btmNameToFiles.get(name) ?? [],
        hint:
          `socket-btm uses \`${name}\` which is mapped to socket-lib\'s ` +
          `\`${aliased}\`, but \`${aliased}\` is not exported. ` +
          `Add \`export const ${aliased} = ${name}\` to ` +
          'socket-lib/src/primordials.ts.',
      })
      continue
    }
    findings.push({
      kind: 'unmapped',
      name,
      files: btmNameToFiles.get(name) ?? [],
      hint:
        `socket-btm destructures \`${name}\` from \`primordials\` but ` +
        'no socket-lib mapping exists. Pick one: ' +
        joinOr([
          'add `${name}` to socket-lib/src/primordials.ts',
          'add a `${name}` → `<name>` entry to SOCKET_LIB_ALIASES',
          'add `${name}` to NODE_INTERNAL_ONLY (if Node-internal only)',
        ]).replace(/\$\{name\}/g, name) +
        '.',
    })
  }

  return {
    btmNames,
    btmNameToFiles,
    socketLibNames,
    findings,
  }
}

interface Args {
  readonly quiet: boolean
  readonly explain: boolean
  readonly json: boolean
}

function parseCliArgs(argv: readonly string[]): Args {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      quiet: { type: 'boolean', default: false },
      explain: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    strict: true,
  })
  if (values.help) {
    logger.log(
      'Usage: node scripts/check-primordials-coverage.mts [--quiet|--explain|--json]',
    )
    process.exit(0)
  }
  return {
    quiet: !!values.quiet,
    explain: !!values.explain,
    json: !!values.json,
  }
}

function main(): void {
  const args = parseCliArgs(process.argv.slice(2))

  const result = scan()

  if (args.json) {
    logger.log(
      JSON.stringify(
        {
          btmNameCount: result.btmNames.size,
          socketLibNameCount: result.socketLibNames.size,
          findings: result.findings,
        },
        undefined,
        2,
      ),
    )
    process.exitCode = result.findings.length > 0 ? 1 : 0
    return
  }

  if (result.findings.length === 0) {
    if (!args.quiet) {
      logger.success(
        `Primordials coverage OK — ${result.btmNames.size} ` +
          `name${result.btmNames.size === 1 ? '' : 's'} used in socket-btm, ` +
          'all accounted for.',
      )
    }
    process.exitCode = 0
    return
  }

  logger.error(
    `Primordials drift detected — ${result.findings.length} unaccounted ` +
      `name${result.findings.length === 1 ? '' : 's'}:`,
  )
  for (const f of result.findings) {
    logger.error(`  ${f.name}`)
    if (args.explain) {
      logger.log(`    ${f.hint}`)
      if (f.files.length > 0) {
        const shown = f.files.slice(0, 3)
        const suffix =
          f.files.length > shown.length
            ? ` (+${f.files.length - shown.length} more)`
            : ''
        logger.log(`    used in: ${joinAnd(shown)}${suffix}`)
      }
    }
  }
  if (!args.explain) {
    logger.log(
      '\nRun with --explain for fix instructions and file references.',
    )
  }

  process.exitCode = 1
}

try {
  main()
} catch (e: unknown) {
  const msg = e instanceof Error ? e.message : String(e)
  logger.error(`check-primordials-coverage failed: ${msg}`)
  process.exitCode = 1
}
