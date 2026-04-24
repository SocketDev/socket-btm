#!/usr/bin/env node
/**
 * @fileoverview Mirror-doc sync checker.
 *
 * CLAUDE.md "Documentation Policy" defines a special path pattern:
 * `docs/additions/<mirror-path>/<name>.md` mirrors a source file at
 * `packages/node-smol-builder/additions/source-patched/<mirror-path>/<name>`
 * (the docs name inherits the source filename verbatim, including the
 * trailing extension — e.g. `version_subset.js.md` for a JS module).
 *
 * This checker verifies two invariants:
 *   1. Every mirror doc has a corresponding source file.
 *   2. Every "user-facing" source file has a mirror doc, where
 *      "user-facing" means PUBLIC `lib/smol-*.js` modules that end
 *      users import, per CLAUDE.md.
 *
 * Invariant 1 catches orphaned docs from deleted source files.
 * Invariant 2 catches new public modules that shipped without docs.
 *
 * Wired into `pnpm run check` via check.mts.
 *
 * Usage:
 *   node scripts/check-mirror-docs.mts
 *   node scripts/check-mirror-docs.mts --explain
 *   node scripts/check-mirror-docs.mts --json
 *
 * Allowlist: `.github/mirror-docs-allowlist.yml` for source files that
 * are deliberately undocumented (internal one-off helpers, C++ bindings
 * where the source IS the spec, etc.) and mirror docs whose source
 * genuinely doesn't exist (transitional states).
 */

import { existsSync, readdirSync, readFileSync, type Dirent } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { parseArgs } from 'node:util'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { errorMessage } from 'build-infra/lib/error-utils'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const MONOREPO_ROOT = path.join(__dirname, '..')
const DOCS_ROOT = path.join(MONOREPO_ROOT, 'docs', 'additions')
const SOURCE_ROOT = path.join(
  MONOREPO_ROOT,
  'packages',
  'node-smol-builder',
  'additions',
  'source-patched',
)
const ALLOWLIST_PATH = path.join(
  MONOREPO_ROOT,
  '.github',
  'mirror-docs-allowlist.yml',
)

type AllowlistEntry = {
  path: string
  kind: 'orphan-doc' | 'missing-doc'
  reason: string
}

function loadAllowlist(): AllowlistEntry[] {
  if (!existsSync(ALLOWLIST_PATH)) {
    return []
  }
  const content = readFileSync(ALLOWLIST_PATH, 'utf8')
  const entries: AllowlistEntry[] = []
  let current: Partial<AllowlistEntry> = {}
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed === '---') {
      continue
    }
    if (line.startsWith('- ')) {
      if (current.path && current.kind && current.reason) {
        entries.push(current as AllowlistEntry)
      }
      current = {}
      const firstKv = line.slice(2).match(/^(\w+):\s*(.+)$/)
      if (firstKv) {
        const key = firstKv[1]!
        const value = firstKv[2]!.replace(/^['"]|['"]$/g, '')
        ;(current as Record<string, unknown>)[key] = value
      }
      continue
    }
    const kv = trimmed.match(/^(\w+):\s*(.+)$/)
    if (kv) {
      const key = kv[1]!
      const value = kv[2]!.replace(/^['"]|['"]$/g, '')
      ;(current as Record<string, unknown>)[key] = value
    }
  }
  if (current.path && current.kind && current.reason) {
    entries.push(current as AllowlistEntry)
  }
  return entries
}

/** Walk a tree returning relative file paths. */
function walk(
  root: string,
  filterFn: (relPath: string) => boolean,
): string[] {
  const out: string[] = []
  if (!existsSync(root)) {
    return out
  }
  const queue: string[] = [root]
  while (queue.length > 0) {
    const dir = queue.pop()!
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as Dirent[]
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        queue.push(full)
      } else if (entry.isFile()) {
        const rel = path.relative(root, full)
        if (filterFn(rel)) {
          out.push(rel)
        }
      }
    }
  }
  return out
}

type Finding = {
  kind: 'orphan-doc' | 'missing-doc'
  path: string // docs-rooted relative path
  detail: string
  fix: string
}

function collectOrphanDocs(): Finding[] {
  const docs = walk(DOCS_ROOT, r => r.endsWith('.md'))
  const findings: Finding[] = []
  for (const docRel of docs) {
    // Doc naming convention: trim the trailing ".md" — the remaining
    // path (e.g. "lib/smol-http.js" or "lib/internal/.../version_subset.js")
    // is the expected source file name. Per CLAUDE.md, the JS extension
    // is preserved in the doc filename so the mirror is visually clear.
    const sourceRel = docRel.slice(0, -'.md'.length)
    // Special-case: files named README.md and module-architecture.md
    // inside docs/additions/ are subsystem overviews, not mirror docs.
    const base = path.basename(docRel)
    if (
      base === 'README.md' ||
      base === 'module-architecture.md' ||
      base.startsWith('_') ||
      /^[A-Z_]+\.md$/.test(base)
    ) {
      continue
    }
    const sourcePath = path.join(SOURCE_ROOT, sourceRel)
    if (!existsSync(sourcePath)) {
      findings.push({
        detail: `docs/additions/${docRel} has no corresponding source at packages/node-smol-builder/additions/source-patched/${sourceRel}`,
        fix: `Either restore the source file or delete the orphan doc.`,
        kind: 'orphan-doc',
        path: `docs/additions/${docRel}`,
      })
    }
  }
  return findings
}

function collectMissingDocs(): Finding[] {
  const findings: Finding[] = []
  // Invariant 2 per CLAUDE.md: only PUBLIC `lib/smol-*.js` modules
  // (things users `require('node:smol-http')` etc.) plus explicitly
  // user-facing internal modules (caches, bootstrap glue, VFS, range
  // parsers) warrant a mirror doc. Internal one-off helpers and C++
  // bindings are exempt.
  //
  // Conservative strategy: only check the very top-level `lib/smol-*.js`
  // files today. Per-subsystem internal-module coverage (caches,
  // bootstrap, VFS, range) is enforced by the authors' judgement per
  // CLAUDE.md — programmatically enforcing it would require a
  // "user-facing" registry that doesn't currently exist. Skip those
  // and let the allowlist carry any exceptions.
  const libDir = path.join(SOURCE_ROOT, 'lib')
  if (!existsSync(libDir)) {
    return findings
  }
  for (const entry of readdirSync(libDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.startsWith('smol-')) {
      continue
    }
    if (!entry.name.endsWith('.js')) {
      continue
    }
    const docPath = path.join(DOCS_ROOT, 'lib', `${entry.name}.md`)
    if (!existsSync(docPath)) {
      findings.push({
        detail: `Public module packages/node-smol-builder/additions/source-patched/lib/${entry.name} has no mirror doc at docs/additions/lib/${entry.name}.md`,
        fix: `Create docs/additions/lib/${entry.name}.md with a short description + public API surface.`,
        kind: 'missing-doc',
        path: `packages/node-smol-builder/additions/source-patched/lib/${entry.name}`,
      })
    }
  }
  return findings
}

type Options = {
  explain: boolean
  json: boolean
  quiet: boolean
}

function printFinding(f: Finding, opts: Options): void {
  if (opts.json) {
    logger.log(JSON.stringify(f))
    return
  }
  const label =
    f.kind === 'orphan-doc' ? 'Orphan mirror doc' : 'Missing mirror doc'
  logger.log('')
  logger.log(`[${label}] ${f.path}`)
  logger.log(`  ${f.detail}`)
  if (opts.explain) {
    logger.log(`  Fix: ${f.fix}`)
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
  const allowSet = new Set(allowlist.map(e => `${e.kind}|${e.path}`))

  if (!opts.quiet && !opts.json) {
    logger.info('Checking mirror-doc sync...')
  }

  const all: Finding[] = [
    ...collectOrphanDocs(),
    ...collectMissingDocs(),
  ]
  const surviving = all.filter(
    f => !allowSet.has(`${f.kind}|${f.path}`),
  )

  if (surviving.length === 0) {
    if (!opts.quiet && !opts.json) {
      logger.success(
        `No mirror-doc drift found (${all.length} raw, ${allowlist.length} allowlisted)`,
      )
    }
    process.exitCode = 0
    return
  }

  if (!opts.json) {
    logger.error(
      `Found ${surviving.length} mirror-doc drift${surviving.length === 1 ? '' : 's'}:`,
    )
  }
  for (const f of surviving) {
    printFinding(f, opts)
  }
  if (!opts.json) {
    logger.log('')
    logger.log('What to do:')
    logger.log(
      '  1. Orphan docs: either restore the source file or delete the doc.',
    )
    logger.log(
      '  2. Missing docs: create a short mirror doc with the public API',
    )
    logger.log(
      '     surface. See existing docs/additions/lib/smol-*.js.md for shape.',
    )
    logger.log(
      '  3. If the source is deliberately undocumented (internal helper or',
    )
    logger.log(
      '     C++ binding where the source IS the spec), add to',
    )
    logger.log('     .github/mirror-docs-allowlist.yml with a reason.')
  }
  process.exitCode = 1
}

main().catch((e: unknown) => {
  logger.error(errorMessage(e))
  process.exitCode = 1
})
