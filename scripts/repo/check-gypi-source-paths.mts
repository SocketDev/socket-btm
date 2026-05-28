#!/usr/bin/env node
/**
 * @fileoverview Lint gyp `.gypi` files for the double-prefix path bug.
 *
 * gyp resolves source paths inside an `'includes':`-d gypi file
 * RELATIVE TO THAT GYPI'S OWN LOCATION, not the parent .gyp. So a
 * .gypi at `<root>/deps/yoga.gypi` listing
 *   'sources': [ 'deps/yoga/Foo.cpp' ]
 * resolves to
 *   <root>/deps/deps/yoga/Foo.cpp        ← DOUBLE deps/ — file missing
 *
 * Build #10 wasted ~30 minutes on this exact bug. The check scans
 * every .gypi under packages/ for any source entry whose path starts
 * with the gypi's own parent-dir segment and reports it.
 *
 * Scope: only .gypi files under packages/. Skips .gyp files (those
 * ARE relative to themselves, but the bug pattern doesn't apply
 * because .gyp files are the top of the include chain).
 *
 * Why it lives in scripts/repo/: this is a btm-only concern (only
 * socket-btm has the additions/source-patched/deps/*.gypi auto-gen
 * pipeline). The repo/ subdir mirrors docs/claude.md/repo/ + the
 * planned hooks/repo/ — host-repo-only utilities that don't cascade
 * fleet-wide.
 *
 * Usage:
 *   node scripts/repo/check-gypi-source-paths.mts
 *   node scripts/repo/check-gypi-source-paths.mts --explain
 *   node scripts/repo/check-gypi-source-paths.mts --json
 *
 * Exit codes:
 *   0 — no double-prefix paths found.
 *   1 — at least one finding.
 *   2 — usage / args error.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const REPO_ROOT = path.resolve(__dirname, '..', '..')

const logger = getDefaultLogger()

interface Finding {
  readonly gypi: string
  readonly offendingPrefix: string
  readonly sources: readonly string[]
}

// oxlint-disable-next-line socket/sort-source-methods -- script's main flow lives at the bottom; helpers above in topical order.
// oxlint-disable-next-line socket/export-top-level-functions -- internal helpers; not part of the script's external contract.
function walkGypiFiles(root: string): readonly string[] {
  const out: string[] = []
  function walk(dir: string): void {
    let entries: ReturnType<typeof readdirSync>
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (let i = 0, { length } = entries; i < length; i += 1) {
      const entry = entries[i]!
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        // Skip node_modules + build outputs that contain irrelevant
        // .gypi files from third-party packages.
        if (
          entry.name === 'node_modules' ||
          entry.name === 'build' ||
          entry.name === 'upstream' ||
          entry.name === '.git'
        ) {
          continue
        }
        walk(full)
        continue
      }
      if (entry.isFile() && entry.name.endsWith('.gypi')) {
        out.push(full)
      }
    }
  }
  walk(root)
  out.sort()
  return out
}

// oxlint-disable-next-line socket/sort-source-methods
// oxlint-disable-next-line socket/export-top-level-functions
function checkOneGypi(absPath: string): Finding | undefined {
  let content: string
  try {
    content = readFileSync(absPath, 'utf8')
  } catch {
    return undefined
  }
  // Determine the offending prefix: the parent directory name of the
  // gypi. For `<root>/deps/yoga.gypi`, that's `deps`.
  const parts = absPath.split(path.sep)
  const parentDir = parts[parts.length - 2]
  if (!parentDir) {
    return undefined
  }
  const offendingPrefix = `${parentDir}/`

  // Extract every 'path/to/file.{c,cc,cpp,h,hpp}' literal in any
  // 'sources': [ ... ] block.
  const sourceRe = /'([^']+\.(?:c|cc|cpp|h|hpp))'/g
  const offenders: string[] = []
  let m: RegExpExecArray | null
  while ((m = sourceRe.exec(content)) !== null) {
    const sourcePath = m[1]!
    if (sourcePath.startsWith(offendingPrefix)) {
      offenders.push(sourcePath)
    }
  }
  if (offenders.length === 0) {
    return undefined
  }
  return {
    gypi: path.relative(REPO_ROOT, absPath),
    offendingPrefix,
    sources: offenders,
  }
}

interface ParsedArgs {
  readonly explain: boolean
  readonly json: boolean
}

// oxlint-disable-next-line socket/sort-source-methods
// oxlint-disable-next-line socket/export-top-level-functions
function parseArgs(): ParsedArgs {
  const argv = process.argv.slice(2)
  let explain = false
  let json = false
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const a = argv[i]!
    if (a === '--explain') {
      explain = true
    } else if (a === '--json') {
      json = true
    } else if (a === '-h' || a === '--help') {
      logger.log(
        'Usage: node scripts/repo/check-gypi-source-paths.mts [--explain] [--json]',
      )
      process.exit(0)
    } else {
      logger.error(`Unknown argument: ${a}`)
      process.exit(2)
    }
  }
  return { explain, json }
}

const { explain, json } = parseArgs()
const packagesDir = path.join(REPO_ROOT, 'packages')
if (!existsSync(packagesDir)) {
  logger.warn('[check-gypi-source-paths] packages/ absent; nothing to scan')
  process.exit(0)
}

const gypiFiles = walkGypiFiles(packagesDir)
const findings: Finding[] = []
for (let i = 0, { length } = gypiFiles; i < length; i += 1) {
  const f = checkOneGypi(gypiFiles[i]!)
  if (f !== undefined) {
    findings.push(f)
  }
}

if (json) {
  process.stdout.write(
    JSON.stringify({
      status: findings.length === 0 ? 'ok' : 'fail',
      findings,
    }) + '\n',
  )
} else if (findings.length === 0) {
  logger.success(
    `[check-gypi-source-paths] scanned ${gypiFiles.length} .gypi file(s); no double-prefix issues`,
  )
} else {
  logger.fail(
    `[check-gypi-source-paths] ${findings.length} .gypi file(s) contain double-prefix source paths:`,
  )
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const f = findings[i]!
    logger.log(`  - ${f.gypi}`)
    logger.log(
      `      offending prefix: "${f.offendingPrefix}" — gyp will prepend this AGAIN at resolve time, producing "${f.offendingPrefix}${f.offendingPrefix}..."`,
    )
    for (let j = 0, sl = f.sources.length; j < sl; j += 1) {
      logger.log(`      - '${f.sources[j]}'`)
      if (j === 4 && f.sources.length > 5) {
        logger.log(`      ... and ${f.sources.length - 5} more`)
        break
      }
    }
    if (explain) {
      logger.log('')
      logger.log(
        `      Fix: drop the leading "${f.offendingPrefix}" from each path. gyp resolves source paths inside an included .gypi RELATIVE TO THE GYPI'S OWN LOCATION, not the parent .gyp.`,
      )
    }
  }
  if (!explain) {
    logger.log('')
    logger.log(
      '  Re-run with --explain for the fix detail. See CLAUDE.md "BTM-Specific" → gypi source paths.',
    )
  }
}

process.exitCode = findings.length === 0 ? 0 : 1
