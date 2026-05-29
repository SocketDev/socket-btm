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
 *   - soaked          — past the 7d floor; if annotated, the annotation
 *                       is cleanup-eligible.
 *   - in-soak         — inside the 7d window with an annotation (allowed).
 *   - unannotated     — no annotation; informational (treat as soaked).
 *
 * Exit 0 today (informational mode). Once the pin-soak-guard hook
 * backfills annotations on edit, flip `--strict` to fail on `in-soak`
 * without annotation evidence.
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
      recordPin(file, lines, i, lines[i].trim(), 'dockerfile-from')
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
      findings.push({
        surface: 'external-tools',
        file: path.relative(REPO_ROOT, file),
        lineNumber: 0,
        identifier: '(parse error)',
        status: 'unannotated',
        note: `JSON parse error: ${errorMessage(error)}`,
      })
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
      if (typeof entry.published !== 'string') {
        findings.push({
          surface: 'external-tools',
          file: path.relative(REPO_ROOT, file),
          lineNumber: 0,
          identifier: `${name}@${entry.version}`,
          status: 'unannotated',
          note: 'no `published` field (backfill for full soak coverage)',
        })
        continue
      }
      pushFromSoak(
        'external-tools',
        path.relative(REPO_ROOT, file),
        0,
        `${name}@${entry.version}`,
        entry.published,
      )
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
    recordPin(file, lines, i, submoduleMatch[1], 'gitmodules')
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
    pushFromSoak(
      'pnpm-workspace',
      path.relative(REPO_ROOT, file),
      i + 1,
      pkgLine,
      annotation.published,
    )
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
        path.relative(REPO_ROOT, file),
        i + 1,
        `${match[1]}@${match[2].slice(0, 8)}`,
        match[3],
      )
    }
  }
}

// =============================================================================
// Helpers — alphabetical.
// =============================================================================

export function pushFromSoak(surface, file, lineNumber, identifier, published) {
  const soak = checkSoak(published)
  findings.push({
    surface,
    file,
    lineNumber,
    identifier,
    status: soak.soaked ? 'soaked' : 'in-soak',
    note: soak.soaked
      ? `soaked (${soak.daysOld}d old)`
      : `IN SOAK: ${soak.daysOld}d old, ${SOAK_DAYS - soak.daysOld}d remaining`,
  })
}

// Walk up to 8 lines above `lineIndex` for the closest `# published:`
// annotation. Used by every surface that places the annotation on the
// line directly above the pin (.gitmodules, Dockerfiles).
export function recordPin(file, lines, lineIndex, identifier, surface) {
  for (let j = lineIndex - 1; j >= Math.max(0, lineIndex - 8); j -= 1) {
    const annotation = parseAnnotation(lines[j])
    if (annotation !== undefined) {
      pushFromSoak(
        surface,
        path.relative(REPO_ROOT, file),
        j + 1,
        identifier,
        annotation.published,
      )
      return
    }
  }
  findings.push({
    surface,
    file: path.relative(REPO_ROOT, file),
    lineNumber: lineIndex + 1,
    identifier,
    status: 'unannotated',
    note: 'no `# published: YYYY-MM-DD` annotation within 8 lines above',
  })
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
const soakedAnnotated = findings.filter(
  f => f.status === 'soaked' && f.surface !== 'workflow-uses',
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
  if (inSoak.length > 0) {
    logger.log(`! ${inSoak.length} pin(s) in 7-day soak (annotated; allowed):`)
    for (let i = 0, { length } = inSoak; i < length; i += 1) {
      const f = inSoak[i]
      logger.log(`  - [${f.surface}] ${f.identifier} (${f.file}:${f.lineNumber})`)
      logger.log(`    ${f.note}`)
    }
    logger.log('')
  }
  if (unannotated.length > 0) {
    logger.log(
      `i ${unannotated.length} pin(s) without annotation (backfill opportunity):`,
    )
    if (verbose) {
      for (let i = 0, { length } = unannotated; i < length; i += 1) {
        const f = unannotated[i]
        logger.log(`  - [${f.surface}] ${f.identifier} (${f.file}:${f.lineNumber})`)
        logger.log(`    ${f.note}`)
      }
    }
    logger.log('')
  }
  if (soakedAnnotated.length > 0) {
    logger.log(
      `i ${soakedAnnotated.length} pin(s) past soak with annotation (cleanup opportunity):`,
    )
    if (verbose) {
      for (let i = 0, { length } = soakedAnnotated; i < length; i += 1) {
        const f = soakedAnnotated[i]
        logger.log(`  - [${f.surface}] ${f.identifier} (${f.file}:${f.lineNumber})`)
        logger.log(`    ${f.note}`)
      }
    }
    logger.log('')
  }
  logger.success(
    `Pin-soak audit clean (${findings.length} inspected, ${inSoak.length} in soak, ${unannotated.length} unannotated).`,
  )
}

process.exitCode = exitCode
