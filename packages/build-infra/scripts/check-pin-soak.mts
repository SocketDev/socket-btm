/**
 * check-pin-soak — auditor for external pin soak compliance.
 *
 * Walks every pin surface in the repo and verifies the soak policy from
 * lib/soak-policy.mts:
 *
 *   - .gitmodules submodule SHA pins
 *   - .github/workflows/**\/*.yml + .github/actions/**\/*.yml uses: pins
 *   - **\/Dockerfile* FROM @sha256: digests
 *   - **\/external-tools.json `published` fields
 *   - pnpm-workspace.yaml minimumReleaseAgeExclude annotations
 *
 * Pure annotation validation — no network. The hook
 * `.claude/hooks/fleet/pin-soak-guard/` probes the registry at edit time;
 * this script just re-confirms the math on every pin.
 *
 * A finding's `status` is one of:
 *   - soaked          — past the 7d floor.
 *   - in-soak         — inside the 7d window with an annotation (allowed).
 *   - unannotated     — no annotation; informational.
 *
 * Workflow `uses:` pins encode the publish date IN the pin line itself
 * (the SHA-pin trailing-date comment), so they never have a separate
 * "annotation to clean up" — they're filtered out of the cleanup bucket
 * automatically by the `hasSeparateAnnotation` flag on the finding.
 *
 * Exit 0 today (informational mode). Once the pin-soak-guard hook is
 * enforcing annotations at edit time, flip to fail on in-soak findings.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { errorMessage } from '@socketsecurity/lib-stable/errors'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { SOAK_DAYS, checkSoak, parseAnnotation } from '../lib/soak-policy.mts'

const logger = getDefaultLogger()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')

const args = process.argv.slice(2)
const verbose = args.includes('--verbose') || args.includes('-v')
const jsonOutput = args.includes('--json')

const findings = []

// =============================================================================
// Surface walkers — alphabetical (fleet `socket/sort-source-methods`).
// =============================================================================

export function auditDockerfiles() {
  const fromRe = /^\s*FROM\s+\S+@sha256:[a-f0-9]{64}/
  for (const file of walk(REPO_ROOT, p => /Dockerfile(\.[^/]+)?$/.test(p))) {
    const lines = readFileSync(file, 'utf8').split('\n')
    for (let i = 0, { length } = lines; i < length; i += 1) {
      if (!fromRe.test(lines[i])) {
        continue
      }
      recordPinWithSeparateAnnotation(file, lines, i, lines[i].trim(), 'dockerfile-from')
    }
  }
}

export function auditExternalToolsJson() {
  for (const file of walk(REPO_ROOT, p =>
    /external-tools\.json$/.test(p) && !p.includes('node_modules'),
  )) {
    let parsed
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'))
    } catch (error) {
      pushUnannotated(
        'external-tools',
        file,
        0,
        '(parse error)',
        `JSON parse error: ${errorMessage(error)}`,
      )
      continue
    }
    const tools = parsed.tools ?? {}
    for (const [name, entry] of Object.entries(tools)) {
      if (
        entry === null ||
        typeof entry !== 'object' ||
        typeof entry.version !== 'string'
      ) {
        continue
      }
      const identifier = `${name}@${entry.version}`
      if (typeof entry.published !== 'string') {
        pushUnannotated(
          'external-tools',
          file,
          0,
          identifier,
          'no `published` field (backfill for full soak coverage)',
        )
        continue
      }
      pushFromSoak('external-tools', file, 0, identifier, entry.published, false)
    }
  }
}

export function auditGitmodules() {
  const file = path.join(REPO_ROOT, '.gitmodules')
  if (!existsSync(file)) {
    return
  }
  const lines = readFileSync(file, 'utf8').split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const submoduleMatch = lines[i].match(/^\[submodule "([^"]+)"\]$/)
    if (submoduleMatch === null) {
      continue
    }
    recordPinWithSeparateAnnotation(file, lines, i, submoduleMatch[1], 'gitmodules')
  }
}

export function auditPnpmWorkspace() {
  const file = path.join(REPO_ROOT, 'pnpm-workspace.yaml')
  if (!existsSync(file)) {
    return
  }
  const lines = readFileSync(file, 'utf8').split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const annotation = parseAnnotation(lines[i])
    if (annotation === undefined) {
      continue
    }
    let pkgLine = '(annotation orphan)'
    for (let j = i + 1; j < length; j += 1) {
      if (lines[j].trim() !== '') {
        pkgLine = lines[j].trim()
        break
      }
    }
    pushFromSoak('pnpm-workspace', file, i + 1, pkgLine, annotation.published, true)
  }
}

export function auditWorkflows() {
  const usesPinRe =
    /^\s*-?\s*uses:\s*([^@\s]+)@([a-f0-9]{40})\s*#\s*[^(]+\((\d{4}-\d{2}-\d{2})\)/
  const root = path.join(REPO_ROOT, '.github')
  for (const file of walk(root, p => /\.ya?ml$/.test(p))) {
    const lines = readFileSync(file, 'utf8').split('\n')
    for (let i = 0, { length } = lines; i < length; i += 1) {
      const match = lines[i].match(usesPinRe)
      if (match === null) {
        continue
      }
      pushFromSoak(
        'workflow-uses',
        file,
        i + 1,
        `${match[1]}@${match[2].slice(0, 8)}`,
        match[3],
        false,
      )
    }
  }
}

// =============================================================================
// Helpers — alphabetical. All take absolute `file`; relativize on push.
// =============================================================================

export function printBucket(label, items, alwaysList) {
  if (items.length === 0) {
    return
  }
  logger.log(`${label} (${items.length}):`)
  if (alwaysList || verbose) {
    for (let i = 0, { length } = items; i < length; i += 1) {
      const f = items[i]
      logger.log(`  - [${f.surface}] ${f.identifier} (${f.file}:${f.lineNumber})`)
      logger.log(`    ${f.note}`)
    }
  }
  logger.log('')
}

export function pushFromSoak(
  surface,
  file,
  lineNumber,
  identifier,
  published,
  hasSeparateAnnotation,
) {
  const soak = checkSoak(published)
  findings.push({
    surface,
    file: path.relative(REPO_ROOT, file),
    lineNumber,
    identifier,
    status: soak.soaked ? 'soaked' : 'in-soak',
    hasSeparateAnnotation,
    note: soak.soaked
      ? `soaked (${soak.daysOld}d old)`
      : `IN SOAK: ${soak.daysOld}d old, ${SOAK_DAYS - soak.daysOld}d remaining`,
  })
}

export function pushUnannotated(surface, file, lineNumber, identifier, note) {
  findings.push({
    surface,
    file: path.relative(REPO_ROOT, file),
    lineNumber,
    identifier,
    status: 'unannotated',
    hasSeparateAnnotation: false,
    note,
  })
}

// Walk up to 8 lines above `lineIndex` for the closest `# published:`
// annotation. Used by surfaces where the annotation is a separate comment
// line above the pin (.gitmodules, Dockerfiles).
export function recordPinWithSeparateAnnotation(
  file,
  lines,
  lineIndex,
  identifier,
  surface,
) {
  for (let j = lineIndex - 1; j >= Math.max(0, lineIndex - 8); j -= 1) {
    const annotation = parseAnnotation(lines[j])
    if (annotation !== undefined) {
      pushFromSoak(surface, file, j + 1, identifier, annotation.published, true)
      return
    }
  }
  pushUnannotated(
    surface,
    file,
    lineIndex + 1,
    identifier,
    'no `# published: YYYY-MM-DD` annotation within 8 lines above',
  )
}

export function* walk(dir, predicate) {
  if (!existsSync(dir)) {
    return
  }
  for (const entry of readdirSync(dir)) {
    if (entry === '.git' || entry === 'node_modules' || entry === 'upstream') {
      continue
    }
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) {
      yield* walk(full, predicate)
    } else if (predicate(full)) {
      yield full
    }
  }
}

// =============================================================================
// Driver
// =============================================================================
auditDockerfiles()
auditExternalToolsJson()
auditGitmodules()
auditPnpmWorkspace()
auditWorkflows()

const inSoak = findings.filter(f => f.status === 'in-soak')
const unannotated = findings.filter(f => f.status === 'unannotated')
// Only surfaces with a SEPARATE annotation line have something to clean
// up. Workflow `uses:` pins encode the date in the pin line itself.
const soakedAnnotated = findings.filter(
  f => f.status === 'soaked' && f.hasSeparateAnnotation,
)

// Exit 0 today — informational mode. Flip to `inSoak.length > 0` once
// pin-soak-guard hook is enforcing annotations at edit time.
const exitCode = 0

if (jsonOutput) {
  logger.log(
    JSON.stringify({ findings, inSoak, unannotated, soakedAnnotated }, undefined, 2),
  )
} else {
  logger.log('')
  logger.log(`=== Pin soak audit (floor: ${SOAK_DAYS}d) ===`)
  logger.log('')
  if (verbose) {
    for (let i = 0, { length } = findings; i < length; i += 1) {
      const f = findings[i]
      logger.log(`[${f.surface}] ${f.identifier}`)
      logger.log(`  ${f.file}:${f.lineNumber}`)
      logger.log(`  ${f.note}`)
      logger.log('')
    }
  }
  printBucket('! pin(s) in 7-day soak (annotated; allowed)', inSoak, true)
  printBucket('i pin(s) without annotation (backfill opportunity)', unannotated, false)
  printBucket(
    'i pin(s) past soak with annotation (cleanup opportunity)',
    soakedAnnotated,
    false,
  )
  logger.success(
    `Pin-soak audit clean (${findings.length} inspected, ${inSoak.length} in soak, ${unannotated.length} unannotated).`,
  )
}

process.exitCode = exitCode
