#!/usr/bin/env node
/**
 * @file Regression-pattern gate. Runs fast grep-based checks for the recurring
 *   bug _shapes_ caught during R14-R25 quality-scan rounds. Each pattern
 *   encodes a lesson learned: the regex matches the shape of a real bug we've
 *   shipped before. Note: "pattern" here means "regex pattern" / "code shape" —
 *   nothing to do with JS/TS class definitions. Strict — no allowlist. A PR
 *   that introduces a new instance of any pattern will fail this check; fix the
 *   code (apply the canonical remediation in the rule's `fix:` field) rather
 *   than opting out. Usage: node scripts/repo/check-regression-patterns.mts #
 *   Fail on any match node scripts/repo/check-regression-patterns.mts --quiet #
 *   No output if clean node scripts/repo/check-regression-patterns.mts --json #
 *   Machine-readable node scripts/repo/check-regression-patterns.mts --explain.
 *
 *   # Long-form output Why a pattern-based check instead of "just more tests":
 *
 *   - Tests check behavior. These checks catch _shapes_ that have historically
 *     caused behavior bugs. They're strictly cheaper than writing a test for
 *     every abort-the-isolate path.
 *   - LLM-based scans found these patterns across 25 rounds. Codifying them turns
 *     one-time scan effort into permanent CI coverage.
 *   - Catches doc drift (skill docs referencing non-existent pnpm scripts) that
 *     escapes every other check. What it does NOT do:
 *   - Find NEW regression patterns. R27+ quality scans still need to run
 *     periodically to discover shapes we haven't seen yet.
 *   - Understand semantics. A match that's _obviously_ safe still fails the check
 *     — fix the shape so the regex doesn't fire, usually by switching to the
 *     canonical safer form (e.g. the `has_room(length, capacity, needed)`
 *     helper for size_t bounds checks).
 */

import { existsSync, promises as fsPromises, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { parseArgs } from 'node:util'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { errorMessage } from 'build-infra/lib/error-utils'

import { REGRESSIONS } from './check-regression-patterns-data.mts'
import type { Regression } from './check-regression-patterns-data.mts'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const MONOREPO_ROOT = path.join(__dirname, '..')

type Match = {
  file: string
  line: number
  column: number
  text: string
  regression: Regression
}

type Options = {
  explain: boolean
  json: boolean
  quiet: boolean
}

/**
 * Resolve every `pnpm run <script>` reference in skill/docs markdown
 * against the actual package.json script registry. Returns markdown
 * references whose target script does NOT exist in any package.json
 * within this monorepo.
 */
export async function findNonExistentPnpmScripts(
  regression: Regression,
): Promise<Match[]> {
  const matches: Match[] = []
  // Gather all known pnpm scripts across the monorepo.
  const knownScripts = new Set<string>()
  const collectPackageScripts = async (pkgJsonPath: string) => {
    if (!existsSync(pkgJsonPath)) {
      return
    }
    try {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
      const scripts = pkg.scripts || {}
      // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
      for (const name of Object.keys(scripts)) {
        knownScripts.add(name)
      }
    } catch {
      // ignore parse errors
    }
  }
  await collectPackageScripts(path.join(MONOREPO_ROOT, 'package.json'))
  const pkgsDir = path.join(MONOREPO_ROOT, 'packages')
  if (existsSync(pkgsDir)) {
    const entries = await fsPromises.readdir(pkgsDir, { withFileTypes: true })
    for (let i = 0, { length } = entries; i < length; i += 1) {
      const entry = entries[i]!
      if (entry.isDirectory()) {
        await collectPackageScripts(
          path.join(pkgsDir, entry.name, 'package.json'),
        )
      }
    }
  }

  // Grep markdown files for `pnpm run <script>`.
  const rawMatches = await runRipgrep(regression)
  // Documentation placeholders that intentionally aren't real scripts —
  // explicit examples in skill docs explaining the `pnpm run <name>`
  // convention.
  const placeholders = new Set(['bar', 'baz', 'foo', 'script'])
  for (let i = 0, { length } = rawMatches; i < length; i += 1) {
    const m = rawMatches[i]!
    // Skip Claude Code permission-glob patterns like
    //   Bash(pnpm run check:*)
    // Those describe a class of allowed Bash invocations, not a
    // literal `pnpm run` reference; the trailing `:*` is a wildcard
    // suffix in Claude Code's permission grammar.
    if (/Bash\([^)]*pnpm run [a-zA-Z][a-zA-Z0-9_-]*:\*/.test(m.text)) {
      continue
    }
    // Extract the script name from the captured line text. Use a
    // strict character class WITHOUT `:` — a colon ends the script
    // name (the part after `:` is a sub-script suffix like `:all`,
    // `:ci`, `:watch`).
    const runMatch = m.text.match(/pnpm run ([a-zA-Z][a-zA-Z0-9_-]*)/)
    if (!runMatch) {
      continue
    }
    const scriptName = runMatch[1]!
    if (placeholders.has(scriptName)) {
      continue
    }
    if (!knownScripts.has(scriptName)) {
      matches.push({
        ...m,
        text: `pnpm run ${scriptName} (not in any package.json)`,
      })
    }
  }
  return matches
}

export function printMatch(m: Match, options: Options): void {
  const opts = { __proto__: null, ...options } as typeof options
  const { regression } = m
  if (opts.json) {
    logger.log(
      JSON.stringify({
        column: m.column,
        file: m.file,
        line: m.line,
        pattern: regression.id,
        severity: regression.severity,
        text: m.text,
        title: regression.title,
      }),
    )
    return
  }
  const locator = `${m.file}:${m.line}:${m.column}`
  const sev = regression.severity.toUpperCase()
  logger.log('')
  logger.log(`[${sev}] ${regression.title}`)
  logger.log(`  ${locator}`)
  logger.log(`    ${m.text}`)
  if (opts.explain) {
    logger.log('')
    logger.log(`  Why it matters:`)
    // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
    for (const chunk of wrapText(regression.why, 74, 4)) {
      logger.log(chunk)
    }
    logger.log('')
    logger.log(`  Fix:`)
    // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
    for (const chunk of wrapText(regression.fix, 74, 4)) {
      logger.log(chunk)
    }
    if (regression.precedents.length > 0) {
      logger.log('')
      logger.log(
        `  This shape was shipped as a real bug in: ${regression.precedents.join(', ')}`,
      )
    }
  } else {
    logger.log(`  → rerun with --explain for why + fix`)
  }
}

export async function runRipgrep(regression: Regression): Promise<Match[]> {
  const matches: Match[] = []
  // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
  for (const scanPath of regression.paths) {
    const absPath = path.join(MONOREPO_ROOT, scanPath)
    if (!existsSync(absPath)) {
      continue
    }
    const args = ['--vimgrep', '--no-config', '--pcre2']
    if (regression.multiline) {
      // ripgrep needs --multiline AND --multiline-dotall for [\s\S]
      // to match newlines reliably across patterns. Without dotall
      // `.` still stops at \n even in multiline mode.
      args.push('--multiline', '--multiline-dotall')
    }
    args.push('-e', regression.pattern)
    if (regression.glob) {
      args.push('-g', regression.glob)
    }
    // Exclude upstream / build / node_modules / source-patched
    // mirrors, and this script itself (its description strings contain
    // pattern-like text that would self-match).
    args.push(
      '-g',
      '!**/upstream/**',
      '-g',
      '!**/build/**',
      '-g',
      '!**/node_modules/**',
      '-g',
      '!**/dist/**',
      '-g',
      '!**/out/**',
      '-g',
      '!**/source-patched/src/socketsecurity/{bin-infra,binject,build-infra}/**',
      '-g',
      '!scripts/repo/check-regression-patterns.mts',
    )
    args.push(absPath)
    // ripgrep exits 1 when there are no matches (not an error for us),
    // 2+ when something actually went wrong. Capture stdout regardless
    // and treat only genuine errors as failures. `error` is `unknown`
    // from catch, so narrow it defensively — no `as { code }` casts.
    let stdout = ''
    try {
      const result = await spawn('rg', args, {
        cwd: MONOREPO_ROOT,
        stdio: 'pipe',
      })
      stdout = String(result.stdout || '')
    } catch (e) {
      const code =
        typeof e === 'object' && e !== null && 'code' in e
          ? (e as { code?: unknown | undefined }).code
          : undefined
      const errStdout =
        typeof e === 'object' && e !== null && 'stdout' in e
          ? (e as { stdout?: unknown | undefined }).stdout
          : undefined
      if (code === 1 || code === '1') {
        // "no matches" — fine
        stdout = errStdout == null ? '' : String(errStdout)
      } else {
        throw e
      }
    }
    // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
    for (const rawLine of stdout.split('\n')) {
      if (!rawLine) {
        continue
      }
      // vimgrep format: file:line:col:text. The file path can contain ':'
      // (Windows drive letters, filenames like `2026-04-24:report.txt`,
      // colon-prefixed submodule refs) so splitting on bare ':' is wrong and
      // so is non-greedy `.+?:\d+` anchoring — that matches the FIRST `:<digit>`
      // pair, misattributing `foo:1:2:bar.ts:12:5:match` to `file="foo"`.
      // Use greedy `.+` so the regex engine backtracks to leave exactly
      // `:<line>:<col>:<text>` at the end — the last three colons are the
      // authoritative separators.
      const match = rawLine.match(/^(.+):(\d+):(\d+):(.*)$/)
      if (!match) {
        continue
      }
      const file = match[1]!
      const line = Number.parseInt(match[2]!, 10)
      const column = Number.parseInt(match[3]!, 10)
      const text = match[4]!.trim()
      // Skip pure comment lines — these describe the pattern, they
      // aren't instances of it. Handles C/C++ (`//`, `*`), markdown
      // (`>`), and TS JSDoc (`*`) line comments. Block comments
      // beginning with `/*` on the match line are also skipped.
      if (/^(?:>|\*|\/\*|\/\/)/.test(text) || /^\s*\*\s/.test(text)) {
        continue
      }
      matches.push({
        file: path.relative(MONOREPO_ROOT, file),
        line,
        column,
        text,
        regression,
      })
    }
  }
  return matches
}

export function wrapText(
  text: string,
  width: number,
  indent: number,
): string[] {
  const out: string[] = []
  const pad = ' '.repeat(indent)
  const words = text.split(/\s+/)
  let line = ''
  for (let i = 0, { length } = words; i < length; i += 1) {
    const w = words[i]!
    if (line.length + w.length + 1 > width) {
      out.push(pad + line)
      line = w
    } else {
      line = line ? `${line} ${w}` : w
    }
  }
  if (line) {
    out.push(pad + line)
  }
  return out
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      explain: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false },
    },
    strict: false,
  })
  const opts: Options = {
    explain: Boolean(values.explain),
    json: Boolean(values.json),
    quiet: Boolean(values.quiet),
  }

  if (!opts.quiet && !opts.json) {
    logger.info('Scanning for known regression patterns…')
  }

  const allMatches: Match[] = []
  for (let i = 0, { length } = REGRESSIONS; i < length; i += 1) {
    const regression = REGRESSIONS[i]!
    const matches =
      regression.id === 'docs-pnpm-run-nonexistent'
        ? await findNonExistentPnpmScripts(regression)
        : await runRipgrep(regression)
    allMatches.push(...matches)
  }

  if (allMatches.length === 0) {
    if (!opts.quiet && !opts.json) {
      logger.success(
        `No regression-pattern matches found (${REGRESSIONS.length} patterns)`,
      )
    }
    process.exitCode = 0
    return
  }

  // Group by pattern for a readable summary first.
  const byPattern = new Map<string, Match[]>()
  for (let i = 0, { length } = allMatches; i < length; i += 1) {
    const m = allMatches[i]!
    const key = m.regression.id
    const arr = byPattern.get(key) || []
    arr.push(m)
    byPattern.set(key, arr)
  }

  if (opts.json) {
    for (let i = 0, { length } = allMatches; i < length; i += 1) {
      const m = allMatches[i]!
      printMatch(m, opts)
    }
  } else {
    logger.error(
      `Found ${allMatches.length} regression-pattern match${allMatches.length === 1 ? '' : 'es'} across ${byPattern.size} pattern${byPattern.size === 1 ? '' : 's'}:`,
    )
    for (let i = 0, { length } = allMatches; i < length; i += 1) {
      const m = allMatches[i]!
      printMatch(m, opts)
    }
    logger.log('')
    logger.log('What to do:')
    logger.log(
      '  1. If it is a real bug: fix it (see --explain for the canonical fix).',
    )
    logger.log(
      '  2. If the match is provably safe: rewrite the code so the regex',
    )
    logger.log(
      '     no longer fires — usually by switching to the canonical safer',
    )
    logger.log(
      '     form (e.g. has_room helper for size_t bounds, fix-not-allow).',
    )
    logger.log('  3. Run with --explain for the full why + fix writeup.')
  }

  process.exitCode = 1
}

main().catch((e: unknown) => {
  logger.error(errorMessage(e))
  process.exitCode = 1
})
