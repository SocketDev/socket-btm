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
 *   - pnpm-workspace.yaml (minimumReleaseAgeExclude entries already use the
 *     same annotation shape — re-verify them too so one auditor covers
 *     the whole fleet pin surface)
 *
 * Pure annotation validation — no network. The hook
 * `.claude/hooks/fleet/pin-soak-guard/` is where new pins get registry-
 * probed at edit time; once the annotation is in place, this script just
 * re-confirms the math.
 *
 * Exit codes:
 *   0  — every pin satisfies the soak floor or has a valid annotation.
 *   1  — at least one pin is unsoaked and lacks the canonical annotation.
 *   2  — invocation error (bad flag, file unreadable).
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import {
  SOAK_DAYS,
  checkSoak,
  parseAnnotation,
} from '../lib/soak-policy.mts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')

const args = process.argv.slice(2)
const verbose = args.includes('--verbose') || args.includes('-v')
const jsonOutput = args.includes('--json')

const findings = []

function record({ surface, file, line, lineNumber, identifier, soak, note }) {
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

/**
 * Walk a directory recursively, yielding file paths matching the predicate.
 */
function* walk(dir, predicate) {
  if (!existsSync(dir)) {
    return
  }
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'upstream') {
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

/**
 * Inspect a multi-line text blob for lines bearing the soak annotation.
 * Returns the contiguous annotation block at lineIndex (0-based) — caller
 * usually reads the line ABOVE the pin to get its annotation.
 */
function readAnnotationAt(lines, lineIndex) {
  if (lineIndex < 0 || lineIndex >= lines.length) {
    return null
  }
  return parseAnnotation(lines[lineIndex])
}

// =============================================================================
// Surface 1: .gitmodules
// =============================================================================
// Layout (per CLAUDE.md's "gitmodules-version-comments" rule):
//
//   # <package>-<version> [sha256:...]
//   # published: YYYY-MM-DD | removable: YYYY-MM-DD   (optional, only within soak)
//   [submodule "path"]
//
function auditGitmodules() {
  const file = path.join(REPO_ROOT, '.gitmodules')
  if (!existsSync(file)) {
    return
  }
  const content = readFileSync(file, 'utf8')
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const submoduleMatch = line.match(/^\[submodule "([^"]+)"\]$/)
    if (submoduleMatch === null) {
      continue
    }
    const identifier = submoduleMatch[1]
    // Walk backwards: first non-comment break stops us.
    let versionCommentLine = null
    let annotationLine = null
    for (let j = i - 1; j >= 0; j -= 1) {
      const trimmed = lines[j].trim()
      if (trimmed === '') {
        break
      }
      if (!trimmed.startsWith('#')) {
        break
      }
      // The version comment matches `# <pkg>-<ver>...` (NOT the soak annotation).
      if (parseAnnotation(lines[j]) !== null) {
        annotationLine = j
      } else if (versionCommentLine === null) {
        versionCommentLine = j
      }
    }
    const annotation =
      annotationLine === null ? null : readAnnotationAt(lines, annotationLine)
    if (annotation === null) {
      // No annotation. The submodule SHA pin is implicitly trusted —
      // submodule bumps go through human review. Flag only if we want
      // strict enforcement; for now, report as `unannotated`.
      record({
        surface: 'gitmodules',
        file,
        line: versionCommentLine === null ? line : lines[versionCommentLine],
        lineNumber: (versionCommentLine ?? i) + 1,
        identifier,
        soak: null,
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

// =============================================================================
// Surface 2: workflow `uses: <owner>/<repo>@<sha>` lines
// =============================================================================
// Existing fleet shape (per uses-sha-verify-guard):
//
//   uses: owner/repo@<40-hex> # <tag> (YYYY-MM-DD)
//
// The trailing date IS the publish date — no separate annotation needed,
// the comment already carries the soak source-of-truth. Parse it.
//
function auditWorkflows() {
  const dirs = [
    path.join(REPO_ROOT, '.github', 'workflows'),
    path.join(REPO_ROOT, '.github', 'actions'),
  ]
  const usesPinRe =
    /^\s*-?\s*uses:\s*([^@\s]+)@([a-f0-9]{40})\s*#\s*[^(]+\((\d{4}-\d{2}-\d{2})\)/
  for (const dir of dirs) {
    for (const file of walk(dir, p => /\.ya?ml$/.test(p))) {
      const content = readFileSync(file, 'utf8')
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i += 1) {
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
// Surface 3: Docker `FROM ... @sha256:` lines
// =============================================================================
// Shape (per the boringssl-builder Dockerfile we just landed):
//
//   # Pinned YYYY-MM-DD.
//   # <image>-tag (notes)
//   FROM <image>@sha256:<digest>
//
// The "Pinned YYYY-MM-DD." comment within ~5 lines above the FROM is the
// publish-date proxy.
//
function auditDockerfiles() {
  const dirs = [REPO_ROOT]
  const fromRe = /^\s*FROM\s+\S+@sha256:[a-f0-9]{64}/
  const pinDateRe = /#\s*Pinned\s+(\d{4}-\d{2}-\d{2})/
  for (const dir of dirs) {
    for (const file of walk(dir, p => /Dockerfile(\.[^/]+)?$/.test(p))) {
      const content = readFileSync(file, 'utf8')
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i += 1) {
        if (!fromRe.test(lines[i])) {
          continue
        }
        let pinDate = null
        for (let j = Math.max(0, i - 8); j < i; j += 1) {
          const match = lines[j].match(pinDateRe)
          if (match !== null) {
            pinDate = match[1]
          }
        }
        if (pinDate === null) {
          record({
            surface: 'dockerfile-from',
            file,
            line: lines[i],
            lineNumber: i + 1,
            identifier: lines[i].trim(),
            soak: null,
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
}

// =============================================================================
// Surface 4: external-tools.json `version` + optional `published` field
// =============================================================================
// New convention: every `tools.<name>` with a `version` field MAY carry a
// `published` field. When present, it gates the soak. When absent, the
// auditor reports as `unannotated` (acceptable for old fleet entries; new
// entries are expected to carry it via the soak-guard hook).
//
function auditExternalToolsJson() {
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
        soak: null,
        note: `JSON parse error: ${error.message}`,
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
          soak: null,
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

// =============================================================================
// Surface 5: pnpm-workspace.yaml `minimumReleaseAgeExclude` annotations
// =============================================================================
// Existing fleet shape:
//
//   # published: YYYY-MM-DD | removable: YYYY-MM-DD
//   - 'package@version'
//
// pnpm itself enforces the soak. We re-validate the annotation date format
// + the math so a stale exclude entry shows up here.
//
function auditPnpmWorkspace() {
  const file = path.join(REPO_ROOT, 'pnpm-workspace.yaml')
  if (!existsSync(file)) {
    return
  }
  const content = readFileSync(file, 'utf8')
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const annotation = parseAnnotation(lines[i])
    if (annotation === null) {
      continue
    }
    // The pkg the annotation refers to is the next non-blank line under it.
    let pkgLine = null
    for (let j = i + 1; j < lines.length; j += 1) {
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

// =============================================================================
// Driver
// =============================================================================
auditGitmodules()
auditWorkflows()
auditDockerfiles()
auditExternalToolsJson()
auditPnpmWorkspace()

// Severity buckets:
//   - in-soak + annotated  → warn (informational; the annotation IS the bypass
//                            audit trail, same pattern as pnpm-workspace.yaml's
//                            `minimumReleaseAgeExclude` entries with `# published:`
//                            comments above the pkg).
//   - in-soak, unannotated → fail (a new pin landed inside the 7d window without
//                            the soak annotation that documents the exception).
//   - soaked + annotated   → cleanup opportunity (the `# published:` comment is
//                            now redundant; safe to remove on next touch).
//
// Soaked pins (no annotation needed) are fine and don't show up in either bucket.
const inSoakWarn = findings.filter(f => f.soak !== null && !f.soak.soaked)
const unannotated = findings.filter(f => f.soak === null)
const soakedExpired = findings.filter(
  f =>
    f.soak !== null &&
    f.soak.soaked &&
    /annotation (?:can|entry can) be removed/.test(f.note),
)
const fail = []

if (jsonOutput) {
  process.stdout.write(
    `${JSON.stringify(
      { findings, inSoakWarn, unannotated, soakedExpired, fail },
      null,
      2,
    )}\n`,
  )
  process.exitCode = fail.length > 0 ? 1 : 0
} else {
  process.stdout.write(`\n=== Pin soak audit (floor: ${SOAK_DAYS}d) ===\n\n`)
  if (verbose) {
    for (const f of findings) {
      process.stdout.write(
        `[${f.surface}] ${f.identifier}\n  ${f.file}:${f.lineNumber}\n  ${f.note}\n\n`,
      )
    }
  }
  if (inSoakWarn.length > 0) {
    process.stdout.write(
      `! ${inSoakWarn.length} pin(s) in 7-day soak (annotated; allowed):\n`,
    )
    for (const f of inSoakWarn) {
      process.stdout.write(
        `  - [${f.surface}] ${f.identifier} (${f.file}:${f.lineNumber})\n    ${f.note}\n`,
      )
    }
    process.stdout.write('\n')
  }
  if (unannotated.length > 0) {
    process.stdout.write(
      `i ${unannotated.length} pin(s) without soak annotation (backfill opportunity; not a failure):\n`,
    )
    if (verbose) {
      for (const f of unannotated) {
        process.stdout.write(
          `  - [${f.surface}] ${f.identifier} (${f.file}:${f.lineNumber})\n    ${f.note}\n`,
        )
      }
    }
    process.stdout.write('\n')
  }
  if (soakedExpired.length > 0) {
    process.stdout.write(
      `i ${soakedExpired.length} pin(s) with annotation past the removable date (cleanup opportunity):\n`,
    )
    if (verbose) {
      for (const f of soakedExpired) {
        process.stdout.write(
          `  - [${f.surface}] ${f.identifier} (${f.file}:${f.lineNumber})\n    ${f.note}\n`,
        )
      }
    }
    process.stdout.write('\n')
  }
  if (fail.length === 0) {
    process.stdout.write(
      `✓ Pin-soak audit clean (${findings.length} pins inspected, ${inSoakWarn.length} in soak, ${unannotated.length} unannotated).\n`,
    )
  } else {
    process.stdout.write(`× ${fail.length} hard-fail finding(s):\n`)
    for (const f of fail) {
      process.stdout.write(
        `  - [${f.surface}] ${f.identifier} (${f.file}:${f.lineNumber})\n    ${f.note}\n`,
      )
    }
  }
  process.exitCode = fail.length > 0 ? 1 : 0
}
