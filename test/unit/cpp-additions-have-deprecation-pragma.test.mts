/**
 * @file Unit coverage for the C++ deprecation-pragma assertion.
 */

import path from 'node:path'

import { expect, test } from 'vitest'

import { findPragmalessFiles } from '../../scripts/repo/check/cpp-additions-have-deprecation-pragma.mts'
import { makeRepo } from './repo-checks-helpers.mts'

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
