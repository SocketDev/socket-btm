/**
 * @file Test262 harness loader, script composer, and corpus
 *   walker.
 *   Loads on-disk harness files (assert.js, sta.js, etc.) with a
 *   memo cache, composes the script that's actually fed to the
 *   binary, and walks the test-corpus tree yielding .js files.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { TEST262_HARNESS_DIR } from '../../../lib/paths.mts'

import type { TestCase } from './types.mts'

const harnessCache = new Map<string, string>()

export function loadHarness(name: string): string {
  const filename = name.endsWith('.js') ? name : `${name}.js`
  const cached = harnessCache.get(filename)
  if (cached !== undefined) {
    return cached
  }
  const filePath = path.join(TEST262_HARNESS_DIR, filename)
  const content = readFileSync(filePath, 'utf8')
  harnessCache.set(filename, content)
  return content
}

// Mandatory harness files per
// https://github.com/tc39/test262/blob/main/INTERPRETING.md
const DEFAULT_INCLUDES = ['assert.js', 'sta.js']

// oxlint-disable-next-line socket/sort-source-methods -- pipeline ordering (loader → composer → walker); the composer depends on the loader so reading it top-down requires this order.
export function composeScript(
  test: TestCase,
  scenario: 'strict' | 'sloppy',
): string {
  const parts: string[] = []
  if (scenario === 'strict') {
    parts.push("'use strict';")
  }
  if (!test.attrs.raw) {
    for (let i = 0, { length } = DEFAULT_INCLUDES; i < length; i += 1) {
      const name = DEFAULT_INCLUDES[i]
      parts.push(loadHarness(name))
    }
    // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
    for (const include of test.attrs.includes ?? []) {
      parts.push(loadHarness(include))
    }
  }
  parts.push(test.source)
  return parts.join('\n')
}

export function* walkTests(rootDir: string): Generator<string> {
  if (!existsSync(rootDir)) {
    return
  }
  const entries = readdirSync(rootDir, { withFileTypes: true })
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]
    const fullPath = path.join(rootDir, entry.name)
    if (entry.isDirectory()) {
      yield* walkTests(fullPath)
    } else if (entry.isFile()) {
      // Skip include-only fixtures.
      if (!entry.name.endsWith('.js') || entry.name.endsWith('_FIXTURE.js')) {
        continue
      }
      yield fullPath
    }
  }
}
