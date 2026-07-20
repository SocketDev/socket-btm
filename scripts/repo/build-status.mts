#!/usr/bin/env node
/**
 * @file Builder publish-state inspector.
 *   Reads .github/cache-versions.json + queries `gh release list` for each
 *   builder in the publish dependency chain, then renders a table showing
 *   each builder's freshness gate against its cache-version bump.
 *   Output columns:
 *
 *   - Builder name
 *   - Tier (1 = leaf, 2 = stubs, 3 = binsuite, 4 = node-smol)
 *   - cache-version current value (e.g. v75)
 *   - latest release (date + short SHA)
 *   - Gate (✓ fresh / ✗ stale / — never published / ? unknown) Stale rows include
 *     the recovery command (which workflow to dispatch). Read-only — no state
 *     changes, no workflow dispatches. Usage: node
 *     scripts/repo/build-status.mts node scripts/repo/build-status.mts --json #
 *     machine-readable output node scripts/repo/build-status.mts
 *     --filter=tier1
 *
 *   # only tier-1 leaves
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  commitDate,
  findCacheVersionBumpSha,
  findLatestRelease,
  isDescendantOrEqual,
  resolveSha,
} from './check-publish-prereq.mts'

const logger = getDefaultLogger()

// oxlint-disable-next-line socket/no-process-cwd-in-scripts-hooks -- build-status.mts is invoked from `pnpm run build-status` which sets cwd=REPO_ROOT
const repoRoot = process.cwd()
const cacheVersionsPath = path.join(repoRoot, '.github', 'cache-versions.json')

if (!existsSync(cacheVersionsPath)) {
  logger.fail(`cache-versions.json not found at ${cacheVersionsPath}`)
  process.exit(1)
}

const cacheVersions = JSON.parse(readFileSync(cacheVersionsPath, 'utf8')) as {
  versions: Record<string, string>
}

interface BuilderRow {
  pkg: string
  tier: 1 | 2 | 3 | 4
  cacheVersion: string | undefined
  release: { date: string; sha: string } | undefined
  bumpSha: string | undefined
  bumpDate: string | undefined
  gate: 'fresh' | 'stale-date' | 'stale-sha' | 'never-published' | 'unknown'
  reason?: string | undefined
  dispatchWorkflow: string
}

interface BuilderEntry {
  pkg: string
  tier: 1 | 2 | 3 | 4
  dispatchWorkflow: string
}

// Mirrors CHAIN in check-publish-prereq.mts. Kept independent so the
// table can render tiers 1-4 even when the prereq script's CHAIN
// composition changes (which is data, not policy).
const BUILDERS: BuilderEntry[] = [
  { pkg: 'curl', tier: 1, dispatchWorkflow: 'curl.yml' },
  { pkg: 'dawn', tier: 1, dispatchWorkflow: 'dawn.yml' },
  { pkg: 'libpq', tier: 1, dispatchWorkflow: 'libpq.yml' },
  { pkg: 'lief', tier: 1, dispatchWorkflow: 'lief.yml' },
  { pkg: 'onnxruntime', tier: 1, dispatchWorkflow: 'onnxruntime.yml' },
  { pkg: 'opentui', tier: 1, dispatchWorkflow: 'opentui.yml' },
  { pkg: 'yoga-layout', tier: 1, dispatchWorkflow: 'yoga-layout.yml' },
  { pkg: 'stubs', tier: 2, dispatchWorkflow: 'stubs.yml' },
  { pkg: 'binflate', tier: 3, dispatchWorkflow: 'binsuite.yml' },
  { pkg: 'binject', tier: 3, dispatchWorkflow: 'binsuite.yml' },
  { pkg: 'binpress', tier: 3, dispatchWorkflow: 'binsuite.yml' },
  { pkg: 'node-smol', tier: 4, dispatchWorkflow: 'node-smol.yml' },
]

// oxlint-disable-next-line socket/sort-source-methods -- script ordered as a top-down pipeline (evaluate → render → main); alphabetizing would scatter the dataflow.
export async function evaluateBuilder(
  entry: BuilderEntry,
): Promise<BuilderRow> {
  const { dispatchWorkflow, pkg, tier } = entry
  const cacheVersion = cacheVersions.versions[pkg]

  if (!cacheVersion) {
    return {
      bumpDate: undefined,
      bumpSha: undefined,
      cacheVersion: undefined,
      dispatchWorkflow,
      gate: 'unknown',
      pkg,
      reason: 'no cache-versions.json entry',
      release: undefined,
      tier,
    }
  }

  const bumpSha = await findCacheVersionBumpSha(pkg, cacheVersion)
  const bumpDate = bumpSha ? await commitDate(bumpSha) : undefined
  const release = await findLatestRelease(pkg)

  if (!release) {
    return {
      bumpDate,
      bumpSha,
      cacheVersion,
      dispatchWorkflow,
      gate: 'never-published',
      pkg,
      release: undefined,
      tier,
    }
  }

  if (bumpDate && release.date < bumpDate) {
    return {
      bumpDate,
      bumpSha,
      cacheVersion,
      dispatchWorkflow,
      gate: 'stale-date',
      pkg,
      reason: `cache-version bumped ${bumpDate} but latest release dated ${release.date}`,
      release,
      tier,
    }
  }

  if (bumpSha) {
    const releaseSha = await resolveSha(release.sha)
    if (releaseSha) {
      const ok = await isDescendantOrEqual(releaseSha, bumpSha)
      if (!ok) {
        return {
          bumpDate,
          bumpSha,
          cacheVersion,
          dispatchWorkflow,
          gate: 'stale-sha',
          pkg,
          reason: `release SHA predates bump SHA (same date)`,
          release,
          tier,
        }
      }
    }
  }

  return {
    bumpDate,
    bumpSha,
    cacheVersion,
    dispatchWorkflow,
    gate: 'fresh',
    pkg,
    release,
    tier,
  }
}

// oxlint-disable-next-line socket/sort-source-methods -- helper grouped with renderTable; alphabetizing would scatter formatting helpers.
export function colorForGate(gate: BuilderRow['gate']): (s: string) => string {
  const codes = {
    fresh: '\x1b[32m',
    'never-published': '\x1b[90m',
    'stale-date': '\x1b[31m',
    'stale-sha': '\x1b[31m',
    unknown: '\x1b[33m',
  }
  const reset = '\x1b[0m'
  const code = codes[gate]
  return (s: string) => `${code}${s}${reset}`
}

export function gateSymbol(gate: BuilderRow['gate']): string {
  switch (gate) {
    case 'fresh':
      return 'fresh'
    case 'never-published':
      return 'never published'
    case 'stale-date':
      return 'stale (date)'
    case 'stale-sha':
      return 'stale (sha)'
    default:
      return 'unknown'
  }
}

export function renderTable(rows: BuilderRow[]): void {
  const headers = ['Builder', 'Tier', 'Version', 'Last Release', 'Gate']
  const data = rows.map(r => [
    r.pkg,
    `t${r.tier}`,
    r.cacheVersion ?? '-',
    r.release ? `${r.release.date} @ ${r.release.sha.slice(0, 8)}` : '-',
    gateSymbol(r.gate),
  ])

  const widths = headers.map((h, i) =>
    Math.max(h.length, ...data.map(row => row[i]!.length)),
  )

  const padCol = (s: string, w: number) => s + ' '.repeat(w - s.length)

  logger.log(headers.map((h, i) => padCol(h, widths[i]!)).join('  '))
  logger.log(widths.map(w => '-'.repeat(w)).join('  '))
  for (let i = 0, { length } = rows; i < length; i += 1) {
    const row = rows[i]!
    const cells = data[i]!
    const colorize = colorForGate(row.gate)
    const padded = cells.map((c, j) => padCol(c, widths[j]!))
    // Color the gate column only — keep the rest at default.
    padded[4] = colorize(padded[4]!)
    logger.log(padded.join('  '))
  }

  // Footer: recovery commands for stale rows.
  const stale = rows.filter(
    r => r.gate === 'stale-date' || r.gate === 'stale-sha',
  )
  if (stale.length > 0) {
    logger.log('')
    logger.log('To re-publish stale builders:')
    for (let i = 0, { length } = stale; i < length; i += 1) {
      const r = stale[i]!
      logger.log(
        `  gh workflow run ${r.dispatchWorkflow} -f dry-run=false  # ${r.pkg}: ${r.reason}`,
      )
    }
  }
  const never = rows.filter(r => r.gate === 'never-published')
  if (never.length > 0) {
    logger.log('')
    logger.log('Builders with no published release yet:')
    for (let i = 0, { length } = never; i < length; i += 1) {
      const r = never[i]!
      logger.log(
        `  gh workflow run ${r.dispatchWorkflow} -f dry-run=false  # ${r.pkg}`,
      )
    }
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      filter: { type: 'string' },
      json: { type: 'boolean' },
    },
    strict: false,
  })

  let builders = BUILDERS
  if (values.filter) {
    const f = String(values.filter).toLowerCase()
    if (f === 't1' || f === 'tier1') {
      builders = BUILDERS.filter(b => b.tier === 1)
    } else if (f === 't2' || f === 'tier2') {
      builders = BUILDERS.filter(b => b.tier === 2)
    } else if (f === 't3' || f === 'tier3') {
      builders = BUILDERS.filter(b => b.tier === 3)
    } else if (f === 't4' || f === 'tier4') {
      builders = BUILDERS.filter(b => b.tier === 4)
    } else if (f === 'stale') {
      // Resolved below after evaluation.
    } else {
      builders = BUILDERS.filter(b => b.pkg.includes(f))
    }
  }

  const rows: BuilderRow[] = []
  for (let i = 0, { length } = builders; i < length; i += 1) {
    rows.push(await evaluateBuilder(builders[i]!))
  }

  let displayRows = rows
  if (values.filter === 'stale') {
    displayRows = rows.filter(
      r => r.gate === 'stale-date' || r.gate === 'stale-sha',
    )
  }

  if (values.json) {
    logger.log(JSON.stringify(displayRows, null, 2))
    return
  }

  renderTable(displayRows)
}

main().catch(err => {
  logger.fail(`build-status failed: ${err}`)
  process.exitCode = 1
})
