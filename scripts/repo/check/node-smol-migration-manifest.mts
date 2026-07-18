#!/usr/bin/env node
/*
 * @file Migration inventory for the node-smol extraction boundary.
 *
 *   This is the machine-readable checkpoint for the current `packages/`
 *   surface. Each workspace package root gets exactly one row with:
 *   current path, public package name, current disposition, planned target
 *   repo, adapter kind, upstream pin placeholder, lockstep tracker, and
 *   removal status.
 *
 *   The check fails if a workspace package root is missing, duplicated, or
 *   renamed without the manifest being updated.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { isMainModule } from '../../fleet/_shared/is-main-module.mts'
import {
  NODE_SMOL_MIGRATION_MANIFEST,
  NODE_SMOL_NEXT_EXTRACTION_TARGETS,
} from './node-smol-migration-manifest-data.mts'

export {
  NODE_SMOL_MIGRATION_MANIFEST,
  NODE_SMOL_NEXT_EXTRACTION_TARGETS,
} from './node-smol-migration-manifest-data.mts'

const logger = getDefaultLogger()
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
)

export type CurrentDisposition =
  | 'node-smol-core'
  | 'destination-owned-rust-crate'
  | 'destination-owned-build-tool'
  | 'retired-duplicate'

export type PlannedDestination =
  | 'node-smol'
  | 'socket-btm'
  | 'sockeye'
  | 'stuie'

export type AdapterKind =
  | 'none'
  | 'build-tool'
  | 'builtin'
  | 'cli'
  | 'napi'
  | 'release-pack'

export type RemovalStatus = 'retained' | 'pending-move' | 'pending-retire'

export interface MigrationManifestRow {
  readonly currentPath: string
  readonly publicPackage: string
  readonly currentDisposition: CurrentDisposition
  readonly plannedDestination: PlannedDestination
  readonly adapterKind: AdapterKind
  readonly upstreamPin: string | undefined
  readonly lockstepTracker: string | undefined
  readonly removalStatus: RemovalStatus
}

export interface NodeSmolExtractionTarget {
  readonly name: string
  readonly plannedDestination: Exclude<PlannedDestination, 'stuie'> | 'stuie'
  readonly tier: 'tier-1b'
  readonly note: string
  readonly sourcePlan: string
}

export interface MigrationManifestFinding {
  readonly kind:
    | 'missing'
    | 'duplicate'
    | 'name-mismatch'
    | 'orphan'
    | 'invalid-disposition'
    | 'invalid-removal-status'
  readonly path: string
  readonly message: string
}

function allowedDestinationsFor(
  disposition: CurrentDisposition,
): ReadonlySet<PlannedDestination> {
  switch (disposition) {
    case 'node-smol-core':
      return new Set(['node-smol', 'socket-btm'])
    case 'destination-owned-rust-crate':
      return new Set(['sockeye', 'stuie'])
    case 'destination-owned-build-tool':
      return new Set(['node-smol', 'socket-btm', 'sockeye'])
    case 'retired-duplicate':
      return new Set(['node-smol'])
  }
}

function validateRowShape(
  row: MigrationManifestRow,
): MigrationManifestFinding[] {
  const findings: MigrationManifestFinding[] = []
  if (
    !allowedDestinationsFor(row.currentDisposition).has(row.plannedDestination)
  ) {
    findings.push({
      kind: 'invalid-disposition',
      message: `planned destination ${row.plannedDestination} does not fit disposition ${row.currentDisposition}`,
      path: row.currentPath,
    })
  }
  if (
    row.currentDisposition === 'retired-duplicate' &&
    row.removalStatus !== 'pending-retire'
  ) {
    findings.push({
      kind: 'invalid-removal-status',
      message: `retired duplicates must be marked pending-retire`,
      path: row.currentPath,
    })
  }
  if (
    row.currentDisposition !== 'retired-duplicate' &&
    row.removalStatus === 'pending-retire'
  ) {
    findings.push({
      kind: 'invalid-removal-status',
      message: `only retired duplicates may be marked pending-retire`,
      path: row.currentPath,
    })
  }
  return findings
}

function rowsGroupedByDestination(
  rows: readonly MigrationManifestRow[],
): Map<PlannedDestination, MigrationManifestRow[]> {
  const grouped = new Map<PlannedDestination, MigrationManifestRow[]>()
  for (let i = 0, { length } = rows; i < length; i += 1) {
    const manifestRow = rows[i]!
    const bucket = grouped.get(manifestRow.plannedDestination)
    if (bucket) {
      bucket.push(manifestRow)
    } else {
      grouped.set(manifestRow.plannedDestination, [manifestRow])
    }
  }
  const groupedValues = [...grouped.values()]
  for (let i = 0, { length } = groupedValues; i < length; i += 1) {
    const bucket = groupedValues[i]!
    bucket.sort((a, b) =>
      a.currentPath === b.currentPath
        ? a.publicPackage.localeCompare(b.publicPackage)
        : a.currentPath.localeCompare(b.currentPath),
    )
  }
  return grouped
}

export function formatNodeSmolMigrationReport(
  repoRoot: string,
  rows: readonly MigrationManifestRow[] = NODE_SMOL_MIGRATION_MANIFEST,
  nextTargets: readonly NodeSmolExtractionTarget[] = NODE_SMOL_NEXT_EXTRACTION_TARGETS,
): string {
  const findings = validateManifest(repoRoot, rows)
  const grouped = rowsGroupedByDestination(rows)
  const total = rows.length
  const moveCount = rows.filter(r => r.removalStatus === 'pending-move').length
  const retireCount = rows.filter(
    r => r.removalStatus === 'pending-retire',
  ).length
  const retainedCount = total - moveCount - retireCount
  const repoOrder = ['node-smol', 'socket-btm', 'sockeye', 'stuie'] as const
  const repoSummaries = repoOrder.map(destination => {
    const bucket = grouped.get(destination) ?? []
    const pending = bucket.filter(r => r.removalStatus !== 'retained').length
    return {
      destination,
      done: bucket.length - pending,
      pending,
      total: bucket.length,
    }
  })

  const lines: string[] = []
  lines.push('# node-smol extraction progress')
  lines.push('')
  lines.push(`**Workspace root:** \`${repoRoot}\``)
  lines.push(`**Current inventory:** ${total} rows`)
  lines.push(
    `**Status mix:** ${retainedCount} retained · ${moveCount} pending-move · ${retireCount} pending-retire`,
  )
  lines.push(
    `**Validation:** ${findings.length === 0 ? 'clean' : `${findings.length} finding(s)`}`,
  )
  lines.push('')

  lines.push('## Repo progress')
  lines.push('')
  lines.push('| Repo | Done | Pending | Total |')
  lines.push('|---|---:|---:|---:|')
  for (let i = 0, { length } = repoSummaries; i < length; i += 1) {
    const summary = repoSummaries[i]!
    lines.push(
      `| ${summary.destination} | ${summary.done} | ${summary.pending} | ${summary.total} |`,
    )
  }
  lines.push('')

  for (let i = 0, { length } = repoOrder; i < length; i += 1) {
    const destination = repoOrder[i]!
    const bucket = grouped.get(destination) ?? []
    lines.push(`## ${destination}`)
    lines.push('')
    if (!bucket.length) {
      lines.push('_No rows._')
      lines.push('')
      continue
    }
    const pending = bucket.filter(r => r.removalStatus !== 'retained')
    if (pending.length) {
      lines.push('Pending rows:')
      for (
        let j = 0, { length: pendingLength } = pending;
        j < pendingLength;
        j += 1
      ) {
        const manifestRow = pending[j]!
        lines.push(
          `- \`${manifestRow.currentPath}\` → ${manifestRow.plannedDestination} (${manifestRow.removalStatus}, ${manifestRow.adapterKind})`,
        )
      }
      lines.push('')
    }
    lines.push('| Path | Package | Disposition | Adapter | Status |')
    lines.push('|---|---|---|---|---|')
    for (
      let j = 0, { length: bucketLength } = bucket;
      j < bucketLength;
      j += 1
    ) {
      const manifestRow = bucket[j]!
      lines.push(
        `| \`${manifestRow.currentPath}\` | \`${manifestRow.publicPackage}\` | ${manifestRow.currentDisposition} | ${manifestRow.adapterKind} | ${manifestRow.removalStatus} |`,
      )
    }
    lines.push('')
  }

  lines.push('## Next extraction targets')
  lines.push('')
  lines.push(
    '_Temporary tier-1b inventory. Remove this section when the extraction boundary closes._',
  )
  lines.push('')
  lines.push('| Target | Destination | Tier | Note | Source |')
  lines.push('|---|---|---|---|---|')
  for (let i = 0, { length } = nextTargets; i < length; i += 1) {
    const target = nextTargets[i]!
    lines.push(
      `| \`${target.name}\` | ${target.plannedDestination} | ${target.tier} | ${target.note} | \`${target.sourcePlan}\` |`,
    )
  }
  lines.push('')

  if (findings.length) {
    lines.push('## Validation findings')
    lines.push('')
    lines.push('| Path | Kind | Message |')
    lines.push('|---|---|---|')
    for (let i = 0, { length } = findings; i < length; i += 1) {
      const finding = findings[i]!
      lines.push(
        `| \`${finding.path}\` | ${finding.kind} | ${finding.message} |`,
      )
    }
    lines.push('')
  }

  return lines.join('\n')
}

export function findWorkspacePackageJsonFiles(repoRoot: string): string[] {
  const packageDirs = [
    path.join(repoRoot, 'packages'),
    path.join(repoRoot, 'packages', 'npm', '@node-smol'),
  ]
  const files: string[] = []
  for (let i = 0, { length } = packageDirs; i < length; i += 1) {
    const dir = packageDirs[i]!
    if (!existsSync(dir)) {
      continue
    }
    const entries = readdirSync(dir, { withFileTypes: true })
    for (
      let j = 0, { length: entriesLength } = entries;
      j < entriesLength;
      j += 1
    ) {
      const entry = entries[j]!
      if (!entry.isDirectory()) {
        continue
      }
      const abs = path.join(dir, entry.name, 'package.json')
      if (existsSync(abs)) {
        files.push(abs)
      }
    }
  }
  return files.toSorted()
}

function packageRelPathFromPackageJson(
  repoRoot: string,
  packageJsonPath: string,
): string {
  return path.relative(repoRoot, path.dirname(packageJsonPath))
}

function readPackageName(packageJsonPath: string): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      name?: string | undefined
    }
    return parsed.name
  } catch {
    return undefined
  }
}

export function validateManifest(
  repoRoot: string,
  rows: readonly MigrationManifestRow[] = NODE_SMOL_MIGRATION_MANIFEST,
): MigrationManifestFinding[] {
  const findings: MigrationManifestFinding[] = []
  const manifestByPath = new Map<string, MigrationManifestRow[]>()
  for (let i = 0, { length } = rows; i < length; i += 1) {
    const manifestRow = rows[i]!
    const bucket = manifestByPath.get(manifestRow.currentPath)
    if (bucket) {
      bucket.push(manifestRow)
    } else {
      manifestByPath.set(manifestRow.currentPath, [manifestRow])
    }
  }

  const packageJsonFiles = findWorkspacePackageJsonFiles(repoRoot)
  const packagePaths = new Set<string>()
  for (let i = 0, { length } = packageJsonFiles; i < length; i += 1) {
    const packageJsonPath = packageJsonFiles[i]!
    const currentPath = packageRelPathFromPackageJson(repoRoot, packageJsonPath)
    packagePaths.add(currentPath)
    const pkgName = readPackageName(packageJsonPath)
    const rowsForPath = manifestByPath.get(currentPath)
    if (!rowsForPath) {
      findings.push({
        kind: 'missing',
        message: `missing manifest row for ${currentPath}`,
        path: currentPath,
      })
      continue
    }
    if (rowsForPath.length > 1) {
      findings.push({
        kind: 'duplicate',
        message: `duplicate manifest rows for ${currentPath}`,
        path: currentPath,
      })
    }
    const manifestRow = rowsForPath[0]!
    if (pkgName && manifestRow.publicPackage !== pkgName) {
      findings.push({
        kind: 'name-mismatch',
        message: `manifest name ${manifestRow.publicPackage} does not match package.json name ${pkgName} for ${currentPath}`,
        path: currentPath,
      })
    }
  }

  for (let i = 0, { length } = rows; i < length; i += 1) {
    const manifestRow = rows[i]!
    findings.push(...validateRowShape(manifestRow))
    if (!packagePaths.has(manifestRow.currentPath)) {
      findings.push({
        kind: 'orphan',
        message: `manifest row has no corresponding workspace package root: ${manifestRow.currentPath}`,
        path: manifestRow.currentPath,
      })
    }
  }

  return findings.toSorted((a, b) => a.path.localeCompare(b.path))
}

async function main(): Promise<number> {
  const findings = validateManifest(REPO_ROOT)
  if (!findings.length) {
    logger.success(
      '[node-smol-migration-manifest] every workspace package root has exactly one migration row.',
    )
    return 0
  }
  logger.fail(
    `[node-smol-migration-manifest] ${findings.length} finding(s) in the migration manifest:`,
  )
  logger.group()
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const finding = findings[i]!
    logger.fail(`${finding.path} — ${finding.message}`)
  }
  logger.groupEnd()
  logger.log(
    'Fix: update scripts/repo/check/node-smol-migration-manifest.mts so the current workspace package inventory and its destination metadata stay in sync.',
  )
  return 1
}

if (isMainModule(import.meta.url)) {
  void main().then(code => {
    process.exitCode = code
  })
}
