#!/usr/bin/env node
/**
 * @fileoverview Cascade-completeness checker.
 *
 * Walks three sources of cross-package build dependencies:
 *   1. Makefile `include ../foo/make/...` directives
 *   2. TypeScript imports from `build-infra/...`, `bin-infra/...`,
 *      `curl-builder/...`, `lief-builder/...`, etc.
 *   3. Dockerfile `COPY packages/foo/...` directives
 *
 * And cross-checks each discovered dependency against:
 *   A. `scripts/validate-cache-versions.mts` CASCADE_RULES
 *   B. The consuming workflow's cache-key composition
 *
 * Reports every path that exists on disk AND is referenced by a
 * builder AND has no matching cascade rule OR workflow hash. This
 * catches the shape that was the bulk of R18-R27 scope creep —
 * R18 missed `build-infra/wasm-synced/`, R19 missed `curl-builder/
 * {docker,lib,scripts}/`, R20 missed `lief-builder/{lib,scripts}/`,
 * R24 missed root package.json + pnpm-workspace.yaml across 11
 * workflows, R27 missed LIEF in stubs.yml. All same shape: dependency
 * exists, builder uses it, cache doesn't know.
 *
 * Output mirrors check-bug-classes.mts — file:line + why + fix +
 * what to do, plus a clean JSON mode for tooling.
 *
 * Usage:
 *   node scripts/check-cascade-completeness.mts
 *   node scripts/check-cascade-completeness.mts --explain
 *   node scripts/check-cascade-completeness.mts --json
 *
 * Allowlist at `.github/cascade-completeness-allowlist.yml`.
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
const CASCADE_RULES_PATH = path.join(
  MONOREPO_ROOT,
  'scripts',
  'validate-cache-versions.mts',
)
const ALLOWLIST_PATH = path.join(
  MONOREPO_ROOT,
  '.github',
  'cascade-completeness-allowlist.yml',
)

// Map each package directory name to the workflow file that builds it.
// Used when we need to check if a Dockerfile-COPY path is hashed in
// the workflow's cache key.
const PACKAGE_TO_WORKFLOW: Record<string, string> = {
  'binflate': '.github/workflows/binsuite.yml',
  'binject': '.github/workflows/binsuite.yml',
  'binpress': '.github/workflows/binsuite.yml',
  'curl-builder': '.github/workflows/curl.yml',
  'ink-builder': '.github/workflows/ink.yml',
  'iocraft-builder': '.github/workflows/iocraft.yml',
  'lief-builder': '.github/workflows/lief.yml',
  'models': '.github/workflows/models.yml',
  'node-smol-builder': '.github/workflows/node-smol.yml',
  'onnxruntime-builder': '.github/workflows/onnxruntime.yml',
  'opentui-builder': '.github/workflows/opentui.yml',
  'stubs-builder': '.github/workflows/stubs.yml',
  'yoga-layout-builder': '.github/workflows/yoga-layout.yml',
}

// Paths that are always implicitly hashed by every workflow through
// `setup-and-install` / pnpm-lock / root metadata hashing added in
// R24. Treat as universally satisfied.
const IMPLICITLY_HASHED = new Set([
  '.node-version',
  '.npmrc',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
])

type Finding = {
  source: 'makefile' | 'import' | 'dockerfile'
  // The path that's missing from the cache
  missingPath: string
  // Where the dependency was discovered
  discoveredAt: string
  // Human-readable description of the gap
  gap: 'cascade-rule' | 'workflow-hash'
  // Consumer identifier (package name, workflow basename)
  consumer: string
}

type AllowlistEntry = {
  consumer: string
  gap: 'cascade-rule' | 'workflow-hash'
  missingPath: string
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
      if (
        current.missingPath &&
        current.consumer &&
        current.gap &&
        current.reason
      ) {
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
  if (
    current.missingPath &&
    current.consumer &&
    current.gap &&
    current.reason
  ) {
    entries.push(current as AllowlistEntry)
  }
  return entries
}

/**
 * Parse CASCADE_RULES out of validate-cache-versions.mts. The file is
 * hand-maintained and follows a strict shape — match
 *   'packages/some/path/': [...]
 * and
 *   'anything.json': [...]
 * patterns.
 */
function loadCascadeRuleKeys(): Set<string> {
  const content = readFileSync(CASCADE_RULES_PATH, 'utf8')
  const keys = new Set<string>()
  // Capture the single-quoted string immediately before a colon +
  // square-bracket array. Multiline / whitespace tolerant.
  const re = /'((?:packages\/|\.github\/)[^']+)'\s*:\s*(?:\[|ALL_DOWNSTREAM)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(content)) !== null) {
    keys.add(match[1]!)
  }
  return keys
}

/** Walk every Makefile and collect `include ../<pkg>/make/<file>.mk` paths. */
function collectMakefileIncludes(): Finding[] {
  const findings: Finding[] = []
  const cascadeKeys = loadCascadeRuleKeys()
  const packages = readdirSync(path.join(MONOREPO_ROOT, 'packages'), {
    withFileTypes: true,
  })
  for (const pkgEntry of packages) {
    if (!pkgEntry.isDirectory()) {
      continue
    }
    const pkgDir = path.join(MONOREPO_ROOT, 'packages', pkgEntry.name)
    let files: string[]
    try {
      files = readdirSync(pkgDir).filter(f => /^Makefile(\.|$)/.test(f))
    } catch {
      continue
    }
    for (const file of files) {
      const mkPath = path.join(pkgDir, file)
      let contents: string
      try {
        contents = readFileSync(mkPath, 'utf8')
      } catch {
        continue
      }
      const lines = contents.split(/\r?\n/)
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i]!
        const match = line.match(/^\s*include\s+\.\.\/([^/]+)\/make\//)
        if (!match) {
          continue
        }
        const dep = match[1]!
        const key = `packages/${dep}/make/`
        if (!cascadeKeys.has(key)) {
          findings.push({
            consumer: pkgEntry.name,
            discoveredAt: `packages/${pkgEntry.name}/${file}:${i + 1}`,
            gap: 'cascade-rule',
            missingPath: key,
            source: 'makefile',
          })
        }
      }
    }
  }
  return findings
}

/** Walk every .mts/.ts for cross-package imports and check cascade coverage. */
function collectTypeScriptImports(): Finding[] {
  const findings: Finding[] = []
  const cascadeKeys = loadCascadeRuleKeys()
  const importRe =
    /from\s+'(build-infra|bin-infra|curl-builder|lief-builder|stubs-builder|binject|binpress|binflate|yoga-layout-builder|node-smol-builder)\/([^']+)'/g
  const walk = (dir: string): string[] => {
    const out: string[] = []
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as Dirent[]
    } catch {
      return out
    }
    for (const entry of entries) {
      if (
        entry.name === 'node_modules' ||
        entry.name === 'build' ||
        entry.name === 'dist' ||
        entry.name === 'upstream' ||
        entry.name === 'out' ||
        entry.name === '.git' ||
        // Test directories import test-helpers (e.g. bin-infra/test)
        // which don't feed the produced binary. Flagging them would
        // force test-helper changes to bump every downstream cache,
        // which isn't a meaningful build-output dependency.
        entry.name === 'test' ||
        entry.name === 'tests' ||
        entry.name === '__tests__'
      ) {
        continue
      }
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        out.push(...walk(full))
      } else if (
        entry.isFile() &&
        (/\.m?ts$/.test(entry.name) || /\.m?js$/.test(entry.name))
      ) {
        out.push(full)
      }
    }
    return out
  }
  const files = walk(path.join(MONOREPO_ROOT, 'packages'))
  for (const file of files) {
    let contents: string
    try {
      contents = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const lines = contents.split(/\r?\n/)
    for (let i = 0; i < lines.length; i += 1) {
      // Use matchAll so multiple cross-package imports on the same line
      // are all checked. A single exec() with the /g flag returns only
      // ONE match even when the regex is global — and some lines carry
      // two or more imports (re-export barrels, minified builds, one-
      // liner `export { a } from 'pkg/a'; export { b } from 'pkg/b'`).
      // Before the fix, every import past the first on a shared line
      // slipped past the gate.
      for (const match of lines[i]!.matchAll(importRe)) {
        const pkg = match[1]!
        const rest = match[2]!
        // Take the top-level dir under the package (lib, scripts, etc.)
        const top = rest.split('/')[0]!
        const key = `packages/${pkg}/${top}/`
        // Some imports like `build-infra/wasm-synced/wasm-sync-wrapper`
        // point at a dir of interest; others like `build-infra/lib/...`
        // are already covered via `packages/<pkg>/lib/`.
        if (!cascadeKeys.has(key)) {
          const relFile = path.relative(MONOREPO_ROOT, file)
          findings.push({
            consumer: relFile.split('/')[1] || pkg,
            discoveredAt: `${relFile}:${i + 1}`,
            gap: 'cascade-rule',
            missingPath: key,
            source: 'import',
          })
        }
      }
    }
  }
  return findings
}

/**
 * Walk every Dockerfile under packages/*\/docker/ and verify each
 * `COPY <src>` path is either implicitly hashed or textually present
 * in the consuming workflow's YAML. This is the audit that caught
 * R24's root-package.json gap and R27's stubs/LIEF gap.
 */
function collectDockerfileCopies(): Finding[] {
  const findings: Finding[] = []
  const packages = readdirSync(path.join(MONOREPO_ROOT, 'packages'), {
    withFileTypes: true,
  })
  for (const pkgEntry of packages) {
    if (!pkgEntry.isDirectory()) {
      continue
    }
    const dockerDir = path.join(
      MONOREPO_ROOT,
      'packages',
      pkgEntry.name,
      'docker',
    )
    if (!existsSync(dockerDir)) {
      continue
    }
    const workflowRel = PACKAGE_TO_WORKFLOW[pkgEntry.name]
    if (!workflowRel) {
      continue
    }
    const workflowPath = path.join(MONOREPO_ROOT, workflowRel)
    if (!existsSync(workflowPath)) {
      continue
    }
    const workflowContent = readFileSync(workflowPath, 'utf8')
    let dockerFiles: string[]
    try {
      dockerFiles = readdirSync(dockerDir).filter(
        f =>
          f === 'Dockerfile' ||
          f.startsWith('Dockerfile.'),
      )
    } catch {
      continue
    }
    for (const df of dockerFiles) {
      const dfPath = path.join(dockerDir, df)
      let contents: string
      try {
        contents = readFileSync(dfPath, 'utf8')
      } catch {
        continue
      }
      const lines = contents.split(/\r?\n/)
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i]!
        if (!/^\s*COPY\s/.test(line)) {
          continue
        }
        // Strip `COPY`, `--from=X`, and split on whitespace to get src tokens
        const afterCopy = line.replace(/^\s*COPY\s+/, '')
        if (afterCopy.startsWith('--from=')) {
          continue
        }
        const tokens = afterCopy.trim().split(/\s+/)
        // Last token is the destination; everything else is a source.
        const sources = tokens.slice(0, -1)
        for (const src of sources) {
          // Skip variable interpolations / quoted anomalies — out of scope.
          if (src.includes('${') || src.includes('"') || src === '.') {
            continue
          }
          if (IMPLICITLY_HASHED.has(src)) {
            continue
          }
          // The package's own path is always covered (workflow runs
          // from within it).
          if (src.startsWith(`packages/${pkgEntry.name}/`)) {
            continue
          }
          // Workflow must reference the src path textually somewhere
          // in its cache-key composition (or setup-checkpoints which
          // has its own coverage). Also accept an ancestor-directory
          // hash — e.g. if the workflow hashes `.github/scripts/` as
          // a directory, then every file inside it is implicitly
          // covered.
          if (workflowContent.includes(src)) {
            continue
          }
          const parts = src.split('/')
          let ancestorCovered = false
          // Require depth >= 2 so we never accept a bare prefix like
          // `packages/` (which every workflow contains). At depth 1 the
          // ancestor is just "packages" — trivially present and thus
          // silently approves ANY cross-package Dockerfile dep. That
          // bypass was the shape this gate exists to catch (R18-R27
          // cache-gap class), so the gate was effectively disabled.
          for (let depth = parts.length - 1; depth >= 2; depth -= 1) {
            const ancestor = parts.slice(0, depth).join('/')
            if (
              workflowContent.includes(`${ancestor}/`) ||
              workflowContent.includes(`${ancestor} `) ||
              workflowContent.includes(`${ancestor}\n`)
            ) {
              ancestorCovered = true
              break
            }
          }
          if (ancestorCovered) {
            continue
          }
          findings.push({
            consumer: path.basename(workflowPath),
            discoveredAt: `packages/${pkgEntry.name}/docker/${df}:${i + 1}`,
            gap: 'workflow-hash',
            missingPath: src,
            source: 'dockerfile',
          })
        }
      }
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
    f.gap === 'cascade-rule'
      ? 'Missing CASCADE_RULE'
      : 'Missing workflow cache-key hash'
  logger.log('')
  logger.log(`[${label}] ${f.missingPath}`)
  logger.log(`  Discovered at: ${f.discoveredAt}`)
  logger.log(`  Consumer:      ${f.consumer}`)
  logger.log(`  Source:        ${f.source}`)
  if (opts.explain) {
    logger.log('')
    if (f.gap === 'cascade-rule') {
      logger.log(
        `  Fix: add to CASCADE_RULES in scripts/validate-cache-versions.mts`,
      )
      logger.log(
        `       with the downstream packages that should bump when this path changes.`,
      )
    } else {
      logger.log(
        `  Fix: add ${f.missingPath} hash to the cache-key composition in`,
      )
      logger.log(`       ${f.consumer} (or extend setup-checkpoints FIND_PATHS`)
      logger.log(`       if that action is used).`)
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

  if (!opts.quiet && !opts.json) {
    logger.info('Checking cross-package cascade completeness...')
  }

  const allowlist = loadAllowlist()
  const allowSet = new Set(
    allowlist.map(e => `${e.consumer}|${e.gap}|${e.missingPath}`),
  )

  const findings: Finding[] = []
  findings.push(...collectMakefileIncludes())
  findings.push(...collectTypeScriptImports())
  findings.push(...collectDockerfileCopies())

  const surviving = findings.filter(
    f => !allowSet.has(`${f.consumer}|${f.gap}|${f.missingPath}`),
  )

  // Dedup — same (consumer, gap, missingPath) may be discovered through
  // multiple files; report once but include one discoveredAt sample.
  const seen = new Set<string>()
  const deduped: Finding[] = []
  for (const f of surviving) {
    const key = `${f.consumer}|${f.gap}|${f.missingPath}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    deduped.push(f)
  }

  if (deduped.length === 0) {
    if (!opts.quiet && !opts.json) {
      // `findings.length` counts every raw match (including duplicates
      // across sibling files); it's 0 only when every dep fully
      // resolves. Report allowlist size and the number of raw matches
      // bypassed so the "all clean" case still conveys the scan ran.
      logger.success(
        `No cascade gaps found (${findings.length} raw matches, ${allowlist.length} allowlisted)`,
      )
    }
    process.exitCode = 0
    return
  }

  if (!opts.json) {
    logger.error(
      `Found ${deduped.length} cascade gap${deduped.length === 1 ? '' : 's'}:`,
    )
  }
  for (const f of deduped) {
    printFinding(f, opts)
  }
  if (!opts.json) {
    logger.log('')
    logger.log('What to do:')
    logger.log(
      '  1. If the gap is real: add to CASCADE_RULES or the workflow',
    )
    logger.log(
      '     cache-key composition (see --explain for placement hints).',
    )
    logger.log(
      '  2. If the dep is genuinely not build-affecting: add to',
    )
    logger.log(
      '     .github/cascade-completeness-allowlist.yml with a reason.',
    )
    logger.log('  3. Run with --explain for fix guidance per finding.')
  }
  process.exitCode = 1
}

main().catch((e: unknown) => {
  logger.error(errorMessage(e))
  process.exitCode = 1
})
