/*
 * @file Unit coverage for the Node Smol Rust-extraction inventory assertion.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { expect, test } from 'vitest'

import { findInventoryDrift } from '../../scripts/repo/check/node-smol-rust-extraction-is-inventoried.mts'
import { makeRepo } from './repo-checks-helpers.mts'

function writeManifest(
  root: string,
  entries: string[],
  removalStatus = 'planned',
): void {
  mkdirSync(path.join(root, '.config', 'repo'), { recursive: true })
  writeFileSync(
    path.join(root, '.config', 'repo', 'node-smol-rust-extraction.json'),
    JSON.stringify({
      entries: entries.map(sourcePath => ({ removalStatus, sourcePath })),
      schemaVersion: 1,
    }),
  )
}

test('findInventoryDrift: a matching package inventory passes', () => {
  const root = makeRepo()
  mkdirSync(path.join(root, 'packages', 'node-smol-builder'), {
    recursive: true,
  })
  writeManifest(root, ['packages/node-smol-builder'])
  expect(findInventoryDrift(root)).toEqual([])
})

test('findInventoryDrift: reports missing, unknown, and duplicate entries', () => {
  const root = makeRepo()
  mkdirSync(path.join(root, 'packages', 'node-smol-builder'), {
    recursive: true,
  })
  writeManifest(root, ['packages/decmpfs', 'packages/decmpfs'])
  expect(findInventoryDrift(root)).toEqual([
    'duplicate entry: packages/decmpfs',
    'missing entry: packages/node-smol-builder',
    'unknown entry: packages/decmpfs',
  ])
})

test('findInventoryDrift: absent packages/ requires every entry removed', () => {
  const root = makeRepo()
  writeManifest(root, ['packages/node-smol-builder'])
  expect(findInventoryDrift(root)).toEqual([
    'entry packages/node-smol-builder says removalStatus "planned" but its source directory no longer exists — mark it removed',
  ])
})

test('findInventoryDrift: absent packages/ passes once every entry is removed', () => {
  const root = makeRepo()
  writeManifest(root, ['packages/node-smol-builder'], 'removed')
  expect(findInventoryDrift(root)).toEqual([])
})
