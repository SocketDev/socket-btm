#!/usr/bin/env node
/**
 * @file External dependency version consistency checker.
 *   Every upstream dependency in this monorepo has AT LEAST two places
 *   where its version is declared:
 *
 *   1. .gitmodules version comment — `# <pkg>-X.Y.Z [sha256:...]` on the line
 *      immediately before [submodule "..."]
 *   2. packages/<pkg-builder>/package.json sources.<upstream>.version (+ .ref,
 *      which should match the submodule gitlink commit SHA)
 *   3. (optional) lockstep.json `packages.<name>.version`
 *   4. (optional) workflow env: pins (e.g. ZIG_VERSION in opentui.yml) When these
 *      get out of sync — R31 found onnxruntime-builder pinned at 1.20.1 in
 *      package.json but 1.24.4 in .gitmodules + lockstep.json — CI tags caches
 *      and releases with the wrong version. The workflows read one source of
 *      truth (package.json), the submodule checks out another (gitmodules
 *      gitlink), and the release label says a third. This checker
 *      cross-references all four sources and fails if any disagree. In addition
 *      to cross-source consistency, the checker validates the `.gitmodules`
 *      comment shape itself:
 *
 *   - `comment-missing` — no "# name-version" comment above the [submodule]
 *     section.
 *   - `comment-name-mismatch` — the <name> slug doesn't appear in the submodule
 *     path (catches typos and stale comments on renamed paths).
 *   - `comment-version-format` — the <version> portion has no digit (catches
 *     "rc1" or "main" pasted as a placeholder).
 *   - `comment-sha256-format` — optional sha256:<hex> isn't exactly 64 lowercase
 *     hex chars (catches truncation, uppercase paste, or non-hex
 *     contamination). Wired into `pnpm run check` via check.mts. Usage: node
 *     scripts/check-version-consistency.mts node
 *     scripts/check-version-consistency.mts --explain node
 *     scripts/check-version-consistency.mts --json Allowlist:
 *     `.github/version-consistency-allowlist.yml` for intentional mismatches
 *     (e.g. a builder pinning an older API-compat version while the submodule
 *     tracks newer).
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { parseArgs } from 'node:util'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { errorMessage } from 'build-infra/lib/error-utils'

import {
  collectMismatches,
  MONOREPO_ROOT,
} from './check-version-consistency-collectors.mts'
import type { Mismatch } from './check-version-consistency-collectors.mts'

const logger = getDefaultLogger()

const ALLOWLIST_PATH = path.join(
  MONOREPO_ROOT,
  '.github',
  'version-consistency-allowlist.yml',
)

type AllowlistEntry = {
  upstream: string
  reason: string
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
      if (current.upstream && current.reason) {
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
  if (current.upstream && current.reason) {
    entries.push(current as AllowlistEntry)
  }
  return entries
}

type Options = {
  explain: boolean
  json: boolean
  quiet: boolean
}

export function printMismatch(m: Mismatch, options: Options): void {
  const opts = { __proto__: null, ...options } as typeof options
  if (opts.json) {
    logger.log(JSON.stringify(m))
    return
  }
  logger.log('')
  logger.log(`[${m.kind} drift] ${m.upstream}`)
  // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
  for (const loc of m.locations) {
    logger.log(`  ${loc.source}`)
    logger.log(`    → ${loc.value}`)
  }
  if (opts.explain) {
    logger.log('')
    switch (m.kind) {
      case 'version':
        logger.log(
          `  Fix: pick the authoritative version and update every site to match.`,
        )
        logger.log(
          `       Usually .gitmodules is canonical; workflows read package.json`,
        )
        logger.log(
          `       for cache keys + release labels, so both must agree.`,
        )
        break
      case 'ref':
        logger.log(
          `  Fix: update sources.${m.upstream}.ref in packages/<pkg>/package.json`,
        )
        logger.log(
          `       to the full commit SHA from \`git ls-tree HEAD <submodule>\`.`,
        )
        break
      case 'comment-missing':
        logger.log(
          `  Fix: add a "# <name>-<version>" comment on the line BEFORE the`,
        )
        logger.log(`       [submodule "..."] header. Example:`)
        logger.log(`         # ${m.upstream}-1.2.3`)
        logger.log(`         [submodule "..."]`)
        logger.log(
          `       The optional sha256 of the release tarball can follow:`,
        )
        logger.log(`         # ${m.upstream}-1.2.3 sha256:<64 hex chars>`)
        break
      case 'comment-name-mismatch':
        logger.log(
          `  Fix: the <name> in the "# <name>-<version>" comment must appear`,
        )
        logger.log(
          `       as a path segment of the submodule (typically the basename).`,
        )
        logger.log(
          `       Either fix the comment's slug or rename the submodule path.`,
        )
        break
      case 'comment-version-format':
        logger.log(
          `  Fix: the <version> portion of "# <name>-<version>" must include`,
        )
        logger.log(
          `       at least one digit. Use the upstream's released tag form:`,
        )
        logger.log(`         # ${m.upstream}-1.2.3`)
        logger.log(`         # ${m.upstream}-v25.9.0`)
        logger.log(`         # ${m.upstream}-2026-02-24_21H  (epoch tags)`)
        break
      case 'comment-sha256-format':
        logger.log(
          `  Fix: sha256:<hex> must be exactly 64 lowercase hex characters.`,
        )
        logger.log(`       Re-derive the digest from the release tarball:`)
        logger.log(
          `         shasum -a 256 <tarball> | cut -d' ' -f1 | tr A-Z a-z`,
        )
        break
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

  const allowlist = loadAllowlist()
  const allowSet = new Set(allowlist.map(e => e.upstream))

  if (!opts.quiet && !opts.json) {
    logger.info('Checking external dependency version consistency…')
  }

  const allMismatches = await collectMismatches()
  const surviving = allMismatches.filter(m => !allowSet.has(m.upstream))

  if (surviving.length === 0) {
    if (!opts.quiet && !opts.json) {
      logger.success(
        `No version drift found (${allMismatches.length} raw, ${allowlist.length} allowlisted)`,
      )
    }
    process.exitCode = 0
    return
  }

  if (!opts.json) {
    logger.error(
      `Found ${surviving.length} version drift${surviving.length === 1 ? '' : 's'}:`,
    )
  }
  for (let i = 0, { length } = surviving; i < length; i += 1) {
    const m = surviving[i]!
    printMismatch(m, opts)
  }
  if (!opts.json) {
    logger.log('')
    logger.log('What to do:')
    logger.log(
      '  1. Align all sites to the same version. `.gitmodules` is usually',
    )
    logger.log(
      '     canonical; update package.json sources.<upstream>.version + .ref',
    )
    logger.log(`     to match.`)
    logger.log('  2. If the mismatch is intentional (builder pinning a stable')
    logger.log(
      '     API-compat version while the submodule tracks newer), add to',
    )
    logger.log('     .github/version-consistency-allowlist.yml with a reason.')
    logger.log('  3. Run with --explain for per-finding fix guidance.')
  }
  process.exitCode = 1
}

main().catch((e: unknown) => {
  logger.error(errorMessage(e))
  process.exitCode = 1
})
