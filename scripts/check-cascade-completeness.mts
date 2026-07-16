#!/usr/bin/env node
/**
 * @file Cascade-completeness checker. Walks three sources of cross-package
 *   build dependencies:
 *
 *   1. Makefile `include ../foo/make/...` directives
 *   2. TypeScript imports from `build-infra/...`, `bin-infra/...`,
 *      `curl-builder/...`, `lief-builder/...`, etc.
 *   3. Dockerfile `COPY packages/foo/...` directives And cross-checks each
 *      discovered dependency against: A. `scripts/validate-cache-versions.mts`
 *      CASCADE_RULES B. The consuming workflow's cache-key composition Reports
 *      every path that exists on disk AND is referenced by a builder AND has no
 *      matching cascade rule OR workflow hash. This catches the shape that was
 *      the bulk of R18-R27 scope creep — R18 missed `build-infra/wasm-synced/`,
 *      R19 missed `curl-builder/ {docker,lib,scripts}/`, R20 missed
 *      `lief-builder/{lib,scripts}/`, R24 missed root package.json +
 *      pnpm-workspace.yaml across 11 workflows, R27 missed LIEF in stubs.yml.
 *      All same shape: dependency exists, builder uses it, cache doesn't know.
 *      Output mirrors check-regression-patterns.mts — file:line + why + fix +
 *      what to do, plus a clean JSON mode for tooling. Usage: node
 *      scripts/check-cascade-completeness.mts node
 *      scripts/check-cascade-completeness.mts --explain node
 *      scripts/check-cascade-completeness.mts --json Allowlist at
 *      `.github/cascade-completeness-allowlist.yml`.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { parseArgs } from 'node:util'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { errorMessage } from 'build-infra/lib/error-utils'

import {
  collectDockerfileCopies,
  collectMakefileIncludes,
  collectTypeScriptImports,
  MONOREPO_ROOT,
} from './check-cascade-completeness-collectors.mts'
import type { Finding } from './check-cascade-completeness-collectors.mts'

const logger = getDefaultLogger()

const ALLOWLIST_PATH = path.join(
  MONOREPO_ROOT,
  '.github',
  'cascade-completeness-allowlist.yml',
)

type AllowlistEntry = {
  consumer: string
  gap: 'cascade-rule' | 'workflow-hash'
  missingPath: string
  reason: string
}

type Options = {
  explain: boolean
  json: boolean
  quiet: boolean
}

export function loadAllowlist(): AllowlistEntry[] {
  if (!existsSync(ALLOWLIST_PATH)) {
    return []
  }
  const content = readFileSync(ALLOWLIST_PATH, 'utf8')
  const entries: AllowlistEntry[] = []
  let current: Partial<AllowlistEntry> = {}
  // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed === '---') {
      continue
    }
    if (line.startsWith('- ')) {
      if (
        current.missingPath &&
        current.consumer &&
        current.gap &&
        current.reason
      ) {
        entries.push(current as AllowlistEntry)
      }
      current = {}
      // Matches a YAML `key: value` line: word-chars up to the first
      // colon (group 1) then the rest of the line trimmed (group 2).
      const firstKv = line.slice(2).match(/^(\w+):\s*(.+)$/)
      if (firstKv) {
        const key = firstKv[1]!
        // Strips a single leading and/or trailing quote (' or ") from
        // a YAML scalar value.
        const value = firstKv[2]!.replace(/^['"]|['"]$/g, '')
        ;(current as Record<string, unknown>)[key] = value
      }
      continue
    }
    // Matches a YAML `key: value` line: word-chars up to the first
    // colon (group 1) then the rest of the line trimmed (group 2).
    const kv = trimmed.match(/^(\w+):\s*(.+)$/)
    if (kv) {
      const key = kv[1]!
      // Strips a single leading and/or trailing quote (' or ") from a
      // YAML scalar value.
      const value = kv[2]!.replace(/^['"]|['"]$/g, '')
      ;(current as Record<string, unknown>)[key] = value
    }
  }
  if (
    current.missingPath &&
    current.consumer &&
    current.gap &&
    current.reason
  ) {
    entries.push(current as AllowlistEntry)
  }
  return entries
}

export function printFinding(f: Finding, options: Options): void {
  const opts = { __proto__: null, ...options }
  if (opts.json) {
    logger.log(JSON.stringify(f))
    return
  }
  const label =
    f.gap === 'cascade-rule'
      ? 'Missing CASCADE_RULE'
      : 'Missing workflow cache-key hash'
  logger.log('')
  logger.log(`[${label}] ${f.missingPath}`)
  logger.log(`  Discovered at: ${f.discoveredAt}`)
  logger.log(`  Consumer:      ${f.consumer}`)
  logger.log(`  Source:        ${f.source}`)
  if (opts.explain) {
    logger.log('')
    if (f.gap === 'cascade-rule') {
      logger.log(
        `  Fix: add to CASCADE_RULES in scripts/validate-cache-versions.mts`,
      )
      logger.log(
        `       with the downstream packages that should bump when this path changes.`,
      )
    } else {
      logger.log(
        `  Fix: add ${f.missingPath} hash to the cache-key composition in`,
      )
      logger.log(`       ${f.consumer} (or extend setup-checkpoints FIND_PATHS`)
      logger.log(`       if that action is used).`)
    }
  }
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
    logger.info('Checking cross-package cascade completeness…')
  }

  const allowlist = loadAllowlist()
  const allowSet = new Set(
    allowlist.map(e => `${e.consumer}|${e.gap}|${e.missingPath}`),
  )

  const findings: Finding[] = []
  findings.push(...collectMakefileIncludes())
  findings.push(...collectTypeScriptImports())
  findings.push(...collectDockerfileCopies())

  const surviving = findings.filter(
    f => !allowSet.has(`${f.consumer}|${f.gap}|${f.missingPath}`),
  )

  // Dedup — same (consumer, gap, missingPath) may be discovered through
  // multiple files; report once but include one discoveredAt sample.
  const seen = new Set<string>()
  const deduped: Finding[] = []
  for (let i = 0, { length } = surviving; i < length; i += 1) {
    const f = surviving[i]!
    const key = `${f.consumer}|${f.gap}|${f.missingPath}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    deduped.push(f)
  }

  if (deduped.length === 0) {
    if (!opts.quiet && !opts.json) {
      // `findings.length` counts every raw match (including duplicates
      // across sibling files); it's 0 only when every dep fully
      // resolves. Report allowlist size and the number of raw matches
      // bypassed so the "all clean" case still conveys the scan ran.
      logger.success(
        `No cascade gaps found (${findings.length} raw matches, ${allowlist.length} allowlisted)`,
      )
    }
    process.exitCode = 0
    return
  }

  if (!opts.json) {
    logger.error(
      `Found ${deduped.length} cascade gap${deduped.length === 1 ? '' : 's'}:`,
    )
  }
  for (let i = 0, { length } = deduped; i < length; i += 1) {
    const f = deduped[i]!
    printFinding(f, opts)
  }
  if (!opts.json) {
    logger.log('')
    logger.log('What to do:')
    logger.log('  1. If the gap is real: add to CASCADE_RULES or the workflow')
    logger.log(
      '     cache-key composition (see --explain for placement hints).',
    )
    logger.log('  2. If the dep is genuinely not build-affecting: add to')
    logger.log('     .github/cascade-completeness-allowlist.yml with a reason.')
    logger.log('  3. Run with --explain for fix guidance per finding.')
  }
  process.exitCode = 1
}

main().catch((e: unknown) => {
  logger.error(errorMessage(e))
  process.exitCode = 1
})
