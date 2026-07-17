/**
 * @file Unit coverage for the checkpoint-chain consumer assertion.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { expect, test } from 'vitest'

import { findChainlessConsumers } from '../../scripts/repo/check/checkpoint-consumers-own-a-chain.mts'
import { makeRepo } from './repo-checks-helpers.mts'

test('findChainlessConsumers: no packages dir → empty', () => {
  expect(findChainlessConsumers(makeRepo())).toEqual([])
})

test('findChainlessConsumers: consumer without a chain file is flagged; owner is not', () => {
  const root = makeRepo()
  const makePackage = (pkg: string, files: Record<string, string>) => {
    const dir = path.join(root, 'packages', pkg, 'scripts')
    mkdirSync(dir, { recursive: true })
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(path.join(dir, name), body)
    }
  }
  makePackage('flagged-builder', {
    'build.mts':
      "import { getCheckpointData } from 'build-infra/lib/checkpoint-manager'\n",
  })
  makePackage('good-builder', {
    'build.mts':
      "import { getCheckpointData } from 'build-infra/lib/checkpoint-manager'\n",
    'get-checkpoint-chain.mts': 'export const CHAIN = []\n',
  })
  makePackage('uninvolved', { 'build.mts': 'export {}\n' })
  expect(findChainlessConsumers(root)).toEqual(['flagged-builder'])
})
