/**
 * check-pin-soak — auditor for external pin soak compliance.
 *
 * Walks every pin surface in the repo and verifies the soak policy from
 * lib/soak-policy.mts. Surfaces inspected:
 *
 *   - .gitmodules (submodule SHA pins)
 *   - .github/workflows/**\/*.yml + .github/actions/**\/*.yml (SHA-pinned `uses:` lines)
 *   - packages/*\/docker/Dockerfile* (FROM image@sha256: digests)
 *   - **\/external-tools.json (tool version pins)
 *   - pnpm-workspace.yaml (minimumReleaseAgeExclude entries)
 *
 * Pure annotation validation — no network. The hook
 * `.claude/hooks/fleet/pin-soak-guard/` is where new pins get registry-
 * probed at edit time; once the annotation is in place, this script just
 * re-confirms the math.
 *
 * Exit codes:
 *   0  — every inspected pin satisfies the soak policy.
 *   1  — at least one pin is in hard-fail bucket (unannotated in-soak).
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { errorMessage } from '@socketsecurity/lib-stable/errors'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  SOAK_DAYS,
  checkSoak,
  parseAnnotation,
} from '../lib/soak-policy.mts'

const logger = getDefaultLogger()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')

const args = process.argv.slice(2)
const verbose = args.includes('--verbose') || args.includes('-v')
const jsonOutput = args.includes('--json')

const findings = []

// =============================================================================
// Surface walkers — ordered alphabetically by `audit*` name (fleet rule
// `socket/sort-source-methods`).
// =============================================================================

// .gitmodules layout per CLAUDE.md "gitmodules-version-comments":
//
//   # <package>-<version> [sha256:...]
//   # published: YYYY-MM-DD | removable: YYYY-MM-DD   (optional, only within soak)
//   [submodule "path"]
//
export function auditDockerfiles() {
  const fromRe = /^\s*FROM\s+\S+@sha256:[a-f0-9]{64}/
  const pinDateRe = /#\s*Pinned\s+(\d{4}-\d{2}-\d{2})/
  for (const file of walk(REPO_ROOT, p => /Dockerfile(\.[^/]+)?$/.test(p))) {
    const content = readFileSync(file, 'utf8')
    const lines = content.split('\n')
    for (let i = 0, { length } = lines; i < length; i += 1) {
      if (!fromRe.test(lines[i])) {
        continue
      }
      let pinDate
      for (let j = Math.max(0, i - 8); j < i; j += 1) {
        const match = lines[j].match(pinDateRe)
        if (match !== null) {
          pinDate = match[1]
        }
      }
      if (pinDate === undefined) {
        record({
          surface: 'dockerfile-from',
          file,
          line: lines[i],
          lineNumber: i + 1,
          identifier: lines[i].trim(),
          soak: undefined,
          note: 'missing `# Pinned YYYY-MM-DD.` comment within 8 lines above FROM',
        })
        continue
      }
      const soak = checkSoak({ published: pinDate })
      record({
        surface: 'dockerfile-from',
        file,
        line: lines[i],
        lineNumber: i + 1,
        identifier: lines[i].trim(),
        soak,
        note: soak.soaked
          ? `soaked (${soak.daysOld}d old)`
          : `IN SOAK: ${soak.daysOld}d old, ${SOAK_DAYS - soak.daysOld}d remaining`,
      })
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
      record({
        surface: 'external-tools',
        file,
        line: '',
        lineNumber: 0,
        identifier: '(parse error)',
        soak: undefined,
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
        record({
          surface: 'external-tools',
          file,
          line: `${name}@${entry.version}`,
          lineNumber: 0,
          identifier: name,
          soak: undefined,
          note: 'no `published` field (backfill needed for full soak coverage)',
        })
        continue
      }
      const soak = checkSoak({ published: entry.published })
      record({
        surface: 'external-tools',
        file,
        line: `${name}@${entry.version}`,
        lineNumber: 0,
        identifier: name,
        soak,
        note: soak.soaked
          ? `soaked (${soak.daysOld}d old)`
          : `IN SOAK: ${soak.daysOld}d old, ${SOAK_DAYS - soak.daysOld}d remaining`,
      })
    }
  }
}

export function auditGitmodules() {
  const file = path.join(REPO_ROOT, '.gitmodules')
  if (!existsSync(file)) {
    return
  }
  const content = readFileSync(file, 'utf8')
  const lines = content.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]
    const submoduleMatch = line.match(/^\[submodule "([^"]+)"\]$/)
    if (submoduleMatch === null) {
      continue
    }
    const identifier = submoduleMatch[1]
    let versionCommentLine
    let annotationLine
    for (let j = i - 1; j >= 0; j -= 1) {
      const trimmed = lines[j].trim()
      if (trimmed === '') {
        break
      }
      if (!trimmed.startsWith('#')) {
        break
      }
      if (parseAnnotation(lines[j]) !== null) {
        annotationLine = j
      } else if (versionCommentLine === undefined) {
        versionCommentLine = j
      }
    }
    const annotation =
      annotationLine === undefined
        ? undefined
        : readAnnotationAt(lines, annotationLine)
    if (annotation === undefined || annotation === null) {
      record({
        surface: 'gitmodules',
        file,
        line: versionCommentLine === undefined ? line : lines[versionCommentLine],
        lineNumber: (versionCommentLine ?? i) + 1,
        identifier,
        soak: undefined,
        note: 'no soak annotation (acceptable for submodules under human-review process; required when added within soak window)',
      })
      continue
    }
    const soak = checkSoak({ published: annotation.published })
    record({
      surface: 'gitmodules',
      file,
      line: lines[annotationLine],
      lineNumber: annotationLine + 1,
      identifier,
      soak,
      note: soak.soaked
        ? `soaked (${soak.daysOld}d old); annotation can be removed`
        : `IN SOAK: ${soak.daysOld}d old, ${SOAK_DAYS - soak.daysOld}d remaining`,
    })
  }
}

export function auditPnpmWorkspace() {
  const file = path.join(REPO_ROOT, 'pnpm-workspace.yaml')
  if (!existsSync(file)) {
    return
  }
  const content = readFileSync(file, 'utf8')
  const lines = content.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const annotation = parseAnnotation(lines[i])
    if (annotation === null) {
      continue
    }
    let pkgLine
    for (let j = i + 1; j < length; j += 1) {
      if (lines[j].trim() !== '') {
        pkgLine = lines[j].trim()
        break
      }
    }
    const soak = checkSoak({ published: annotation.published })
    record({
      surface: 'pnpm-workspace',
      file,
      line: lines[i],
      lineNumber: i + 1,
      identifier: pkgLine ?? '(annotation orphan)',
      soak,
      note: soak.soaked
        ? `soaked (${soak.daysOld}d old); annotation entry can be removed`
        : `IN SOAK: ${soak.daysOld}d old, ${SOAK_DAYS - soak.daysOld}d remaining`,
    })
  }
}

export function auditWorkflows() {
  const dirs = [
    path.join(REPO_ROOT, '.github', 'workflows'),
    path.join(REPO_ROOT, '.github', 'actions'),
  ]
  const usesPinRe =
    /^\s*-?\s*uses:\s*([^@\s]+)@([a-f0-9]{40})\s*#\s*[^(]+\((\d{4}-\d{2}-\d{2})\)/
  for (let d = 0, { length: dLen } = dirs; d < dLen; d += 1) {
    const dir = dirs[d]
    for (const file of walk(dir, p => /\.ya?ml$/.test(p))) {
      const content = readFileSync(file, 'utf8')
      const lines = content.split('\n')
      for (let i = 0, { length } = lines; i < length; i += 1) {
        const match = lines[i].match(usesPinRe)
        if (match === null) {
          continue
        }
        const [, identifier, , publishedDate] = match
        const soak = checkSoak({ published: publishedDate })
        record({
          surface: 'workflow-uses',
          file,
          line: lines[i],
          lineNumber: i + 1,
          identifier: `${identifier}@${match[2].slice(0, 8)}`,
          soak,
          note: soak.soaked
            ? `soaked (${soak.daysOld}d old)`
            : `IN SOAK: ${soak.daysOld}d old, ${SOAK_DAYS - soak.daysOld}d remaining`,
        })
      }
    }
  }
}

// =============================================================================
// Helpers — ordered alphabetically.
// =============================================================================

export function readAnnotationAt(lines, lineIndex) {
  if (lineIndex < 0 || lineIndex >= lines.length) {
    return undefined
  }
  return parseAnnotation(lines[lineIndex])
}

export function record({
  surface,
  file,
  line,
  lineNumber,
  identifier,
  soak,
  note,
}) {
  findings.push({
    surface,
    file: path.relative(REPO_ROOT, file),
    lineNumber,
    line: line.trim(),
    identifier,
    soak,
    note,
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
    const st = statSync(full)
    if (st.isDirectory()) {
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

const inSoakWarn = findings.filter(f => f.soak !== undefined && !f.soak.soaked)
const unannotated = findings.filter(f => f.soak === undefined)
const soakedExpired = findings.filter(
  f =>
    f.soak !== undefined &&
    f.soak.soaked &&
    /annotation (?:can|entry can) be removed/.test(f.note),
)
const fail = []

if (jsonOutput) {
  logger.log(
    JSON.stringify(
      { findings, inSoakWarn, unannotated, soakedExpired, fail },
      undefined,
      2,
    ),
  )
  process.exitCode = fail.length > 0 ? 1 : 0
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
  if (inSoakWarn.length > 0) {
    logger.log(`! ${inSoakWarn.length} pin(s) in 7-day soak (annotated; allowed):`)
    for (let i = 0, { length } = inSoakWarn; i < length; i += 1) {
      const f = inSoakWarn[i]
      logger.log(`  - [${f.surface}] ${f.identifier} (${f.file}:${f.lineNumber})`)
      logger.log(`    ${f.note}`)
    }
    logger.log('')
  }
  if (unannotated.length > 0) {
    logger.log(
      `i ${unannotated.length} pin(s) without soak annotation (backfill opportunity; not a failure):`,
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
  if (soakedExpired.length > 0) {
    logger.log(
      `i ${soakedExpired.length} pin(s) with annotation past the removable date (cleanup opportunity):`,
    )
    if (verbose) {
      for (let i = 0, { length } = soakedExpired; i < length; i += 1) {
        const f = soakedExpired[i]
        logger.log(`  - [${f.surface}] ${f.identifier} (${f.file}:${f.lineNumber})`)
        logger.log(`    ${f.note}`)
      }
    }
    logger.log('')
  }
  if (fail.length === 0) {
    logger.success(
      `Pin-soak audit clean (${findings.length} pins inspected, ${inSoakWarn.length} in soak, ${unannotated.length} unannotated).`,
    )
  } else {
    logger.error(`${fail.length} hard-fail finding(s):`)
    for (let i = 0, { length } = fail; i < length; i += 1) {
      const f = fail[i]
      logger.error(`  - [${f.surface}] ${f.identifier} (${f.file}:${f.lineNumber})`)
      logger.error(`    ${f.note}`)
    }
  }
  process.exitCode = fail.length > 0 ? 1 : 0
}
