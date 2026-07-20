#!/usr/bin/env node
/**
 * @file Patch format validator.
 *   Validates every `.patch` under `packages/*\/patches/` against the
 *   conventions in CLAUDE.md's "Source Patches" section and the format
 *   lessons from R14-R21 quality scans:
 *
 *   1. Starts with `# @<project>-versions: vX.Y.Z` header (allowed projects: node
 *      / lief / opentui)
 *   2. Has a `# @description: <one-liner>` header
 *   3. Uses standard unified diff format (`--- a/`, `+++ b/`), NOT `git
 *      format-patch` output (which starts with `From <sha>`)
 *   4. Hunk headers `@@ -A,B +C,D @@` have correct line counts: sum of context
 *      (space-prefixed) + minus lines == B sum of context (space-prefixed) +
 *      plus lines == C Malformed counts make `patch --dry-run` silently reject;
 *      this validator actually counts the bytes.
 *   5. Touches exactly one file (per CLAUDE.md "Patch Rules"). The numbered-prefix
 *      series (001-, 002-, ...) enforces ordering.
 *   6. Numbered patches in a series have no gaps (e.g. 001, 002, 004 without 003).
 *      Gaps are allowed if documented — add to the allowlist with a `gap-ok`
 *      entry.
 *   7. Each source file is touched by AT MOST ONE patch in the series (per
 *      CLAUDE.md "Patch Rules": 1 patch, 1 file). Two patches modifying the
 *      same file is a convention violation — fold them into a single patch.
 *      Allowlist with rule `multiple-patches-per-file` if the split is
 *      intentional and documented. Wired into `pnpm run check` so CI fails on
 *      any regression. Usage: node scripts/repo/check-patch-format.mts node
 *      scripts/repo/check-patch-format.mts --explain node
 *      scripts/repo/check-patch-format.mts --json Allowlist:
 *      `.github/patch-format-allowlist.yml`.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { parseArgs } from 'node:util'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { naturalCompare } from '@socketsecurity/lib-stable/sorts/natural'

import { errorMessage } from 'build-infra/lib/error-utils'

import {
  collectMultiplePatchesPerFileViolations,
  collectNumberGapViolations,
  MONOREPO_ROOT,
  validatePatch,
} from './check-patch-format-collectors.mts'
import type { Violation } from './check-patch-format-collectors.mts'

const logger = getDefaultLogger()

const ALLOWLIST_PATH = path.join(
  MONOREPO_ROOT,
  '.github',
  'patch-format-allowlist.yml',
)

// Known patch roots. Each entry maps to an allowed `@<project>-versions`
// token — validator rejects patches with a mismatched project tag so a
// lief patch can't land in the ink tree with stale headers.
const PATCH_ROOTS: Array<{ dir: string; project: string }> = [
  {
    dir: 'packages/node-smol-builder/patches/source-patched',
    project: 'node',
  },
  { dir: 'packages/lief-builder/patches/lief', project: 'lief' },
  { dir: 'packages/opentui-builder/patches', project: 'opentui' },
]

type AllowlistEntry = {
  file: string
  rule: string
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
      if (current.file && current.rule && current.reason) {
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
  if (current.file && current.rule && current.reason) {
    entries.push(current as AllowlistEntry)
  }
  return entries
}

export function printViolation(v: Violation, options: Options): void {
  const opts = { __proto__: null, ...options } as typeof options
  if (opts.json) {
    logger.log(JSON.stringify(v))
    return
  }
  logger.log('')
  logger.log(`[${v.rule}] ${v.file}:${v.line}`)
  logger.log(`  ${v.detail}`)
  if (opts.explain && v.fix) {
    logger.log(`  Fix: ${v.fix}`)
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

  const allowlist = loadAllowlist()
  const allowSet = new Set(allowlist.map(e => `${e.file}|${e.rule}`))

  if (!opts.quiet && !opts.json) {
    logger.info('Validating patch format…')
  }

  const allViolations: Violation[] = []
  let patchesScanned = 0
  for (
    let rootIndex = 0, { length: rootCount } = PATCH_ROOTS;
    rootIndex < rootCount;
    rootIndex += 1
  ) {
    const root = PATCH_ROOTS[rootIndex]!
    const absRoot = path.join(MONOREPO_ROOT, root.dir)
    if (!existsSync(absRoot)) {
      continue
    }
    let files: string[]
    try {
      files = readdirSync(absRoot)
        .filter(f => f.endsWith('.patch'))
        .toSorted(naturalCompare)
    } catch {
      continue
    }
    for (
      let fileIndex = 0, { length: fileCount } = files;
      fileIndex < fileCount;
      fileIndex += 1
    ) {
      const f = files[fileIndex]!
      const abs = path.join(absRoot, f)
      try {
        const stat = statSync(abs)
        if (!stat.isFile()) {
          continue
        }
      } catch {
        continue
      }
      patchesScanned += 1
      allViolations.push(...validatePatch(abs, root.project))
    }
    allViolations.push(...collectNumberGapViolations(absRoot))
    allViolations.push(...collectMultiplePatchesPerFileViolations(absRoot))
  }

  const surviving = allViolations.filter(
    v => !allowSet.has(`${v.file}|${v.rule}`),
  )

  if (surviving.length === 0) {
    if (!opts.quiet && !opts.json) {
      logger.success(
        `No patch format violations found (${patchesScanned} patches, ${allowlist.length} allowlisted)`,
      )
    }
    process.exitCode = 0
    return
  }

  if (!opts.json) {
    logger.error(
      `Found ${surviving.length} patch format violation${surviving.length === 1 ? '' : 's'}:`,
    )
  }
  for (let i = 0, { length } = surviving; i < length; i += 1) {
    const v = surviving[i]!
    printViolation(v, opts)
  }
  if (!opts.json) {
    logger.log('')
    logger.log('What to do:')
    logger.log(
      '  1. Fix the format issue. Run with --explain for per-violation fix hints.',
    )
    logger.log(
      '  2. If the violation is intentional (e.g. numbered-series gap from',
    )
    logger.log(
      '     a removed patch): add to .github/patch-format-allowlist.yml with',
    )
    logger.log('     file, rule, and a reason.')
    logger.log('  3. See CLAUDE.md "Source Patches" for the canonical format.')
  }
  process.exitCode = 1
}

main().catch((e: unknown) => {
  logger.error(errorMessage(e))
  process.exitCode = 1
})
