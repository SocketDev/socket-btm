/**
 * @file Asserts C++ additions files that include Node.js internal headers
 *   open with the Object::GetIsolate() deprecation suppression pragma pair
 *   (`#pragma GCC diagnostic push` + `ignored "-Wdeprecated-declarations"`)
 *   — Node internals still call the deprecated V8 API, and without the
 *   pragma every new additions file breaks -Werror builds against newer V8.
 *   REPORT-ONLY until the backlog clears; `--strict` exits non-zero on
 *   findings. Runs under `check --all` via the scripts/repo/check/ seam.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

const logger = getDefaultLogger()
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
)

// Quoted includes that resolve to Node core internals (the headers that pull
// the deprecated Object::GetIsolate() call chain).
const NODE_INTERNAL_INCLUDE_RE =
  /^#include\s+"(base_object(-inl)?\.h|env(-inl)?\.h|node(_[a-z_]+)?\.h|util(-inl)?\.h|v8\.h)"/m

const PRAGMA_RE = /#pragma GCC diagnostic ignored "-Wdeprecated-declarations"/

export function findPragmalessFiles(repoRoot: string): string[] {
  const ls = spawnSync(
    'git',
    ['-C', repoRoot, 'ls-files', 'packages/*/additions/**/src/**'],
    { stdio: 'pipe', stdioString: true },
  )
  if (ls.status !== 0) {
    return []
  }
  const findings: string[] = []
  const files = String(ls.stdout)
    .split('\n')
    .filter(f => f.endsWith('.cc') || f.endsWith('.h'))
  const sortedFiles = files.toSorted()
  for (let i = 0, { length } = sortedFiles; i < length; i += 1) {
    const rel = sortedFiles[i]!
    const text = readFileSync(path.join(repoRoot, rel), 'utf8')
    if (NODE_INTERNAL_INCLUDE_RE.test(text) && !PRAGMA_RE.test(text)) {
      findings.push(rel)
    }
  }
  return findings
}

export function main(): void {
  const strict = process.argv.includes('--strict')
  const findings = findPragmalessFiles(REPO_ROOT)
  if (findings.length === 0) {
    logger.success(
      'cpp-additions-have-deprecation-pragma: every additions file including Node internals carries the suppression pragma',
    )
    return
  }
  logger.warn(
    `cpp-additions-have-deprecation-pragma: ${findings.length} file(s) include Node internals without the deprecation pragma`,
  )
  logger.group()
  for (const rel of findings) {
    logger.warn(rel)
  }
  logger.warn(
    'Where: file head | Saw: Node-internal #include, no pragma | Fix: open the file with the 3-line suppression block from stream_chunk_pool.cc:1-3',
  )
  logger.groupEnd()
  if (strict) {
    process.exitCode = 1
  }
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  main()
}
