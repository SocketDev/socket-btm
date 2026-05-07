#!/usr/bin/env node
/**
 * @fileoverview Enumerate GLIBC_2.x symbol versions pulled in by the built node binary.
 *
 * USAGE:
 *   pnpm --filter node-smol-builder run glibc:audit [--binary=PATH] [--floor=2.17]
 *
 * What it does:
 *   1. Locates the most recent built binary (or uses --binary).
 *   2. Runs `objdump -T` and extracts every `(GLIBC_2.x)` version reference.
 *   3. Sorts by version tuple, counts per version, prints a table.
 *   4. Exits non-zero if any symbol exceeds the `--floor` (default 2.17).
 *
 * This is a groundwork tool — it does not mutate the build. Use it to
 * (a) see what's currently pulled in on an existing glibc 2.28 build, and
 * (b) detect regressions if/when we lower the floor.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { errorMessage } from 'build-infra/lib/error-utils'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { getLatestFinalBinary } from '../test/paths.mts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const logger = getDefaultLogger()

type SymbolRow = {
  __proto__: null
  symbol: string
  version: string
  tuple: readonly number[]
}

/**
 * Parse "2.17" / "2.17.1" / "2.2.5" into a readonly integer tuple.
 * Uses plain Number() — matching Bun's symbols.test.ts comparator. npm semver
 * libs throw on "2.17" (not valid semver), hence this custom parser.
 */
function parseVersionTuple(raw: string): readonly number[] {
  return raw.split('.').map(n => Number(n) || 0)
}

/**
 * Lexicographic tuple comparison: [2,17] > [2,17,0] is false.
 */
function compareTuples(
  a: readonly number[],
  b: readonly number[],
): number {
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    if (av !== bv) {
      return av < bv ? -1 : 1
    }
  }
  return 0
}

function parseCliArgs(argv: readonly string[]) {
  const result = {
    __proto__: null,
    binary: undefined as string | undefined,
    floor: '2.17',
    fallbackReport: false,
  }
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--binary=')) {
      result.binary = arg.slice('--binary='.length)
    } else if (arg.startsWith('--floor=')) {
      result.floor = arg.slice('--floor='.length)
    } else if (arg === '--fallback-report') {
      result.fallbackReport = true
    }
  }
  return result
}

/**
 * Parse `src/socketsecurity/compat/glibc_compat.h` to learn which symbols
 * the compat layer currently wraps. Used by --fallback-report to annotate
 * each violation with "wrapped?" yes/no, so an engineer extending the floor
 * can see at a glance which symbols already have a fallback and which need
 * new __wrap_ entries.
 */
async function readWrappedSymbols(): Promise<ReadonlySet<string>> {
  const header = path.join(
    __dirname,
    '..',
    'additions',
    'source-patched',
    'src',
    'socketsecurity',
    'compat',
    'glibc_compat.h',
  )
  try {
    const text = await fs.readFile(header, 'utf8')
    const pattern = /__wrap_(\w+)\s*\(/g
    const wrapped = new Set<string>()
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) {
      wrapped.add(match[1]!)
    }
    return wrapped
  } catch {
    return new Set()
  }
}

async function runObjdump(binary: string): Promise<string> {
  // Prefer `objdump` (GNU / LLVM). On macOS the LLVM tool is `llvm-objdump`
  // — point PATH at Homebrew's llvm keg (`brew install llvm`) and the
  // symlink is provided as `objdump` inside its bin dir.
  const result = await spawn('objdump', ['-T', binary], { stdio: 'pipe' })
  if (result.code !== 0) {
    throw new Error(
      `objdump failed with exit ${result.code}: ${result.stderr?.toString()}`,
    )
  }
  return result.stdout?.toString() ?? ''
}

function parseObjdumpOutput(text: string): SymbolRow[] {
  // objdump -T lines look like:
  //   0000000000000000  w   DF *UND*  0000000000000000 (GLIBC_2.17) dlsym
  //                     ^                             ^^^^^^^^^^^^  ^^^^^
  //                     weak                          version       symbol
  //
  // We greedy-match `(GLIBC_<version>)` then take the trailing token as the
  // symbol name. Empty captures are skipped.
  const pattern = /\(GLIBC_(\d+(?:\.\d+)+)\)\s+(\S+)/
  const rows: SymbolRow[] = []
  for (const line of text.split('\n')) {
    const match = pattern.exec(line)
    if (!match) {
      continue
    }
    rows.push({
      __proto__: null,
      symbol: match[2]!,
      version: match[1]!,
      tuple: parseVersionTuple(match[1]!),
    })
  }
  return rows
}

function uniqueSortedByVersion(rows: readonly SymbolRow[]): SymbolRow[] {
  const seen = new Set<string>()
  const unique: SymbolRow[] = []
  for (const row of rows) {
    const key = `${row.version}\0${row.symbol}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    unique.push(row)
  }
  return unique.sort((a, b) => {
    const cmp = compareTuples(a.tuple, b.tuple)
    return cmp !== 0 ? cmp : a.symbol.localeCompare(b.symbol)
  })
}

function countByVersion(rows: readonly SymbolRow[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of rows) {
    counts.set(row.version, (counts.get(row.version) ?? 0) + 1)
  }
  return counts
}

async function main() {
  const args = parseCliArgs(process.argv)
  const floorTuple = parseVersionTuple(args.floor)

  let binary = args.binary
  if (!binary) {
    try {
      binary = getLatestFinalBinary()
    } catch (e) {
      throw new Error(
        'No built binary found. Build first or pass --binary=PATH.',
        { cause: e },
      )
    }
  }

  if (!existsSync(binary)) {
    throw new Error(`Binary not found: ${binary}`)
  }

  if (process.platform !== 'linux') {
    logger.warn(
      'glibc symbol audit only meaningful on Linux binaries — ' +
        'objdump will likely not recognize the Mach-O/PE format.',
    )
  }

  logger.step(`Auditing glibc symbols in ${binary}`)
  logger.log(`Floor: GLIBC_${args.floor} (any higher version = violation)`)

  const objdumpOut = await runObjdump(binary)
  const allRows = parseObjdumpOutput(objdumpOut)
  const rows = uniqueSortedByVersion(allRows)

  if (rows.length === 0) {
    logger.warn('No GLIBC_2.x symbols found. Binary may be static or non-ELF.')
    return
  }

  logger.log('')
  logger.log('GLIBC version  |  Symbol count')
  logger.log('---------------|--------------')
  for (const [version, count] of countByVersion(rows)) {
    logger.log(`  ${version.padEnd(12)} | ${String(count).padStart(5)}`)
  }

  const violations = rows.filter(r => compareTuples(r.tuple, floorTuple) > 0)

  if (violations.length > 0) {
    logger.log('')
    logger.error(
      `${violations.length} symbol(s) exceed floor GLIBC_${args.floor}:`,
    )

    if (args.fallbackReport) {
      const wrapped = await readWrappedSymbols()
      logger.log('  wrapped? | symbol (GLIBC_ver)')
      logger.log('  ---------|-------------------')
      for (const v of violations) {
        const has = wrapped.has(v.symbol) ? '✓ yes   ' : '✗ NO    '
        logger.log(`  ${has} | GLIBC_${v.version.padEnd(6)} ${v.symbol}`)
      }
      logger.log('')
      const missing = violations.filter(v => !wrapped.has(v.symbol)).length
      if (missing > 0) {
        logger.log(
          `${missing} symbol(s) have no __wrap_ in glibc_compat.h — must be added.`,
        )
      } else {
        logger.log(
          'All violations are already wrapped; inert on current floor, will activate on target.',
        )
      }
    } else {
      for (const v of violations) {
        logger.log(`  GLIBC_${v.version.padEnd(8)} ${v.symbol}`)
      }
      logger.log('')
      logger.log(
        'To lower the floor, add -Wl,--wrap=<symbol> in 021-glibc-compat-layer.patch',
      )
      logger.log(
        'and implement __wrap_<symbol> in socketsecurity/compat/glibc_compat.cc.',
      )
      logger.log(
        'Pass --fallback-report to see which symbols are already wrapped.',
      )
    }
    // Signal "violations found" via exit code 2 without killing the process
    // abruptly — lets any pending stderr writes flush and keeps the function
    // composable under unit tests.
    process.exitCode = 2
    return
  }

  logger.success(
    `All ${rows.length} GLIBC_2.x references are <= GLIBC_${args.floor}.`,
  )
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1]!)) {
  main().catch(err => {
    logger.error(errorMessage(err))
    process.exitCode = 1
  })
}
