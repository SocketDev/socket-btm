/**
 * @file Collectors for `check-cascade-completeness.mts`. Each `collect*`
 *   function walks one source of cross-package build dependencies
 *   (Dockerfile `COPY`, Makefile `include`, TypeScript cross-package
 *   imports) and reports paths that exist on disk, are referenced by a
 *   builder, and have no matching cascade rule or workflow hash. Split out
 *   of the main checker so the orchestration file (arg parsing, allowlist,
 *   report printing) stays under the file-size soft cap.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import path from 'node:path'

import { fileURLToPath } from 'node:url'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
export const MONOREPO_ROOT = path.join(__dirname, '..')
const CASCADE_RULES_PATH = path.join(
  MONOREPO_ROOT,
  'scripts',
  'validate-cache-versions.mts',
)

// Map each package directory name to the workflow file that builds it.
// Used when we need to check if a Dockerfile-COPY path is hashed in
// the workflow's cache key.
const PACKAGE_TO_WORKFLOW: Record<string, string> = {
  'bin-stub-builder': '.github/workflows/stubs.yml',
  binflate: '.github/workflows/binsuite.yml',
  binject: '.github/workflows/binsuite.yml',
  binpress: '.github/workflows/binsuite.yml',
  'curl-builder': '.github/workflows/curl.yml',
  'lief-builder': '.github/workflows/lief.yml',
  models: '.github/workflows/models.yml',
  'node-smol-builder': '.github/workflows/node-smol.yml',
  'onnxruntime-builder': '.github/workflows/onnxruntime.yml',
  'opentui-builder': '.github/workflows/opentui.yml',
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

export type Finding = {
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

/**
 * Parse CASCADE_RULES out of validate-cache-versions.mts. The file is
 * hand-maintained and follows a strict shape — match 'packages/some/path/':
 * [...] and 'anything.json': [...] patterns.
 */
export function loadCascadeRuleKeys(): Set<string> {
  const content = readFileSync(CASCADE_RULES_PATH, 'utf8')
  const keys = new Set<string>()
  // Capture the single-quoted string immediately before a colon +
  // square-bracket array. Multiline / whitespace tolerant.
  const re = /'((?:\.github\/|packages\/)[^']+)'\s*:\s*(?:ALL_DOWNSTREAM|\[)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(content)) !== null) {
    keys.add(match[1]!)
  }
  return keys
}

/**
 * Walk every Dockerfile under `packages/*`/`docker/` and verify each `COPY
 * <src>` path is either implicitly hashed or textually present in the consuming
 * workflow's YAML. This is the audit that caught R24's root-package.json gap
 * and R27's stubs/LIEF gap.
 */
export function collectDockerfileCopies(): Finding[] {
  const findings: Finding[] = []
  const packages = readdirSync(path.join(MONOREPO_ROOT, 'packages'), {
    withFileTypes: true,
  })
  for (
    let pkgIndex = 0, { length: pkgCount } = packages;
    pkgIndex < pkgCount;
    pkgIndex += 1
  ) {
    const pkgEntry = packages[pkgIndex]!
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
        f => f === 'Dockerfile' || f.startsWith('Dockerfile.'),
      )
    } catch {
      continue
    }
    for (
      let fileIndex = 0, { length: fileCount } = dockerFiles;
      fileIndex < fileCount;
      fileIndex += 1
    ) {
      const df = dockerFiles[fileIndex]!
      const dfPath = path.join(dockerDir, df)
      let contents: string
      try {
        contents = readFileSync(dfPath, 'utf8')
      } catch {
        continue
      }
      const lines = contents.split(/\r?\n/)
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex]!
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
        for (
          let srcIndex = 0, { length: srcCount } = sources;
          srcIndex < srcCount;
          srcIndex += 1
        ) {
          const src = sources[srcIndex]!
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
          const parts = normalizePath(src).split('/')
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
            discoveredAt: `packages/${pkgEntry.name}/docker/${df}:${lineIndex + 1}`,
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

/**
 * Walk every Makefile and collect `include ../<pkg>/make/<file>.mk` paths.
 */
export function collectMakefileIncludes(): Finding[] {
  const findings: Finding[] = []
  const cascadeKeys = loadCascadeRuleKeys()
  const packages = readdirSync(path.join(MONOREPO_ROOT, 'packages'), {
    withFileTypes: true,
  })
  for (
    let pkgIndex = 0, { length: pkgCount } = packages;
    pkgIndex < pkgCount;
    pkgIndex += 1
  ) {
    const pkgEntry = packages[pkgIndex]!
    if (!pkgEntry.isDirectory()) {
      continue
    }
    const pkgDir = path.join(MONOREPO_ROOT, 'packages', pkgEntry.name)
    let files: string[]
    try {
      files = readdirSync(pkgDir).filter(f => /^Makefile($|\.)/.test(f))
    } catch {
      continue
    }
    for (
      let fileIndex = 0, { length: fileCount } = files;
      fileIndex < fileCount;
      fileIndex += 1
    ) {
      const file = files[fileIndex]!
      const mkPath = path.join(pkgDir, file)
      let contents: string
      try {
        contents = readFileSync(mkPath, 'utf8')
      } catch {
        continue
      }
      const lines = contents.split(/\r?\n/)
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex]!
        const match = line.match(/^\s*include\s+\.\.\/([^/]+)\/make\//)
        if (!match) {
          continue
        }
        const dep = match[1]!
        const key = `packages/${dep}/make/`
        if (!cascadeKeys.has(key)) {
          findings.push({
            consumer: pkgEntry.name,
            discoveredAt: `packages/${pkgEntry.name}/${file}:${lineIndex + 1}`,
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

// Test directories (`test`, `tests`, `__tests__`) import test-helpers
// (e.g. bin-infra/test) which don't feed the produced binary. Flagging
// them would force test-helper changes to bump every downstream cache,
// which isn't a meaningful build-output dependency.
const COLLECT_TS_IMPORTS_SKIP_DIRS = new Set([
  '__tests__',
  '.git',
  'build',
  'dist',
  'node_modules',
  'out',
  'test',
  'tests',
  'upstream',
])

/**
 * Walk every .mts/.ts for cross-package imports and check cascade coverage.
 */
export function collectTypeScriptImports(): Finding[] {
  const findings: Finding[] = []
  const cascadeKeys = loadCascadeRuleKeys()
  // Matches `from '<builder-package>/<subpath>'`: builder package name
  // (group 1, one of the known cross-package builders) then the
  // imported subpath (group 2).
  const importRe =
    /from\s+'(bin-infra|bin-stub-builder|binflate|binject|binpress|build-infra|curl-builder|lief-builder|node-smol-builder|yoga-layout-builder)\/([^']+)'/g
  const walk = (dir: string): string[] => {
    const out: string[] = []
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as Dirent[]
    } catch {
      return out
    }
    for (
      let entryIndex = 0, { length: entryCount } = entries;
      entryIndex < entryCount;
      entryIndex += 1
    ) {
      const entry = entries[entryIndex]!
      if (COLLECT_TS_IMPORTS_SKIP_DIRS.has(entry.name)) {
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
  for (
    let fileIndex = 0, { length: fileCount } = files;
    fileIndex < fileCount;
    fileIndex += 1
  ) {
    const file = files[fileIndex]!
    let contents: string
    try {
      contents = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const lines = contents.split(/\r?\n/)
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      // Use matchAll so multiple cross-package imports on the same line
      // are all checked. A single exec() with the /g flag returns only
      // ONE match even when the regex is global — and some lines carry
      // two or more imports (re-export barrels, minified builds, one-
      // liner `export { a } from 'pkg/a'; export { b } from 'pkg/b'`).
      // Before the fix, every import past the first on a shared line
      // slipped past the gate.
      // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
      for (const match of lines[lineIndex]!.matchAll(importRe)) {
        const pkg = match[1]!
        const rest = match[2]!
        // Take the top-level dir under the package (lib, scripts, etc.)
        const top = rest.split('/')[0]!
        const key = `packages/${pkg}/${top}/`
        // Some imports like `build-infra/wasm-synced/wasm-sync-wrapper`
        // point at a dir of interest; others like `build-infra/lib/...`
        // are already covered via `packages/<pkg>/lib/`.
        if (!cascadeKeys.has(key)) {
          const relFile = normalizePath(path.relative(MONOREPO_ROOT, file))
          findings.push({
            consumer: relFile.split('/')[1] || pkg,
            discoveredAt: `${relFile}:${lineIndex + 1}`,
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
