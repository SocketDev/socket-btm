/**
 * Asserts the link-flag bundle stays in lockstep with the gypi.
 *
 * Per fleet rule "1 path, 1 reference" — the canonical wrap-symbol list
 * lives in `lib/link-flags.mts`. The gypi mirrors that list; this test
 * fails the moment the two drift.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  GLIBC_SHIMS_LINK_FLAGS,
  GLIBC_SHIMS_WRAP_SYMBOLS,
} from '../lib/link-flags.mts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.resolve(HERE, '..')

describe('GLIBC_SHIMS_WRAP_SYMBOLS', () => {
  it('is alphabetically sorted (stable diffs)', () => {
    const sorted = [...GLIBC_SHIMS_WRAP_SYMBOLS].toSorted()
    expect(GLIBC_SHIMS_WRAP_SYMBOLS).toEqual(sorted)
  })

  it('expands to one -Wl,--wrap= entry per symbol', () => {
    expect(GLIBC_SHIMS_LINK_FLAGS.length).toBe(GLIBC_SHIMS_WRAP_SYMBOLS.length)
    for (let i = 0; i < GLIBC_SHIMS_WRAP_SYMBOLS.length; i += 1) {
      expect(GLIBC_SHIMS_LINK_FLAGS[i]).toBe(
        `-Wl,--wrap=${GLIBC_SHIMS_WRAP_SYMBOLS[i]}`,
      )
    }
  })

  it('matches the gypi --wrap entries', () => {
    const gypi = readFileSync(
      path.join(PACKAGE_ROOT, 'gyp', 'glibc-shims-infra.gypi'),
      'utf8',
    )
    // Every wrap symbol from lib/link-flags MUST appear in the gypi
    // (the gypi may list them in either the top-level ldflags or
    // direct_dependent_settings.ldflags — both blocks must include
    // each symbol).
    for (const symbol of GLIBC_SHIMS_WRAP_SYMBOLS) {
      const occurrences = (
        gypi.match(new RegExp(`-Wl,--wrap=${symbol}\\b`, 'g')) ?? []
      ).length
      expect(
        occurrences,
        `gypi missing --wrap=${symbol}`,
      ).toBeGreaterThanOrEqual(2)
    }
  })

  it('matches the per-shim source files under src/socketsecurity/glibc-2-17-compat/shims/', () => {
    const shimsDir = path.join(
      PACKAGE_ROOT,
      'src',
      'socketsecurity',
      'glibc-2-17-compat',
      'shims',
    )
    // Convert wrap symbols ('__cxa_thread_atexit_impl' → 'cxa_thread_atexit_impl')
    // to expected filenames. The double-underscore prefix is dropped for
    // filesystem clarity.
    const expectedShimFiles = GLIBC_SHIMS_WRAP_SYMBOLS.map(s =>
      s.replace(/^__/, ''),
    ).map(s => `${s}.c`)
    for (const filename of expectedShimFiles) {
      const shimPath = path.join(shimsDir, filename)
      expect(
        () => readFileSync(shimPath, 'utf8'),
        `shim source missing: ${filename}`,
      ).not.toThrow()
    }
  })
})
