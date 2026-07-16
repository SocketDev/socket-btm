/**
 * @file Unit coverage for the scripts/repo/check/ assertions: the
 *   checkpoint-chain consumer scan and the C++ deprecation-pragma scan.
 *   Fixture repos are built in tmp dirs; the pragma scan also gets one
 *   run against the real repo to pin the report-only contract (exit-free,
 *   findings listed).
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { expect, test } from 'vitest'

import { findChainlessConsumers } from '../../scripts/repo/check/checkpoint-consumers-own-a-chain.mts'
import { findPragmalessFiles } from '../../scripts/repo/check/cpp-additions-have-deprecation-pragma.mts'

function makeRepo(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'btm-repo-checks-'))
}

test('findChainlessConsumers: no packages dir → empty', () => {
  expect(findChainlessConsumers(makeRepo())).toEqual([])
})

test('findChainlessConsumers: consumer without a chain file is flagged; owner is not', () => {
  const root = makeRepo()
  const mk = (pkg: string, files: Record<string, string>) => {
    const dir = path.join(root, 'packages', pkg, 'scripts')
    mkdirSync(dir, { recursive: true })
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(path.join(dir, name), body)
    }
  }
  mk('flagged-builder', {
    'build.mts':
      "import { getCheckpointData } from 'build-infra/lib/checkpoint-manager'\n",
  })
  mk('good-builder', {
    'build.mts':
      "import { getCheckpointData } from 'build-infra/lib/checkpoint-manager'\n",
    'get-checkpoint-chain.mts': 'export const CHAIN = []\n',
  })
  mk('uninvolved', { 'build.mts': 'export {}\n' })
  expect(findChainlessConsumers(root)).toEqual(['flagged-builder'])
})

test('findPragmalessFiles: non-git dir → empty (ls-files fails closed)', () => {
  expect(findPragmalessFiles(makeRepo())).toEqual([])
})

test('findPragmalessFiles: real repo scan is deterministic and pragma-carrying files are absent', () => {
  const repoRoot = path.resolve(import.meta.dirname, '..', '..')
  const findings = findPragmalessFiles(repoRoot)
  // The known-good exemplar carries the pragma and must never be flagged.
  expect(findings).not.toContain(
    'packages/node-smol-builder/additions/source-patched/src/socketsecurity/webstreams/stream_chunk_pool.cc',
  )
  // Determinism: two scans agree.
  expect(findPragmalessFiles(repoRoot)).toEqual(findings)
})
